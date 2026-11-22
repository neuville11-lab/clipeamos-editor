# ClipLab API (starter)

This service implements the HTTP contract used by `studio-v2`:

- `GET /health`
- `POST /v1/jobs` (multipart fields: `video`, `brief`, `language`)
- `GET /v1/jobs/{id}`

It transcribes on the server with faster-whisper (`base`, CPU/int8 by default), returns word-level timing, and ranks up to four transcript windows that meet the minimum duration found in the campaign brief. Files are written to a temporary directory and deleted after analysis. Job state is in memory and expires after six hours.

## Deploy to Railway

1. Push this project to a private GitHub repository or make the existing website repository available to Railway.
2. Create a Railway project from that repository and set the service root to the repository root. The `backend/railway.toml` points to the Dockerfile.
3. Set `ALLOWED_ORIGINS=https://neuville11-lab.github.io` and optionally adjust `MAX_UPLOAD_BYTES`, `MAX_VIDEO_SECONDS`, and `WHISPER_MODEL`.
4. Generate a public domain for the service. The API URL is the domain root, for example `https://cliplab-api-production.up.railway.app`.
5. Open the ClipLab Studio page, paste that URL into “Conecta el backend”, and choose “Probar conexión”.

## Limits and privacy

- CPU transcription may take a while; the first analysis downloads the model.
- Temporary local storage and in-memory job state are suitable for a single-instance trial only. A restart clears active jobs. Use private object storage and a durable queue before offering this publicly.
- CORS restricts browser access to the configured frontend, but is not user authentication. Do not expose an unrestricted paid endpoint publicly; add authentication, quotas, and abuse controls before sharing it.
- The service does not publish videos, predict view counts, add licensed background music, or render/export final clips yet. Candidate moments are transcript heuristics and need human review.
- Upload limits and retention can be tuned with environment variables. Raw uploads are deleted when transcription finishes or fails.

