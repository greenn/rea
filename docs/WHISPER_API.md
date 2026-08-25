# REA Whisper API

REA владеет локальным Whisper-сервисом и по умолчанию работает на:

`http://127.0.0.1:8787`

Канонический prefix: `/api/whisper`.

Для совместимости с CC сохранены короткие aliases `/health`, `/jobs`, `/jobs/{id}`, `/transcribe`.

## Health

`GET /api/whisper/health`

Пример ответа:

```json
{
  "ok": true,
  "service": "REA Whisper",
  "version": "0.1.4",
  "defaultModel": "large-v3",
  "loadedModel": "",
  "supportedModels": ["small", "medium", "large-v3"],
  "device": "cpu",
  "computeType": "int8",
  "modelLoaded": false,
  "activeJobs": 0,
  "queuedJobs": 0
}
```

`/health` не должен загружать модель.

## Распознавание URL

`POST /api/whisper/jobs`

```json
{
  "url": "https://www.youtube.com/watch?v=...",
  "model": "large-v3",
  "language": null
}
```

Ответ возвращается быстро:

```json
{
  "ok": true,
  "job": {
    "id": "...",
    "status": "queued",
    "progress": 0
  }
}
```

## Распознавание локального файла

`POST /api/whisper/jobs/file?model=large-v3`

Тело: `multipart/form-data`, поле `file`.

REA UI использует этот endpoint для аудиофайлов, сохранённых в IndexedDB браузера.

## Состояние job

`GET /api/whisper/jobs/{id}`

Основные состояния:

- `queued`
- `running`
- `done`
- `error`
- `cancelled`

Основные phases:

- `queued`
- `starting`
- `downloading_audio`
- `preparing_audio`
- `loading_model`
- `transcribing`
- `done`
- `error`

Job содержит `progress`, `phaseProgress`, `message`, `heartbeatAt`, `lastProgressAt` и timestamps.

## Результат

При `status: done` поле `result` содержит:

```json
{
  "ok": true,
  "text": "...",
  "segments": [
    {
      "id": "segment-1",
      "start": 0.0,
      "end": 4.2,
      "text": "..."
    }
  ],
  "language": "ru",
  "languageProbability": 0.99,
  "model": "large-v3",
  "device": "cpu",
  "computeType": "int8",
  "audioDurationSeconds": 120.0,
  "downloadSeconds": 0.0,
  "modelLoadSeconds": 3.2,
  "transcriptionSeconds": 52.1,
  "totalSeconds": 55.3,
  "realtimeFactor": 0.434,
  "wordCount": 318,
  "finishedAt": "2026-08-25T...Z"
}
```

## Cancel

`POST /api/whisper/jobs/{id}/cancel`

Отмена проверяется между стадиями и во время получения сегментов Whisper.

## Модели

`GET /api/whisper/models`

Поддерживаются:

- `small`
- `medium`
- `large-v3`

REA держит только один активный экземпляр модели одновременно. При запросе другой модели текущий экземпляр освобождается и загружается новый.

## CC

CC может продолжать использовать старый base URL:

`http://127.0.0.1:8787`

Его текущий контракт совместим с REA, поэтому отдельный Whisper-процесс внутри CC больше не нужен.
