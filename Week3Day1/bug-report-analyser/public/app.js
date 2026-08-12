const form = document.getElementById('bug-form');
const submitBtn = document.getElementById('submit-btn');
const clearBtn = document.getElementById('clear-btn');
const statusEl = document.getElementById('status');
const errorBanner = document.getElementById('error-banner');
const resultEl = document.getElementById('result');

const summaryEl = document.getElementById('result-summary');
const severityEl = document.getElementById('result-severity');
const causesEl = document.getElementById('result-causes');
const nextStepEl = document.getElementById('result-nextstep');
const traceDetails = document.getElementById('trace-details');
const traceList = document.getElementById('trace-list');
const rawJsonEl = document.getElementById('raw-json');

const VALID_SEVERITIES = ['low', 'medium', 'high', 'critical'];

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  await runAnalysis();
});

clearBtn.addEventListener('click', () => {
  form.reset();
  hide(errorBanner);
  hide(resultEl);
  hide(statusEl);
});

async function runAnalysis() {
  hide(errorBanner);
  hide(resultEl);
  setLoading(true);
  showStatus('Contacting local Ollama model...');

  const payload = {
    expected: form.expected.value,
    actual: form.actual.value,
    error: form.error.value,
    reproduction: form.reproduction.value,
    question: form.question.value,
    simulateInvalid: form.simulateInvalid.checked,
  };

  try {
    const response = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const body = await safeParseJson(response);

    if (!response.ok || !body || body.ok !== true) {
      const message = body?.error || `Request failed with status ${response.status}.`;
      throw new Error(message);
    }

    // Never trust the server blindly: validate before rendering, even though
    // the server already validates. This is what protects the UI when
    // "Simulate malformed AI response" is checked.
    const validated = validateAnalysis(body.result);

    renderResult(validated, body.trace || [], body.result);
  } catch (err) {
    showError(err.message || 'Something went wrong.');
  } finally {
    setLoading(false);
    hide(statusEl);
  }
}

/** Mirrors the schema described in the exercise: summary/severity/possibleCauses/nextStep. */
function validateAnalysis(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('The model response was not a JSON object.');
  }

  const problems = [];
  const { summary, severity, possibleCauses, nextStep } = data;

  if (typeof summary !== 'string' || !summary.trim()) {
    problems.push('missing or empty "summary"');
  }
  if (!VALID_SEVERITIES.includes(severity)) {
    problems.push(`"severity" must be one of ${VALID_SEVERITIES.join(', ')} (got ${JSON.stringify(severity)})`);
  }
  if (!Array.isArray(possibleCauses) || possibleCauses.some((c) => typeof c !== 'string')) {
    problems.push('"possibleCauses" must be an array of strings');
  }
  if (typeof nextStep !== 'string' || !nextStep.trim()) {
    problems.push('missing or empty "nextStep"');
  }

  if (problems.length > 0) {
    throw new Error(`The AI response failed validation: ${problems.join('; ')}.`);
  }

  return { summary, severity, possibleCauses, nextStep };
}

function renderResult(validated, trace, rawResult) {
  summaryEl.textContent = validated.summary;

  severityEl.textContent = validated.severity;
  severityEl.className = `severity-badge severity-${validated.severity}`;

  causesEl.innerHTML = '';
  for (const cause of validated.possibleCauses) {
    const li = document.createElement('li');
    li.textContent = cause;
    causesEl.appendChild(li);
  }

  nextStepEl.textContent = validated.nextStep;

  traceList.innerHTML = '';
  if (trace.length > 0) {
    for (const step of trace) {
      const li = document.createElement('li');
      li.textContent = `get_project_info(${JSON.stringify(step.args?.section)}) → "${step.result}"`;
      traceList.appendChild(li);
    }
    show(traceDetails);
  } else {
    hide(traceDetails);
  }

  rawJsonEl.textContent = JSON.stringify(rawResult, null, 2);

  show(resultEl);
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
  submitBtn.textContent = isLoading ? 'Analysing...' : 'Analyse Bug';
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
