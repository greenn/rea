const demoGroups = [
  {
    name: 'Apollo weekly sync', count: 3, files: [
      ['2025-05-18_10-42-33.wav','18 May 2025  ·  10:42','02:27:19'],
      ['Project updates.wav','18 May 2025  ·  09:15','00:45:12'],
      ['Risk review.wav','18 May 2025  ·  11:30','00:33:47']
    ]
  },
  {
    name: 'Client interview batch', count: 3, files: [
      ['Meeting with client.wav','17 May 2025  ·  17:22','00:12:08'],
      ['Interview_Anna.mp3','17 May 2025  ·  15:40','01:02:31'],
      ['Call with supplier.wav','17 May 2025  ·  13:03','00:21:33']
    ]
  },
  {
    name: 'May planning', count: 3, files: [
      ['Brainstorm ideas.wav','16 May 2025  ·  19:05','00:40:11'],
      ['Team sync.mp3','16 May 2025  ·  10:30','00:28:56'],
      ['Roadmap review.wav','15 May 2025  ·  16:45','00:36:22']
    ]
  }
];

const transcript = [
  ['00:00:03','Speaker 1','Привет, давайте начнём нашу встречу. Сегодня обсудим статус проекта и следующие шаги.'],
  ['00:00:12','Speaker 2','Да, конечно. Я подготовил отчёт по последним изменениям. Начну с общей картины.'],
  ['00:00:27','Speaker 1','Отлично. Какие основные результаты за эту неделю?'],
  ['00:00:35','Speaker 2','Мы завершили интеграцию модуля авторизации и приступили к тестированию. Есть один блокирующий баг.'],
  ['00:00:51','Speaker 1','Понял. Сможем показать демо на следующей неделе?'],
  ['00:00:56','Speaker 2','Да, если не возникнет новых проблем.']
];

let notes = [
  'Integration of auth module completed.',
  'One blocking bug found in testing.',
  'Demo target for next week.',
  'Client feedback on UI pending.',
  'Prepare risk assessment.'
];

let uploadFiles = [
  ['2025-05-20_09-15-Project Kickoff.wav','20 May 2025 · 09:15','00:48:21','68.4 MB'],
  ['Architecture Review.mp3','20 May 2025 · 11:02','00:35:47','54.1 MB'],
  ['Budget Discussion.wav','20 May 2025 · 13:30','01:12:04','112.7 MB'],
  ['Marketing Sync.m4a','20 May 2025 · 15:45','00:27:33','42.6 MB'],
  ['Client Feedback Call.wav','21 May 2025 · 09:05','00:58:19','87.3 MB'],
  ['Product Roadmap Update.mp3','21 May 2025 · 11:40','00:44:11','62.8 MB'],
  ['Engineering Standup.wav','21 May 2025 · 14:20','00:31:52','46.0 MB'],
  ['QA Review Session.m4a','21 May 2025 · 16:05','00:23:18','35.2 MB'],
  ['Retrospective Meeting.wav','21 May 2025 · 17:30','00:39:27','79.3 MB']
];

const $ = s => document.querySelector(s);
const groupsEl = $('#groups');
const recordingView = $('#recordingView');
const uploadView = $('#uploadView');
const searchInput = $('#recordingSearch');

function renderGroups(filter='') {
  const q = filter.trim().toLowerCase();
  groupsEl.innerHTML = '';
  demoGroups.forEach((group, gi) => {
    const files = group.files.filter(f => !q || f[0].toLowerCase().includes(q) || group.name.toLowerCase().includes(q));
    if (!files.length) return;
    const section = document.createElement('section');
    section.className = 'group';
    section.innerHTML = `<div class="group-head"><span class="folder-icon">▱</span><span>${group.name}</span><span class="group-count">${files.length}</span><span class="more">•••</span></div>`;
    files.forEach((f, fi) => {
      const row = document.createElement('div');
      row.className = 'recording' + (gi===0 && fi===0 && !q ? ' selected' : '');
      row.innerHTML = `<div class="record-play">▶</div><div><div class="recording-name">${f[0]}</div><div class="recording-sub">${f[1]}</div></div><div class="recording-duration">${f[2]}</div>`;
      row.addEventListener('click', () => {
        document.querySelectorAll('.recording').forEach(x => x.classList.remove('selected'));
        row.classList.add('selected');
        $('#currentFileTitle').textContent = f[0];
        $('#metaFile').textContent = f[0];
        $('#metaGroup').textContent = group.name;
        showRecording();
      });
      section.appendChild(row);
    });
    groupsEl.appendChild(section);
  });
}

function renderTranscript() {
  const wrap = $('#transcriptRows');
  wrap.innerHTML = '';
  transcript.forEach((t, i) => {
    const row = document.createElement('div');
    row.className = 'transcript-row' + (i===0 ? ' active' : '');
    row.dataset.index = i;
    row.innerHTML = `<div class="time-cell"><button>▶</button><span>${t[0]}</span></div><div class="text-cell"><div class="speaker">${t[1]}</div><div class="speech">${t[2]}</div></div>`;
    row.querySelector('.time-cell').addEventListener('click', () => setTranscriptIndex(i));
    wrap.appendChild(row);
  });
}

function renderNotes() {
  const list = $('#noteList');
  list.innerHTML = '';
  notes.forEach((note,i) => {
    const row = document.createElement('div');
    row.className = 'note-row';
    row.innerHTML = `<span class="note-dot">•</span><span contenteditable="true">${note}</span><button class="note-action" title="Edit">✎</button><button class="note-action delete-note" title="Delete">⌫</button>`;
    row.querySelector('.delete-note').addEventListener('click', () => { notes.splice(i,1); renderNotes(); });
    list.appendChild(row);
  });
}

function renderUploadRows() {
  const body = $('#uploadRows');
  body.innerHTML = '';
  uploadFiles.forEach((f, i) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${i+1}</td><td><span class="file-icon">≋</span>${f[0]}</td><td>${f[1]}</td><td>${f[2]}</td><td>${f[3]}</td><td><button class="remove-file">×</button></td>`;
    tr.querySelector('.remove-file').addEventListener('click', () => { uploadFiles.splice(i,1); renderUploadRows(); });
    body.appendChild(tr);
  });
  $('#fileCount').textContent = uploadFiles.length;
  $('#infoCount').textContent = uploadFiles.length;
  const mb = uploadFiles.reduce((sum,f) => sum + parseFloat(f[3]) || 0, 0);
  const label = mb >= 1024 ? `${(mb/1024).toFixed(2)} GB` : `${mb.toFixed(1)} MB`;
  $('#totalSize').textContent = label;
  $('#infoSize').textContent = `${label} total`;
}

function showUpload(){ recordingView.classList.add('hidden'); uploadView.classList.remove('hidden'); }
function showRecording(){ uploadView.classList.add('hidden'); recordingView.classList.remove('hidden'); }

function setTranscriptIndex(index){
  const rows = [...document.querySelectorAll('.transcript-row')];
  rows.forEach(r => r.classList.remove('active'));
  const row = rows[Math.max(0, Math.min(index, rows.length-1))];
  if(row){ row.classList.add('active'); row.scrollIntoView({block:'nearest', behavior:'smooth'}); $('#playerTime').textContent = transcript[index][0]; }
}

$('#openUpload').addEventListener('click', showUpload);
$('#cancelUpload').addEventListener('click', showRecording);
searchInput.addEventListener('input', e => renderGroups(e.target.value));

$('#editTranscript').addEventListener('click', e => {
  const editable = e.target.dataset.editing !== '1';
  document.querySelectorAll('.speech').forEach(el => el.contentEditable = editable ? 'true' : 'false');
  e.target.dataset.editing = editable ? '1' : '0';
  e.target.textContent = editable ? 'Done' : 'Edit';
});

$('#addNote').addEventListener('click', () => { notes.push('New note'); renderNotes(); });

const seek = $('#seek');
seek.addEventListener('input', () => {
  const pct = Number(seek.value);
  const index = Math.min(transcript.length-1, Math.floor((pct/100) * transcript.length));
  document.querySelector('.wave-wrap').style.setProperty('--seek-x', `${pct}%`);
  setTranscriptIndex(index);
});

let playing = false;
$('#playBtn').addEventListener('click', e => { playing = !playing; e.target.textContent = playing ? 'Ⅱ' : '▶'; });

document.querySelectorAll('.tabs button').forEach(btn => btn.addEventListener('click', () => {
  document.querySelectorAll('.tabs button').forEach(x => x.classList.remove('active'));
  btn.classList.add('active');
}));

const dropzone = $('#dropzone');
const fileInput = $('#fileInput');
$('#browseBtn').addEventListener('click', () => fileInput.click());
['dragenter','dragover'].forEach(ev => dropzone.addEventListener(ev, e => { e.preventDefault(); dropzone.classList.add('dragging'); }));
['dragleave','drop'].forEach(ev => dropzone.addEventListener(ev, e => { e.preventDefault(); dropzone.classList.remove('dragging'); }));
dropzone.addEventListener('drop', e => addFiles([...e.dataTransfer.files]));
fileInput.addEventListener('change', e => addFiles([...e.target.files]));

function addFiles(files){
  files.forEach(file => {
    const mb = (file.size/1024/1024).toFixed(1);
    const now = new Date();
    uploadFiles.push([file.name, now.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}) + ' · ' + now.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}), '—', `${mb} MB`]);
  });
  renderUploadRows();
}

$('#clearFiles').addEventListener('click', () => { uploadFiles = []; renderUploadRows(); });
$('#addToApp').addEventListener('click', () => {
  const name = $('#groupName').value.trim() || 'New group';
  if(uploadFiles.length){
    demoGroups.unshift({name, count: uploadFiles.length, files: uploadFiles.map(f => [f[0], '25 Aug 2026  ·  10:25', f[2]])});
    renderGroups();
    showRecording();
  }
});

renderGroups();
renderTranscript();
renderNotes();
renderUploadRows();
document.querySelector('.wave-wrap').style.setProperty('--seek-x','3%');
