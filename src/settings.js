const DEFAULT_WHISPER_URL = 'http://127.0.0.1:8787';

const settingsEls = {};

window.addEventListener('DOMContentLoaded', () => {
  Object.assign(settingsEls, {
    open: document.querySelector('#openSettings'),
    modal: document.querySelector('#settingsModal'),
    panel: document.querySelector('#settingsPanel'),
    close: document.querySelector('#closeSettings'),
    cancel: document.querySelector('#cancelSettings'),
    save: document.querySelector('#saveSettings'),
    test: document.querySelector('#testWhisper'),
    url: document.querySelector('#whisperUrl'),
    status: document.querySelector('#whisperStatus'),
    statusText: document.querySelector('#whisperStatusText'),
    details: document.querySelector('#whisperDetails'),
    model: document.querySelector('#whisperModel'),
    device: document.querySelector('#whisperDevice')
  });

  if (!settingsEls.open || !settingsEls.modal) return;

  settingsEls.url.value = DEFAULT_WHISPER_URL;
  settingsEls.url.readOnly = true;
  settingsEls.save.hidden = true;
  settingsEls.open.addEventListener('click', openSettings);
  settingsEls.close.addEventListener('click', closeSettings);
  settingsEls.cancel.addEventListener('click', closeSettings);
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

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    let health = {};
    try {
      health = await response.json();
    } catch {
      health = {};
    }

    if (health?.ok === false) throw new Error('REA Whisper reported an unhealthy state');

    setStatus('connected', 'Connected to REA Whisper');
    settingsEls.model.textContent = health?.loadedModel || health?.defaultModel || health?.model || '—';
    const device = health?.device || '—';
    const compute = health?.computeType ? ` · ${health.computeType}` : '';
    settingsEls.device.textContent = `${device}${compute}`;
    settingsEls.details.classList.remove('hidden');
    window.dispatchEvent(new CustomEvent('rea:whisper-status', { detail: { url: DEFAULT_WHISPER_URL, health } }));
  } catch (error) {
    console.error('REA Whisper health check failed:', error);
    const message = error?.name === 'AbortError'
      ? 'No response within 5 seconds'
      : 'REA Whisper is not available';
    setStatus('error', message);
  } finally {
    clearTimeout(timeout);
    settingsEls.test.disabled = false;
  }
}

function resetStatus() {
  settingsEls.details.classList.add('hidden');
  setStatus('idle', 'Not checked');
}

function setStatus(state, text) {
  settingsEls.status.dataset.state = state;
  settingsEls.statusText.textContent = text;
}
