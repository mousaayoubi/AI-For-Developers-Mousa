/**
 * Prints one line per tool call to the console as the agent runs, in the
 * shape described in the exercise (step, tool, arguments, status). The
 * agent loop is the source of truth for the log array returned to the
 * caller - this module is just the console side-effect.
 */
export function logToolCall(entry) {
  const { step, tool, arguments: args, status, error } = entry;
  const suffix = error ? ` (${error})` : "";
  console.log(`[agent] step ${step}: ${tool}(${JSON.stringify(args)}) -> ${status}${suffix}`);
}
