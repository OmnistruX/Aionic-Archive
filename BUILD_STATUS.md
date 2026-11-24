# Aionic Archive Intelligence — Multimodal Analysis Subsystem
## Implementation Status Register (`BUILD_STATUS.md`)

Last Updated: 2026-11-24 (Release `1.0.0-sprint001` — Convergence Sprint 001)

This register strictly distinguishes working, verified capabilities from planned or unconfigured extensions per Master Specification §23.

---

### Implemented and Tested
- **Real Media Ingestion & Vault Preservation (`AAI-01 Archivist`)**: Multipart ingestion supporting MP4, MOV, WebM, MKV, AVI, MP3, WAV, M4A, JPEG, PNG, and WebP with cryptographic SHA-256 hashing, non-destructive duplicate detection, and FFprobe technical metadata extraction (`server/media/ffmpegProcessor.ts`, `server.ts`).
- **Real FFmpeg Video & Audio Processing Pipeline**: Scene-change boundary detection (`select='gt(scene,...)'`), representative JPEG keyframe extraction, acoustic volume/silence envelope profiling (`volumedetect` + `silencedetect`), mono 16kHz MP3 audio extraction for ASR (`extractAudioTrackForAsr`), and HTTP Range streaming preview (`/api/media/:assetId`).
- **12-Stage Resumable Processing Orchestrator (`AAI-01`–`AAI-07`)**: Independent per-stage status, timing, error logging, checkpoint persistence in SQLite (`node:sqlite`), and recovery/resume from interrupted jobs (`POST /api/analysis/jobs/:jobId/resume`).
- **Configurable Relevance Ranking Engine (`src/shared/ranking.ts`)**: All 12 canonical Moment Categories (§7), live weight multipliers (0.0x–2.5x), multimodal corroboration boost, low-information deprioritisation, non-destructive human-review calibration, score breakdown explanations, and pre-flight cost/resource estimator across Economy / Balanced / Deep Analysis modes.
- **5-Layer Epistemic Integrity Architecture (`src/shared/layers.ts`)**: Strict separation of **Layer E (Evidence)**, **Layer A (Analysis)**, **Layer R (Recollection)**, **Layer S (Symbolism)**, and **Layer F (Fiction)** with server-side validation blocking supernatural/diagnostic claims from Layer E, blocking silent cross-layer migration, and enforcing ordinary technical explanations on `technical_irregularity` detections.
- **Reusable Provider-Independent Adapter Layer & Reconciled Gemini Contract (`server/multimodal/providerAdapter.ts`, `src/shared/apiContract.ts`)**:
  - `LocalSignalAdapter`: Tested end-to-end on real FFmpeg-generated 24s multi-scene verification MP4.
  - `GeminiMultimodalAdapter` (`google-gemini-multimodal`, `gemini-4-hydrogen`): Live-verified end-to-end against `@google/genai` with extracted JPEG keyframes and `responseSchema` (`status: completed`, `22,182ms`, `cloudAiConsent: true`).
  - `GeminiSpeechTranscriptionAdapter` (`google-gemini-transcribe`, `gemini-3.5-transcribe` on `v1beta`): Live-verified end-to-end against FFmpeg-extracted mono 16kHz MP3 (`145,029 bytes`, `status: completed`, `1,463ms`, `697 tokens`, honestly returned `NO_SPEECH` on tone-only test reel without fabricating dialogue).
  - `ProviderRegistry`: Live runtime capability detection across 6 adapters without fabricating unavailable models.
  - Canonical Gemini contract reconciled to `@google/genai` (`^3.6.1`) server-side only, `User-Agent: aistudio-build`, `gemini-4-hydrogen` (multimodal) and `gemini-3.5-transcribe` (`v1beta`, plain-text timestamped ASR), with deprecated models forbidden and explicit `cloudAiConsent` enforced.
- **Human Review Workbench, Bulk Selection & Persistence**: Accept, reject, bookmark, mark false positive, bulk action checkboxes with Shift+Click range selection & master indeterminate select-all (`POST /api/events/bulk-review`), clip boundary trimming (`startSec`/`endSec`), classification correction, reviewer annotations, and revision history persisted in SQLite (`data/aai_archive.db`).
- **Hybrid Search & Comparison (`server/search.ts`)**: Keyword + semantic synonym expansion + multi-facet filtering across events, epistemic layers, and transcripts, plus side-by-side recording comparison and timestamp jump navigation.
- **Evidence-Linked Exports & Release Manifest (`src/shared/exports.ts`, `GET /api/governance/release-manifest`)**: JSON evidence packages, CSV significant-event registers, Markdown reports, SRT/WebVTT subtitles, and downloadable Release Manifest JSON capturing runtime/contract/SHA-256 deployment evidence.
- **Unit & Integration Test Suite**: Deterministic `node:test` coverage across ranking, epistemic guardrails, exports, bulk selection, transcript parsing/window-matching, FFmpeg MP3 audio extraction, and interrupted-job recovery.

---

### Implemented but Untested Live on Real Spoken Archival Footage
- **Spoken Human Dialogue Archival Verification (`google-gemini-transcribe` / `local-whisper-asr`)**: Live `gemini-3.5-transcribe` API connectivity and non-fabrication behavior are verified; verbatim spoken-word accuracy on real archival human recordings requires uploading representative user footage (Sprint 001 item 5).

---

### Partially Implemented
- **Local Offline Speech Transcription (`local-whisper-asr`)**: Binary detection (`whisper` / `whisper-cpp`) is wired; neither binary is installed in this Linux container, so honest non-fabricating disclosures are emitted unless `GEMINI_API_KEY` or local Whisper is provided on the host machine.
- **Chunked Processing for 1+ Hour Recordings**: Pre-flight chunk planning and resumable job state are implemented; full multi-hour FFmpeg segment-splitting endurance testing on a 60-minute MP4 file remains a Phase 2 milestone (per §20 acceptance note).

---

### Planned (Canonical AAI Roadmap Phases 2–5)
- **External Cloud Import Adapters**: Google Drive, OneDrive, and Dropbox OAuth import connectors.
- **Vector Embedding Index**: Dense vector retrieval via `gemini-embedding-2` or local embedding models alongside existing FTS/synonym hybrid search.
- **Selected MP4 Clip & Contact Sheet Rendering**: FFmpeg clip trimming and tiled contact sheet image exports.
- **Narrative Studio & Constellation Integrations**: Drag-and-drop scene cards, Substack drafts, and Phase 4 constellation hooks.

---

### Blocked / Requires User Approval
- **Cloud Processing & Paid AI Calls (`AAI_ALLOW_CLOUD_AI=false` Default Lock)**: All remote cloud adapters (`google-gemini-multimodal`, `google-gemini-transcribe`, `openai-multimodal`, `azure-ai-multimodal`) are hard-disabled by default pending explicit deployment approval (`AAI_ALLOW_CLOUD_AI=true`) **and** per-run user consent (`cloudAiConsent: true`) per Sprint AAI-MVP-01 and Master Specification §16 & §18.
- **OpenAI (`OPENAI_API_KEY`) & Azure AI (`AZURE_AI_API_KEY`, `AZURE_AI_ENDPOINT`) Adapters**: Registered in `ProviderRegistry` with honest capability detection; transport activation requires user credentials and explicit authorization.
- **Codex Handoff & Contract Artifacts**: Machine-readable contract (`docs/multimodal_contract_v1.json`), Codex Sprint AAI-MVP-01 brief (`docs/CODEX_HANDOFF_AAI_MVP_01.md`), versioned SQLite schema migration `v2` (`schema_migrations`, soft-delete `deleted_at`, `model_run_id`, `export_records`, `narrative_scenes`), and `/api/v1/*` compatibility routes (`/api/v1/transcripts/search`, `/api/v1/jobs/:jobId`, `GET/POST /api/v1/search`) are packaged in this source release (`1.0.0-sprint001`) for direct reconciliation with Codex `main` commit `afd8a5e717d628bf3983d64a5b56aa3b22a3e59d`.
