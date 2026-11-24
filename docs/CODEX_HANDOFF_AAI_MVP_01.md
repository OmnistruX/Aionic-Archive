# Codex Implementation Handoff — Sprint AAI-MVP-01

- **Canonical Python Baseline Commit**: `afd8a5e717d628bf3983d64a5b56aa3b22a3e59d` on `main`
- **AI Studio Source Package Version**: `1.0.0-sprint001` (Schema `v2`)
- **Machine-Readable Contract**: `docs/multimodal_contract_v1.json` and `GET /api/v1/contract`
- **Cloud / Paid AI Policy**: **DISABLED BY DEFAULT** pending explicit approval (`AAI_ALLOW_CLOUD_AI="false"` + per-run `cloudAiConsent: true` required). Local-first FFmpeg + offline Whisper remain the Phase 1 release path.

---

## Directives for Codex (Anchored to `afd8a5e717d628bf3983d64a5b56aa3b22a3e59d`)

### 1. Versioned Schema Migration (Preserve Existing Archives & History)
- Evolve the SQLite schema through an explicit versioned migration table (`schema_migrations`) rather than destructive rebuilds.
- Preserve all existing stable IDs, duplicate-import lineage (`is_duplicate_of`), source SHA-256 hashes, append-only `revision_history` / `review_decisions`, and `audit_records`.
- Ensure the migration adds:
  - Explicit soft-delete semantics (`deleted_at TEXT NULL`) on `assets`, `detected_events`, `layer_records`, and `narrative_scenes`.
  - Epistemic Layer `F` (Fiction / Narrative) support alongside `E`, `A`, `R`, `S`.
  - Source/provenance links: `model_run_id` on `detected_events` and `layer_records`, `export_records` linked to `assets(id)` + `source_sha256`, and `narrative_scenes` linked to `asset_id` + optional `event_id` + `source_reference`.
- Keep PostgreSQL DDL compatibility as a documented portability target only (do not claim Postgres verification until tested against a live Postgres instance).

### 2. `/api/v1/*` Route Evolution & Backward Compatibility
- Add `/api/v1/*` routes alongside all existing `/api/*` routes so current multipart uploads, review mutations, bulk review, and search clients continue working unbroken.
- Scope any new local-path import endpoint (`AAI-004`) strictly to explicitly configured archive root directories (canonical `path.resolve` + trailing separator confinement; reject path traversal).
- Keep `POST /search` and `GET /search` compatible on both `/api` and `/api/v1`.
- Register `GET /api/v1/transcripts/search` **ahead** of any `/:assetId` route to prevent route shadowing.
- Expose `GET /api/v1/jobs/:jobId` computing progress strictly from **actual completed stages (`completedStages / totalStages`)** and **actual completed chunks (`completedChunks / chunkCount`)**.

### 3. Close Phase 1 Acceptance Gaps First (Windows + Offline Speech)
- Priority 1 (Phase 1 release gate on Windows):
  1. Verify **real offline speech recognition** (`local-whisper-asr` / `faster-whisper` / `whisper.cpp`) on an approved recording containing human dialogue.
  2. Verify browser media playback (`HTTP 206 Range`), timestamp seeking, human review / bulk review mutations, event facet filtering, and evidence-linked JSON/CSV export on Windows.
  3. Run the representative one-hour dialogue recording validation and record concrete evidence in `BUILD_STATUS.md` and the MVP validation report before Phase 1 sign-off.
- Priority 2 (Tracked separately so they do not obscure Phase 1 sign-off):
  - Narrative scene authoring UI (`narrative_scenes` / Layer `F`).
  - Remote cloud multimodal & transcription activation (`gemini-4-hydrogen` / `gemini-3.5-transcribe`), kept hard-disabled behind `AAI_ALLOW_CLOUD_AI=false` until approved.

---

## Reconciled AI Studio Multimodal Contract Summary

- **Default zero-egress adapter**: `local-ffmpeg-signal` (`ffmpeg-scdet-volumedetect-v1`)
- **Offline speech adapter**: `local-whisper-asr`
- **Remote Gemini multimodal adapter** (disabled pending `AAI_ALLOW_CLOUD_AI=true`):
  - ID: `google-gemini-multimodal`, SDK: `@google/genai`, Model: `gemini-4-hydrogen`, Header: `User-Agent: aistudio-build`
- **Remote Gemini speech adapter** (disabled pending `AAI_ALLOW_CLOUD_AI=true`):
  - ID: `google-gemini-transcribe`, SDK: `@google/genai`, Model: `gemini-3.5-transcribe`, API version: `v1beta`, plain-text timestamped mode (JSON mode unsupported by model; parsed via `src/shared/transcript.ts` with strict `NO_SPEECH` non-fabrication guard)
- **Forbidden deprecated models**: `gemini-1.5-*`, `gemini-2.0-*`, `gemini-pro`
