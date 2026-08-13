const form = document.getElementById("ask-form");
const questionInput = document.getElementById("question");
const askButton = document.getElementById("ask-button");
const statusEl = document.getElementById("status");
const resultEl = document.getElementById("result");
const answerTextEl = document.getElementById("answer-text");
const sourcesListEl = document.getElementById("sources-list");
const chunksListEl = document.getElementById("chunks-list");

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
  setStatus("");
  resultEl.hidden = true;

  try {
    const response = await fetch("/api/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || `Request failed (${response.status})`);
    }

    renderResult(data);
    setStatus("");
  } catch (err) {
    setStatus(`Error: ${err.message}`, true);
  } finally {
    setLoading(false, /* keepStatus */ true);
  }
}

function renderResult(data) {
  answerTextEl.textContent = data.answer;

  sourcesListEl.innerHTML = "";
  sourcesListEl.classList.toggle("empty", data.sources.length === 0);
  if (data.sources.length === 0) {
    const li = document.createElement("li");
    li.textContent = "No documented source";
    sourcesListEl.appendChild(li);
  } else {
    for (const source of data.sources) {
      const li = document.createElement("li");
      li.textContent = source;
      sourcesListEl.appendChild(li);
    }
  }

  chunksListEl.innerHTML = "";
  for (const chunk of data.retrieved ?? []) {
    const li = document.createElement("li");
    li.className = "chunk-item";

    const meta = document.createElement("div");
    meta.className = "chunk-meta";

    const badge = document.createElement("span");
    badge.className = `score-badge ${scoreClass(chunk.score)}`;
    badge.textContent = chunk.score.toFixed(3);

    const label = document.createElement("span");
    label.textContent = `${chunk.source} (chunk ${chunk.chunkIndex})`;

    meta.append(badge, label);

    const text = document.createElement("p");
    text.className = "chunk-text";
    text.textContent = chunk.text;

    li.append(meta, text);
    chunksListEl.appendChild(li);
  }

  resultEl.hidden = false;
}

function scoreClass(score) {
  if (score >= 0.6) return "score-high";
  if (score >= 0.35) return "score-mid";
  return "score-low";
}

function setLoading(isLoading, keepStatus = false) {
  askButton.disabled = isLoading;
  askButton.textContent = isLoading ? "Thinking…" : "Ask";
  if (isLoading && !keepStatus) setStatus("Searching documents and generating an answer…");
}

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("error", isError);
}
