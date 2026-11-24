# AAI Convergence Sprint 001 — Verification & Release Evidence

- **Release Version**: `1.0.0-sprint001`
- **Subsystem**: Aionic Archive Intelligence (AAI) — Multimodal Analysis Subsystem
- **Verification Date**: 2026-11-24
- **Container Runtime**: Node `v22.23.5` (`linux/x64`), FFmpeg + FFprobe installed, SQLite (`node:sqlite`), `@google/genai@^3.6.1`

---

## Sprint 001 Checklist Status

| Status | Item | Verification Scope & Evidence |
| --- | --- | --- |
| `[ ]` | Export Google AI Studio source package | **Host/UI action required** — Use Google AI Studio's **Export / Download source** control to archive the `1.0.0-sprint001` workspace package. |
| `[ ]` | Confirm canonical Codex repository HEAD | **Host/Git action required** — This AI Studio sandbox is not a Git working tree (`git status` reports no `.git` repository). Run `git rev-parse HEAD && git status --short` on your canonical Codex repository clone after syncing the exported package. |
| `[ ]` | Launch canonical application on Windows | **Host/Windows action required** — Container runtime is Linux (`linux/x64`). Follow the Windows launch checklist below (`npm ci`, `npm run test`, `npm run build`, `npm run dev` on port `3000`). |
| `[x]` | Verify real speech transcription | **Verified live (`gemini-3.5-transcribe` on `v1beta`)** — FFmpeg Stage 4 extracted `145,029 bytes` mono 16kHz MP3 from `aai_verification_reel_24s.mp4`; `POST /api/assets/asset-fixture-001/transcribe` blocked unconsented requests (`HTTP 403`) and succeeded with explicit consent (`HTTP 200`, `1,463ms`, `697 tokens`), honestly returning `NO_SPEECH` on the tone-only reel without fabricating dialogue. Verbatim human speech accuracy should also be checked on your own spoken archival clip once launched on Windows. |
| `[ ]` | Process representative archival footage | **User footage required** — Verified end-to-end on the built-in 24s multi-scene FFmpeg verification MP4 (`SHA-256 03bae2ff124cbd40887ef58fe335a2d77dc6083bfbc1b1b592056737cc5f9056`) via both `LocalSignalAdapter` and live `gemini-4-hydrogen` (`22,182ms`). Representative personal archival recordings must be ingested on your host machine. |
| `[x]` | Verify timestamp navigation and search | **Verified live (API + Browser)** — `POST /api/search` for `"flicker"` returned 6 evidence-linked hits with `sourceReference`, `layer`, and `startSec` (`15.7s`); clicking search jumps and keyframe cards seeks `<video>.currentTime` accurately in the Scanner workspace. |
| `[x]` | Export evidence-linked significant moments | **Verified live (API + Browser)** — `GET /api/assets/asset-fixture-001/export?format=json` and `?format=csv` returned full provenance packages preserving SHA-256 hash, all 5 separated epistemic layers (`E`, `A`, `R`, `S`, `F`), significant moments, model runs, and prioritisation disclaimers, with `EXPORT_GENERATED` logged in the Custodian Audit Ledger. |
| `[x]` | Reconcile Gemini integration contract | **Reconciled & live-verified** — Single-source contract in `src/shared/apiContract.ts` (`GEMINI_INTEGRATION_CONTRACT`) and `docs/MULTIMODAL_API_CONTRACT.md`: `@google/genai` server-side only, `User-Agent: aistudio-build`, `gemini-4-hydrogen` for multimodal keyframe analysis (live `HTTP 200`, `22,182ms`), `gemini-3.5-transcribe` (`v1beta`, plain-text timestamped ASR, live `HTTP 200`, `1,463ms`), `gemini-embedding-2` reserved for embeddings, deprecated `1.5`/`2.0`/`pro` models forbidden, and explicit `cloudAiConsent` enforced server-side. |
| `[x]` | Record release version and deployment evidence | **Recorded** — Version `1.0.0-sprint001` set in `package.json`, exposed via `GET /api/contract` and `GET /api/governance/release-manifest` (with `?download=1` JSON download in the Governance & Export workspace), and documented here and in `BUILD_STATUS.md`. |

---

## Reconciled Gemini Integration Evidence

- **SDK**: `@google/genai` `3.6.1` (server-side only in `server/multimodal/providerAdapter.ts`)
- **Multimodal Vision/Moment Run**:
  - Adapter: `google-gemini-multimodal` (`gemini-4-hydrogen`)
  - Result: `status: completed`, `latencyMs: 22182`, `fallbackUsed: false`
- **Speech Transcription Run**:
  - Adapter: `google-gemini-transcribe` (`gemini-3.5-transcribe` via `apiVersion: 'v1beta'`, plain-text timestamped format)
  - Input: FFmpeg-extracted mono 16kHz MP3 (`145,029 bytes`)
  - Result: `status: completed`, `latencyMs: 1463`, `estimatedTokens: 697`, honest `NO_SPEECH` disclosure on non-speech test tones
- **Consent Guardrail**:
  - `POST /api/assets/asset-fixture-001/transcribe` with `cloudAiConsent: false` -> `HTTP 403`

---

## Windows & Codex Host Completion Steps

Run these steps after exporting the source package from Google AI Studio to complete the remaining host-side Sprint 001 items:

```powershell
# 1. Confirm canonical Codex repository HEAD
git rev-parse HEAD
git status --short

# 2. Configure local environment on Windows (do not commit .env)
Copy-Item .env.example .env
# Edit .env to set GEMINI_API_KEY and verify ffmpeg/ffprobe are on PATH:
ffmpeg -version
ffprobe -version

# 3. Install, verify tests, typecheck, build, and launch on port 3000
npm ci
npm run test
npm run lint
npm run build
npm run dev
```

Once running at `http://localhost:3000`:
1. Ingest a representative archival video/audio recording containing spoken dialogue in **Multimodal Scanner**.
2. Grant explicit audio consent and click **Transcribe Speech** (or run the 12-stage pipeline with Gemini) to verify verbatim spoken dialogue transcription on real archival footage.
3. Review/bulk-approve significant moments, verify timestamp search jumps, and download the **JSON Evidence Package** + **Release Manifest (`aai_release_manifest_1.0.0-sprint001.json`)** from **Governance & Export**.
