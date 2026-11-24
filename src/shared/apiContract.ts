/**
 * Documented REST & Provider Adapter Integration Contract
 * for Canonical Aionic Archive Intelligence (AAI) Integration
 */

export interface ApiEndpointSpec {
  id: string;
  method: 'GET' | 'POST' | 'PATCH' | 'PUT';
  path: string;
  summary: string;
  governanceRule: string;
  sampleRequestBody?: Record<string, unknown>;
  responseShape: string;
}

export const MULTIMODAL_API_CONTRACT: ApiEndpointSpec[] = [
  {
    id: 'providers-list',
    method: 'GET',
    path: '/api/providers',
    summary: 'Inspect live runtime capability detection across all registered multimodal adapters (Local FFmpeg/Signal, Google Gemini, OpenAI, Azure AI, Local Whisper).',
    governanceRule: 'Never exposes credentials or API keys. Unconfigured providers honestly report available=false and required environment variable.',
    responseShape: '{ providers: ProviderCapability[], defaultLocalProvider: string }',
  },
  {
    id: 'assets-list',
    method: 'GET',
    path: '/api/assets',
    summary: 'List all ingested audiovisual assets with SHA-256 hashes, technical metadata, provenance, and duplicate pointers.',
    governanceRule: 'Original source files are immutable; duplicate imports reference original without deletion.',
    responseShape: '{ assets: Asset[] }',
  },
  {
    id: 'assets-upload',
    method: 'POST',
    path: '/api/assets/upload',
    summary: 'Ingest a real media file (MP4, MOV, WebM, MKV, AVI, MP3, WAV, M4A, JPEG, PNG, WebP), compute SHA-256 hash, detect duplicates, and extract FFprobe metadata.',
    governanceRule: 'Strict MIME/extension allowlist and vault path confinement. Runs AAI-01 Archivist locally.',
    responseShape: '{ asset: Asset, duplicateDetected: boolean, duplicateOfAssetId: string | null }',
  },
  {
    id: 'analysis-preflight',
    method: 'POST',
    path: '/api/analysis/preflight',
    summary: 'Compute pre-flight keyframe count, chunk plan, local time estimate, and cloud token/USD range before running analysis.',
    governanceRule: 'Mandatory before paid/cloud AI runs per Spec §18.',
    sampleRequestBody: {
      assetId: 'asset-fixture-001',
      mode: 'balanced',
      useCloudAi: false,
    },
    responseShape: '{ estimate: PreFlightEstimate }',
  },
  {
    id: 'analysis-run',
    method: 'POST',
    path: '/api/analysis/run',
    summary: 'Execute or resume the 12-stage multimodal processing pipeline (scene boundaries, keyframes, audio profile, candidate events, Layer E/A extraction, indexing).',
    governanceRule: 'Enforces explicit cloudAiConsent=true server-side before invoking any external provider; defaults to LocalSignalAdapter.',
    sampleRequestBody: {
      assetId: 'asset-fixture-001',
      mode: 'balanced',
      providerId: 'local-ffmpeg-signal',
      cloudAiConsent: false,
    },
    responseShape: '{ job: ProcessingJob, events: DetectedEvent[], keyframes: Keyframe[], modelRuns: ModelRun[] }',
  },
  {
    id: 'analysis-resume',
    method: 'POST',
    path: '/api/analysis/jobs/:jobId/resume',
    summary: 'Recover and resume an interrupted or failed processing job from the first incomplete stage without redoing completed stages.',
    governanceRule: 'Preserves stage audit logs and model run provenance.',
    responseShape: '{ job: ProcessingJob, resumedFromStage: PipelineStageId }',
  },
  {
    id: 'events-list',
    method: 'GET',
    path: '/api/assets/:assetId/workspace',
    summary: 'Retrieve complete hydrated asset workspace: technical metadata, extracted keyframes, transcripts, ranked Significant Moments, 5 Epistemic Layers (E/A/R/S/F), jobs, model runs, and revision history.',
    governanceRule: 'Applies current RankingConfig dynamically without overwriting persisted Layer E fields.',
    responseShape: '{ asset, keyframes, transcripts, events, layers, jobs, modelRuns, revisions, rankingConfig }',
  },
  {
    id: 'event-review',
    method: 'PATCH',
    path: '/api/events/:eventId',
    summary: 'Human review mutation: accept/reject/bookmark/mark false positive, adjust start/end clip boundaries, correct classification, or add reviewer annotations.',
    governanceRule: 'Records ReviewDecision + RevisionEntry + AuditRecord. Never overwrites original Layer E observable description.',
    sampleRequestBody: {
      reviewStatus: 'accepted',
      userAnnotations: 'Confirmed visual transition matches field notes.',
    },
    responseShape: '{ event: DetectedEvent, revision: RevisionEntry }',
  },
  {
    id: 'layers-create',
    method: 'POST',
    path: '/api/layers',
    summary: 'Append a new structured entry strictly scoped to Layer E, A, R, S, or F with server-side epistemic integrity validation.',
    governanceRule: 'Blocks supernatural/speculative assertions in Layer E and blocks silent cross-layer migration.',
    sampleRequestBody: {
      assetId: 'asset-fixture-001',
      layer: 'R',
      title: 'Personal recording context',
      content: 'Recorded during the coastal equipment calibration test before dusk.',
      sourceReference: 'asset-fixture-001 @ 00:08.0',
      startSec: 8,
    },
    responseShape: '{ record: LayerRecord, warnings: string[] }',
  },
  {
    id: 'ranking-update',
    method: 'PUT',
    path: '/api/ranking/config',
    summary: 'Update configurable relevance ranking weights across all 12 categories, modality corroboration boost, minimum threshold, and feedback calibration.',
    governanceRule: 'Recalculates prioritisation estimates non-destructively and records revision history.',
    responseShape: '{ config: RankingConfig }',
  },
  {
    id: 'search-hybrid',
    method: 'POST',
    path: '/api/search',
    summary: 'Run hybrid retrieval across transcripts, Layer E/A/R/S/F records, and detected events with classification, layer, confidence, and review status filters.',
    governanceRule: 'Every hit returns explicit sourceReference, layer code, timestamp, and dataOrigin.',
    sampleRequestBody: {
      query: 'flicker',
      layer: 'all',
      category: 'all',
      reviewStatus: 'all',
    },
    responseShape: '{ results: HybridSearchResult[], totalCount: number }',
  },
  {
    id: 'jobs-progress',
    method: 'GET',
    path: '/api/v1/jobs/:jobId',
    summary: 'Inspect a public processing job record and progress percentages calculated strictly from actual completed stages and completed chunks.',
    governanceRule: 'Available on both /api/jobs/:jobId and /api/v1/jobs/:jobId.',
    responseShape: '{ job: ProcessingJob, progress: { completedStages, totalStages, stageProgressPct, completedChunks, chunkCount, chunkProgressPct } }',
  },
  {
    id: 'transcripts-search',
    method: 'GET',
    path: '/api/v1/transcripts/search?q=<term>&assetId=<optional>',
    summary: 'Search timestamped transcript segments across ingested assets (registered ahead of asset-ID routes to guarantee route precedence).',
    governanceRule: 'Excludes non-speech system notices by default (includeNotices=1 to inspect). Available on /api and /api/v1.',
    responseShape: '{ query: string, totalCount: number, results: TranscriptSearchHit[] }',
  },
  {
    id: 'assets-transcribe',
    method: 'POST',
    path: '/api/v1/assets/:assetId/transcribe',
    summary: 'Extract mono 16kHz MP3 audio via FFmpeg and execute speech transcription via Google Gemini (gemini-3.5-transcribe) or Local Whisper when approved/available.',
    governanceRule: 'Disabled pending deployment approval (AAI_ALLOW_CLOUD_AI=true) AND per-run cloudAiConsent=true; never fabricates dialogue.',
    sampleRequestBody: {
      providerId: 'google-gemini-transcribe',
      cloudAiConsent: true,
    },
    responseShape: '{ segments: TranscriptSegment[], modelRun: ModelRun, audioExtractedBytes: number }',
  },
  {
    id: 'exports-generate',
    method: 'GET',
    path: '/api/v1/assets/:assetId/export?format=json|csv|srt|vtt|md',
    summary: 'Generate downloadable evidence-linked export preserving SHA-256 provenance, layer boundaries, and model run metadata.',
    governanceRule: 'Persists an export_records provenance row and AuditRecord per Spec §16 & §19.',
    responseShape: 'Attachment stream (application/json | text/csv | text/plain | text/vtt | text/markdown)',
  },
  {
    id: 'governance-release-manifest',
    method: 'GET',
    path: '/api/v1/governance/release-manifest',
    summary: 'Return canonical release version, schema migration version, runtime readiness, reconciled Gemini contract, cloud approval lock state, and vault SHA-256 inventory.',
    governanceRule: 'Discloses boolean secret/gate readiness only; never leaks API key material.',
    responseShape: 'ReleaseManifest',
  },
];

export const GEMINI_INTEGRATION_CONTRACT = {
  sdk: '@google/genai',
  serverSideOnly: true,
  userAgentHeader: 'aistudio-build',
  multimodalModel: 'gemini-4-hydrogen',
  transcriptionModel: 'gemini-3.5-transcribe',
  transcriptionApiVersion: 'v1beta',
  embeddingModel: 'gemini-embedding-2',
  forbiddenDeprecatedModels: ['gemini-1.5-pro', 'gemini-1.5-flash', 'gemini-2.0-flash', 'gemini-pro'],
  explicitConsentEnforced: true,
  cloudApprovalEnvVar: 'AAI_ALLOW_CLOUD_AI',
  cloudDefaultEnabled: false,
  envVar: 'GEMINI_API_KEY',
} as const;

export const PROVIDER_ADAPTER_TS_INTERFACE = `export interface MultimodalAnalysisRequest {
  assetId: string;
  originalFilename: string;
  mediaKind: 'video' | 'audio' | 'image';
  durationSec: number;
  mode: 'economy' | 'balanced' | 'deep';
  sceneCuts: Array<{ timestampSec: number; sceneScore: number }>;
  keyframes: Array<{
    timestampSec: number;
    sceneIndex: number;
    sceneScore: number;
    localFilePath: string;
    extractionMethod: string;
  }>;
  audioProfile: {
    hasAudio: boolean;
    meanVolumeDb: number | null;
    maxVolumeDb: number | null;
    silenceIntervals: Array<{ startSec: number; endSec: number; durationSec: number }>;
    energyShiftTimestampsSec: number[];
  };
  extractedAudioPath?: string | null;
  existingTranscript?: Array<{ startSec: number; endSec: number; text: string }>;
  cloudAiConsent: boolean;
}

export interface MultimodalProviderOutput {
  providerId: string;
  modelName: string;
  modality: 'visual' | 'audio' | 'multimodal' | 'signal_analysis';
  observableEvidence: Array<{
    startSec: number;
    endSec: number;
    title: string;
    observableFact: string; // Strictly Layer E
  }>;
  candidateMoments: Array<{
    startSec: number;
    endSec: number;
    classification: MomentCategory;
    observableDescription: string; // Layer E
    analyticalSummary: string;     // Layer A
    reasonForSelection: string;
    baseSignalStrength: number;    // 0..1
    confidenceScore: number | null;
    uncertaintyNote: string;
    ordinaryExplanations: string[];
    modalities: Array<'visual' | 'audio' | 'transcript' | 'metadata'>;
    relevantTranscript: string;
    tags: string[];
  }>;
  transcriptSegments: Array<{
    startSec: number;
    endSec: number;
    text: string;
    speakerLabel: string | null;
    confidence: number | null;
    isPlaceholderNotice: boolean;
  }>;
  estimatedTokens: number | null;
}

export interface IMultimodalProviderAdapter {
  readonly id: string;
  readonly name: string;
  detectCapabilities(): Promise<ProviderCapability>;
  analyze(request: MultimodalAnalysisRequest): Promise<MultimodalProviderOutput>;
}`;
