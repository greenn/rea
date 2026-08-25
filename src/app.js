const DB_NAME = 'rea-local';
const DB_VERSION = 1;
const AUDIO_EXTENSIONS = ['wav', 'mp3', 'm4a', 'flac', 'ogg', 'aac', 'webm'];
const WHISPER_MODEL = 'large-v3';
const WHISPER_API_BASE = location.port === '18787'
  ? '/api/whisper'
  : 'http://127.0.0.1:18787/api/whisper';
const WM_0825_JULY_14_CLEANUP_KEY = 'rea.cleanup.wm-0825-2026-07-14';
const APP_QUEUE_CLIENT_ID = getAppQueueClientId();

const state = {
  db: null,
  groups: [],
  selectedGroup: null,
  selectedFile: null,
  stagedFiles: [],
  editingTranscript: false,
  readingTranscript: false,
  orthographyRunning: false,
  currentPage: 'segments',
  currentView: 'recording',
  activeTranscriptId: null,
  currentObjectUrl: null,
  dragDepth: 0,
  recognitionJobs: new Map(),
  stagingKeys: new Set(),
  groupRecognition: null,
  appQueueSignature: '',
  appLog: [],
  journalOpen: true
};

const els = {};
const $ = (selector) => document.querySelector(selector);

window.addEventListener('DOMContentLoaded', init);
window.addEventListener('error', (event) => appendAppLog('error', `Application error: ${event.message || 'Unknown error'}`));
window.addEventListener('unhandledrejection', (event) => appendAppLog('error', `Unhandled operation error: ${event.reason?.message || event.reason || 'Unknown error'}`));

function getAppQueueClientId() {
  const key = 'rea.app-queue-client-id';
  try {
    let clientId = sessionStorage.getItem(key);
    if (!clientId) {
      clientId = globalThis.crypto?.randomUUID?.() || `browser-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      sessionStorage.setItem(key, clientId);
    }
    return clientId;
  } catch {
    return `browser-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
}

async function init() {
  appendAppLog('info', 'Starting REA interface.');
  cacheElements();
  bindEvents();
  setDefaultDate();
  await loadVersion();

  try {
    appendAppLog('info', 'Opening local recording storage.');
    state.db = await openDatabase();
    const removedDuplicates = await removeStoredDuplicates();
    const removedWm0825Files = await removeWm0825July14Files();
    await reloadGroups();
    const recordingCount = state.groups.reduce((total, group) => total + group.files.length, 0);
    appendAppLog('success', `Loaded ${state.groups.length} folder(s) and ${recordingCount} recording(s) from this browser.`);
    const removedTotal = removedDuplicates + removedWm0825Files;
    if (removedTotal) showToast(`Removed ${removedTotal} recording${removedTotal === 1 ? '' : 's'} from local storage.`);
  } catch (error) {
    console.error(error);
    state.groups = [];
    appendAppLog('error', `Local storage could not be opened: ${error.message || error}`);
    showToast('Local storage could not be opened in this browser.', true);
  }

  renderSidebar();
  renderUploadRows();

  const route = readRoute();
  state.currentPage = route.page;
  if (route.view === 'upload') {
    showUpload({ updateUrl: false });
  } else {
    const selected = findFile(route.fileId)
      || (state.groups[0]?.files?.[0] ? { file: state.groups[0].files[0], group: state.groups[0] } : null);
    if (selected) await selectFile(selected.file, selected.group, { updateUrl: false });
    else renderEmptyRecording();
    if (route.view === 'journal') showJournal({ updateUrl: false });
    else showRecording({ updateUrl: false });
  }
  writeRoute({ replace: true });
}

function cacheElements() {
  Object.assign(els, {
    groups: $('#groups'),
    recordingView: $('#recordingView'),
    uploadView: $('#uploadView'),
    journalView: $('#journalView'),
    recordingSearch: $('#recordingSearch'),
    renameFile: $('#renameFile'),
    currentFileTitle: $('#currentFileTitle'),
    audio: $('#audio'),
    playBtn: $('#playBtn'),
    seek: $('#seek'),
    waveCanvas: $('#waveCanvas'),
    waveCursor: $('#waveCursor'),
    playerTime: $('#playerTime'),
    playerDuration: $('#playerDuration'),
    playbackRate: $('#playbackRate'),
    volume: $('#volume'),
    audioNotice: $('#audioNotice'),
    transcriptRows: $('#transcriptRows'),
    transcriptSearch: $('#transcriptSearch'),
    readTranscript: $('#readTranscript'),
    orthographyTranscript: $('#orthographyTranscript'),
    editTranscript: $('#editTranscript'),
    recognizeTranscript: $('#recognizeTranscript'),
    cancelAllRecognition: $('#cancelAllRecognition'),
    recognitionStatus: $('#recognitionStatus'),
    appProcessing: $('#appProcessing'),
    recognitionReport: $('#recognitionReport'),
    recognitionReportTitle: $('#recognitionReportTitle'),
    recognitionReportCurrent: $('#recognitionReportCurrent'),
    recognitionJournal: $('#recognitionJournal'),
    toggleRecognitionJournal: $('#toggleRecognitionJournal'),
    openFullJournal: $('#openFullJournal'),
    closeFullJournal: $('#closeFullJournal'),
    fullJournal: $('#fullJournal'),
    closeRecognitionReport: $('#closeRecognitionReport'),
    recognizeGroup: $('#recognizeGroup'),
    deleteRecording: $('#deleteRecording'),
    noteTitle: $('#noteTitle'),
    noteList: $('#noteList'),
    metaGroup: $('#metaGroup'),
    metaDate: $('#metaDate'),
    metaPurpose: $('#metaPurpose'),
    metaCount: $('#metaCount'),
    metaFile: $('#metaFile'),
    metaDuration: $('#metaDuration'),
    metaFormat: $('#metaFormat'),
    metaSize: $('#metaSize'),
    metaUploaded: $('#metaUploaded'),
    metaRecognitionSection: $('#metaRecognitionSection'),
    metaRecognitionModel: $('#metaRecognitionModel'),
    metaRecognitionLanguage: $('#metaRecognitionLanguage'),
    metaRecognitionOutput: $('#metaRecognitionOutput'),
    metaRecognitionLoad: $('#metaRecognitionLoad'),
    metaRecognitionTime: $('#metaRecognitionTime'),
    metaRecognitionTotal: $('#metaRecognitionTotal'),
    metaRecognitionSpeed: $('#metaRecognitionSpeed'),
    metaRecognitionFinished: $('#metaRecognitionFinished'),
    dropzone: $('#dropzone'),
    fileInput: $('#fileInput'),
    uploadRows: $('#uploadRows'),
    uploadEmpty: $('#uploadEmpty'),
    fileCount: $('#fileCount'),
    totalSize: $('#totalSize'),
    infoCount: $('#infoCount'),
    infoSize: $('#infoSize'),
    groupName: $('#groupName'),
    assignedDate: $('#assignedDate'),
    groupPurpose: $('#groupPurpose'),
    addToApp: $('#addToApp'),
    globalDropOverlay: $('#globalDropOverlay'),
    toast: $('#toast')
  });
}

function bindEvents() {
  $('#openUpload').addEventListener('click', showUpload);
  $('#openUploadTop').addEventListener('click', showUpload);
  $('#cancelUpload').addEventListener('click', showRecording);
  $('#browseBtn').addEventListener('click', () => els.fileInput.click());
  $('#focusSearch').addEventListener('click', () => els.recordingSearch.focus());
  $('#clearSearch').addEventListener('click', () => {
    els.recordingSearch.value = '';
    renderSidebar();
  });

  els.recordingSearch.addEventListener('input', renderSidebar);
  els.transcriptSearch?.addEventListener('input', renderTranscript);
  els.fileInput.addEventListener('change', async (event) => {
    await addStagedFiles([...event.target.files]);
    event.target.value = '';
  });

  ['dragenter', 'dragover'].forEach((name) => {
    els.dropzone.addEventListener(name, (event) => {
      event.preventDefault();
      els.dropzone.classList.add('dragging');
    });
  });
  ['dragleave', 'drop'].forEach((name) => {
    els.dropzone.addEventListener(name, (event) => {
      event.preventDefault();
      els.dropzone.classList.remove('dragging');
    });
  });
  els.dropzone.addEventListener('drop', async (event) => {
    event.stopPropagation();
    await addStagedFiles([...event.dataTransfer.files]);
  });

  window.addEventListener('dragenter', (event) => {
    if (!hasFiles(event)) return;
    state.dragDepth += 1;
    els.globalDropOverlay.classList.remove('hidden');
  });
  window.addEventListener('dragover', (event) => {
    if (hasFiles(event)) event.preventDefault();
  });
  window.addEventListener('dragleave', () => {
    state.dragDepth = Math.max(0, state.dragDepth - 1);
    if (!state.dragDepth) els.globalDropOverlay.classList.add('hidden');
  });
  window.addEventListener('drop', async (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    state.dragDepth = 0;
    els.globalDropOverlay.classList.add('hidden');
    showUpload();
    await addStagedFiles([...event.dataTransfer.files]);
  });

  $('#clearFiles').addEventListener('click', () => {
    state.stagedFiles = [];
    renderUploadRows();
  });
  els.addToApp.addEventListener('click', saveUploadGroup);

  els.playBtn.addEventListener('click', togglePlayback);
  $('#back10').addEventListener('click', () => seekBy(-10));
  $('#forward10').addEventListener('click', () => seekBy(10));
  els.playbackRate.addEventListener('change', () => {
    els.audio.playbackRate = Number(els.playbackRate.value);
  });
  els.volume.addEventListener('input', () => {
    els.audio.volume = Number(els.volume.value);
  });
  els.seek.addEventListener('input', () => setPlaybackTime(Number(els.seek.value), true));

  els.audio.addEventListener('timeupdate', () => setPlaybackTime(els.audio.currentTime, false));
  els.audio.addEventListener('loadedmetadata', () => {
    const duration = Number.isFinite(els.audio.duration) ? els.audio.duration : 0;
    els.seek.max = Math.max(duration, 1);
    els.playerDuration.textContent = formatDuration(duration);
  });
  els.audio.addEventListener('ended', () => {
    els.playBtn.textContent = '▶';
  });

  els.readTranscript.addEventListener('click', toggleTranscriptRead);
  els.orthographyTranscript.addEventListener('click', correctTranscriptOrthography);
  els.editTranscript.addEventListener('click', toggleTranscriptEdit);
  els.recognizeTranscript?.addEventListener('click', recognizeSelectedFile);
  els.recognizeGroup?.addEventListener('click', recognizeCurrentGroup);
  els.cancelAllRecognition?.addEventListener('click', cancelAllRecognition);
  els.openFullJournal?.addEventListener('click', showJournal);
  els.closeFullJournal?.addEventListener('click', showRecording);
  els.toggleRecognitionJournal?.addEventListener('click', () => {
    state.journalOpen = true;
    renderRecognitionJournal();
  });
  els.closeRecognitionReport?.addEventListener('click', () => {
    state.journalOpen = false;
    renderRecognitionJournal();
  });
  els.deleteRecording?.addEventListener('click', () => deleteRecording(state.selectedFile, state.selectedGroup));
  els.renameFile?.addEventListener('click', renameSelectedFile);
  $('#addNote').addEventListener('click', addNote);
  els.noteTitle.addEventListener('change', persistNoteTitle);

  document.querySelectorAll('.tabs button').forEach((button) => {
    button.addEventListener('click', () => activateTab(button));
  });

  window.addEventListener('popstate', () => applyRouteFromUrl());
  window.addEventListener('resize', drawSelectedWaveform);
  window.addEventListener('beforeunload', revokeObjectUrl);
}

function hasFiles(event) {
  return [...(event.dataTransfer?.types || [])].includes('Files');
}

async function loadVersion() {
  try {
    const response = await fetch('./VERSION.json', { cache: 'no-store' });
    if (!response.ok) return;
    const version = await response.json();
    $('#appVersion').textContent = version.version;
    document.title = `REA ${version.version}`;
  } catch {
    // Keep the version embedded in HTML.
  }
}

function setDefaultDate() {
  els.assignedDate.value = toDateInput(new Date());
}

function showUpload({ updateUrl = true } = {}) {
  state.currentView = 'upload';
  els.recordingView.classList.add('hidden');
  els.uploadView.classList.remove('hidden');
  els.journalView.classList.add('hidden');
  if (updateUrl) writeRoute();
}

function showRecording({ updateUrl = true } = {}) {
  state.currentView = 'recording';
  els.uploadView.classList.add('hidden');
  els.recordingView.classList.remove('hidden');
  els.journalView.classList.add('hidden');
  renderRecordingPage();
  if (updateUrl) writeRoute();
}

function showJournal({ updateUrl = true } = {}) {
  state.currentView = 'journal';
  els.recordingView.classList.add('hidden');
  els.uploadView.classList.add('hidden');
  els.journalView.classList.remove('hidden');
  renderFullJournal();
  if (updateUrl) writeRoute();
}

function normalizePage(page) {
  return ['segments', 'text', 'result'].includes(page) ? page : 'segments';
}

function readRoute() {
  const params = new URLSearchParams(location.search);
  return {
    view: ['upload', 'journal'].includes(params.get('view')) ? params.get('view') : 'recording',
    fileId: params.get('file') || '',
    page: normalizePage(params.get('page'))
  };
}

function writeRoute({ replace = false } = {}) {
  const url = new URL(location.href);
  if (state.currentView === 'upload') {
    url.searchParams.set('view', 'upload');
    url.searchParams.delete('file');
    url.searchParams.delete('page');
  } else if (state.currentView === 'journal') {
    url.searchParams.set('view', 'journal');
    if (state.selectedFile?.id) url.searchParams.set('file', state.selectedFile.id);
    else url.searchParams.delete('file');
    url.searchParams.set('page', normalizePage(state.currentPage));
  } else {
    url.searchParams.set('view', 'recording');
    if (state.selectedFile?.id) url.searchParams.set('file', state.selectedFile.id);
    else url.searchParams.delete('file');
    url.searchParams.set('page', normalizePage(state.currentPage));
  }
  history[replace ? 'replaceState' : 'pushState']({}, '', url);
}

function findFile(fileId) {
  if (!fileId) return null;
  for (const group of state.groups) {
    const file = group.files.find((item) => item.id === fileId);
    if (file) return { file, group };
  }
  return null;
}

async function applyRouteFromUrl() {
  const route = readRoute();
  state.currentPage = route.page;
  if (route.view === 'upload') {
    showUpload({ updateUrl: false });
    return;
  }
  const selected = findFile(route.fileId);
  if (selected && selected.file.id !== state.selectedFile?.id) {
    await selectFile(selected.file, selected.group, { updateUrl: false });
  }
  if (route.view === 'journal') return showJournal({ updateUrl: false });
  showRecording({ updateUrl: false });
  renderTranscript();
  renderRecognitionState();
}

async function setRecordingPage(page, { updateUrl = true } = {}) {
  const nextPage = normalizePage(page);
  if (state.editingTranscript && nextPage !== 'segments') {
    collectTranscriptEdits();
    invalidateOrthographyResult(state.selectedFile);
    state.editingTranscript = false;
    await persistCurrentFile();
    els.editTranscript.textContent = 'Редактировать';
  }
  state.currentPage = nextPage;
  state.readingTranscript = nextPage === 'text';
  renderRecordingPage();
  renderTranscript();
  if (updateUrl) writeRoute();
}

function renderRecordingPage() {
  const page = normalizePage(state.currentPage);
  state.currentPage = page;
  els.recordingView.dataset.page = page;
  document.querySelectorAll('.tabs button').forEach((button) => {
    const active = button.dataset.page === page;
    button.classList.toggle('active', active);
    button.setAttribute('aria-current', active ? 'page' : 'false');
  });
  els.readTranscript?.setAttribute('aria-pressed', String(page === 'text'));
  const hasResult = Boolean(state.selectedFile?.orthographyResult?.text || state.selectedFile?.orthographyMeta?.method);
  document.querySelector('.tabs button[data-page="result"]')?.classList.toggle('has-result', hasResult);
}

async function reloadGroups() {
  if (!state.db) {
    state.groups = [];
    return;
  }

  const [groups, files] = await Promise.all([dbGetAll('groups'), dbGetAll('files')]);
  const groupMap = new Map(groups.map((group) => [group.id, { ...group, files: [] }]));

  files.forEach((file) => groupMap.get(file.groupId)?.files.push(file));
  state.groups = [...groupMap.values()]
    .filter((group) => group.files.length)
    .map((group) => ({
      ...group,
      files: group.files.sort(compareRecordingNames)
    }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
}

function renderSidebar() {
  const query = els.recordingSearch.value.trim().toLowerCase();
  els.groups.innerHTML = '';
  let renderedCount = 0;

  state.groups.forEach((group) => {
    const groupMatch = group.name.toLowerCase().includes(query);
    const files = group.files.filter((file) => groupMatch || file.name.toLowerCase().includes(query));
    if (!files.length) return;

    renderedCount += files.length;
    const section = document.createElement('section');
    section.className = 'group';

    const head = document.createElement('div');
    head.className = 'group-head';
    head.innerHTML = '<span class="folder-icon">▱</span><span></span><span class="group-count"></span><button class="group-recognize" title="Recognize unprocessed files in this folder" aria-label="Recognize folder">AI</button>';
    head.children[1].textContent = group.name;
    head.children[2].textContent = String(files.length);
    head.addEventListener('click', () => section.classList.toggle('collapsed'));
    section.appendChild(head);

    const groupJob = groupRecognitionFor(group.id);
    const recognize = head.querySelector('.group-recognize');
    const pending = unrecognizedFiles(group).length;
    recognize.disabled = Boolean(groupJob?.running) || !pending;
    if (groupJob?.running) recognize.classList.add('is-running');
    recognize.addEventListener('click', (event) => {
      event.stopPropagation();
      recognizeGroup(group);
    });
    if (groupJob?.running) {
      const current = Math.min(groupJob.total, groupJob.finished + 1);
      const waiting = Math.max(0, groupJob.total - current);
      const currentProgress = Number(recognitionFor(groupJob.currentFileId)?.progress);
      const overallProgress = Number.isFinite(currentProgress) ? Math.max(0, Math.min(100, ((groupJob.finished + (currentProgress / 100)) / groupJob.total) * 100)) : (groupJob.finished / groupJob.total) * 100;
      const progress = document.createElement('div');
      progress.className = 'group-progress';
      progress.innerHTML = `<span>Processing ${current} of ${groupJob.total} · ${waiting} waiting locally</span><i><b style="width:${Math.round(overallProgress)}%"></b></i>`;
      section.appendChild(progress);
    }

    files.forEach((file) => {
      const row = document.createElement('div');
      const recognition = recognitionFor(file.id);
      const isRecognizing = recognition && ['uploading', 'queued', 'running'].includes(recognition.status);
      row.className = `recording${state.selectedFile?.id === file.id ? ' selected' : ''}${hasCompletedRecognition(file) ? '' : ' not-recognized'}${isRecognizing ? ' is-recognizing' : ''}`;
      if (!hasCompletedRecognition(file)) row.title = 'Not recognized yet';

      const play = document.createElement('div');
      play.className = 'record-play';
      play.textContent = '▶';

      const body = document.createElement('div');
      const name = document.createElement('div');
      name.className = 'recording-name';
      const fileName = document.createElement('span');
      fileName.textContent = file.name;
      name.appendChild(fileName);
      if (isRecognizing) {
        const indicator = document.createElement('span');
        indicator.className = 'recording-processing-indicator';
        indicator.setAttribute('role', 'status');
        indicator.setAttribute('aria-label', recognition.message || 'Recognition in progress');
        indicator.innerHTML = '<i></i><i></i><i></i><i></i><i></i>';
        name.appendChild(indicator);
      }
      const sub = document.createElement('div');
      sub.className = 'recording-sub';
      sub.textContent = formatDateTime(file.uploadedAt);
      body.append(name, sub);

      const duration = document.createElement('div');
      duration.className = 'recording-duration';
      duration.textContent = file.durationSec ? formatDuration(file.durationSec) : '—';

      const remove = document.createElement('button');
      remove.className = 'recording-delete';
      remove.type = 'button';
      remove.title = `Delete ${file.name}`;
      remove.setAttribute('aria-label', remove.title);
      remove.textContent = '×';
      remove.addEventListener('click', (event) => {
        event.stopPropagation();
        deleteRecording(file, group);
      });

      row.append(play, body, duration, remove);
      row.addEventListener('click', () => selectFile(file, group));
      section.appendChild(row);
    });

    els.groups.appendChild(section);
  });

  if (!renderedCount) {
    const empty = document.createElement('div');
    empty.className = 'sidebar-empty';
    empty.textContent = query
      ? 'No recordings match this search.'
      : 'No recordings yet. Upload a group of audio files to start.';
    els.groups.appendChild(empty);
  }
}

async function selectFile(file, group, { updateUrl = true } = {}) {
  state.selectedFile = file;
  state.selectedGroup = group;
  state.editingTranscript = false;
  state.readingTranscript = state.currentPage === 'text';
  state.activeTranscriptId = null;
  els.editTranscript.textContent = 'Редактировать';
  els.readTranscript.textContent = 'Просмотр';
  els.readTranscript.setAttribute('aria-pressed', String(state.currentPage === 'text'));
  if (els.transcriptSearch) els.transcriptSearch.value = '';

  renderSidebar();
  renderDetails();
  renderNotes();
  renderRecordingPage();
  renderTranscript();
  renderRecognitionState();
  showRecording({ updateUrl });
  await prepareAudio(file);
}

function renderDetails() {
  const file = state.selectedFile;
  const group = state.selectedGroup;
  if (!file || !group) return renderEmptyRecording();

  els.currentFileTitle.textContent = file.name;
  els.renameFile.disabled = false;
  els.metaGroup.textContent = group.name;
  els.metaDate.textContent = formatDate(group.assignedDate);
  els.metaPurpose.textContent = group.purpose || '—';
  els.metaCount.textContent = String(group.files.length);
  els.metaFile.textContent = file.name;
  els.metaDuration.textContent = file.durationSec ? formatDuration(file.durationSec) : '—';
  els.metaFormat.textContent = file.format || getFormat(file.name, file.type);
  els.metaSize.textContent = formatBytes(file.size);
  els.metaUploaded.textContent = formatDateTime(file.uploadedAt);
  renderRecognitionMetadata(file);
  els.noteTitle.value = file.noteTitle || '';
  els.deleteRecording.disabled = Boolean(recognitionFor(file.id)?.status === 'running' || state.groupRecognition?.running);
}

function renderEmptyRecording() {
  state.selectedFile = null;
  state.selectedGroup = null;
  revokeObjectUrl();
  els.currentFileTitle.textContent = 'No recording selected';
  els.renameFile.disabled = true;
  els.playBtn.disabled = true;
  els.playerTime.textContent = '00:00:00';
  els.playerDuration.textContent = '00:00:00';
  els.seek.value = 0;
  els.seek.max = 1;
  els.audioNotice.textContent = '';
  clearWaveform();
  els.transcriptRows.innerHTML = '<div class="transcript-empty"><div><strong>No recordings yet</strong>Upload audio files to create your first local group.</div></div>';
  els.noteTitle.value = '';
  els.noteList.innerHTML = '<div class="notes-empty">No recording selected.</div>';
  [els.metaGroup, els.metaDate, els.metaPurpose, els.metaCount, els.metaFile, els.metaDuration, els.metaFormat, els.metaSize, els.metaUploaded]
    .forEach((element) => { element.textContent = '—'; });
  els.metaRecognitionSection.classList.add('hidden');
  els.deleteRecording.disabled = true;
  renderRecognitionState();
}

async function renameSelectedFile() {
  const file = state.selectedFile;
  if (!file) return;
  const nextName = window.prompt('Новое название записи', file.name);
  if (nextName === null) return;
  const name = nextName.trim();
  if (!name) return showToast('Название записи не может быть пустым.', true);
  if (name === file.name) return;
  file.name = name;
  await persistCurrentFile();
  renderSidebar();
  renderDetails();
  showToast('Название записи обновлено.');
}

function renderNotes() {
  const file = state.selectedFile;
  els.noteList.innerHTML = '';
  if (!file) return;

  if (!file.notes?.length) {
    const empty = document.createElement('div');
    empty.className = 'notes-empty';
    empty.textContent = 'No notes for this recording.';
    els.noteList.appendChild(empty);
    return;
  }

  file.notes.forEach((note) => {
    const row = document.createElement('div');
    row.className = 'note-row';

    const dot = document.createElement('span');
    dot.textContent = '•';
    const text = document.createElement('div');
    text.className = 'note-text';
    text.contentEditable = 'true';
    text.textContent = note.text;
    text.addEventListener('blur', async () => {
      note.text = text.textContent.trim();
      await persistCurrentFile();
    });

    const remove = document.createElement('button');
    remove.className = 'note-action';
    remove.title = 'Delete note';
    remove.textContent = '⌫';
    remove.addEventListener('click', async () => {
      file.notes = file.notes.filter((item) => item.id !== note.id);
      await persistCurrentFile();
      renderNotes();
    });

    row.append(dot, text, remove);
    els.noteList.appendChild(row);
  });
}

async function addNote() {
  const file = state.selectedFile;
  if (!file) return;
  file.notes ||= [];
  const note = { id: makeId('note'), text: '' };
  file.notes.push(note);
  await persistCurrentFile();
  renderNotes();
  const texts = els.noteList.querySelectorAll('.note-text');
  const last = texts[texts.length - 1];
  last?.focus();
}

async function persistNoteTitle() {
  if (!state.selectedFile) return;
  state.selectedFile.noteTitle = els.noteTitle.value.trim();
  await persistCurrentFile();
}

function renderTranscript() {
  const file = state.selectedFile;
  els.transcriptRows.innerHTML = '';
  if (!file) return;

  if (state.currentPage === 'result') {
    renderOrthographyResult(file);
    return;
  }

  const query = els.transcriptSearch?.value.trim().toLowerCase() || '';
  const transcript = (file.transcript || []).filter((segment) => {
    if (!query) return true;
    return segment.text.toLowerCase().includes(query)
      || segment.speaker.toLowerCase().includes(query)
      || formatDuration(segment.start).includes(query);
  });

  if (!transcript.length) {
    const empty = document.createElement('div');
    empty.className = 'transcript-empty';
    const wrap = document.createElement('div');
    const strong = document.createElement('strong');
    strong.textContent = query ? 'No matching transcript text' : 'No transcription yet';
    const text = document.createElement('div');
    text.textContent = query
      ? 'Try a different search.'
      : `Use Recognize ${WHISPER_MODEL} to transcribe this recording locally through REA.`;
    wrap.append(strong, text);

    if (!query && state.editingTranscript) {
      const button = document.createElement('button');
      button.className = 'btn btn-dark';
      button.style.marginTop = '14px';
      button.textContent = '+ Add segment';
      button.addEventListener('click', addTranscriptSegment);
      wrap.appendChild(button);
    }

    empty.appendChild(wrap);
    els.transcriptRows.appendChild(empty);
    return;
  }

  if (state.currentPage === 'text') {
    const reading = document.createElement('div');
    reading.className = 'reading-text';
    reading.textContent = transcript.map((segment) => segment.text.trim()).filter(Boolean).join('\n');
    els.transcriptRows.appendChild(reading);
    return;
  }

  transcript.forEach((segment) => {
    const row = document.createElement('div');
    row.className = `transcript-row${segment.id === state.activeTranscriptId ? ' active' : ''}`;
    row.dataset.segmentId = segment.id;

    const time = document.createElement('div');
    time.className = 'time-cell';
    const jump = document.createElement('button');
    jump.textContent = '▶';
    jump.title = 'Jump to this time';
    jump.addEventListener('click', () => setPlaybackTime(segment.start, true));
    const stamp = document.createElement('span');
    stamp.textContent = formatDuration(segment.start);
    const timeMeta = document.createElement('div');
    timeMeta.className = 'time-meta';
    timeMeta.appendChild(stamp);
    time.append(jump, timeMeta);

    const textCell = document.createElement('div');
    textCell.className = 'text-cell';

    if (state.editingTranscript) {
      const speaker = document.createElement('input');
      speaker.className = 'speaker-input time-speaker-input';
      speaker.value = segment.speaker;
      speaker.dataset.role = 'speaker';
      speaker.setAttribute('aria-label', 'Speaker');
      const speech = document.createElement('textarea');
      speech.className = 'speech-input';
      speech.value = segment.text;
      speech.dataset.role = 'speech';
      timeMeta.appendChild(speaker);
      textCell.appendChild(speech);
    } else {
      const speaker = document.createElement('div');
      speaker.className = 'time-speaker';
      speaker.textContent = segment.speaker;
      timeMeta.appendChild(speaker);
      const speech = document.createElement('div');
      speech.className = 'speech';
      speech.textContent = segment.text;
      textCell.appendChild(speech);
    }

    row.append(time, textCell);
    els.transcriptRows.appendChild(row);
  });

  if (state.editingTranscript && !query) {
    const footer = document.createElement('div');
    footer.style.padding = '12px';
    footer.style.textAlign = 'center';
    const button = document.createElement('button');
    button.className = 'btn btn-dark';
    button.textContent = '+ Add segment at current time';
    button.addEventListener('click', addTranscriptSegment);
    footer.appendChild(button);
    els.transcriptRows.appendChild(footer);
  }
}

async function toggleTranscriptEdit() {
  if (!state.selectedFile) return;

  if (state.editingTranscript) {
    collectTranscriptEdits();
    invalidateOrthographyResult(state.selectedFile);
    state.editingTranscript = false;
    await persistCurrentFile();
    els.editTranscript.textContent = 'Редактировать';
  } else {
    if (state.currentPage !== 'segments') await setRecordingPage('segments');
    state.editingTranscript = true;
    els.editTranscript.textContent = 'Готово';
  }
  renderTranscript();
}

async function toggleTranscriptRead() {
  if (!state.selectedFile) return;
  await setRecordingPage('text');
}

async function correctTranscriptOrthography() {
  const file = state.selectedFile;
  if (!file?.transcript?.length || state.orthographyRunning) return;

  if (state.editingTranscript) {
    collectTranscriptEdits();
    invalidateOrthographyResult(file);
    state.editingTranscript = false;
    els.editTranscript.textContent = 'Редактировать';
    await persistCurrentFile();
  }

  const segments = file.transcript
    .filter((segment) => String(segment.text || '').trim())
    .map((segment) => ({ id: segment.id, text: segment.text }));
  if (!segments.length) return showToast('There is no transcript text to correct.', true);

  state.orthographyRunning = true;
  renderRecognitionState();
  try {
    const response = await whisperFetch('/orthography', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ segments })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok || !Array.isArray(data.segments)) {
      throw new Error(data.detail || data.error || `AIB correction failed (${response.status})`);
    }

    const correctedById = new Map(data.segments.map((segment) => [segment.id, segment.text]));
    const correctedSegments = file.transcript.map((segment) => ({
      ...segment,
      text: correctedById.has(segment.id) ? String(correctedById.get(segment.id) || '') : segment.text
    }));
    file.orthographyResult = {
      text: formatOrthographyResult(correctedSegments),
      segments: correctedSegments.map((segment) => ({ id: segment.id, text: segment.text })),
      createdAt: data.correctedAt || new Date().toISOString()
    };
    file.orthographyMeta = {
      method: 'aib',
      model: data.model || 'AIB',
      correctedAt: data.correctedAt || new Date().toISOString()
    };
    await dbPut('files', file);
    for (const group of state.groups) {
      const index = group.files.findIndex((item) => item.id === file.id);
      if (index >= 0) {
        group.files[index] = file;
        break;
      }
    }
    if (state.selectedFile?.id === file.id) {
      state.selectedFile = file;
      renderDetails();
      await setRecordingPage('result');
    }
    showToast(`AIB ${file.orthographyMeta.model} исправил орфографию и пунктуацию.`);
  } catch (error) {
    console.error('AIB orthography correction failed:', error);
    showToast(`Орфо не выполнено: ${error.message || error}`, true);
  } finally {
    state.orthographyRunning = false;
    renderRecognitionState();
  }
}

function formatOrthographyResult(segments) {
  let previousStart = null;
  return segments.reduce((text, segment) => {
    const value = String(segment.text || '').trim();
    if (!value) return text;
    const paragraph = previousStart !== null && Number(segment.start) - previousStart > 12;
    previousStart = Number(segment.start);
    return `${text}${text ? (paragraph ? '\n\n' : ' ') : ''}${value}`;
  }, '');
}

function renderOrthographyResult(file) {
  const textValue = file.orthographyResult?.text || (file.orthographyMeta?.method
    ? (file.transcript || []).map((segment) => String(segment.text || '').trim()).filter(Boolean).join(' ')
    : '');
  if (!textValue) {
    els.transcriptRows.innerHTML = '<div class="transcript-empty"><div><strong>Результата пока нет</strong>Нажмите «Орфо», чтобы получить отформатированный текст.</div></div>';
    return;
  }
  const text = document.createElement('div');
  text.className = 'result-text';
  text.textContent = textValue;
  els.transcriptRows.appendChild(text);
  const meta = document.createElement('div');
  meta.className = 'result-meta';
  meta.textContent = `Орфография и пунктуация: ${file.orthographyMeta?.model || 'AIB'}`;
  els.transcriptRows.appendChild(meta);
}

function collectTranscriptEdits() {
  const file = state.selectedFile;
  if (!file) return;

  els.transcriptRows.querySelectorAll('.transcript-row').forEach((row) => {
    const segment = file.transcript.find((item) => item.id === row.dataset.segmentId);
    if (!segment) return;
    const speaker = row.querySelector('[data-role="speaker"]');
    const speech = row.querySelector('[data-role="speech"]');
    if (speaker) segment.speaker = speaker.value.trim() || 'Speaker';
    if (speech) segment.text = speech.value.trim();
  });
}

function addTranscriptSegment() {
  const file = state.selectedFile;
  if (!file) return;
  collectTranscriptEdits();
  invalidateOrthographyResult(file);
  file.transcript ||= [];
  file.transcript.push({
    id: makeId('segment'),
    start: Math.round(getCurrentPlaybackTime()),
    speaker: 'Speaker 1',
    text: ''
  });
  file.transcript.sort((a, b) => a.start - b.start);
  renderTranscript();
}

function invalidateOrthographyResult(file) {
  if (!file) return;
  delete file.orthographyResult;
  delete file.orthographyMeta;
}

function recognitionFor(fileId) {
  return fileId ? state.recognitionJobs.get(fileId) || null : null;
}

function hasCompletedRecognition(file) {
  return Boolean(file?.transcriptMeta?.method === 'whisper' || file?.transcript?.length);
}

function unrecognizedFiles(group) {
  return group?.files?.filter((file) => !hasCompletedRecognition(file)) || [];
}

function fileById(fileId) {
  for (const group of state.groups) {
    const file = group.files.find((item) => item.id === fileId);
    if (file) return file;
  }
  return null;
}

function appendRecognitionLog(file, level, message) {
  if (!file || !message) return;
  file.recognitionLog ||= [];
  const text = String(message).trim();
  const last = file.recognitionLog[file.recognitionLog.length - 1];
  if (last?.level === level && last?.message === text) return;

  file.recognitionLog.push({ at: new Date().toISOString(), level, message: text });
  if (file.recognitionLog.length > 40) file.recognitionLog.splice(0, file.recognitionLog.length - 40);
  if (level === 'error') state.journalOpen = true;
  if (state.db) dbPut('files', file).catch((error) => console.error('Could not save recognition journal:', error));
  if (state.selectedFile?.id === file.id) renderRecognitionJournal();
  renderFullJournal();
}

function appendAppLog(level, message) {
  const text = String(message || '').trim();
  if (!text) return;
  state.appLog.push({ at: new Date().toISOString(), level, message: text });
  if (state.appLog.length > 20) state.appLog.splice(0, state.appLog.length - 20);
  if (level === 'error') state.journalOpen = true;
  renderRecognitionJournal();
  renderFullJournal();
}

function renderRecognitionJournal() {
  if (!els.recognitionReport || !els.recognitionJournal) return;
  const file = state.selectedFile;
  const job = recognitionFor(file?.id);
  const active = Boolean((job && ['queued', 'running', 'uploading'].includes(job.status)) || state.groupRecognition?.running);
  const entries = [...state.appLog, ...(file?.recognitionLog || [])]
    .sort((left, right) => String(left.at).localeCompare(String(right.at)));
  const shouldShow = state.currentView === 'recording' && state.currentPage === 'segments'
    && (active || (state.journalOpen && entries.length));
  els.recognitionReport.classList.toggle('hidden', !shouldShow);
  if (els.toggleRecognitionJournal) els.toggleRecognitionJournal.setAttribute('aria-pressed', String(shouldShow));
  if (!shouldShow) return;

  if (els.recognitionReportTitle) els.recognitionReportTitle.textContent = file ? 'Activity journal' : 'Application journal';
  els.recognitionReportCurrent.textContent = job && ['queued', 'running', 'uploading'].includes(job.status)
    ? `${job.message || job.phase || 'Работаем…'}${Number.isFinite(Number(job.progress)) ? ` · ${Math.round(Number(job.progress))}%` : ''}`
    : state.groupRecognition?.running
      ? `Обработка папки: ${Math.min(state.groupRecognition.total, state.groupRecognition.finished + 1)}/${state.groupRecognition.total}`
    : entries[entries.length - 1]?.message || '';
  els.recognitionJournal.innerHTML = '';
  [...entries].reverse().slice(0, 16).forEach((entry) => {
    const row = document.createElement('div');
    row.className = `journal-entry ${entry.level || 'info'}`;
    const time = document.createElement('span');
    time.className = 'journal-time';
    time.textContent = formatJournalTime(entry.at);
    const text = document.createElement('span');
    text.className = 'journal-message';
    text.textContent = entry.message;
    row.append(time, text);
    els.recognitionJournal.appendChild(row);
  });
}

function allJournalEntries() {
  const entries = state.appLog.map((entry) => ({ ...entry, source: 'Приложение' }));
  state.groups.forEach((group) => {
    group.files.forEach((file) => {
      (file.recognitionLog || []).forEach((entry) => {
        entries.push({ ...entry, source: file.name, group: group.name });
      });
    });
  });
  return entries.sort((left, right) => String(right.at).localeCompare(String(left.at)));
}

function renderFullJournal() {
  if (!els.fullJournal || state.currentView !== 'journal') return;
  const entries = allJournalEntries();
  els.fullJournal.innerHTML = '';
  if (!entries.length) {
    els.fullJournal.innerHTML = '<div class="journal-empty">Записей в журнале пока нет.</div>';
    return;
  }
  entries.forEach((entry) => {
    const row = document.createElement('article');
    row.className = `full-journal-entry ${entry.level || 'info'}`;
    const time = document.createElement('time');
    time.textContent = formatJournalTime(entry.at);
    const body = document.createElement('div');
    const source = document.createElement('strong');
    source.textContent = entry.group ? `${entry.group} · ${entry.source}` : entry.source;
    const message = document.createElement('p');
    message.textContent = entry.message;
    body.append(source, message);
    row.append(time, body);
    els.fullJournal.appendChild(row);
  });
}

function formatJournalTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(date);
}

function renderRecognitionState() {
  if (!els.recognizeTranscript || !els.recognitionStatus) return;
  renderFullJournal();
  const file = state.selectedFile;
  const group = state.selectedGroup;
  const groupJob = groupRecognitionFor(group?.id);
  const groupPending = unrecognizedFiles(group).length;
  const activeJobs = [...state.recognitionJobs.entries()]
    .filter(([, job]) => ['queued', 'running', 'uploading'].includes(job.status));
  const activeGroupJob = state.groupRecognition?.running ? state.groupRecognition : null;
  const activeFileJob = file ? recognitionFor(file.id) : null;
  const active = activeFileJob && ['queued', 'running', 'uploading'].includes(activeFileJob.status);
  const applicationBusy = Boolean(activeGroupJob || activeJobs.length || state.orthographyRunning);

  if (els.recognizeGroup) {
    els.recognizeGroup.disabled = !group || Boolean(activeGroupJob) || !groupPending;
    const current = groupJob?.running ? Math.min(groupJob.total, groupJob.finished + 1) : 0;
    els.recognizeGroup.textContent = groupJob?.running
      ? `Распознаётся ${current}/${groupJob.total}`
      : groupPending ? `Распознать папку (${groupPending})` : 'Папка распознана';
  }
  els.cancelAllRecognition.disabled = !activeJobs.length && !activeGroupJob;

  if (!file) {
    els.recognizeTranscript.disabled = true;
    els.recognizeTranscript.textContent = `Распознать ${WHISPER_MODEL}`;
    els.recognitionStatus.textContent = activeGroupJob
      ? `Обработка папки: ${Math.min(activeGroupJob.total, activeGroupJob.finished + 1)}/${activeGroupJob.total}`
      : 'Выберите запись для распознавания';
    els.orthographyTranscript.disabled = true;
    els.orthographyTranscript.textContent = 'Орфо';
    els.appProcessing?.classList.toggle('is-processing', applicationBusy);
    renderRecognitionJournal();
    return;
  }

  const job = activeFileJob;
  els.recognizeTranscript.disabled = Boolean(active || activeGroupJob);
  const hasTranscriptText = file.transcript?.some((segment) => String(segment.text || '').trim());
  els.orthographyTranscript.disabled = Boolean(!hasTranscriptText || active || activeGroupJob || state.orthographyRunning);
  els.orthographyTranscript.textContent = state.orthographyRunning ? 'Орфо…' : 'Орфо';

  if (active) {
    const progress = Number(job.progress);
    const suffix = Number.isFinite(progress) ? ` · ${Math.round(progress)}%` : '';
    els.recognizeTranscript.textContent = `Распознаётся${suffix}`;
    els.recognitionStatus.textContent = job.message || job.phase || 'Идёт обработка…';
  } else if (activeGroupJob) {
    const current = Math.min(activeGroupJob.total, activeGroupJob.finished + 1);
    els.recognizeTranscript.textContent = `Распознать ${WHISPER_MODEL}`;
    els.recognitionStatus.textContent = `Обработка папки: ${current}/${activeGroupJob.total}`;
  } else {
    els.recognizeTranscript.textContent = hasCompletedRecognition(file)
      ? `Распознать снова · ${WHISPER_MODEL}`
      : `Распознать ${WHISPER_MODEL}`;
    if (job?.status === 'error') els.recognitionStatus.textContent = job.error || 'Ошибка распознавания';
    else if (file.transcriptMeta?.model) els.recognitionStatus.textContent = `Готово · Whisper ${file.transcriptMeta.model}`;
    else els.recognitionStatus.textContent = 'Готово к распознаванию';
  }
  els.appProcessing?.classList.toggle('is-processing', applicationBusy);
  renderRecognitionJournal();
}

async function removeStoredDuplicates() {
  if (!state.db) return 0;
  const files = await dbGetAll('files');
  const byGroup = new Map();
  files.forEach((file) => {
    const groupFiles = byGroup.get(file.groupId) || [];
    groupFiles.push(file);
    byGroup.set(file.groupId, groupFiles);
  });

  const duplicateIds = [];
  byGroup.forEach((groupFiles) => {
    const seen = new Set();
    groupFiles
      .sort((left, right) => String(left.uploadedAt).localeCompare(String(right.uploadedAt)))
      .forEach((file) => {
        const key = fileDuplicateKey(file);
        if (seen.has(key)) duplicateIds.push(file.id);
        else seen.add(key);
      });
  });

  await Promise.all(duplicateIds.flatMap((id) => [dbDelete('files', id), dbDelete('blobs', id)]));
  return duplicateIds.length;
}

async function removeWm0825July14Files() {
  if (!state.db || localStorage.getItem(WM_0825_JULY_14_CLEANUP_KEY)) return 0;
  const groups = await dbGetAll('groups');
  const target = groups.find((group) => String(group.name).trim() === 'WM-0825');
  if (!target) return 0;

  const files = await dbGetAll('files');
  const removeIds = files
    .filter((file) => file.groupId === target.id && /^2026[_-]07[_-]14(?:[_-]|$)/.test(String(file.name)))
    .map((file) => file.id);
  await Promise.all(removeIds.flatMap((id) => [dbDelete('files', id), dbDelete('blobs', id)]));
  localStorage.setItem(WM_0825_JULY_14_CLEANUP_KEY, 'done');
  return removeIds.length;
}

async function deleteRecording(file, group) {
  if (!file || !group || !state.db) return;
  if (recognitionFor(file.id)?.status === 'running' || state.groupRecognition?.running) {
    showToast('Wait for recognition to finish before deleting this recording.', true);
    return;
  }
  if (!window.confirm(`Delete “${file.name}” from “${group.name}”? The audio file and its transcript will be removed from this browser.`)) return;

  await Promise.all([dbDelete('files', file.id), dbDelete('blobs', file.id)]);
  group.files = group.files.filter((item) => item.id !== file.id);
  if (!group.files.length) {
    await dbDelete('groups', group.id);
    state.groups = state.groups.filter((item) => item.id !== group.id);
  }

  if (state.selectedFile?.id === file.id) {
    const nextGroup = group.files.length ? group : state.groups[0];
    const nextFile = nextGroup?.files?.[0];
    if (nextFile) await selectFile(nextFile, nextGroup);
    else {
      renderEmptyRecording();
      showRecording();
    }
  } else {
    renderSidebar();
    renderDetails();
  }
  showToast(`Deleted “${file.name}”.`);
}

function groupRecognitionFor(groupId) {
  return state.groupRecognition?.groupId === groupId ? state.groupRecognition : null;
}

function groupForFile(fileId) {
  return state.groups.find((group) => group.files.some((file) => file.id === fileId)) || null;
}

function currentApplicationQueue() {
  const groupJob = state.groupRecognition;
  if (groupJob) {
    const group = state.groups.find((item) => item.id === groupJob.groupId) || null;
    const currentFile = fileById(groupJob.currentFileId);
    const active = Boolean(groupJob.running);
    const total = Math.max(0, Number(groupJob.total) || 0);
    const completed = Math.min(total, Math.max(0, Number(groupJob.finished) || 0));
    return {
      clientId: APP_QUEUE_CLIENT_ID,
      active,
      groupName: group?.name || '',
      currentFileName: active ? currentFile?.name || '' : '',
      total,
      currentPosition: active && currentFile ? Math.min(total, completed + 1) : 0,
      completed
    };
  }

  const activeEntry = [...state.recognitionJobs.entries()].find(([, job]) => ['uploading', 'queued', 'running'].includes(job?.status));
  if (!activeEntry) {
    return { clientId: APP_QUEUE_CLIENT_ID, active: false, groupName: '', currentFileName: '', total: 0, currentPosition: 0, completed: 0 };
  }

  const [fileId] = activeEntry;
  const file = fileById(fileId);
  const group = groupForFile(fileId);
  return {
    clientId: APP_QUEUE_CLIENT_ID,
    active: true,
    groupName: group?.name || '',
    currentFileName: file?.name || '',
    total: 1,
    currentPosition: 1,
    completed: 0
  };
}

function syncApplicationQueue() {
  const queue = currentApplicationQueue();
  const signature = JSON.stringify(queue);
  if (signature === state.appQueueSignature) return;
  state.appQueueSignature = signature;
  whisperFetch('/app-queue', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: signature
  }).catch((error) => console.debug('Could not update local REA queue state:', error));
}

async function whisperFetch(path, options = {}) {
  const url = `${WHISPER_API_BASE}${path}`;
  const init = { cache: 'no-store', ...options };
  try {
    return await fetch(new Request(url, { ...init, targetAddressSpace: 'loopback' }));
  } catch {
    return fetch(url, init);
  }
}

async function recognizeSelectedFile() {
  const file = state.selectedFile;
  if (!file || !state.db) return;
  if (recognitionFor(file.id)?.status === 'running') return;

  if (hasCompletedRecognition(file)) {
    const replace = window.confirm('Replace the current transcript with a new Whisper recognition?');
    if (!replace) return;
  }

  try {
    await startRecognitionForFile(file);
  } catch (error) {
    console.error(error);
    showToast(`Whisper could not start: ${error.message || error}`, true);
  }
}

async function startRecognitionForFile(file) {
  let stored;
  try {
    stored = await dbGet('blobs', file.id);
  } catch (error) {
    console.error(error);
  }
  if (!stored?.blob) {
    appendRecognitionLog(file, 'error', 'Audio data is missing from local storage.');
    throw new Error('Audio data is missing from local storage.');
  }

  const localJob = {
    id: null,
    status: 'uploading',
    phase: 'uploading',
    progress: 0,
    message: 'Sending audio to local REA Whisper…',
    model: WHISPER_MODEL
  };
  state.recognitionJobs.set(file.id, localJob);
  syncApplicationQueue();
  appendRecognitionLog(file, 'info', localJob.message);
  renderRecognitionState();
  if (state.groupRecognition?.currentFileId === file.id) renderSidebar();

  try {
    const form = new FormData();
    form.append('file', stored.blob, file.name);
    const response = await whisperFetch(`/jobs/file?model=${encodeURIComponent(WHISPER_MODEL)}`, {
      method: 'POST',
      body: form
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok || !data.job?.id) {
      throw new Error(data.detail || data.error || `Whisper upload failed (${response.status})`);
    }

    state.recognitionJobs.set(file.id, { ...data.job });
    syncApplicationQueue();
    appendRecognitionLog(file, 'info', data.job.message || 'Recognition job queued.');
    renderRecognitionState();
    if (state.groupRecognition?.currentFileId === file.id) renderSidebar();
    return await pollRecognitionJob(file.id, data.job.id);
  } catch (error) {
    console.error(error);
    state.recognitionJobs.set(file.id, {
      ...localJob,
      status: 'error',
      phase: 'error',
      error: error.message || String(error),
      message: 'Recognition could not start.'
    });
    syncApplicationQueue();
    appendRecognitionLog(file, 'error', `Could not start recognition: ${error.message || error}`);
    renderRecognitionState();
    throw error;
  }
}

async function pollRecognitionJob(fileId, jobId) {
  while (true) {
    await delay(document.visibilityState === 'visible' ? 900 : 2500);

    let response;
    let data;
    try {
      response = await whisperFetch(`/jobs/${encodeURIComponent(jobId)}`);
      data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok || !data.job) {
        throw new Error(data.detail || data.error || `Whisper job check failed (${response.status})`);
      }
    } catch (error) {
      console.error(error);
      state.recognitionJobs.set(fileId, {
        id: jobId,
        status: 'error',
        phase: 'error',
        error: error.message || String(error),
        message: 'Lost connection to the REA Whisper job.'
      });
      syncApplicationQueue();
      appendRecognitionLog(fileById(fileId), 'error', `Lost connection to REA Whisper: ${error.message || error}`);
      if (state.selectedFile?.id === fileId) renderRecognitionState();
      throw new Error(error.message || String(error));
    }

    const previous = recognitionFor(fileId);
    const job = data.job;
    state.recognitionJobs.set(fileId, { ...job });
    syncApplicationQueue();
    if (previous?.phase !== job.phase || previous?.status !== job.status) {
      appendRecognitionLog(fileById(fileId), job.status === 'error' || job.status === 'cancelled' ? 'error' : 'info', job.error || job.message || job.phase || job.status);
    }
    if (state.selectedFile?.id === fileId) renderRecognitionState();
    if (state.groupRecognition?.currentFileId === fileId) renderSidebar();

    if (job.status === 'done') {
      if (!job.result?.ok) {
        state.recognitionJobs.set(fileId, {
          ...job,
          status: 'error',
          error: 'Recognition completed without a transcript.'
        });
        if (state.selectedFile?.id === fileId) renderRecognitionState();
        appendRecognitionLog(fileById(fileId), 'error', 'Recognition completed without a transcript.');
        throw new Error('Recognition completed without a transcript.');
      }
      await applyRecognitionResult(fileId, job.result);
      state.recognitionJobs.delete(fileId);
      syncApplicationQueue();
      if (state.selectedFile?.id === fileId) renderRecognitionState();
      return job.result;
    }

    if (job.status === 'error' || job.status === 'cancelled') {
      appendRecognitionLog(fileById(fileId), 'error', job.error || job.message || `Recognition ${job.status}.`);
      if (state.selectedFile?.id === fileId) renderRecognitionState();
      throw new Error(job.error || job.message || (job.status === 'cancelled' ? 'Recognition was cancelled.' : 'Whisper recognition failed.'));
    }
  }
}

async function recognizeCurrentGroup() {
  await recognizeGroup(state.selectedGroup);
}

async function cancelAllRecognition() {
  if (!els.cancelAllRecognition || els.cancelAllRecognition.disabled) return;
  els.cancelAllRecognition.disabled = true;
  els.cancelAllRecognition.textContent = 'Останавливаем…';
  if (state.groupRecognition?.running) state.groupRecognition.cancelRequested = true;

  try {
    const response = await whisperFetch('/jobs/cancel-all', { method: 'POST' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) throw new Error(data.detail || data.error || `Stop request failed (${response.status})`);
    state.recognitionJobs.forEach((job, fileId) => {
      if (['queued', 'running', 'uploading'].includes(job.status)) {
        appendRecognitionLog(fileById(fileId), 'info', 'Stop all recognition requested.');
      }
    });
    showToast(data.cancelRequested ? `Stop requested for ${data.cancelRequested} recognition job(s).` : 'There are no active recognition jobs.');
  } catch (error) {
    console.error('Could not cancel recognition jobs:', error);
    showToast(`Could not stop recognition: ${error.message || error}`, true);
  } finally {
    els.cancelAllRecognition.disabled = false;
    els.cancelAllRecognition.textContent = 'Остановить всё';
    renderRecognitionState();
  }
}

async function recognizeGroup(group) {
  if (!group || state.groupRecognition?.running) return;
  const files = unrecognizedFiles(group);
  if (!files.length) return showToast('Every recording in this folder already has a transcript.');

  try {
    const response = await whisperFetch('/health');
    const health = await response.json().catch(() => ({}));
    if (!response.ok || health?.ok === false) throw new Error(health.detail || `REA Whisper health check failed (${response.status})`);
  } catch (error) {
    showToast('REA Whisper is unavailable. Open Settings → Test connection for the reason.', true);
    return;
  }

  const groupJob = { groupId: group.id, total: files.length, finished: 0, failed: 0, running: true, cancelRequested: false, currentFileId: null };
  state.groupRecognition = groupJob;
  syncApplicationQueue();
  renderRecognitionState();
  renderSidebar();

  try {
    for (const file of files) {
      if (groupJob.cancelRequested) break;
      groupJob.currentFileId = file.id;
      syncApplicationQueue();
      renderRecognitionState();
      renderSidebar();
      try {
        await startRecognitionForFile(file);
      } catch (error) {
        console.error('Folder recognition failed:', error);
        groupJob.failed += 1;
      } finally {
        groupJob.finished += 1;
        syncApplicationQueue();
        renderRecognitionState();
        renderSidebar();
      }
    }
  } finally {
    groupJob.running = false;
    groupJob.currentFileId = null;
    syncApplicationQueue();
    renderRecognitionState();
    renderSidebar();
  }

  const { total, failed } = groupJob;
  if (groupJob.cancelRequested) showToast(`Folder recognition stopped after ${groupJob.finished}/${total} files.`);
  else showToast(failed ? `Folder recognition finished: ${total - failed} completed, ${failed} failed.` : `Folder recognition complete: ${total} files.`);
}

async function applyRecognitionResult(fileId, result) {
  const storedFile = await dbGet('files', fileId);
  if (!storedFile) throw new Error('REA could not find the recording after recognition.');

  const segments = Array.isArray(result.segments) ? result.segments : [];
  storedFile.transcript = segments.map((segment) => ({
    id: makeId('segment'),
    start: Number(segment.start || 0),
    speaker: 'Speaker 1',
    text: String(segment.text || '').trim()
  }));
  invalidateOrthographyResult(storedFile);
  storedFile.transcriptMeta = {
    method: 'whisper',
    model: result.model || WHISPER_MODEL,
    language: result.language || '',
    languageProbability: result.languageProbability ?? null,
    device: result.device || '',
    computeType: result.computeType || '',
    audioDurationSeconds: result.audioDurationSeconds ?? null,
    downloadSeconds: result.downloadSeconds ?? null,
    modelLoadSeconds: result.modelLoadSeconds ?? null,
    transcriptionSeconds: result.transcriptionSeconds ?? null,
    totalSeconds: result.totalSeconds ?? null,
    realtimeFactor: result.realtimeFactor ?? null,
    wordCount: result.wordCount ?? null,
    finishedAt: result.finishedAt || new Date().toISOString()
  };
  appendRecognitionLog(storedFile, 'success', `Recognition complete: ${storedFile.transcript.length} segments.`);
  await dbPut('files', storedFile);

  for (const group of state.groups) {
    const index = group.files.findIndex((item) => item.id === fileId);
    if (index >= 0) {
      group.files[index] = storedFile;
      if (state.selectedGroup?.id === group.id) state.selectedGroup = group;
      break;
    }
  }

  if (state.selectedFile?.id === fileId) {
    state.selectedFile = storedFile;
    state.editingTranscript = false;
    state.activeTranscriptId = null;
    els.editTranscript.textContent = 'Редактировать';
    renderTranscript();
    renderDetails();
    renderSidebar();
    showToast(`Whisper ${storedFile.transcriptMeta.model} finished: ${storedFile.transcript.length} segments.`);
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function activateTab(button) {
  await setRecordingPage(button.dataset.page);
}

async function prepareAudio(file) {
  revokeObjectUrl();
  els.audio.pause();
  els.audio.removeAttribute('src');
  els.audio.load();
  els.playBtn.textContent = '▶';
  els.playerTime.textContent = '00:00:00';
  els.playerDuration.textContent = file.durationSec ? formatDuration(file.durationSec) : '00:00:00';
  els.seek.min = 0;
  els.seek.max = Math.max(file.durationSec || 1, 1);
  els.seek.value = 0;
  updateWaveCursor(0);
  els.audioNotice.className = 'audio-notice';
  els.audioNotice.textContent = '';

  if (!state.db) {
    els.playBtn.disabled = true;
    clearWaveform();
    return;
  }

  try {
    const stored = await dbGet('blobs', file.id);
    if (!stored?.blob) throw new Error('Audio data is missing');
    state.currentObjectUrl = URL.createObjectURL(stored.blob);
    els.audio.src = state.currentObjectUrl;
    els.audio.volume = Number(els.volume.value);
    els.audio.playbackRate = Number(els.playbackRate.value);
    els.playBtn.disabled = false;
    await drawWaveformFromBlob(stored.blob, file.name);
  } catch (error) {
    console.error(error);
    els.playBtn.disabled = true;
    els.audioNotice.className = 'audio-notice error';
    els.audioNotice.textContent = 'The audio file could not be loaded from local storage.';
    clearWaveform();
  }
}

async function togglePlayback() {
  if (els.playBtn.disabled || !els.audio.src) return;
  if (els.audio.paused) {
    try {
      await els.audio.play();
      els.playBtn.textContent = 'Ⅱ';
    } catch (error) {
      console.error(error);
      showToast('Playback could not start.', true);
    }
  } else {
    els.audio.pause();
    els.playBtn.textContent = '▶';
  }
}

function seekBy(delta) {
  setPlaybackTime(getCurrentPlaybackTime() + delta, true);
}

function getCurrentPlaybackTime() {
  return els.audio.src ? els.audio.currentTime : Number(els.seek.value || 0);
}

function setPlaybackTime(time, updateAudio) {
  const max = Number(els.seek.max) || state.selectedFile?.durationSec || 1;
  const safe = Math.max(0, Math.min(Number(time) || 0, max));
  els.seek.value = String(safe);
  els.playerTime.textContent = formatDuration(safe);
  updateWaveCursor(max ? safe / max : 0);

  if (updateAudio && els.audio.src && Number.isFinite(els.audio.duration)) {
    els.audio.currentTime = Math.min(safe, els.audio.duration || safe);
  }
  syncTranscript(safe);
}

function updateWaveCursor(ratio) {
  els.waveCursor.style.left = `${Math.max(0, Math.min(1, ratio)) * 100}%`;
}

function syncTranscript(time) {
  const transcript = state.selectedFile?.transcript || [];
  if (!transcript.length) return;

  let active = transcript[0];
  for (const segment of transcript) {
    if (segment.start <= time) active = segment;
    else break;
  }

  if (state.activeTranscriptId === active.id) return;
  state.activeTranscriptId = active.id;
  els.transcriptRows.querySelectorAll('.transcript-row').forEach((row) => {
    row.classList.toggle('active', row.dataset.segmentId === active.id);
  });
  const activeRow = els.transcriptRows.querySelector(`[data-segment-id="${CSS.escape(active.id)}"]`);
  activeRow?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

async function drawWaveformFromBlob(blob, seed) {
  if (blob.size > 180 * 1024 * 1024) {
    drawFallbackWaveform(seed);
    els.audioNotice.textContent = 'Waveform preview is simplified for this large file.';
    return;
  }

  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) throw new Error('Web Audio API unavailable');
    const context = new AudioContextClass();
    const buffer = await context.decodeAudioData(await blob.arrayBuffer());
    drawSamples(buffer.getChannelData(0));
    await context.close();
  } catch (error) {
    console.warn('Waveform decode failed, using fallback.', error);
    drawFallbackWaveform(seed);
  }
}

function drawSamples(samples) {
  const { ctx, width, height } = prepareCanvas();
  const bars = Math.max(80, Math.floor(width / 5));
  const block = Math.max(1, Math.floor(samples.length / bars));
  const mid = height / 2;
  ctx.strokeStyle = '#f4c32e';
  ctx.lineWidth = Math.max(1, window.devicePixelRatio || 1);
  ctx.beginPath();

  for (let i = 0; i < bars; i += 1) {
    let peak = 0;
    const start = i * block;
    const end = Math.min(samples.length, start + block);
    for (let j = start; j < end; j += Math.max(1, Math.floor(block / 80))) {
      peak = Math.max(peak, Math.abs(samples[j] || 0));
    }
    const amplitude = Math.max(2, peak * height * 0.46);
    const x = (i / Math.max(1, bars - 1)) * width;
    ctx.moveTo(x, mid - amplitude);
    ctx.lineTo(x, mid + amplitude);
  }
  ctx.stroke();
}

function drawFallbackWaveform(seed = 'rea') {
  const { ctx, width, height } = prepareCanvas();
  const bars = Math.max(80, Math.floor(width / 5));
  const random = seededRandom(hashString(seed));
  const mid = height / 2;
  ctx.strokeStyle = '#f4c32e';
  ctx.lineWidth = Math.max(1, window.devicePixelRatio || 1);
  ctx.beginPath();

  for (let i = 0; i < bars; i += 1) {
    const envelope = 0.25 + 0.75 * Math.sin((i / bars) * Math.PI);
    const amplitude = Math.max(2, (0.08 + random() * 0.72) * envelope * height * 0.46);
    const x = (i / Math.max(1, bars - 1)) * width;
    ctx.moveTo(x, mid - amplitude);
    ctx.lineTo(x, mid + amplitude);
  }
  ctx.stroke();
}

function drawSelectedWaveform() {
  if (!state.selectedFile) return clearWaveform();
  if (!els.audio.src) return clearWaveform();
  drawFallbackWaveform(state.selectedFile.name);
}

function clearWaveform() {
  const { ctx, width, height } = prepareCanvas();
  ctx.clearRect(0, 0, width, height);
}

function prepareCanvas() {
  const canvas = els.waveCanvas;
  const rect = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.floor(rect.width * ratio));
  canvas.height = Math.max(1, Math.floor(rect.height * ratio));
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  return { ctx, width: canvas.width, height: canvas.height };
}

async function addStagedFiles(files) {
  const audioFiles = files.filter(isAudioFile);
  if (!audioFiles.length) {
    showToast('No supported audio files were found.', true);
    return;
  }

  const existing = new Set([
    ...state.stagedFiles.map(fileDuplicateKey),
    ...state.groups.flatMap((group) => group.files.map(fileDuplicateKey))
  ]);
  const seen = new Set();
  const skipped = [];
  const uniqueFiles = audioFiles.filter((file) => {
    const key = fileDuplicateKey(file);
    if (existing.has(key) || seen.has(key) || state.stagingKeys.has(key)) {
      skipped.push(file);
      return false;
    }
    seen.add(key);
    state.stagingKeys.add(key);
    return true;
  });
  if (!uniqueFiles.length) {
    showToast(`All ${skipped.length} selected files are already in REA or the upload queue.`);
    return;
  }

  let additions;
  try {
    additions = await Promise.all(uniqueFiles.map(async (file) => ({
      id: makeId('file'),
      file,
      name: file.name,
      size: file.size,
      type: file.type,
      format: getFormat(file.name, file.type),
      durationSec: await readAudioDuration(file),
      dateAdded: new Date().toISOString()
    })));
  } finally {
    uniqueFiles.forEach((file) => state.stagingKeys.delete(fileDuplicateKey(file)));
  }

  state.stagedFiles.push(...additions);
  renderUploadRows();
  if (skipped.length) showToast(`Added ${additions.length}; skipped ${skipped.length} duplicate${skipped.length === 1 ? '' : 's'}.`);
}

function renderUploadRows() {
  els.uploadRows.innerHTML = '';
  els.uploadEmpty.classList.toggle('hidden', state.stagedFiles.length > 0);

  state.stagedFiles.forEach((item, index) => {
    const row = document.createElement('tr');
    const number = document.createElement('td');
    number.textContent = String(index + 1);

    const name = document.createElement('td');
    const icon = document.createElement('span');
    icon.className = 'file-icon';
    icon.textContent = '≋';
    name.append(icon, document.createTextNode(item.name));

    const date = document.createElement('td');
    date.textContent = formatDateTime(item.dateAdded);
    const duration = document.createElement('td');
    duration.textContent = item.durationSec ? formatDuration(item.durationSec) : '—';
    const size = document.createElement('td');
    size.textContent = formatBytes(item.size);
    const action = document.createElement('td');
    const remove = document.createElement('button');
    remove.className = 'remove-file';
    remove.textContent = '×';
    remove.addEventListener('click', () => {
      state.stagedFiles.splice(index, 1);
      renderUploadRows();
    });
    action.appendChild(remove);

    row.append(number, name, date, duration, size, action);
    els.uploadRows.appendChild(row);
  });

  const total = state.stagedFiles.reduce((sum, item) => sum + item.size, 0);
  els.fileCount.textContent = String(state.stagedFiles.length);
  els.totalSize.textContent = formatBytes(total);
  els.infoCount.textContent = String(state.stagedFiles.length);
  els.infoSize.textContent = `${formatBytes(total)} total`;
}

async function saveUploadGroup() {
  const name = els.groupName.value.trim();
  const assignedDate = els.assignedDate.value;
  const purpose = els.groupPurpose.value.trim();

  if (!name) return showToast('Enter a group name.', true);
  if (!assignedDate) return showToast('Choose an assigned date.', true);
  if (!state.stagedFiles.length) return showToast('Add at least one audio file.', true);
  if (!state.db) return showToast('Local database is unavailable in this browser.', true);

  els.addToApp.disabled = true;
  els.addToApp.textContent = 'Adding…';

  try {
    const group = {
      id: makeId('group'),
      name,
      assignedDate,
      purpose,
      createdAt: new Date().toISOString()
    };
    await dbPut('groups', group);

    const createdFiles = [];
    for (const staged of state.stagedFiles) {
      const record = {
        id: staged.id,
        groupId: group.id,
        name: staged.name,
        durationSec: staged.durationSec || 0,
        size: staged.size,
        type: staged.type,
        format: staged.format,
        uploadedAt: staged.dateAdded,
        noteTitle: '',
        notes: [],
        transcript: []
      };
      await dbPut('files', record);
      await dbPut('blobs', { id: staged.id, blob: staged.file });
      createdFiles.push(record);
    }

    const newGroup = { ...group, files: createdFiles };
    state.groups.unshift(newGroup);
    state.stagedFiles = [];
    els.groupName.value = '';
    els.groupPurpose.value = '';
    setDefaultDate();
    renderUploadRows();
    renderSidebar();
    await selectFile(createdFiles[0], newGroup);
    showToast(`Added ${createdFiles.length} file${createdFiles.length === 1 ? '' : 's'} to “${group.name}”.`);
  } catch (error) {
    console.error(error);
    showToast('The files could not be saved. Check browser storage space and try again.', true);
  } finally {
    els.addToApp.disabled = false;
    els.addToApp.innerHTML = '⇧ &nbsp; Add to app';
  }
}

function isAudioFile(file) {
  if (file.type?.startsWith('audio/')) return true;
  const ext = file.name.split('.').pop()?.toLowerCase();
  return AUDIO_EXTENSIONS.includes(ext);
}

function readAudioDuration(file) {
  return new Promise((resolve) => {
    const audio = document.createElement('audio');
    const url = URL.createObjectURL(file);
    const done = (value) => {
      URL.revokeObjectURL(url);
      audio.remove();
      resolve(Number.isFinite(value) ? value : 0);
    };
    audio.preload = 'metadata';
    audio.addEventListener('loadedmetadata', () => done(audio.duration), { once: true });
    audio.addEventListener('error', () => done(0), { once: true });
    audio.src = url;
  });
}

async function persistCurrentFile() {
  if (!state.selectedFile || !state.db) return;
  await dbPut('files', { ...state.selectedFile });
}

function revokeObjectUrl() {
  if (!state.currentObjectUrl) return;
  URL.revokeObjectURL(state.currentObjectUrl);
  state.currentObjectUrl = null;
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.addEventListener('upgradeneeded', () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('groups')) db.createObjectStore('groups', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('files')) {
        const files = db.createObjectStore('files', { keyPath: 'id' });
        files.createIndex('groupId', 'groupId', { unique: false });
      }
      if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs', { keyPath: 'id' });
    });
    request.addEventListener('success', () => resolve(request.result));
    request.addEventListener('error', () => reject(request.error));
  });
}

function dbGetAll(storeName) {
  return dbRequest(storeName, 'readonly', (store) => store.getAll());
}

function dbGet(storeName, key) {
  return dbRequest(storeName, 'readonly', (store) => store.get(key));
}

function dbPut(storeName, value) {
  return dbRequest(storeName, 'readwrite', (store) => store.put(value));
}

function dbDelete(storeName, key) {
  return dbRequest(storeName, 'readwrite', (store) => store.delete(key));
}

function dbRequest(storeName, mode, operation) {
  return new Promise((resolve, reject) => {
    const transaction = state.db.transaction(storeName, mode);
    const store = transaction.objectStore(storeName);
    const request = operation(store);
    request.addEventListener('success', () => resolve(request.result));
    request.addEventListener('error', () => reject(request.error));
    transaction.addEventListener('abort', () => reject(transaction.error));
  });
}

function compareRecordingNames(left, right) {
  return String(left.name || '').localeCompare(String(right.name || ''), undefined, {
    numeric: true,
    sensitivity: 'base'
  });
}

function renderRecognitionMetadata(file) {
  const meta = file.transcriptMeta;
  const hasRecognition = meta?.method === 'whisper';
  els.metaRecognitionSection.classList.toggle('hidden', !hasRecognition);
  if (!hasRecognition) return;

  const execution = [meta.model, meta.device, meta.computeType].filter(Boolean).join(' · ');
  const confidence = meta.languageProbability;
  const language = meta.language
    ? `${meta.language}${confidence !== null && confidence !== undefined && Number.isFinite(Number(confidence)) ? ` (${Math.round(Number(confidence) * 100)}%)` : ''}`
    : '—';
  const words = meta.wordCount === null || meta.wordCount === undefined ? null : Number(meta.wordCount);
  const segments = Array.isArray(file.transcript) ? file.transcript.length : 0;

  els.metaRecognitionModel.textContent = execution || 'Whisper';
  els.metaRecognitionLanguage.textContent = language;
  els.metaRecognitionOutput.textContent = `${Number.isFinite(words) ? words.toLocaleString('en-US') : '—'} / ${segments || '—'}`;
  els.metaRecognitionLoad.textContent = formatProcessingTime(meta.modelLoadSeconds);
  els.metaRecognitionTime.textContent = formatProcessingTime(meta.transcriptionSeconds);
  els.metaRecognitionTotal.textContent = formatProcessingTime(meta.totalSeconds);
  els.metaRecognitionSpeed.textContent = formatProcessingSpeed(meta.realtimeFactor);
  els.metaRecognitionFinished.textContent = formatDateTime(meta.finishedAt);
}

function formatDuration(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  return [hours, minutes, secs].map((value) => String(value).padStart(2, '0')).join(':');
}

function formatProcessingTime(seconds) {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value < 0) return '—';
  if (value < 60) return `${value.toFixed(value < 10 ? 1 : 0)} sec`;
  return formatDuration(value);
}

function formatProcessingSpeed(realtimeFactor) {
  const factor = Number(realtimeFactor);
  if (!Number.isFinite(factor) || factor <= 0) return '—';
  if (factor <= 1) return `${(1 / factor).toFixed(1)}× faster`;
  return `${factor.toFixed(1)}× slower`;
}

function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (!value) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024)));
  const amount = value / (1024 ** index);
  const decimals = amount >= 100 || index === 0 ? 0 : amount >= 10 ? 1 : 2;
  return `${amount.toFixed(decimals)} ${units[index]}`;
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).format(date);
}

function formatDateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
  }).format(date).replace(',', ' ·');
}

function toDateInput(date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function getFormat(name, type = '') {
  const ext = name.split('.').pop();
  if (ext && ext !== name) return ext.toUpperCase();
  return type.split('/').pop()?.toUpperCase() || 'AUDIO';
}

function fileDuplicateKey(file) {
  return `${String(file.name || '').trim().toLocaleLowerCase()}:${Number(file.size) || 0}`;
}

function makeId(prefix) {
  return `${prefix}-${crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
}

function prepareSeededValue(value) {
  return value >>> 0;
}

function hashString(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return prepareSeededValue(hash);
}

function seededRandom(seed) {
  let value = prepareSeededValue(seed || 1);
  return () => {
    value += 0x6D2B79F5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let toastTimer;
function showToast(message, isError = false) {
  clearTimeout(toastTimer);
  els.toast.textContent = message;
  els.toast.classList.toggle('error', isError);
  els.toast.classList.remove('hidden');
  toastTimer = setTimeout(() => els.toast.classList.add('hidden'), 3200);
}
