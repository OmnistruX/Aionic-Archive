import {
  Asset,
  AuditRecord,
  DetectedEvent,
  EpistemicLayer,
  HybridSearchQuery,
  HybridSearchResult,
  Keyframe,
  LayerRecord,
  ModelRun,
  MomentCategory,
  PipelineStageId,
  PreFlightEstimate,
  ProcessingJob,
  ProcessingMode,
  ProviderCapability,
  RankingConfig,
  ReleaseManifest,
  ReviewStatus,
  RevisionEntry,
  TranscriptSegment,
} from '../shared/types';
import { ApiEndpointSpec } from '../shared/apiContract';

export interface AssetWorkspaceData {
  asset: Asset;
  keyframes: Keyframe[];
  transcripts: TranscriptSegment[];
  events: DetectedEvent[];
  layers: LayerRecord[];
  jobs: ProcessingJob[];
  modelRuns: ModelRun[];
  revisions: RevisionEntry[];
  rankingConfig: RankingConfig;
}

async function handleResponse<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (data as { error?: string }).error || `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return data as T;
}

export async function fetchAssets(): Promise<Asset[]> {
  const res = await fetch('/api/assets');
  const data = await handleResponse<{ assets: Asset[] }>(res);
  return data.assets;
}

export async function fetchAssetWorkspace(assetId: string): Promise<AssetWorkspaceData> {
  const res = await fetch(`/api/assets/${encodeURIComponent(assetId)}/workspace`);
  return handleResponse<AssetWorkspaceData>(res);
}

export async function fetchProviders(): Promise<{
  providers: ProviderCapability[];
  defaultLocalProvider: string;
}> {
  const res = await fetch('/api/providers');
  return handleResponse(res);
}

export async function fetchApiContract(): Promise<{
  version: string;
  subsystem: string;
  endpoints: ApiEndpointSpec[];
}> {
  const res = await fetch('/api/contract');
  return handleResponse(res);
}

export async function uploadMediaAsset(
  file: File,
  provenanceNote: string
): Promise<{ asset: Asset; duplicateDetected: boolean; duplicateOfAssetId: string | null }> {
  const form = new FormData();
  form.append('file', file);
  form.append('provenanceNote', provenanceNote);
  const res = await fetch('/api/assets/upload', {
    method: 'POST',
    body: form,
  });
  return handleResponse(res);
}

export async function fetchPreFlightEstimate(params: {
  assetId: string;
  mode: ProcessingMode;
  useCloudAi: boolean;
}): Promise<PreFlightEstimate> {
  const res = await fetch('/api/analysis/preflight', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  const data = await handleResponse<{ estimate: PreFlightEstimate }>(res);
  return data.estimate;
}

export async function runMultimodalPipeline(params: {
  assetId: string;
  mode: ProcessingMode;
  providerId: string;
  cloudAiConsent: boolean;
  simulateInterruptAtStage?: PipelineStageId;
}): Promise<{
  job: ProcessingJob;
  keyframes: Keyframe[];
  events: DetectedEvent[];
  modelRuns: ModelRun[];
  fallbackUsed: boolean;
  fallbackNotice: string | null;
}> {
  const res = await fetch('/api/analysis/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return handleResponse(res);
}

export async function resumePipelineJob(jobId: string): Promise<{
  job: ProcessingJob;
  resumedFromStage: PipelineStageId;
  events: DetectedEvent[];
}> {
  const res = await fetch(`/api/analysis/jobs/${encodeURIComponent(jobId)}/resume`, {
    method: 'POST',
  });
  return handleResponse(res);
}

export async function updateEventReview(
  eventId: string,
  patch: {
    reviewStatus?: ReviewStatus;
    classification?: MomentCategory;
    startSec?: number;
    endSec?: number;
    userAnnotations?: string;
    assignedProject?: string | null;
  }
): Promise<{ event: DetectedEvent; revision: RevisionEntry }> {
  const res = await fetch(`/api/events/${encodeURIComponent(eventId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  return handleResponse(res);
}

export async function bulkReviewEvents(
  eventIds: string[],
  reviewStatus: ReviewStatus
): Promise<{ updatedCount: number; updatedIds: string[] }> {
  const res = await fetch('/api/events/bulk-review', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ eventIds, reviewStatus }),
  });
  return handleResponse(res);
}

export async function createLayerRecord(payload: {
  assetId: string;
  eventId?: string | null;
  layer: EpistemicLayer;
  title: string;
  content: string;
  sourceReference: string;
  startSec?: number | null;
  endSec?: number | null;
  authorName?: string;
}): Promise<{ record: LayerRecord; warnings: string[] }> {
  const res = await fetch('/api/layers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return handleResponse(res);
}

export async function saveRankingConfig(config: RankingConfig): Promise<RankingConfig> {
  const res = await fetch('/api/ranking/config', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });
  const data = await handleResponse<{ config: RankingConfig }>(res);
  return data.config;
}

export async function runHybridSearch(query: HybridSearchQuery): Promise<{
  results: HybridSearchResult[];
  totalCount: number;
}> {
  const res = await fetch('/api/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(query),
  });
  return handleResponse(res);
}

export async function fetchGovernanceAudit(): Promise<{
  audits: AuditRecord[];
  revisions: RevisionEntry[];
  modelRuns: ModelRun[];
}> {
  const res = await fetch('/api/governance/audit');
  return handleResponse(res);
}

export async function verifyAssetIntegrity(assetId: string): Promise<{
  assetId: string;
  expectedSha256: string;
  measuredSha256: string;
  verifiedIntact: boolean;
  checkedAt: string;
}> {
  const res = await fetch(`/api/assets/${encodeURIComponent(assetId)}/verify-integrity`, {
    method: 'POST',
  });
  return handleResponse(res);
}

export async function fetchExportPreview(
  assetId: string,
  format: 'json' | 'csv' | 'srt' | 'vtt' | 'md'
): Promise<{ filename: string; format: string; content: string }> {
  const res = await fetch(`/api/assets/${encodeURIComponent(assetId)}/export?format=${format}&preview=1`);
  return handleResponse(res);
}

export async function transcribeAssetSpeech(params: {
  assetId: string;
  providerId?: string;
  cloudAiConsent: boolean;
}): Promise<{
  segments: TranscriptSegment[];
  modelRun: ModelRun;
  audioExtractedBytes: number;
}> {
  const res = await fetch(`/api/assets/${encodeURIComponent(params.assetId)}/transcribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      providerId: params.providerId ?? 'google-gemini-transcribe',
      cloudAiConsent: params.cloudAiConsent,
    }),
  });
  return handleResponse(res);
}

export async function fetchReleaseManifest(): Promise<ReleaseManifest> {
  const res = await fetch('/api/governance/release-manifest');
  return handleResponse<ReleaseManifest>(res);
}
