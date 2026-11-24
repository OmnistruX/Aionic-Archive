/**
 * Canonical Domain Contracts for Aionic Archive Intelligence (AAI)
 * Multimodal Analysis Subsystem v1.0
 */

export type EpistemicLayer = 'E' | 'R' | 'A' | 'S' | 'F';

export interface EpistemicLayerMeta {
  code: EpistemicLayer;
  name: string;
  shortLabel: string;
  definition: string;
  provenanceRule: string;
  accentClass: string;
}

export const EPISTEMIC_LAYERS: Record<EpistemicLayer, EpistemicLayerMeta> = {
  E: {
    code: 'E',
    name: 'Layer E: Evidence',
    shortLabel: 'Evidence',
    definition:
      'Directly observable or measurable facts extracted from original source material (frames, audio signals, embedded metadata, exact verbatim speech).',
    provenanceRule: 'Immutable source reference required. Must not contain speculation, diagnoses, or unverified claims.',
    accentClass: 'text-cyan-300',
  },
  A: {
    code: 'A',
    name: 'Layer A: Analysis',
    shortLabel: 'Analysis',
    definition:
      'Machine-generated or human-generated interpretations, classifications, and relevance estimates derived from Layer E evidence.',
    provenanceRule: 'Must cite source Layer E timestamps and model/method provenance. Prioritisation estimates are never proof.',
    accentClass: 'text-violet-300',
  },
  R: {
    code: 'R',
    name: 'Layer R: Recollection',
    shortLabel: 'Recollection',
    definition:
      'Personal memories, oral context, and historical accounts supplied by the archive owner or witnesses.',
    provenanceRule: 'Attributed to a human author and revision date. Never overwrites Layer E evidence.',
    accentClass: 'text-slate-200',
  },
  S: {
    code: 'S',
    name: 'Layer S: Symbolism',
    shortLabel: 'Symbolism',
    definition:
      'Personal, spiritual, mythological, or archetypal associations recorded for creative or reflective mapping.',
    provenanceRule: 'Strictly separated from physical fact. Must never be presented as verified supernatural activity.',
    accentClass: 'text-indigo-300',
  },
  F: {
    code: 'F',
    name: 'Layer F: Fiction',
    shortLabel: 'Fiction',
    definition:
      'Creative adaptation, narrative drafts, documentary framing, or fictionalised reinterpretations.',
    provenanceRule: 'Explicitly marked as creative invention while retaining links to originating evidence.',
    accentClass: 'text-amber-300',
  },
};

export type MomentCategory =
  | 'important_dialogue'
  | 'emotional_turning_point'
  | 'environmental_change'
  | 'new_person_or_object'
  | 'location_transition'
  | 'repeated_phrase'
  | 'music_or_performance'
  | 'potential_documentary_material'
  | 'memory_association'
  | 'technical_irregularity'
  | 'user_defined_significance'
  | 'low_information_footage';

export interface MomentCategoryMeta {
  id: MomentCategory;
  label: string;
  description: string;
  defaultWeight: number;
}

export const MOMENT_CATEGORIES: Record<MomentCategory, MomentCategoryMeta> = {
  important_dialogue: {
    id: 'important_dialogue',
    label: 'Important dialogue',
    description: 'Substantive spoken statements, decisions, or notable exchanges.',
    defaultWeight: 1.2,
  },
  emotional_turning_point: {
    id: 'emotional_turning_point',
    label: 'Emotional turning point',
    description: 'Observable shift in vocal tone, pacing, or visual expression.',
    defaultWeight: 1.25,
  },
  environmental_change: {
    id: 'environmental_change',
    label: 'Environmental change',
    description: 'Notable shift in lighting, weather, acoustic atmosphere, or spatial setting.',
    defaultWeight: 1.0,
  },
  new_person_or_object: {
    id: 'new_person_or_object',
    label: 'New person or object',
    description: 'Entrance of a previously unseen figure, prop, or focal visual subject (no biometric ID).',
    defaultWeight: 1.05,
  },
  location_transition: {
    id: 'location_transition',
    label: 'Location transition',
    description: 'Scene boundary moving between distinct physical environments or camera setups.',
    defaultWeight: 0.95,
  },
  repeated_phrase: {
    id: 'repeated_phrase',
    label: 'Repeated phrase',
    description: 'Recurring spoken motif or linguistic echo within or across recordings.',
    defaultWeight: 0.9,
  },
  music_or_performance: {
    id: 'music_or_performance',
    label: 'Music or performance',
    description: 'Harmonic content, instrumentation, rhythmic audio, or live performance cues.',
    defaultWeight: 1.15,
  },
  potential_documentary_material: {
    id: 'potential_documentary_material',
    label: 'Potential documentary material',
    description: 'Visually composed, narratively clear, or contextually rich archival footage.',
    defaultWeight: 1.15,
  },
  memory_association: {
    id: 'memory_association',
    label: 'Memory association',
    description: 'Cue linked to user-supplied recollections or recurring personal motifs.',
    defaultWeight: 1.0,
  },
  technical_irregularity: {
    id: 'technical_irregularity',
    label: 'Technical irregularity',
    description: 'Exposure flicker, compression blockiness, lens reflection, audio clip, or drop frame.',
    defaultWeight: 0.85,
  },
  user_defined_significance: {
    id: 'user_defined_significance',
    label: 'User-defined significance',
    description: 'Moment manually flagged or prioritized by the archive owner.',
    defaultWeight: 1.35,
  },
  low_information_footage: {
    id: 'low_information_footage',
    label: 'Low-information footage',
    description: 'Static, obscured, silent, or repetitive segments candidates for deprioritisation.',
    defaultWeight: 0.35,
  },
};

export const ALL_MOMENT_CATEGORIES = Object.keys(MOMENT_CATEGORIES) as MomentCategory[];

export type ProcessingMode = 'economy' | 'balanced' | 'deep';
export type ReviewStatus = 'unreviewed' | 'accepted' | 'rejected' | 'false_positive' | 'bookmarked';
export type DataOrigin = 'real_upload' | 'verification_fixture';

export type PipelineStageId =
  | 'validate_file'
  | 'extract_metadata'
  | 'generate_preview'
  | 'extract_audio'
  | 'speech_transcription'
  | 'detect_scenes'
  | 'extract_keyframes'
  | 'multimodal_analysis'
  | 'detect_moments'
  | 'generate_descriptions'
  | 'index_results'
  | 'present_review';

export interface PipelineStageState {
  stageId: PipelineStageId;
  order: number;
  label: string;
  agentCode: 'AAI-01' | 'AAI-02' | 'AAI-03' | 'AAI-04' | 'AAI-05' | 'AAI-06' | 'AAI-07';
  status: 'pending' | 'running' | 'completed' | 'skipped' | 'failed';
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  log: string;
  errorMessage: string | null;
}

export interface Asset {
  id: string;
  originalFilename: string;
  sourceAdapter: 'local_upload' | 'verification_fixture' | 'google_drive' | 'onedrive' | 'dropbox';
  dataOrigin: DataOrigin;
  mediaKind: 'video' | 'audio' | 'image';
  mimeType: string;
  fileFormat: string;
  fileSizeBytes: number;
  durationSec: number;
  importDate: string;
  creationDate: string | null;
  creationDateStatus: 'embedded' | 'estimated' | 'unknown';
  width: number | null;
  height: number | null;
  frameRate: number | null;
  videoCodec: string | null;
  audioCodec: string | null;
  audioSampleRate: number | null;
  audioChannels: number | null;
  locationMetadata: string | null;
  sha256Hash: string;
  isDuplicateOf: string | null;
  processingStatus: 'imported' | 'processing' | 'completed' | 'partial' | 'failed';
  provenanceNote: string;
  embeddedMetadataJson: string;
  mediaUrl: string;
}

export interface Keyframe {
  id: string;
  assetId: string;
  timestampSec: number;
  sceneIndex: number;
  sceneScore: number;
  imageUrl: string;
  width: number | null;
  height: number | null;
  extractionMethod: string;
}

export interface TranscriptSegment {
  id: string;
  assetId: string;
  startSec: number;
  endSec: number;
  text: string;
  speakerLabel: string | null;
  confidence: number | null;
  providerId: string;
  isPlaceholderNotice: boolean;
}

export interface ScoreBreakdownItem {
  factor: string;
  contribution: number;
  detail: string;
}

export interface DetectedEvent {
  id: string;
  assetId: string;
  startSec: number;
  endSec: number;
  thumbnailUrl: string | null;
  observableDescription: string; // Strictly Layer E
  analyticalSummary: string; // Strictly Layer A
  relevantTranscript: string;
  detectionMethod: string;
  providerId: string;
  modelName: string | null;
  baseSignalStrength: number; // 0..1 raw detector score
  estimatedRelevanceScore: number; // 0..100 prioritisation estimate, NOT proof
  confidenceScore: number | null; // 0..1 where meaningful
  uncertaintyNote: string;
  reasonForSelection: string;
  ordinaryExplanations: string[]; // Mandatory for technical_irregularity
  classification: MomentCategory;
  reviewStatus: ReviewStatus;
  userAnnotations: string;
  assignedProject: string | null;
  tags: string[];
  modalities: Array<'visual' | 'audio' | 'transcript' | 'metadata' | 'user'>;
  dataOrigin: DataOrigin;
  scoreBreakdown?: ScoreBreakdownItem[];
  createdAt: string;
  updatedAt: string;
}

export interface LayerRecord {
  id: string;
  assetId: string;
  eventId: string | null;
  layer: EpistemicLayer;
  title: string;
  content: string;
  startSec: number | null;
  endSec: number | null;
  authorType: 'system_detector' | 'ai_model' | 'human_reviewer';
  authorName: string;
  providerId: string | null;
  modelName: string | null;
  sourceReference: string;
  confidence: number | null;
  uncertaintyDisclosure: string | null;
  revisionCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface RevisionEntry {
  id: string;
  entityType: 'event' | 'layer_record' | 'ranking_config';
  entityId: string;
  fieldChanged: string;
  previousValue: string;
  newValue: string;
  changedBy: string;
  reason: string;
  createdAt: string;
}

export interface ProcessingJob {
  id: string;
  assetId: string;
  mode: ProcessingMode;
  providerId: string;
  cloudAiAuthorized: boolean;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'interrupted';
  currentStage: PipelineStageId | null;
  chunkCount: number;
  completedChunks: number;
  stages: PipelineStageState[];
  startedAt: string;
  completedAt: string | null;
  errorSummary: string | null;
}

export interface ModelRun {
  id: string;
  jobId: string;
  assetId: string;
  providerId: string;
  modelName: string;
  modality: 'visual' | 'audio' | 'multimodal' | 'signal_analysis';
  configJson: string;
  inputSummary: string;
  status: 'completed' | 'failed' | 'skipped';
  latencyMs: number;
  estimatedTokens: number | null;
  errorMessage: string | null;
  createdAt: string;
}

export interface ReviewDecision {
  id: string;
  eventId: string;
  assetId: string;
  decision: ReviewStatus;
  previousClassification: MomentCategory;
  correctedClassification: MomentCategory;
  note: string;
  createdAt: string;
}

export interface AuditRecord {
  id: string;
  action: string;
  actor: string;
  entityType: string;
  entityId: string;
  details: string;
  createdAt: string;
}

export interface RankingConfig {
  id: string;
  name: string;
  categoryWeights: Record<MomentCategory, number>;
  modalityCorroborationBoost: number; // bonus per additional corroborating modality (0..20)
  minRelevanceThreshold: number; // 0..100 display/flagging threshold
  useHumanFeedbackCalibration: boolean;
  feedbackCalibrationStrength: number; // 0..1
  deprioritiseLowInfo: boolean;
  updatedAt: string;
}

export interface ProviderCapability {
  id: string;
  name: string;
  kind: 'local_signal' | 'cloud_multimodal' | 'local_speech' | 'cloud_speech' | 'cloud_embedding';
  available: boolean;
  requiresConsent: boolean;
  isPaidOrMetered: boolean;
  modelName: string | null;
  supportedModalities: Array<'video_frames' | 'audio_signal' | 'speech_transcription' | 'structured_json' | 'embeddings'>;
  statusReason: string;
  limitations: string[];
  environmentVarRequired: string | null;
}

export interface ReleaseManifest {
  releaseVersion: string;
  sprintId: string;
  generatedAt: string;
  schemaVersion: number;
  runtime: {
    nodeVersion: string;
    platform: string;
    arch: string;
    ffmpegAvailable: boolean;
    ffprobeAvailable: boolean;
  };
  geminiContract: {
    sdk: string;
    serverSideOnly: boolean;
    userAgentHeader: string;
    multimodalModel: string;
    transcriptionModel: string;
    embeddingModel: string;
    forbiddenDeprecatedModels: string[];
    explicitConsentEnforced: boolean;
    cloudProcessingApproved: boolean;
    apiKeyConfigured: boolean;
  };
  providers: ProviderCapability[];
  archiveSummary: {
    totalAssets: number;
    realUploads: number;
    verificationFixtures: number;
    totalEvents: number;
    totalLayerRecords: number;
    totalModelRuns: number;
    totalAuditRecords: number;
    assets: Array<{
      id: string;
      originalFilename: string;
      dataOrigin: DataOrigin;
      sha256Hash: string;
      durationSec: number;
      processingStatus: Asset['processingStatus'];
    }>;
  };
}

export interface PreFlightEstimate {
  mode: ProcessingMode;
  durationSec: number;
  estimatedKeyframes: number;
  chunkCount: number;
  estimatedLocalSeconds: number;
  cloudProviderSelected: boolean;
  estimatedCloudTokens: number;
  estimatedCostRangeUsd: string;
  requiresExplicitConsent: boolean;
  notes: string[];
}

export interface HybridSearchQuery {
  query: string;
  assetId?: string;
  category?: MomentCategory | 'all';
  layer?: EpistemicLayer | 'all';
  reviewStatus?: ReviewStatus | 'all';
  minConfidence?: number;
  dataOrigin?: DataOrigin | 'all';
}

export interface HybridSearchResult {
  resultType: 'event' | 'layer_record' | 'transcript';
  id: string;
  assetId: string;
  assetFilename: string;
  startSec: number | null;
  endSec: number | null;
  thumbnailUrl: string | null;
  layer: EpistemicLayer;
  classification: MomentCategory | null;
  reviewStatus: ReviewStatus | null;
  title: string;
  excerpt: string;
  matchScore: number;
  matchedTerms: string[];
  sourceReference: string;
  dataOrigin: DataOrigin;
}
