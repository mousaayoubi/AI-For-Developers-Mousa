const form = document.getElementById("goal-form");
const goalInput = document.getElementById("goal-input");
const submitBtn = document.getElementById("submit-btn");
const clearBtn = document.getElementById("clear-btn");
const statusEl = document.getElementById("status");
const errorBanner = document.getElementById("error-banner");
const resultEl = document.getElementById("result");

const answerEl = document.getElementById("result-answer");
const stoppedNote = document.getElementById("stopped-note");
const filesList = document.getElementById("files-inspected");
const noFilesEl = document.getElementById("no-files");
const logDetails = document.getElementById("log-details");
const logList = document.getElementById("log-list");
const logCount = document.getElementById("log-count");

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  await runInvestigation();
});

clearBtn.addEventListener("click", () => {
  form.reset();
  hide(errorBanner);
  hide(resultEl);
  hide(statusEl);
});

for (const chip of document.querySelectorAll(".chip")) {
  chip.addEventListener("click", () => {
    goalInput.value = chip.dataset.goal;
    goalInput.focus();
  });
}

async function runInvestigation() {
  const goal = goalInput.value.trim();
  if (!goal) return;

  hide(errorBanner);
  hide(resultEl);
  setLoading(true);
  showStatus("Agent is investigating the repository...");

  try {
    const response = await fetch("/api/agent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ goal }),
    });

    const body = await safeParseJson(response);

    if (!response.ok || !body || body.ok !== true) {
      const message = body?.error || `Request failed with status ${response.status}.`;
      throw new Error(message);
    }

    renderResult(body);
  } catch (err) {
    showError(err.message || "Something went wrong.");
  } finally {
    setLoading(false);
    hide(statusEl);
  }
}

function renderResult(body) {
  const { answer, filesInspected = [], log = [], stopped } = body;

  answerEl.textContent = answer;

  if (stopped === "duplicate_call") {
    stoppedNote.textContent =
      "⚠️ Stopped early: the agent tried to repeat a tool call it had already made.";
    show(stoppedNote);
  } else if (stopped === "max_steps") {
    stoppedNote.textContent =
      "⚠️ Stopped early: the agent reached the maximum number of investigation steps.";
    show(stoppedNote);
  } else {
    hide(stoppedNote);
  }

  filesList.innerHTML = "";
  if (filesInspected.length > 0) {
    for (const file of filesInspected) {
      const li = document.createElement("li");
      li.textContent = file;
      filesList.appendChild(li);
    }
    show(filesList);
    hide(noFilesEl);
  } else {
    hide(filesList);
    show(noFilesEl);
  }

  logList.innerHTML = "";
  logCount.textContent = String(log.length);
  if (log.length > 0) {
    for (const entry of log) {
      logList.appendChild(renderLogEntry(entry));
    }
    show(logDetails);
  } else {
    hide(logDetails);
  }

  show(resultEl);
}

function renderLogEntry(entry) {
  const li = document.createElement("li");

  const toolSpan = document.createElement("span");
  toolSpan.textContent = `${entry.tool}(`;

  const argsSpan = document.createElement("span");
  argsSpan.className = "log-args";
  argsSpan.textContent = JSON.stringify(entry.arguments ?? {});

  const closeSpan = document.createElement("span");
  closeSpan.textContent = ")";

  const statusSpan = document.createElement("span");
  statusSpan.className = `log-status log-status-${entry.status}`;
  statusSpan.textContent = entry.status;

  li.append(toolSpan, argsSpan, closeSpan, statusSpan);

  if (entry.error) {
    const errSpan = document.createElement("div");
    errSpan.className = "log-args";
    errSpan.textContent = entry.error;
    li.appendChild(errSpan);
  }

  return li;
}

function showError(message) {
  errorBanner.textContent = `⚠️ ${message}`;
  show(errorBanner);
}

function showStatus(message) {
  statusEl.textContent = message;
  show(statusEl);
}

function setLoading(isLoading) {
  submitBtn.disabled = isLoading;
  submitBtn.textContent = isLoading ? "Investigating..." : "Investigate";
}

async function safeParseJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function show(el) {
  el.hidden = false;
}

function hide(el) {
  el.hidden = true;
}
