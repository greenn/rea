const DB_NAME = 'rea-local';
const DB_VERSION = 1;
const AUDIO_EXTENSIONS = ['wav', 'mp3', 'm4a', 'flac', 'ogg', 'aac', 'webm'];

const DEMO_TRANSCRIPT = [
  { id: 'd1', start: 3, speaker: 'Speaker 1', text: 'Привет, давайте начнём нашу встречу. Сегодня обсудим статус проекта и следующие шаги.' },
  { id: 'd2', start: 12, speaker: 'Speaker 2', text: 'Да, конечно. Я подготовил отчёт по последним изменениям. Начну с общей картины.' },
  { id: 'd3', start: 27, speaker: 'Speaker 1', text: 'Отлично. Какие основные результаты за эту неделю?' },
  { id: 'd4', start: 35, speaker: 'Speaker 2', text: 'Мы завершили интеграцию модуля авторизации и приступили к тестированию. Есть один блокирующий баг.' },
  { id: 'd5', start: 51, speaker: 'Speaker 1', text: 'Понял. Сможем показать демо на следующей неделе?' },
  { id: 'd6', start: 56, speaker: 'Speaker 2', text: 'Да, если не возникнет новых проблем.' }
];

const DEMO_GROUPS = [
  {
    id: 'demo-apollo',
    demo: true,
    name: 'Apollo weekly sync',
    assignedDate: '2025-05-18',
    purpose: 'Weekly project sync',
    files: [
      demoFile('demo-a1', '2025-05-18_10-42-33.wav', 8839, 1280 * 1024 * 1024, '2025-05-18T10:45:00', DEMO_TRANSCRIPT, [
        'Integration of auth module completed.',
        'One blocking bug found in testing.',
        'Demo target for next week.'
      ]),
      demoFile('demo-a2', 'Project updates.wav', 2712, 68.4 * 1024 * 1024, '2025-05-18T09:15:00'),
      demoFile('demo-a3', 'Risk review.wav', 2027, 54.1 * 1024 * 1024, '2025-05-18T11:30:00')
    ]
  },
  {
    id: 'demo-client',
    demo: true,
    name: 'Client interview batch',
    assignedDate: '2025-05-17',
    purpose: 'Client interviews',
    files: [
      demoFile('demo-c1', 'Meeting with client.wav', 728, 48.2 * 1024 * 1024, '2025-05-17T17:22:00'),
      demoFile('demo-c2', 'Interview_Anna.mp3', 3751, 72.3 * 1024 * 1024, '2025-05-17T15:40:00'),
      demoFile('demo-c3', 'Call with supplier.wav', 1293, 51.8 * 1024 * 1024, '2025-05-17T13:03:00')
    ]
  }
];

function demoFile(id, name, durationSec, size, uploadedAt, transcript = [], noteTexts = []) {
  return {
    id,
    groupId: id.startsWith('demo-a') ? 'demo-apollo' : 'demo-client',
    demo: true,
    name,
    durationSec,
    size,
    type: name.endsWith('.mp3') ? 'audio/mpeg' : 'audio/wav',
    format: name.split('.').pop().toUpperCase(),
    uploadedAt,
    noteTitle: 'Project status update',
    notes: noteTexts.map((text, index) => ({ id: `${id}-n${index}`, text })),
    transcript: structuredClone(transcript)
  };
}

const state = {
  db: null,
  groups: [],
  selectedGroup: null,
  selectedFile: null,
  stagedFiles: [],
  editingTranscript: false,
  activeTranscriptId: null,
  currentObjectUrl: null,
  dragDepth: 0
};

const els = {};
const $ = (selector) => document.querySelector(selector);

window.addEventListener('DOMContentLoaded', init);

async function init() {
  cacheElements();
  bindEvents();
  setDefaultDate();
  await loadVersion();

  try {
    state.db = await openDatabase();
    await reloadGroups();
  } catch (error) {
    console.error(error);
    state.groups = structuredClone(DEMO_GROUPS);
    showToast('Local storage could not be opened. Demo mode is still available.', true);
  }

  renderSidebar();
  renderUploadRows();

  const firstGroup = state.groups[0];
  if (firstGroup?.files?.[0]) {
    await selectFile(firstGroup.files[0], firstGroup);
  } else {
    renderEmptyRecording();
  }
}

function cacheElements() {
  Object.assign(els, {
    groups: $('#groups'),
    recordingView: $('#recordingView'),
    uploadView: $('#uploadView'),
    recordingSearch: $('#recordingSearch'),
    currentFileTitle: $('#currentFileTitle'),
    audio: $('#audio'),
    playBtn: $('#playBtn'),
    seek: $('#seek'),
    waveCanvas: $('#waveCanvas'),
    waveCursor: $('#waveCursor'),
    waveWrap: $('#waveWrap'),
    playerTime: $('#playerTime'),
    playerDuration: $('#playerDuration'),
    playbackRate: $('#playbackRate'),
    volume: $('#volume'),
    audioNotice: $('#audioNotice'),
    transcriptRows: $('#transcriptRows'),
    transcriptSearch: $('#transcriptSearch'),
    editTranscript: $('#editTranscript'),
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
  els.transcriptSearch.addEventListener('input', renderTranscript);
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
  els.dropzone.addEventListener('drop', async (event) => addStagedFiles([...event.dataTransfer.files]));

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

  els.editTranscript.addEventListener('click', toggleTranscriptEdit);
  $('#addNote').addEventListener('click', addNote);
  els.noteTitle.addEventListener('change', persistNoteTitle);

  document.querySelectorAll('.tabs button').forEach((button) => {
    button.addEventListener('click', () => activateTab(button));
  });

  window.addEventListener('resize', () => drawSelectedWaveform());
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
    // Keep the version embedded in the HTML.
  }
}

function setDefaultDate() {
  const now = new Date();
  els.assignedDate.value = toDateInput(now);
}

function showUpload() {
  els.recordingView.classList.add('hidden');
  els.uploadView.classList.remove('hidden');
}

function showRecording() {
  els.uploadView.classList.add('hidden');
  els.recordingView.classList.remove('hidden');
}

async function reloadGroups() {
  if (!state.db) {
    state.groups = structuredClone(DEMO_GROUPS);
    return;
  }

  const [groups, files] = await Promise.all([
    dbGetAll('groups'),
    dbGetAll('files')
  ]);

  const groupMap = new Map(groups.map((group) => [group.id, { ...group, files: [] }]));
  files.forEach((file) => {
    groupMap.get(file.groupId)?.files.push(file);
  });

  const persisted = [...groupMap.values()]
    .filter((group) => group.files.length)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));

  state.groups = [...structuredClone(DEMO_GROUPS), ...persisted];
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
    head.innerHTML = `<span class="folder-icon">▱</span><span></span><span class="group-count"></span><span class="more">•••</span>`;
    head.children[1].textContent = group.name;
    head.children[2].textContent = String(files.length);
    head.addEventListener('click', () => section.classList.toggle('collapsed'));
    section.appendChild(head);

    files.forEach((file) => {
      const row = document.createElement('div');
      row.className = `recording${state.selectedFile?.id === file.id ? ' selected' : ''}`;
      const play = document.createElement('div');
      play.className = 'record-play';
      play.textContent = '▶';

      const body = document.createElement('div');
      const name = document.createElement('div');
      name.className = 'recording-name';
      name.textContent = file.name;
      const sub = document.createElement('div');
      sub.className = 'recording-sub';
      sub.textContent = formatDateTime(file.uploadedAt);
      body.append(name, sub);

      const duration = document.createElement('div');
      duration.className = 'recording-duration';
      duration.textContent = formatDuration(file.durationSec);
      row.append(play, body, duration);
      row.addEventListener('click', () => selectFile(file, group));
      section.appendChild(row);
    });

    els.groups.appendChild(section);
  });

  if (!renderedCount) {
    const empty = document.createElement('div');
    empty.className = 'sidebar-empty';
    empty.textContent = query ? 'No recordings match this search.' : 'No recordings yet. Upload a group of audio files to start.';
    els.groups.appendChild(empty);
  }
}

async function selectFile(file, group) {
  state.selectedFile = file;
  state.selectedGroup = group;
  state.editingTranscript = false;
  state.activeTranscriptId = null;
  els.editTranscript.textContent = 'Edit';
  els.transcriptSearch.value = '';

  renderSidebar();
  renderDetails();
  renderNotes();
  renderTranscript();
  showRecording();
  await prepareAudio(file);
}

function renderDetails() {
  const file = state.selectedFile;
  const group = state.selectedGroup;
  if (!file || !group) return renderEmptyRecording();

  els.currentFileTitle.textContent = file.name;
  els.metaGroup.textContent = group.name;
  els.metaDate.textContent = formatDate(group.assignedDate);
  els.metaPurpose.textContent = group.purpose || '—';
  els.metaCount.textContent = String(group.files.length);
  els.metaFile.textContent = file.name;
  els.metaDuration.textContent = formatDuration(file.durationSec);
  els.metaFormat.textContent = file.format || getFormat(file.name, file.type);
  els.metaSize.textContent = formatBytes(file.size);
  els.metaUploaded.textContent = formatDateTime(file.uploadedAt);
  els.noteTitle.value = file.noteTitle || '';
}

function renderEmptyRecording() {
  els.currentFileTitle.textContent = 'Select a recording';
  els.playBtn.disabled = true;
  els.transcriptRows.innerHTML = '<div class="transcript-empty"><div><strong>No recording selected</strong>Select a file from the left panel or upload a new group.</div></div>';
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
  const note = { id: makeId('note'), text: 'New note' };
  file.notes.push(note);
  await persistCurrentFile();
  renderNotes();
  const texts = els.noteList.querySelectorAll('.note-text');
  const last = texts[texts.length - 1];
  last?.focus();
  selectEditableText(last);
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

  const query = els.transcriptSearch.value.trim().toLowerCase();
  const transcript = (file.transcript || []).filter((segment) => {
    if (!query) return true;
    return segment.text.toLowerCase().includes(query) || segment.speaker.toLowerCase().includes(query) || formatDuration(segment.start).includes(query);
  });

  if (!transcript.length) {
    const empty = document.createElement('div');
    empty.className = 'transcript-empty';
    const wrap = document.createElement('div');
    const strong = document.createElement('strong');
    strong.textContent = query ? 'No matching transcript text' : 'No transcription yet';
    const text = document.createElement('div');
    text.textContent = query ? 'Try a different search.' : 'Automatic speech recognition is not connected in this frontend build. You can add and edit transcript segments manually.';
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
    time.append(jump, stamp);

    const textCell = document.createElement('div');
    textCell.className = 'text-cell';

    if (state.editingTranscript) {
      const speaker = document.createElement('input');
      speaker.className = 'speaker-input';
      speaker.value = segment.speaker;
      speaker.dataset.role = 'speaker';
      const speech = document.createElement('textarea');
      speech.className = 'speech-input';
      speech.value = segment.text;
      speech.dataset.role = 'speech';
      textCell.append(speaker, speech);
    } else {
      const speaker = document.createElement('div');
      speaker.className = 'speaker';
      speaker.textContent = segment.speaker;
      const speech = document.createElement('div');
      speech.className = 'speech';
      speech.textContent = segment.text;
      textCell.append(speaker, speech);
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
    state.editingTranscript = false;
    await persistCurrentFile();
    els.editTranscript.textContent = 'Edit';
  } else {
    state.editingTranscript = true;
    els.editTranscript.textContent = 'Done';
  }
  renderTranscript();
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
  file.transcript ||= [];
  const current = getCurrentPlaybackTime();
  file.transcript.push({ id: makeId('segment'), start: Math.round(current), speaker: 'Speaker 1', text: 'New transcript segment' });
  file.transcript.sort((a, b) => a.start - b.start);
  renderTranscript();
}

function activateTab(button) {
  document.querySelectorAll('.tabs button').forEach((item) => item.classList.remove('active'));
  button.classList.add('active');
  const target = button.dataset.target;
  if (target === 'transcription' || target === 'speakers' || target === 'insights') {
    $('#transcriptionPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } else if (target === 'notes') {
    $('#notesPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } else {
    $('#overviewPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

async function prepareAudio(file) {
  revokeObjectUrl();
  els.audio.pause();
  els.audio.removeAttribute('src');
  els.audio.load();
  els.playBtn.textContent = '▶';
  els.playerTime.textContent = '00:00:00';
  els.playerDuration.textContent = formatDuration(file.durationSec);
  els.seek.min = 0;
  els.seek.max = Math.max(file.durationSec || 1, 1);
  els.seek.value = 0;
  updateWaveCursor(0);
  els.audioNotice.className = 'audio-notice';

  if (file.demo || !state.db) {
    els.playBtn.disabled = true;
    els.audioNotice.textContent = 'Demo recording: use the waveform slider to test transcript navigation. Upload a real file for audio playback.';
    drawSyntheticWaveform(file.name);
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
    els.audioNotice.textContent = '';
    await drawWaveformFromBlob(stored.blob, file.name);
  } catch (error) {
    console.error(error);
    els.playBtn.disabled = true;
    els.audioNotice.className = 'audio-notice error';
    els.audioNotice.textContent = 'The audio file could not be loaded from local storage.';
    drawSyntheticWaveform(file.name);
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
    drawSyntheticWaveform(seed);
    els.audioNotice.textContent = 'Waveform preview is simplified for large files; playback remains available.';
    return;
  }

  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) throw new Error('Web Audio API unavailable');
    const context = new AudioContextClass();
    const buffer = await context.decodeAudioData(await blob.arrayBuffer());
    const channel = buffer.getChannelData(0);
    drawSamples(channel);
    await context.close();
  } catch (error) {
    console.warn('Waveform decode failed, using fallback.', error);
    drawSyntheticWaveform(seed);
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

function drawSyntheticWaveform(seed = 'rea') {
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
  if (!state.selectedFile) return;
  drawSyntheticWaveform(state.selectedFile.name);
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

  const additions = await Promise.all(audioFiles.map(async (file) => ({
    id: makeId('file'),
    file,
    name: file.name,
    size: file.size,
    type: file.type,
    format: getFormat(file.name, file.type),
    durationSec: await readAudioDuration(file),
    dateAdded: new Date().toISOString()
  })));

  state.stagedFiles.push(...additions);
  renderUploadRows();
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
    state.groups.push(newGroup);
    state.stagedFiles = [];
    els.groupName.value = '';
    els.groupPurpose.value = '';
    setDefaultDate();
    renderUploadRows();
    renderSidebar();
    await selectFile(createdFiles[0], newGroup);
    showToast(`Added ${createdFiles.length} files to “${group.name}”.`);
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
  const file = state.selectedFile;
  if (!file || file.demo || !state.db) return;
  await dbPut('files', { ...file });
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

function formatDuration(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  return [hours, minutes, secs].map((value) => String(value).padStart(2, '0')).join(':');
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

function makeId(prefix) {
  return `${prefix}-${crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
}

function selectEditableText(element) {
  if (!element) return;
  const range = document.createRange();
  range.selectNodeContents(element);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
}

function showToast(message, error = false) {
  els.toast.textContent = message;
  els.toast.classList.toggle('error', error);
  els.toast.classList.remove('hidden');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => els.toast.classList.add('hidden'), 3500);
}

function hashString(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededRandom(seed) {
  let value = seed || 1;
  return () => {
    value += 0x6D2B79F5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
