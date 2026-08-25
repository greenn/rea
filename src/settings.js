const DEFAULT_WHISPER_URL = 'http://127.0.0.1:18787';
const DEFAULT_AIB_URL = 'http://127.0.0.1:8282';

const settingsEls = {};

window.addEventListener('DOMContentLoaded', () => {
  Object.assign(settingsEls, {
    open: document.querySelector('#openSettings'),
    modal: document.querySelector('#settingsModal'),
    panel: document.querySelector('#settingsPanel'),
    close: document.querySelector('#closeSettings'),
    cancel: document.querySelector('#cancelSettings'),
    save: document.querySelector('#saveSettings'),
    start: document.querySelector('#startWhisper'),
    test: document.querySelector('#testWhisper'),
    url: document.querySelector('#whisperUrl'),
    aibUrl: document.querySelector('#aibUrl'),
    status: document.querySelector('#whisperStatus'),
    statusText: document.querySelector('#whisperStatusText'),
    hint: document.querySelector('#whisperHint'),
    details: document.querySelector('#whisperDetails'),
    model: document.querySelector('#whisperModel'),
    device: document.querySelector('#whisperDevice')
  });

  if (!settingsEls.open || !settingsEls.modal) return;

  settingsEls.url.value = DEFAULT_WHISPER_URL;
  settingsEls.url.readOnly = true;
  settingsEls.aibUrl.value = DEFAULT_AIB_URL;
  settingsEls.aibUrl.readOnly = true;
  settingsEls.save.hidden = true;
  settingsEls.open.addEventListener('click', openSettings);
  settingsEls.close.addEventListener('click', closeSettings);
  settingsEls.cancel.addEventListener('click', closeSettings);
  settingsEls.start.addEventListener('click', startWhisperService);
  settingsEls.test.addEventListener('click', testWhisperConnection);
  settingsEls.modal.addEventListener('click', (event) => {
    if (event.target === settingsEls.modal) closeSettings();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !settingsEls.modal.classList.contains('hidden')) closeSettings();
  });
});

function openSettings() {
  settingsEls.url.value = DEFAULT_WHISPER_URL;
  settingsEls.aibUrl.value = DEFAULT_AIB_URL;
  resetStatus();
  settingsEls.modal.classList.remove('hidden');
  settingsEls.modal.setAttribute('aria-hidden', 'false');
}

function closeSettings() {
  settingsEls.modal.classList.add('hidden');
  settingsEls.modal.setAttribute('aria-hidden', 'true');
}

async function testWhisperConnection() {
  settingsEls.url.value = DEFAULT_WHISPER_URL;
  settingsEls.test.disabled = true;
  setStatus('checking', 'Checking REA Whisper…');
  clearHint();
  settingsEls.details.classList.add('hidden');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const response = await fetch(`${DEFAULT_WHISPER_URL}/health`, {
      method: 'GET',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      signal: controller.signal
    });

    if (!response.ok) {
      const detail = await readErrorDetail(response);
      throw new Error(detail ? `HTTP ${response.status}: ${detail}` : `HTTP ${response.status}`);
    }

    let health = {};
    try {
      health = await response.json();
    } catch {
      health = {};
    }

    if (health?.ok === false) throw new Error('REA Whisper reported an unhealthy state');

    showConnected(health);
    window.dispatchEvent(new CustomEvent('rea:whisper-status', { detail: { url: DEFAULT_WHISPER_URL, health } }));
  } catch (error) {
    console.error('REA Whisper health check failed:', error);
    const diagnosis = explainConnectionError(error);
    setStatus('error', diagnosis.title);
    showHint(diagnosis.help);
  } finally {
    clearTimeout(timeout);
    settingsEls.test.disabled = false;
  }
}

function resetStatus() {
  settingsEls.details.classList.add('hidden');
  clearHint();
  setStatus('idle', 'Not checked');
}

function setStatus(state, text) {
  settingsEls.status.dataset.state = state;
  settingsEls.statusText.textContent = text;
}

async function startWhisperService() {
  settingsEls.start.disabled = true;
  settingsEls.test.disabled = true;
  setStatus('checking', 'Starting REA Whisper…');
  settingsEls.details.classList.add('hidden');
  showHint('Opening the local REA launcher. Approve the browser prompt if it appears.');

  try {
    window.location.href = 'rea://start';
    const health = await waitForStartedService();
    if (!health) {
      setStatus('error', 'REA Whisper did not start in 30 seconds');
      showHint('The launcher did not make the service available. Run start-rea.cmd once to see any installation error, then try this button again.');
      return;
    }
    clearHint();
    showConnected(health);
    window.dispatchEvent(new CustomEvent('rea:whisper-status', { detail: { url: DEFAULT_WHISPER_URL, health } }));
  } finally {
    settingsEls.start.disabled = false;
    settingsEls.test.disabled = false;
  }
}

async function waitForStartedService() {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${DEFAULT_WHISPER_URL}/health`, { cache: 'no-store' });
      if (response.ok) {
        const health = await response.json().catch(() => ({}));
        if (health?.ok !== false) return health;
      }
    } catch {
      // The service can take a moment to create its environment and start.
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return null;
}

function showConnected(health) {
  setStatus('connected', 'Connected to REA Whisper');
  settingsEls.model.textContent = health?.loadedModel || health?.defaultModel || health?.model || '—';
  const device = health?.device || '—';
  const compute = health?.computeType ? ` · ${health.computeType}` : '';
  settingsEls.device.textContent = `${device}${compute}`;
  settingsEls.details.classList.remove('hidden');
}

async function readErrorDetail(response) {
  try {
    const payload = await response.json();
    return typeof payload?.detail === 'string' ? payload.detail : '';
  } catch {
    return '';
  }
}

function explainConnectionError(error) {
  if (error?.name === 'AbortError') {
    return { title: 'REA Whisper did not respond in 5 seconds', help: 'The service may still be starting or is overloaded. Start start-rea.cmd, wait for the “Whisper API” address, then test again.' };
  }
  const message = String(error?.message || '');
  if (/HTTP 404/.test(message)) {
    return { title: 'The address is reachable, but this is not the REA Whisper service', help: 'REA expected the local /health endpoint on http://127.0.0.1:18787. Start the service with start-rea.cmd and test again.' };
  }
  if (/HTTP /.test(message)) {
    return { title: 'REA Whisper returned an error', help: `The service answered but rejected the health check: ${message}. Restart start-rea.cmd and try again.` };
  }
  if (/unhealthy/i.test(message)) {
    return { title: 'REA Whisper reported an unhealthy state', help: 'Restart start-rea.cmd. If this repeats, inspect the service terminal for the underlying error.' };
  }
  return { title: 'REA Whisper is not reachable', help: 'Nothing responded at http://127.0.0.1:18787. Start start-rea.cmd, keep it running, then click Test connection again.' };
}

function showHint(text) {
  settingsEls.hint.textContent = text;
  settingsEls.hint.classList.remove('hidden');
}

function clearHint() {
  settingsEls.hint.textContent = '';
  settingsEls.hint.classList.add('hidden');
}
