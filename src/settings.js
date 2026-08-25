const WHISPER_URL_KEY = 'rea.whisper.url';
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

  settingsEls.url.value = getWhisperUrl();
  settingsEls.open.addEventListener('click', openSettings);
  settingsEls.close.addEventListener('click', closeSettings);
  settingsEls.cancel.addEventListener('click', closeSettings);
  settingsEls.save.addEventListener('click', saveSettings);
  settingsEls.test.addEventListener('click', testWhisperConnection);
  settingsEls.modal.addEventListener('click', (event) => {
    if (event.target === settingsEls.modal) closeSettings();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !settingsEls.modal.classList.contains('hidden')) closeSettings();
  });
});

function openSettings() {
  settingsEls.url.value = getWhisperUrl();
  resetStatus();
  settingsEls.modal.classList.remove('hidden');
  settingsEls.modal.setAttribute('aria-hidden', 'false');
  requestAnimationFrame(() => settingsEls.url.focus());
}

function closeSettings() {
  settingsEls.modal.classList.add('hidden');
  settingsEls.modal.setAttribute('aria-hidden', 'true');
}

function saveSettings() {
  const url = normalizeWhisperUrl(settingsEls.url.value);
  settingsEls.url.value = url;
  localStorage.setItem(WHISPER_URL_KEY, url);
  setStatus('saved', 'Saved locally');
  window.dispatchEvent(new CustomEvent('rea:whisper-settings', { detail: { url } }));
}

async function testWhisperConnection() {
  const url = normalizeWhisperUrl(settingsEls.url.value);
  settingsEls.url.value = url;
  localStorage.setItem(WHISPER_URL_KEY, url);

  settingsEls.test.disabled = true;
  setStatus('checking', 'Checking connection…');
  settingsEls.details.classList.add('hidden');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const response = await fetch(`${url}/health`, {
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

    if (health?.ok === false) throw new Error('Whisper reported an unhealthy state');

    setStatus('connected', 'Connected');
    settingsEls.model.textContent = health?.model || '—';
    settingsEls.device.textContent = health?.device || '—';
    settingsEls.details.classList.remove('hidden');
    window.dispatchEvent(new CustomEvent('rea:whisper-settings', { detail: { url, health } }));
  } catch (error) {
    console.error('Whisper health check failed:', error);
    const message = error?.name === 'AbortError'
      ? 'No response within 5 seconds'
      : 'Connection failed';
    setStatus('error', message);
  } finally {
    clearTimeout(timeout);
    settingsEls.test.disabled = false;
  }
}

function getWhisperUrl() {
  return normalizeWhisperUrl(localStorage.getItem(WHISPER_URL_KEY) || DEFAULT_WHISPER_URL);
}

function normalizeWhisperUrl(value) {
  let url = String(value || DEFAULT_WHISPER_URL).trim();
  url = url.replace(/\/health\/?$/i, '');
  url = url.replace(/\/+$/, '');
  return url || DEFAULT_WHISPER_URL;
}

function resetStatus() {
  settingsEls.details.classList.add('hidden');
  setStatus('idle', 'Not checked');
}

function setStatus(state, text) {
  settingsEls.status.dataset.state = state;
  settingsEls.statusText.textContent = text;
}
