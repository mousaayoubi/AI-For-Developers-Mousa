/**
 * Builds the user-message prompt for a single bug report.
 * Reusable: called by the server for every /api/analyze request.
 */
export function buildBugAnalysisPrompt({ expected, actual, error, reproduction, question } = {}) {
  const lines = [
    'Analyse the following bug report and produce a structured diagnosis.',
    '',
    `Expected behaviour:\n${clean(expected)}`,
    '',
    `Actual behaviour:\n${clean(actual)}`,
    '',
    `Error message:\n${clean(error)}`,
    '',
    `Reproduction steps:\n${clean(reproduction)}`,
  ];

  if (question && question.trim()) {
    lines.push('', `Additional question from the reporter:\n${question.trim()}`);
  }

  lines.push(
    '',
    'If any field above is "(not provided)" or too vague to diagnose, treat that as missing information: ' +
      'name what is missing in possibleCauses/nextStep rather than inventing details.'
  );

  return lines.join('\n');
}

/** Second-phase instruction that asks the model to emit only the final JSON. */
export const structuredOutputInstruction =
  'Based on the analysis above, respond with ONLY a JSON object matching the required schema ' +
  '(summary, severity, possibleCauses, nextStep). No prose, no markdown, no code fences.';

function clean(value) {
  const trimmed = (value || '').trim();
  return trimmed || '(not provided)';
}
