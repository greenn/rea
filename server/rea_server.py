from __future__ import annotations

import asyncio
import json
import os
import shutil
import tempfile
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import Body, FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from faster_whisper import WhisperModel
from yt_dlp import YoutubeDL

ROOT = Path(__file__).resolve().parents[1]
VERSION_FILE = ROOT / "VERSION.json"
HOST = os.getenv("REA_HOST", "127.0.0.1")
PORT = int(os.getenv("REA_PORT", "8787"))
SUPPORTED_MODELS = ("small", "medium", "large-v3")
DEFAULT_MODEL = os.getenv("REA_WHISPER_MODEL", "large-v3")
DEVICE = os.getenv("REA_WHISPER_DEVICE", "cpu")
COMPUTE_TYPE = os.getenv("REA_WHISPER_COMPUTE_TYPE", "int8")
MODEL_DIR = os.getenv("REA_WHISPER_MODEL_DIR", "").strip() or None
MAX_UPLOAD_BYTES = int(os.getenv("REA_MAX_UPLOAD_MB", "2048")) * 1024 * 1024

app = FastAPI(title="REA local media service", docs_url="/api/docs", redoc_url=None)
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"^(https://greenn\.github\.io|http://(?:127\.0\.0\.1|localhost)(?::\d+)?)$",
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)


@app.middleware("http")
async def private_network_headers(request: Request, call_next):
    response = await call_next(request)
    if request.headers.get("access-control-request-private-network") == "true":
        response.headers["Access-Control-Allow-Private-Network"] = "true"
    response.headers["X-REA-Service"] = "local"
    return response


jobs: dict[str, dict[str, Any]] = {}
jobs_lock = threading.RLock()
executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="rea-whisper")
model_lock = threading.RLock()
loaded_model: WhisperModel | None = None
loaded_model_name: str | None = None


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def read_version() -> str:
    try:
        return str(json.loads(VERSION_FILE.read_text(encoding="utf-8")).get("version") or "0.0.0")
    except Exception:
        return "0.0.0"


def clean_model_name(value: str | None) -> str:
    model = str(value or DEFAULT_MODEL).strip()
    if model not in SUPPORTED_MODELS:
        raise HTTPException(status_code=400, detail=f"Unsupported Whisper model: {model}")
    return model


def public_job(job: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in job.items() if not key.startswith("_")}


def update_job(job_id: str, **fields: Any) -> None:
    with jobs_lock:
        job = jobs.get(job_id)
        if not job:
            return
        now = utc_now()
        job.update(fields)
        job["updatedAt"] = now
        job["heartbeatAt"] = now
        if "progress" in fields:
            job["lastProgressAt"] = now


def job_counts() -> tuple[int, int]:
    with jobs_lock:
        active = sum(1 for job in jobs.values() if job.get("status") == "running")
        queued = sum(1 for job in jobs.values() if job.get("status") == "queued")
    return active, queued


def heartbeat_loop() -> None:
    while True:
        time.sleep(5)
        now = utc_now()
        with jobs_lock:
            for job in jobs.values():
                if job.get("status") == "running":
                    job["heartbeatAt"] = now
                    job["updatedAt"] = now


threading.Thread(target=heartbeat_loop, name="rea-whisper-heartbeat", daemon=True).start()


def health_payload() -> dict[str, Any]:
    active, queued = job_counts()
    # Do not wait for model_lock here. Loading large-v3 can take a long time,
    # while /health must stay responsive for CC and the REA settings check.
    loaded = loaded_model_name
    return {
        "ok": True,
        "service": "REA Whisper",
        "version": read_version(),
        "defaultModel": DEFAULT_MODEL,
        "model": DEFAULT_MODEL,
        "loadedModel": loaded or "",
        "supportedModels": list(SUPPORTED_MODELS),
        "device": DEVICE,
        "computeType": COMPUTE_TYPE,
        "modelLoaded": bool(loaded),
        "activeJobs": active,
        "queuedJobs": queued,
    }


def cancellation_requested(job_id: str) -> bool:
    with jobs_lock:
        return bool(jobs.get(job_id, {}).get("_cancelRequested"))


def check_cancel(job_id: str) -> None:
    if cancellation_requested(job_id):
        raise InterruptedError("Recognition cancelled")


def resolve_model_source(model_name: str) -> tuple[str, dict[str, Any]]:
    kwargs: dict[str, Any] = {
        "device": DEVICE,
        "compute_type": COMPUTE_TYPE,
    }
    if not MODEL_DIR:
        return model_name, kwargs

    model_dir = Path(MODEL_DIR).expanduser().resolve()
    model_dir.mkdir(parents=True, exist_ok=True)

    # A direct CTranslate2/faster-whisper model folder can be reused as-is for
    # the configured default model. Otherwise treat MODEL_DIR as the cache root.
    if model_name == DEFAULT_MODEL and (model_dir / "model.bin").exists():
        return str(model_dir), kwargs

    kwargs["download_root"] = str(model_dir)
    return model_name, kwargs


def load_whisper_model(job_id: str, model_name: str) -> tuple[WhisperModel, float]:
    global loaded_model, loaded_model_name
    started = time.perf_counter()
    with model_lock:
        check_cancel(job_id)
        if loaded_model is not None and loaded_model_name == model_name:
            return loaded_model, 0.0

        update_job(
            job_id,
            phase="loading_model",
            progress=30,
            phaseProgress=0,
            message=f"Loading Whisper {model_name}…",
        )
        loaded_model = None
        loaded_model_name = None

        model_source, kwargs = resolve_model_source(model_name)
        model = WhisperModel(model_source, **kwargs)
        loaded_model = model
        loaded_model_name = model_name
        elapsed = time.perf_counter() - started
        update_job(
            job_id,
            phase="loading_model",
            progress=42,
            phaseProgress=100,
            message=f"Whisper {model_name} loaded.",
        )
        return model, elapsed


def download_audio(job_id: str, url: str, directory: Path) -> tuple[Path, float]:
    started = time.perf_counter()
    update_job(
        job_id,
        phase="downloading_audio",
        progress=3,
        phaseProgress=0,
        message="Downloading source audio…",
    )

    def hook(data: dict[str, Any]) -> None:
        check_cancel(job_id)
        if data.get("status") != "downloading":
            return
        total = data.get("total_bytes") or data.get("total_bytes_estimate") or 0
        downloaded = data.get("downloaded_bytes") or 0
        ratio = (float(downloaded) / float(total)) if total else 0.0
        phase_progress = max(0, min(99, round(ratio * 100)))
        progress = 3 + round(ratio * 24)
        speed = data.get("speed")
        eta = data.get("eta")
        suffix = ""
        if speed:
            suffix += f" · {speed / (1024 * 1024):.1f} MB/s"
        if eta is not None:
            suffix += f" · ETA {int(eta)}s"
        update_job(
            job_id,
            phase="downloading_audio",
            progress=progress,
            phaseProgress=phase_progress,
            message=f"Downloading source audio{suffix}",
        )

    options = {
        "format": "bestaudio/best",
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "progress_hooks": [hook],
        "outtmpl": str(directory / "source.%(ext)s"),
        "retries": 3,
        "fragment_retries": 3,
    }

    with YoutubeDL(options) as ydl:
        info = ydl.extract_info(url, download=True)
        check_cancel(job_id)
        requested = (info.get("requested_downloads") or []) if isinstance(info, dict) else []
        candidate = requested[0].get("filepath") if requested else None
        if not candidate:
            candidate = ydl.prepare_filename(info)

    path = Path(candidate)
    if not path.exists():
        files = [item for item in directory.iterdir() if item.is_file() and not item.name.endswith(".part")]
        if not files:
            raise RuntimeError("yt-dlp did not produce an audio file")
        path = max(files, key=lambda item: item.stat().st_size)

    elapsed = time.perf_counter() - started
    update_job(
        job_id,
        phase="preparing_audio",
        progress=28,
        phaseProgress=100,
        message="Audio ready for Whisper.",
    )
    return path, elapsed


def run_transcription(
    job_id: str,
    source_path: Path,
    model_name: str,
    language: str | None,
    download_seconds: float,
    total_started: float,
) -> dict[str, Any]:
    model, model_load_seconds = load_whisper_model(job_id, model_name)
    check_cancel(job_id)

    transcription_started = time.perf_counter()
    update_job(
        job_id,
        phase="transcribing",
        progress=43,
        phaseProgress=0,
        message="Recognizing speech…",
    )

    segments_iter, info = model.transcribe(
        str(source_path),
        language=language or None,
        beam_size=5,
        vad_filter=True,
    )
    duration = float(getattr(info, "duration", 0.0) or 0.0)
    segments: list[dict[str, Any]] = []
    text_parts: list[str] = []

    for index, segment in enumerate(segments_iter):
        check_cancel(job_id)
        text = str(segment.text or "").strip()
        start = float(segment.start or 0.0)
        end = float(segment.end or start)
        segments.append({
            "id": f"segment-{index + 1}",
            "start": start,
            "end": end,
            "text": text,
        })
        if text:
            text_parts.append(text)
        ratio = (end / duration) if duration > 0 else min(0.98, (index + 1) / (index + 8))
        ratio = max(0.0, min(1.0, ratio))
        update_job(
            job_id,
            phase="transcribing",
            progress=43 + round(ratio * 54),
            phaseProgress=round(ratio * 100),
            message=f"Recognizing speech · {round(ratio * 100)}%",
        )

    transcription_seconds = time.perf_counter() - transcription_started
    total_seconds = time.perf_counter() - total_started
    full_text = " ".join(text_parts).strip()
    word_count = len(full_text.split()) if full_text else 0
    realtime_factor = (transcription_seconds / duration) if duration > 0 else None

    return {
        "ok": True,
        "text": full_text,
        "segments": segments,
        "language": str(getattr(info, "language", "") or ""),
        "languageProbability": float(getattr(info, "language_probability", 0.0) or 0.0),
        "model": model_name,
        "device": DEVICE,
        "computeType": COMPUTE_TYPE,
        "audioDurationSeconds": duration,
        "downloadSeconds": download_seconds,
        "modelLoadSeconds": model_load_seconds,
        "transcriptionSeconds": transcription_seconds,
        "totalSeconds": total_seconds,
        "realtimeFactor": realtime_factor,
        "wordCount": word_count,
        "finishedAt": utc_now(),
    }


def worker(job_id: str) -> None:
    with jobs_lock:
        job = jobs.get(job_id)
        if not job:
            return
        job["status"] = "running"
        job["phase"] = "starting"
        job["startedAt"] = utc_now()
        job["updatedAt"] = job["startedAt"]
        job["heartbeatAt"] = job["startedAt"]
        model_name = job["model"]
        language = job.get("language") or None
        source_url = job.get("_url")
        source_path_value = job.get("_filePath")
        temp_dir_value = job.get("_tempDir")

    total_started = time.perf_counter()
    temp_dir = Path(temp_dir_value) if temp_dir_value else Path(tempfile.mkdtemp(prefix="rea-whisper-"))
    download_seconds = 0.0

    try:
        check_cancel(job_id)
        if source_url:
            source_path, download_seconds = download_audio(job_id, str(source_url), temp_dir)
        elif source_path_value:
            source_path = Path(source_path_value)
            if not source_path.exists():
                raise RuntimeError("Uploaded audio file is no longer available")
            update_job(
                job_id,
                phase="preparing_audio",
                progress=28,
                phaseProgress=100,
                message="Uploaded audio ready for Whisper.",
            )
        else:
            raise RuntimeError("No audio source was supplied")

        result = run_transcription(
            job_id,
            source_path,
            model_name,
            language,
            download_seconds,
            total_started,
        )
        update_job(
            job_id,
            status="done",
            phase="done",
            progress=100,
            phaseProgress=100,
            message="Recognition complete.",
            result=result,
            error=None,
            finishedAt=utc_now(),
        )
    except InterruptedError:
        update_job(
            job_id,
            status="cancelled",
            phase="cancelled",
            message="Recognition cancelled.",
            error=None,
            finishedAt=utc_now(),
        )
    except Exception as exc:
        update_job(
            job_id,
            status="error",
            phase="error",
            message="Recognition failed.",
            error=str(exc),
            finishedAt=utc_now(),
        )
    finally:
        try:
            shutil.rmtree(temp_dir, ignore_errors=True)
        except Exception:
            pass


def create_job(*, url: str | None, file_path: Path | None, temp_dir: Path | None, model: str, language: str | None) -> dict[str, Any]:
    job_id = uuid.uuid4().hex
    now = utc_now()
    job: dict[str, Any] = {
        "id": job_id,
        "model": model,
        "status": "queued",
        "phase": "queued",
        "progress": 0,
        "phaseProgress": 0,
        "message": "Queued for REA Whisper.",
        "error": None,
        "result": None,
        "createdAt": now,
        "startedAt": None,
        "finishedAt": None,
        "updatedAt": now,
        "heartbeatAt": now,
        "lastProgressAt": now,
        "_url": url,
        "_filePath": str(file_path) if file_path else None,
        "_tempDir": str(temp_dir) if temp_dir else None,
        "_cancelRequested": False,
    }
    with jobs_lock:
        jobs[job_id] = job
        snapshot = public_job(job)
    executor.submit(worker, job_id)
    return snapshot


def get_job_or_404(job_id: str) -> dict[str, Any]:
    with jobs_lock:
        job = jobs.get(job_id)
        if not job:
            raise HTTPException(status_code=404, detail="Recognition job not found")
        return public_job(job)


@app.get("/api/whisper/health")
@app.get("/health")
def health():
    return health_payload()


@app.get("/api/whisper/models")
def models():
    payload = health_payload()
    return {
        "ok": True,
        "defaultModel": payload["defaultModel"],
        "loadedModel": payload["loadedModel"],
        "supportedModels": payload["supportedModels"],
    }


@app.post("/api/whisper/jobs")
@app.post("/jobs")
def start_url_job(payload: dict[str, Any] = Body(...)):
    url = str(payload.get("url") or "").strip()
    if not url.startswith(("http://", "https://")):
        raise HTTPException(status_code=400, detail="A valid http(s) media URL is required")
    model = clean_model_name(payload.get("model"))
    language = str(payload.get("language") or "").strip() or None
    return {"ok": True, "job": create_job(url=url, file_path=None, temp_dir=None, model=model, language=language)}


@app.post("/api/whisper/jobs/file")
async def start_file_job(
    file: UploadFile = File(...),
    model: str = DEFAULT_MODEL,
    language: str | None = None,
):
    model_name = clean_model_name(model)
    temp_dir = Path(tempfile.mkdtemp(prefix="rea-whisper-upload-"))
    suffix = Path(file.filename or "audio.bin").suffix or ".bin"
    path = temp_dir / f"upload{suffix}"
    written = 0
    try:
        with path.open("wb") as output:
            while True:
                chunk = await file.read(1024 * 1024)
                if not chunk:
                    break
                written += len(chunk)
                if written > MAX_UPLOAD_BYTES:
                    raise HTTPException(status_code=413, detail="Audio file is too large for the configured REA upload limit")
                output.write(chunk)
    except Exception:
        shutil.rmtree(temp_dir, ignore_errors=True)
        raise
    finally:
        await file.close()

    job = create_job(url=None, file_path=path, temp_dir=temp_dir, model=model_name, language=language)
    return {"ok": True, "job": job}


@app.get("/api/whisper/jobs/{job_id}")
@app.get("/jobs/{job_id}")
def read_job(job_id: str):
    return {"ok": True, "job": get_job_or_404(job_id)}


@app.post("/api/whisper/jobs/{job_id}/cancel")
@app.post("/jobs/{job_id}/cancel")
def cancel_job(job_id: str):
    with jobs_lock:
        job = jobs.get(job_id)
        if not job:
            raise HTTPException(status_code=404, detail="Recognition job not found")
        if job.get("status") in {"done", "error", "cancelled"}:
            return {"ok": True, "job": public_job(job)}
        job["_cancelRequested"] = True
        job["message"] = "Cancellation requested…"
        job["updatedAt"] = utc_now()
    return {"ok": True, "job": get_job_or_404(job_id)}


@app.post("/api/whisper/transcribe")
@app.post("/transcribe")
async def transcribe_sync(payload: dict[str, Any] = Body(...)):
    started = start_url_job(payload)
    job_id = started["job"]["id"]
    while True:
        job = get_job_or_404(job_id)
        if job["status"] == "done":
            return JSONResponse(job["result"])
        if job["status"] == "error":
            raise HTTPException(status_code=500, detail=job.get("error") or "Recognition failed")
        if job["status"] == "cancelled":
            raise HTTPException(status_code=409, detail="Recognition cancelled")
        await asyncio.sleep(0.5)


@app.get("/api/version")
def api_version():
    return {"ok": True, "service": "REA", "version": read_version()}


app.mount("/src", StaticFiles(directory=str(ROOT / "src")), name="src")


@app.get("/VERSION.json")
def version_file():
    return FileResponse(VERSION_FILE, media_type="application/json")


@app.get("/")
def index():
    return FileResponse(ROOT / "index.html", media_type="text/html")


if __name__ == "__main__":
    import uvicorn

    print(f"REA: http://{HOST}:{PORT}")
    print(f"Whisper API: http://{HOST}:{PORT}/api/whisper/health")
    uvicorn.run(app, host=HOST, port=PORT, log_level="info")
