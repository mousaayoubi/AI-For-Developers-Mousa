import { systemPrompt } from '../prompts/systemPrompt.js';
import { structuredOutputInstruction } from '../prompts/bugAnalysisPrompt.js';
import { getProjectInfo, projectInfoToolDefinition } from '../tools/projectInfo.js';

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434/api/chat';
const MODEL = process.env.OLLAMA_MODEL || 'llama3.1';
const MAX_TOOL_ROUNDS = 4;

export class OllamaUnavailableError extends Error {}
export class ModelUnavailableError extends Error {}
export class InvalidResponseError extends Error {}

const VALID_SEVERITIES = ['low', 'medium', 'high', 'critical'];

/** JSON schema handed to Ollama's structured-output "format" parameter. */
const responseSchema = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    severity: { type: 'string', enum: VALID_SEVERITIES },
    possibleCauses: { type: 'array', items: { type: 'string' } },
    nextStep: { type: 'string' },
  },
  required: ['summary', 'severity', 'possibleCauses', 'nextStep'],
};

async function callOllama(messages, { format, tools } = {}) {
  let response;
  try {
    response = await fetch(OLLAMA_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        messages,
        stream: false,
        ...(format ? { format } : {}),
        ...(tools ? { tools } : {}),
      }),
    });
  } catch (err) {
    // fetch throws (ECONNREFUSED etc.) when Ollama isn't running at all.
    throw new OllamaUnavailableError(
      `Could not reach Ollama at ${OLLAMA_URL}. Is "ollama serve" running? (${err.message})`
    );
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    if (response.status === 404) {
      throw new ModelUnavailableError(
        `Model "${MODEL}" is not available. Run "ollama pull ${MODEL}" first. ${body}`
      );
    }
    throw new ModelUnavailableError(`Ollama returned HTTP ${response.status}: ${body}`);
  }

  let data;
  try {
    data = await response.json();
  } catch (err) {
    throw new InvalidResponseError(`Ollama response was not valid JSON: ${err.message}`);
  }

  if (!data?.message) {
    throw new InvalidResponseError('Ollama response was missing a "message" field.');
  }

  return data.message;
}

function parseJsonLoose(text) {
  try {
    return JSON.parse(text);
  } catch {
    // Some models wrap JSON in prose/code fences despite instructions; try to salvage it.
    const match = String(text || '').match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        // fall through to the error below
      }
    }
    throw new InvalidResponseError('Could not parse JSON out of the model response.');
  }
}

export function validateAnalysis(parsed) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new InvalidResponseError('Model response was not a JSON object.');
  }

  const { summary, severity, possibleCauses, nextStep } = parsed;
  const problems = [];

  if (typeof summary !== 'string' || !summary.trim()) {
    problems.push('summary must be a non-empty string');
  }
  if (!VALID_SEVERITIES.includes(severity)) {
    problems.push(`severity must be one of ${VALID_SEVERITIES.join(', ')}`);
  }
  if (!Array.isArray(possibleCauses) || possibleCauses.some((c) => typeof c !== 'string')) {
    problems.push('possibleCauses must be an array of strings');
  }
  if (typeof nextStep !== 'string' || !nextStep.trim()) {
    problems.push('nextStep must be a non-empty string');
  }

  if (problems.length > 0) {
    throw new InvalidResponseError(`Model response failed validation: ${problems.join('; ')}`);
  }

  return { summary, severity, possibleCauses, nextStep };
}

/**
 * Runs the full analysis: system + user messages, a tool-calling loop for
 * get_project_info, and a final structured-JSON call once the model is
 * ready to answer.
 */
export async function analyzeBugReport(userPrompt) {
  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];

  const trace = [];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    const message = await callOllama(messages, { tools: [projectInfoToolDefinition] });

    if (message.tool_calls && message.tool_calls.length > 0) {
      messages.push({ role: 'assistant', content: message.content || '', tool_calls: message.tool_calls });

      for (const call of message.tool_calls) {
        const name = call.function?.name;
        let args = call.function?.arguments;
        if (typeof args === 'string') {
          try {
            args = JSON.parse(args);
          } catch {
            args = {};
          }
        }

        const result = name === 'get_project_info' ? getProjectInfo(args?.section) : `Unknown tool "${name}"`;

        trace.push({ tool: name, args, result });
        messages.push({ role: 'tool', name, content: String(result) });
      }

      continue; // let the model see the tool results and respond again
    }

    // No tool call: the model is ready. Ask it to finalize as strict JSON.
    messages.push({ role: 'assistant', content: message.content || '' });
    messages.push({ role: 'user', content: structuredOutputInstruction });

    const finalMessage = await callOllama(messages, { format: responseSchema });
    const parsed = parseJsonLoose(finalMessage.content);
    const validated = validateAnalysis(parsed);
    return { result: validated, trace };
  }

  throw new InvalidResponseError('The model kept calling tools without producing a final answer.');
}
