# REA project instructions

## Versioning

- Follow `VERSIONING.md`.
- Current baseline version: `0.1.4`.
- Keep `VERSION.json`, the visible version in `index.html`, and `package.json` synchronized.

## Project role

REA is both:

1. the local frontend for working with audio recordings;
2. the owner of the reusable local Whisper service.

CC and future applications are clients of REA's local API. Do not move the Whisper runtime back into CC.

## Local service

Default address:

`http://127.0.0.1:18787`

The normal local launch is `start-rea.cmd`.

REA must bind to loopback by default. Do not switch the default host to `0.0.0.0`.

## Whisper API compatibility

Keep these compatibility endpoints working because CC already uses them:

- `GET /health`
- `POST /jobs`
- `GET /jobs/{id}`
- `POST /transcribe`

The canonical REA namespace is `/api/whisper`.

Long-running recognition must use background jobs. A client should be able to leave the current screen while the job continues.

## Models

Supported models:

- `small`
- `medium`
- `large-v3`

Default model: `large-v3`.

Do not commit model files to Git. Use the normal faster-whisper/Hugging Face cache or an explicit `REA_WHISPER_MODEL_DIR`.

Only one Whisper worker runs at a time by default so multiple large models are not loaded concurrently into memory.

## Files and privacy

- User recordings belong to browser IndexedDB, not the Git repository.
- Direct API uploads are temporary processing files and must be deleted when the recognition job finishes.
- `.venv`, model caches, generated media, and user data must stay outside Git.
- Never commit API keys, tokens, passwords, or user recordings.

## API design

Keep REA generic. Do not make CC-specific source IDs or CC storage structures required API fields.

Return clear job state, progress, errors, model, device, timing, language and transcript segments when available.

A service restart may lose in-memory jobs; clients must receive a clean `404` for unknown job IDs rather than a fake result.

## Runtime resilience

- `/health` must not load the Whisper model.
- The model loads lazily on first recognition.
- Reuse an already loaded model when the requested model is unchanged.
- Avoid concurrent model loads.
- Do not clear browser data or recordings because the local service is unavailable.

## UI reference

Treat `blank/ui1g` as read-only reference material unless the user explicitly asks to modify it.
