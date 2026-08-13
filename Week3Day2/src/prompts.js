/**
 * Builds a grounded prompt that instructs the LLM to answer only from the
 * supplied context, and to cite sources / admit when it doesn't know.
 *
 * @param {string} context Combined retrieved chunks (see buildContext()).
 * @param {string} question The user's question.
 * @returns {string}
 */
export function buildGroundedPrompt(context, question) {
  return `You are a project documentation assistant.

Answer the question using ONLY the information in the supplied context below.
Do not use outside knowledge and do not invent missing information.

If the context does not contain enough information to answer confidently,
respond exactly with: "The available project documentation does not specify [topic]."
(replace [topic] with a short description of what's missing) — do not guess.

Some of the context sections below may be irrelevant to the question — ignore
those and do not mention them. When you do answer, end your response on a
new line starting with "Source:" followed by a comma-separated list of only
the source file names that directly contain the fact(s) in your answer.

Context:
${context}

Question:
${question}

Answer:`;
}
