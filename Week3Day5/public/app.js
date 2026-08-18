const form = document.getElementById("ask-form");
const questionInput = document.getElementById("question");
const askButton = document.getElementById("ask-button");
const statusEl = document.getElementById("status");
const resultEl = document.getElementById("result");
const routeBadgeEl = document.getElementById("route-badge");
const answerTextEl = document.getElementById("answer-text");
const sourcesListEl = document.getElementById("sources-list");
const toolsUsedEl = document.getElementById("tools-used");
const filesInspectedEl = document.getElementById("files-inspected");
const agentStepsEl = document.getElementById("agent-steps");
const fallbackUsedEl = document.getElementById("fallback-used");
const latencyEl = document.getElementById("latency");
const requestIdEl = document.getElementById("request-id");

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const question = questionInput.value.trim();
  if (!question) return;
  await askQuestion(question);
});

document.querySelectorAll(".example-chip").forEach((chip) => {
  chip.addEventListener("click", () => {
    questionInput.value = chip.textContent;
    questionInput.focus();
    form.requestSubmit();
  });
});

async function askQuestion(question) {
  setLoading(true);
  setStatus("Routing and answering…");
  resultEl.hidden = true;

  try {
    const response = await fetch("/api/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question }),
    });

    const data = await response.json();

    if (!response.ok && !data.route) {
      throw new Error(data.error || `Request failed (${response.status})`);
    }

    renderResult(data);
    setStatus(data.ok === false ? `Error: ${data.errorCode || "request failed"}` : "", data.ok === false);
  } catch (err) {
    setStatus(`Error: ${err.message}`, true);
  } finally {
    setLoading(false, /* keepStatus */ true);
  }
}

function renderResult(data) {
  routeBadgeEl.textContent = data.ok === false ? "error" : data.route || "unknown";
  routeBadgeEl.className = `route-badge route-${data.ok === false ? "error" : data.route || "unknown"}`;

  answerTextEl.textContent = data.answer;

  const sources = data.sources || [];
  sourcesListEl.innerHTML = "";
  sourcesListEl.classList.toggle("empty", sources.length === 0);
  if (sources.length === 0) {
    const li = document.createElement("li");
    li.textContent = "No documented source";
    sourcesListEl.appendChild(li);
  } else {
    for (const source of sources) {
      const li = document.createElement("li");
      li.textContent = source;
      sourcesListEl.appendChild(li);
    }
  }

  toolsUsedEl.textContent = (data.toolsUsed || []).length ? data.toolsUsed.join(", ") : "—";
  filesInspectedEl.textContent = (data.filesInspected || []).length ? data.filesInspected.join(", ") : "—";
  agentStepsEl.textContent = data.agentSteps ? String(data.agentSteps) : "—";
  fallbackUsedEl.textContent = data.fallbackUsed ? "yes (keyword search)" : "no";
  latencyEl.textContent = data.timings ? `${data.timings.totalMs}ms total` : "—";
  requestIdEl.textContent = data.requestId || "—";

  resultEl.hidden = false;
}

function setLoading(isLoading, keepStatus = false) {
  askButton.disabled = isLoading;
  askButton.textContent = isLoading ? "Thinking…" : "Ask";
  if (!isLoading && !keepStatus) setStatus("");
}

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("error", isError);
}
