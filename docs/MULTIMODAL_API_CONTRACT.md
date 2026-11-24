# Aionic Archive Intelligence (AAI)
## Multimodal Analysis Subsystem — Provider Adapter & REST API Contract v1.0

This document defines the reusable TypeScript provider adapter interface and HTTP REST contract for integrating the Multimodal Analysis Subsystem into the canonical Aionic Archive Intelligence application.

---

## 1. Epistemic Integrity Contract (Layers E / A / R / S / F)

Every observation, candidate moment, and export MUST preserve strict separation across five epistemic layers:

| Code | Layer | Scope & Governance Constraint |
| --- | --- | --- |
| `E` | **Evidence** | Directly observable or measurable facts from source media (pixel deltas, frame observations, audio dB/silence, embedded metadata, verbatim speech). Immutable during human review. Prohibits supernatural claims, hidden-intent assertions, or mental-state diagnoses. |
| `A` | **Analysis** | Machine or human interpretations, semantic classifications, selection rationales, and prioritisation relevance estimates (`0–100`). Must cite model/detector provenance and uncertainty. |
| `R` | **Recollection** | Human-supplied memories, personal accounts, and historical context. |
| `S` | **Symbolism** | Personal, spiritual, mythological, or archetypal associations. Never framed as verified physical or supernatural fact. |
| `F` | **Fiction** | Creative adaptation, narrative framing, or documentary drafts retaining links to source evidence. |

**Non-Migration Rule**: Records must never silently change their `layer` code. Cross-layer elaboration must create a new linked record in the target layer referencing the original entity ID.

---

## 2. Reusable Provider Adapter Interface (`server/multimodal/providerAdapter.ts`)

```ts
export interface IMultimodalProviderAdapter {
  readonly id: string;
  readonly name: string;
  detectCapabilities(): Promise<ProviderCapability>;
  analyze(request: MultimodalAnalysisRequest): Promise<MultimodalProviderOutput>;
}
```

### Built-In Adapters
1. `LocalSignalAdapter` (`local-ffmpeg-signal`) — Local FFmpeg scene-change, keyframe, and acoustic volume/silence analyzer (`$0` cloud cost, zero external egress).
2. `GeminiMultimodalAdapter` (`google-gemini-multimodal`) — Server-side `@google/genai` (`gemini-4-hydrogen`) analyzing extracted JPEG keyframes, audio profile, and optional verbatim transcript with structured `responseSchema`. Strictly enforces `cloudAiConsent === true` and `process.env.GEMINI_API_KEY`.
3. `GeminiSpeechTranscriptionAdapter` (`google-gemini-transcribe`) — Server-side `@google/genai` (`gemini-3.5-transcribe`) transcribing FFmpeg-extracted mono 16kHz MP3 audio (`inlineData`) into timestamped JSON segments without fabricating speech on silent/tone tracks. Strictly enforces `cloudAiConsent === true` and `process.env.GEMINI_API_KEY`.
4. `OpenAIMultimodalAdapter` (`openai-multimodal`) — Capability-detecting adapter slot; honestly reports availability without simulating results.
5. `AzureAIAdapter` (`azure-ai-multimodal`) — Capability-detecting adapter slot for Microsoft/Azure AI services.
6. `LocalSpeechWhisperAdapter` (`local-whisper-asr`) — Probes local `whisper` / `whisper-cpp` availability.

### Reconciled Gemini Integration Contract (`src/shared/apiContract.ts`)
- **SDK**: `@google/genai` (`^3.6.1`), strictly server-side (`server/multimodal/providerAdapter.ts`). Never exposed in client bundles or UI API-key inputs.
- **Request Header**: `User-Agent: aistudio-build` configured via `httpOptions.headers`.
- **Canonical Model Aliases**:
  - Multimodal frame & moment analysis: `gemini-4-hydrogen`
  - Pre-recorded audio speech transcription: `gemini-3.5-transcribe`
  - Future semantic embeddings slot: `gemini-embedding-2`
- **Forbidden Deprecated Models**: `gemini-1.5-pro`, `gemini-1.5-flash`, `gemini-2.0-flash`, `gemini-pro`.
- **Consent & Provenance**: Every remote call requires explicit `cloudAiConsent === true`, reads `process.env.GEMINI_API_KEY`, logs a `ModelRun` record (model, latency, tokens, error), and falls back or discloses errors honestly without fabricating outputs.

---

## 3. REST API Contract (`/api/*`)

| Method | Endpoint | Purpose | Governance & Error Contract |
| --- | --- | --- | --- |
| `GET` | `/api/providers` | Probe live runtime capability matrix for all registered adapters. | Never leaks secrets or API keys. |
| `GET` | `/api/contract` | Return machine-readable API contract & reconciled Gemini contract descriptor. | Read-only. |
| `GET` | `/api/assets` | List all ingested vault assets with SHA-256 hashes and origin flags (`real_upload` vs `verification_fixture`). | Originals immutable. |
| `POST` | `/api/assets/upload` | Ingest multipart media file (`field: file`), compute SHA-256, flag duplicates non-destructively, run FFprobe. | Allowlisted extensions only; 150MB cap; vault path confinement. |
| `GET` | `/api/media/:assetId` | Stream original vault media with HTTP `Range` (`206 Partial Content`) support. | Path confined inside vault directory. |
| `GET` | `/api/keyframes/:assetId/:filename` | Serve extracted representative JPEG keyframe. | Strict filename regex + directory confinement. |
| `GET` | `/api/assets/:assetId/workspace` | Hydrate asset metadata, keyframes, transcripts, dynamically ranked moments, 5 epistemic layers, jobs, model runs, revisions, and ranking config. | Dynamic ranking never mutates Layer E text. |
| `POST` | `/api/analysis/preflight` | Calculate estimated keyframes, chunks, local runtime, cloud tokens, and USD cost range (`economy` \| `balanced` \| `deep`). | Required prior to cloud runs (§18). |
| `POST` | `/api/analysis/run` | Execute 12-stage multimodal pipeline (including Stage 4 MP3 extraction & Stage 5 speech transcription when authorized). Body: `{ assetId, mode, providerId, cloudAiConsent }`. | Returns `403` if cloud provider requested without `cloudAiConsent: true`. |
| `POST` | `/api/analysis/jobs/:jobId/resume` | Resume an interrupted or failed processing job from the first incomplete stage. | Skips completed stages; logs recovery audit. |
| `POST` | `/api/assets/:assetId/transcribe` | On-demand FFmpeg mono 16kHz MP3 extraction + speech transcription via `google-gemini-transcribe` (`gemini-3.5-transcribe`) or local Whisper. | Returns `403` without `cloudAiConsent: true`; `503` if `GEMINI_API_KEY` unconfigured. |
| `PATCH` | `/api/events/:eventId` | Update review status, classification, `startSec`/`endSec` boundaries, project assignment, or annotations. | Appends `ReviewDecision`, `RevisionEntry`, and `AuditRecord`. Never overwrites `observableDescription`. |
| `POST` | `/api/events/bulk-review` | Bulk update review status for multiple event IDs (deduplicated, max 500 per request). | Records per-event review decisions, revisions, and audit entry. |
| `POST` | `/api/layers` | Append validated Layer `E`, `A`, `R`, `S`, or `F` record. | Returns `422` when Layer E contains speculative/supernatural/diagnostic claims. |
| `GET` / `PUT` | `/api/ranking/config` | Read or update configurable relevance ranking weights across all 12 categories, corroboration boost, min threshold, and feedback calibration. | Persisted in SQLite; creates revision log. |
| `POST` | `/api/search` | Hybrid retrieval across transcripts, events, and all 5 epistemic layers with multi-facet filters. | Returns source references, layer codes, timestamps, and `dataOrigin`. |
| `GET` | `/api/governance/audit` | Retrieve custodian audit ledger, revision history, and model run provenance. | Read-only audit trail. |
| `GET` | `/api/governance/release-manifest` | Return release version (`1.0.0-sprint001`), runtime readiness, reconciled Gemini contract, provider matrix, and vault SHA-256 inventory (`?download=1` downloads JSON). | Discloses boolean key presence only; never exposes secrets. |
| `POST` | `/api/assets/:assetId/verify-integrity` | Re-hash original vault file with SHA-256 and compare to ingestion record. | Logs `INTEGRITY_VERIFIED` audit record. |
| `GET` | `/api/assets/:assetId/export?format=json\|csv\|md\|srt\|vtt` | Generate downloadable evidence-linked export (or JSON preview with `&preview=1`). | Preserves SHA-256, layer separation, and prioritisation disclaimer. |
