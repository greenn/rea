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
    testAib: document.querySelector('#testAib'),
    aibStatus: document.querySelector('#aibStatus'),
    aibStatusText: document.querySelector('#aibStatusText'),
    aibHint: document.querySelector('#aibHint'),
    aibDetails: document.querySelector('#aibDetails'),
    aibModel: document.querySelector('#aibModel'),
    aibOllama: document.querySelector('#aibOllama'),
    libraryStatus: document.querySelector('#libraryStatus'),
    libraryStatusText: document.querySelector('#libraryStatusText'),
    libraryHint: document.querySelector('#libraryHint'),
    libraryDetails: document.querySelector('#libraryDetails'),
    libraryCounts: document.querySelector('#libraryCounts'),
    libraryAudioCount: document.querySelector('#libraryAudioCount'),
    libraryPath: document.querySelector('#libraryPath'),
    testLibrary: document.querySelector('#testLibrary'),
    backupLibrary: document.querySelector('#backupLibrary'),
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
  settingsEls.testAib.addEventListener('click', testAibConnection);
  settingsEls.testLibrary.addEventListener('click', testLibraryConnection);
  settingsEls.backupLibrary.addEventListener('click', backupLibrary);
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
  resetAibStatus();
  resetLibraryStatus();
  settingsEls.modal.classList.remove('hidden');
  settingsEls.modal.setAttribute('aria-hidden', 'false');
  void testLibraryConnection();
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

async function testLibraryConnection() {
  settingsEls.testLibrary.disabled = true;
  setLibraryStatus('checking', 'Проверяем постоянное хранилище…');
  clearLibraryHint();
  settingsEls.libraryDetails.classList.add('hidden');
  try {
    const response = await fetch(`${DEFAULT_WHISPER_URL}/api/library/health`, {
      cache: 'no-store',
      headers: { Accept: 'application/json' }
    });
    if (!response.ok) {
      const detail = await readErrorDetail(response);
      throw new Error(detail ? `HTTP ${response.status}: ${detail}` : `HTTP ${response.status}`);
    }
    const health = await response.json().catch(() => ({}));
    if (!health.ok || health.integrity !== 'ok') throw new Error(health.detail || `SQLite integrity: ${health.integrity || 'unknown'}`);
    settingsEls.libraryCounts.textContent = `${health.groups || 0} / ${health.recordings || 0}`;
    settingsEls.libraryAudioCount.textContent = String(health.recordingsWithAudio || 0);
    settingsEls.libraryPath.textContent = health.dataDirectory || '—';
    settingsEls.libraryDetails.classList.remove('hidden');
    setLibraryStatus('connected', 'SQLite исправна');
  } catch (error) {
    console.error('REA library health check failed:', error);
    setLibraryStatus('error', 'Постоянная база недоступна');
    showLibraryHint(/HTTP 404/.test(String(error?.message || ''))
      ? 'Перезапустите start-rea.cmd: запущена предыдущая версия сервиса без локальной базы.'
      : `Не удалось проверить SQLite: ${error.message || error}`);
  } finally {
    settingsEls.testLibrary.disabled = false;
  }
}

async function backupLibrary() {
  settingsEls.backupLibrary.disabled = true;
  setLibraryStatus('checking', 'Создаём резервную копию…');
  clearLibraryHint();
  try {
    const response = await fetch(`${DEFAULT_WHISPER_URL}/api/library/backup`, {
      method: 'POST',
      cache: 'no-store',
      headers: { Accept: 'application/json' }
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.ok) throw new Error(payload.detail || `HTTP ${response.status}`);
    setLibraryStatus('connected', 'Резервная копия создана');
    showLibraryHint(payload.backupPath || 'Резервная копия SQLite создана.');
  } catch (error) {
    setLibraryStatus('error', 'Не удалось создать резервную копию');
    showLibraryHint(error.message || String(error));
  } finally {
    settingsEls.backupLibrary.disabled = false;
  }
}

function resetLibraryStatus() {
  settingsEls.libraryDetails.classList.add('hidden');
  clearLibraryHint();
  setLibraryStatus('idle', 'Не проверено');
}

function setLibraryStatus(state, text) {
  settingsEls.libraryStatus.dataset.state = state;
  settingsEls.libraryStatusText.textContent = text;
}

function showLibraryHint(text) {
  settingsEls.libraryHint.textContent = text;
  settingsEls.libraryHint.classList.remove('hidden');
}

function clearLibraryHint() {
  settingsEls.libraryHint.textContent = '';
  settingsEls.libraryHint.classList.add('hidden');
}

async function testAibConnection() {
  settingsEls.aibUrl.value = DEFAULT_AIB_URL;
  settingsEls.testAib.disabled = true;
  setAibStatus('checking', 'Проверяем AIB (Орфо)…');
  clearAibHint();
  settingsEls.aibDetails.classList.add('hidden');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(`${DEFAULT_AIB_URL}/health`, {
      method: 'GET',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      signal: controller.signal
    });
    if (!response.ok) {
      const detail = await readErrorDetail(response);
      throw new Error(detail ? `HTTP ${response.status}: ${detail}` : `HTTP ${response.status}`);
    }
    const health = await response.json().catch(() => ({}));
    const ollamaStatus = String(health?.ollama?.status || '').toLowerCase();
    settingsEls.aibModel.textContent = health?.default_model || health?.model || '—';
    settingsEls.aibOllama.textContent = ollamaStatus || 'не указан';
    settingsEls.aibDetails.classList.remove('hidden');

    if (health?.status === 'degraded' || ['unavailable', 'error', 'offline'].includes(ollamaStatus)) {
      setAibStatus('error', 'AIB доступен, но Орфо пока не готов');
      showAibHint('AIB ответил, но его зависимость Ollama недоступна. Запустите Ollama и повторите проверку.');
      return;
    }
    setAibStatus('connected', 'AIB (Орфо) готов к работе');
  } catch (error) {
    console.error('AIB health check failed:', error);
    const diagnosis = explainAibConnectionError(error);
    setAibStatus('error', diagnosis.title);
    showAibHint(diagnosis.help);
  } finally {
    clearTimeout(timeout);
    settingsEls.testAib.disabled = false;
  }
}

function resetAibStatus() {
  settingsEls.aibDetails.classList.add('hidden');
  clearAibHint();
  setAibStatus('idle', 'Не проверено');
}

function setAibStatus(state, text) {
  settingsEls.aibStatus.dataset.state = state;
  settingsEls.aibStatusText.textContent = text;
}

function explainAibConnectionError(error) {
  if (error?.name === 'AbortError') {
    return { title: 'AIB не ответил за 8 секунд', help: 'Сервис AIB может зависнуть при запуске или ожидать Ollama. Проверьте окно AIB и запустите Ollama, затем повторите проверку.' };
  }
  const message = String(error?.message || '');
  if (/HTTP /.test(message)) {
    return { title: 'AIB вернул ошибку', help: `Сервис ответил, но не прошёл проверку: ${message}. Посмотрите вывод окна AIB и повторите проверку.` };
  }
  return { title: 'AIB (Орфо) недоступен', help: `Нет ответа на ${DEFAULT_AIB_URL}. Запустите локальный AIB и оставьте его работающим.` };
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

function showAibHint(text) {
  settingsEls.aibHint.textContent = text;
  settingsEls.aibHint.classList.remove('hidden');
}

function clearAibHint() {
  settingsEls.aibHint.textContent = '';
  settingsEls.aibHint.classList.add('hidden');
}
