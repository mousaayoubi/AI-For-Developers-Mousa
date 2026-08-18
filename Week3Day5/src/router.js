/**
 * Request router (Part 3). Classifies a question into one of three routes
 * and maps each to its workflow:
 *
 *   general       -> Direct LLM
 *   documentation -> RAG
 *   repository    -> Agent
 *
 * Classification is a structured LLM call constrained to a fixed JSON
 * shape ({ "route": "..." }). JavaScript then validates the result against
 * the allowed values before anything downstream executes - an
 * unrecognised or malformed route is never trusted, it falls back to a
 * keyword heuristic and, failing that, "general".
 */
import { chatJSON, InvalidResponseError } from "./ollama.js";

export const ROUTES = ["general", "documentation", "repository"];

const CLASSIFIER_PROMPT = `You are a request router for an AI engineering assistant. Classify the
user's question into exactly one route:

- "general": a general engineering/CS knowledge question that needs no
  project-specific information (e.g. "What does HTTP 401 mean?", "What is JWT?").
- "documentation": a question about how THIS project is built, tested, or
  secured, answerable from project documentation (e.g. "What testing
  framework does this project use?", "What does our security guide say
  about JWT?").
- "repository": a question that requires actually inspecting THIS
  project's source code to answer (e.g. "Find where authentication is
  implemented", "Which file validates JWT tokens?", "Which tests cover
  authentication?").

The route names describe a workflow, not a keyword to match in the
question. A question that merely uses the words "project" or "repository"
(e.g. "Who created this repository?", "Which AWS region is this project
deployed in?") is about project metadata, not source code - route those to
"documentation" unless they clearly ask you to inspect code or files.

Watch for this specific confusion: a question asking WHICH SPECIFIC test
file(s), function(s), or piece of code cover/test/exercise a feature
(e.g. "Which tests cover authentication?", "What tests exist for the
login flow?") is a "repository" question - it requires opening the actual
test files, and the general testing-policy documentation ("what framework
is used", "what must pass before merging") does not answer it. Only route
to "documentation" when the question is about testing process, tools, or
policy in general, not about what covers one specific feature.

Reply with ONLY a JSON object of the exact shape {"route": "general"} or
{"route": "documentation"} or {"route": "repository"}. No other text.`;

/**
 * Strong, deterministic signal that a question is trying to read a
 * specific file (by path or extension) - e.g. "Read ../../../.env" or
 * "read_project_file(.env)". These always route to the agent so the real
 * guardrail (validateFilePath) gets a chance to reject it, instead of
 * risking a route where no filesystem check ever runs (Part 14).
 */
function looksLikeFileAccessRequest(question) {
  return /\.(env|js|ts|json|md|pem|key)\b/i.test(question) || question.includes("../") || question.includes("..\\");
}

/**
 * Strong, deterministic signal that a question asks which specific test(s)
 * cover/test/exercise a feature - e.g. "Which tests cover authentication?".
 * Answering this requires opening actual test files; the general testing
 * policy documentation (framework, CI rules) does not answer it, and the
 * classifier LLM was observed reliably misrouting this phrasing to
 * "documentation" purely because it mentions "tests" (matching the topic
 * of testing.md by word association, not by what the question needs).
 */
function looksLikeTestCoverageQuestion(question) {
  return /\b(which|what)\s+tests?\b.{0,40}\b(cover|covers|covering|test|tests|testing|exercise|exercises)\b/i.test(
    question
  );
}

/**
 * Cheap keyword-based first pass / fallback, used when the LLM's answer
 * is missing, malformed, or not one of the three allowed values.
 */
function ruleBasedRoute(question) {
  const q = question.toLowerCase();

  if (looksLikeFileAccessRequest(question)) return "repository";
  if (looksLikeTestCoverageQuestion(question)) return "repository";

  const repoHints = [
    "find where",
    "which file",
    "implement",
    "implemented",
    "how does the code",
    "explain how",
    "in the code",
    "the codebase",
    "source code",
    "validates",
  ];
  const docHints = [
    "our project",
    "this project",
    "the project",
    "our security",
    "our testing",
    "documentation",
    "readme",
    "does this project",
    "does our",
  ];

  if (repoHints.some((h) => q.includes(h))) return "repository";
  if (docHints.some((h) => q.includes(h))) return "documentation";
  return null;
}

/**
 * Classifies a question into a route.
 * @param {string} question
 * @param {object} [options] { metrics }
 * @returns {Promise<{ route: string, method: "llm"|"fallback" }>}
 */
export async function classifyRoute(question, options = {}) {
  // Deterministic override: never let an LLM classification mistake route
  // a file-access attempt away from the agent, where the real guardrail
  // (validateFilePath) actually runs (Part 14).
  if (looksLikeFileAccessRequest(question)) {
    return { route: "repository", method: "rule" };
  }
  // Deterministic override: "which tests cover X" was observed reliably
  // misrouted to "documentation" by the classifier LLM (it matches the
  // topic of testing.md by word association, not by what's needed to
  // actually answer) - force it to the agent, which can open the real
  // test files.
  if (looksLikeTestCoverageQuestion(question)) {
    return { route: "repository", method: "rule" };
  }

  const fallback = ruleBasedRoute(question);

  try {
    const parsed = await chatJSON(
      [
        { role: "system", content: CLASSIFIER_PROMPT },
        { role: "user", content: question },
      ],
      options
    );

    if (parsed && ROUTES.includes(parsed.route)) {
      return { route: parsed.route, method: "llm" };
    }
    // Structured output came back but wasn't one of the allowed values -
    // don't trust it; use the rule-based hint or default to general.
    return { route: fallback ?? "general", method: "fallback" };
  } catch (err) {
    if (!(err instanceof InvalidResponseError)) throw err;
    // Model timeout/unavailable bubbles up as a different error type and
    // is handled by the caller; invalid structured output degrades to the
    // rule-based route instead of failing the whole request.
    return { route: fallback ?? "general", method: "fallback" };
  }
}
