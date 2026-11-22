from __future__ import annotations

import asyncio
import os
import re
import shutil
import subprocess
import tempfile
import threading
import uuid
from pathlib import Path
from typing import Any

from fastapi import BackgroundTasks, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from faster_whisper import WhisperModel

APP_VERSION = "0.1.0"
MAX_UPLOAD_BYTES = int(os.getenv("MAX_UPLOAD_BYTES", str(1_000 * 1024 * 1024)))
MAX_VIDEO_SECONDS = int(os.getenv("MAX_VIDEO_SECONDS", "7200"))
RETENTION_SECONDS = int(os.getenv("JOB_RETENTION_SECONDS", "21600"))
ALLOWED_ORIGINS = [value.strip() for value in os.getenv(
    "ALLOWED_ORIGINS", "https://neuville11-lab.github.io"
).split(",") if value.strip()]

app = FastAPI(title="ClipLab API", version=APP_VERSION)
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type"],
)

jobs: dict[str, dict[str, Any]] = {}
jobs_lock = threading.Lock()
model_lock = threading.Lock()
model: WhisperModel | None = None


def get_model() -> WhisperModel:
    global model
    if model is None:
        with model_lock:
            if model is None:
                # CPU-only deployment keeps setup simple; model weights are cached on disk.
                model = WhisperModel(
                    os.getenv("WHISPER_MODEL", "base"),
                    device="cpu",
                    compute_type=os.getenv("WHISPER_COMPUTE_TYPE", "int8"),
                    download_root=os.getenv("MODEL_CACHE", "/tmp/cliplab-models"),
                )
    return model


def set_job(job_id: str, **changes: Any) -> None:
    with jobs_lock:
        job = jobs.get(job_id)
        if job:
            job.update(changes)


def parse_minimum(brief: str) -> int:
    found = re.search(r"duraci[oó]n\s+m[ií]nima[^\d]{0,50}(\d+)\s*(?:s\b|segundos?)", brief, re.I)
    return max(1, int(found.group(1))) if found else 10


def score_text(text: str) -> float:
    value = text.lower()
    score = 0.0
    signals = (
        (r"\b(pero|aunque|sin embargo|el problema|la clave|lo importante)\b", 2.0),
        (r"\b(nunca|siempre|nadie|todo el mundo|error|secreto|sorpresa)\b", 2.2),
        (r"\b(porque|por eso|significa|aprend[ií]|descubr[ií])\b", 1.0),
        (r"[?!]", 0.5),
        (r"\b(euro|euros|por ciento|millones?|inversi[oó]n|vivienda|alquiler)\b", 0.8),
    )
    for pattern, weight in signals:
        if re.search(pattern, value):
            score += weight
    return score


def suggest_candidates(words: list[dict[str, Any]], brief: str, duration: float) -> list[dict[str, Any]]:
    minimum = parse_minimum(brief)
    target = min(60.0, max(float(minimum), 35.0))
    if duration < minimum:
        raise ValueError(f"El vídeo dura {duration:.0f} s y la campaña pide al menos {minimum} s.")

    # Score overlapping windows; captions remain exact Whisper word timings.
    step = max(8.0, target / 3)
    starts = []
    cursor = 0.0
    while cursor + minimum <= duration:
        starts.append(cursor)
        cursor += step
    if duration > target:
        starts.append(max(0.0, duration - target))

    scored: list[tuple[float, float, float, list[dict[str, Any]]]] = []
    for start in starts:
        end = min(duration, start + target)
        if end - start < minimum:
            continue
        window = [word for word in words if word["start"] < end and word["end"] > start]
        if not window:
            continue
        text = " ".join(word["word"].strip() for word in window).strip()
        if len(text) < 28:
            continue
        score = score_text(text) + min(len(text) / 240, 1.5)
        scored.append((score, start, end, window))

    chosen: list[tuple[float, float, float, list[dict[str, Any]]]] = []
    for item in sorted(scored, reverse=True, key=lambda item: item[0]):
        _, start, _, _ = item
        if all(abs(start - existing[1]) >= target * 0.65 for existing in chosen):
            chosen.append(item)
            if len(chosen) == 4:
                break
    chosen.sort(key=lambda item: item[1])

    result = []
    for rank, (score, start, end, window) in enumerate(chosen, 1):
        excerpt = " ".join(word["word"].strip() for word in window).strip()
        hook = next((word["word"].strip() for word in window if score_text(word["word"]) > 0), excerpt[:90])
        result.append({
            "title": hook[:90],
            "hook": hook,
            "reason": "Fragmento priorizado por expresiones de contraste, énfasis y términos del tema; revisa que el corte tenga sentido.",
            "start_time": round(start, 2),
            "end_time": round(end, 2),
            "score": round(min(99, 45 + score * 8), 1),
            "rank": rank,
        })
    return result


def process_job(job_id: str, path: str, brief: str, language: str) -> None:
    try:
        probe = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", path],
            capture_output=True, text=True, timeout=45, check=True,
        )
        probed_duration = float(probe.stdout.strip())
        if probed_duration > MAX_VIDEO_SECONDS:
            raise ValueError(f"El vídeo supera el límite de {MAX_VIDEO_SECONDS // 60} minutos.")
        set_job(job_id, status="running", progress=2, message="Preparando modelo Whisper")
        whisper = get_model()
        set_job(job_id, progress=10, message="Transcribiendo el vídeo")
        segments, info = whisper.transcribe(
            path,
            language=None if language == "auto" else language,
            word_timestamps=True,
            vad_filter=True,
            condition_on_previous_text=False,
            beam_size=5,
        )
        words: list[dict[str, Any]] = []
        for segment in segments:
            for word in segment.words or []:
                value = word.word.strip()
                if value and word.end >= word.start:
                    words.append({"word": value, "start": round(word.start, 3), "end": round(word.end, 3)})
        if not words:
            raise ValueError("Whisper no detectó palabras. Prueba con un vídeo con voz más clara.")
        duration = float(info.duration or words[-1]["end"])
        set_job(job_id, progress=78, message="Buscando momentos que cumplan el brief")
        candidates = suggest_candidates(words, brief, duration)
        if not candidates:
            raise ValueError("No se encontró ningún tramo válido con voz. Revisa el vídeo o el mínimo de duración.")
        transcript = " ".join(word["word"] for word in words)
        set_job(job_id, status="completed", progress=100, message="Análisis completado", duration=round(duration, 2),
                language=info.language, transcript=transcript, words=words, candidates=candidates)
    except ValueError as exc:
        set_job(job_id, status="failed", progress=100, message="No se pudo completar el análisis", error=str(exc))
    except Exception:
        # Avoid exposing local paths, provider responses, or secrets to the browser.
        set_job(job_id, status="failed", progress=100, message="Error durante el análisis", error="El análisis falló. Revisa los registros del servicio y vuelve a intentarlo.")
    finally:
        shutil.rmtree(Path(path).parent, ignore_errors=True)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "cliplab-api", "version": APP_VERSION}


@app.post("/v1/jobs", status_code=202)
async def create_job(
    background_tasks: BackgroundTasks,
    video: UploadFile = File(...),
    brief: str = Form(""),
    language: str = Form("es"),
) -> dict[str, Any]:
    if video.content_type and not video.content_type.startswith("video/"):
        raise HTTPException(415, "El archivo debe ser un vídeo.")
    if language not in {"es", "en", "auto"}:
        raise HTTPException(400, "Idioma no admitido.")

    suffix = Path(video.filename or "video.mp4").suffix.lower()
    if suffix not in {".mp4", ".mov", ".webm", ".m4v", ".mkv", ".avi"}:
        raise HTTPException(415, "Formato no admitido. Usa MP4, MOV, WEBM, M4V, MKV o AVI.")
    job_id = str(uuid.uuid4())
    temp_dir = tempfile.mkdtemp(prefix="cliplab-")
    path = str(Path(temp_dir) / f"source{suffix}")
    total = 0
    try:
        with open(path, "wb") as output:
            while chunk := await video.read(1024 * 1024):
                total += len(chunk)
                if total > MAX_UPLOAD_BYTES:
                    raise HTTPException(413, f"El vídeo supera el límite de {MAX_UPLOAD_BYTES // (1024 * 1024)} MB.")
                output.write(chunk)
    except Exception:
        shutil.rmtree(temp_dir, ignore_errors=True)
        raise
    finally:
        await video.close()

    if total == 0:
        shutil.rmtree(temp_dir, ignore_errors=True)
        raise HTTPException(400, "El archivo está vacío.")

    with jobs_lock:
        now = asyncio.get_event_loop().time()
        expired = [key for key, value in jobs.items() if now - value["created"] > RETENTION_SECONDS]
        for key in expired:
            jobs.pop(key, None)
        # Keep a small bounded in-memory queue while the first deployment is single-instance.
        if len(jobs) >= 8:
            shutil.rmtree(temp_dir, ignore_errors=True)
            raise HTTPException(429, "El servicio está ocupado. Espera a que termine otro análisis.")
        jobs[job_id] = {"id": job_id, "status": "queued", "progress": 0, "message": "En cola", "created": now}

    background_tasks.add_task(process_job, job_id, path, brief[:20_000], language)
    return {"id": job_id, "status": "queued", "progress": 0, "message": "En cola"}


@app.get("/v1/jobs/{job_id}")
def get_job(job_id: str) -> dict[str, Any]:
    with jobs_lock:
        job = jobs.get(job_id)
        if not job:
            raise HTTPException(404, "No se encontró este trabajo o ya expiró.")
        return {key: value for key, value in job.items() if key != "created"}

