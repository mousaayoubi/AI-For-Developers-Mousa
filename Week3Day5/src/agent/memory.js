/**
 * Short-term agent memory (Part 10). Wraps the running chat `messages`
 * array plus deterministic evidence tracking (what was actually searched
 * / read / called), so the agent loop doesn't need to re-derive that from
 * message history, and so the final answer can be validated against real
 * tool results rather than the model's own claims (Part 15).
 */
export function createMemory(systemPrompt, goal) {
  return {
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: goal },
    ],
    previousCalls: new Set(),
    filesSearched: new Set(),
    filesRead: new Set(),
    toolsUsed: [],
    steps: 0,
  };
}

/** True if this exact tool+args call has already been made this run. */
export function isDuplicateCall(memory, name, args) {
  return memory.previousCalls.has(callKey(name, args));
}

/** Records a completed tool call into memory (Part 10 / Part 15 evidence). */
export function recordToolCall(memory, { name, args, result, status }) {
  memory.previousCalls.add(callKey(name, args));
  memory.toolsUsed.push(name);

  if (status !== "success") return;

  if (name === "search_project_files" && Array.isArray(result)) {
    for (const r of result) if (r?.file) memory.filesSearched.add(r.file);
  }
  if (name === "list_project_files" && Array.isArray(result)) {
    for (const f of result) memory.filesSearched.add(f);
  }
  if (name === "read_project_file" && result?.file) {
    memory.filesRead.add(result.file);
  }
}

function callKey(name, args) {
  return `${name}:${JSON.stringify(args)}`;
}
