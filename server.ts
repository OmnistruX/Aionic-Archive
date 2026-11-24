import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import multer from 'multer';
import { createServer as createViteServer } from 'vite';
import {
  ALL_MOMENT_CATEGORIES,
  EpistemicLayer,
  LayerRecord,
  MomentCategory,
  ProcessingMode,
  RankingConfig,
  ReleaseManifest,
  ReviewStatus,
} from './src/shared/types';
import {
  createDefaultRankingConfig,
  estimateProcessingCost,
  rankDetectedEvents,
} from './src/shared/ranking';
import { validateLayerRecordInput } from './src/shared/layers';
import {
  exportCsvEventRegister,
  exportJsonEvidencePackage,
  exportMarkdownReport,
  exportSubtitlesSrt,
  exportSubtitlesVtt,
} from './src/shared/exports';
import { GEMINI_INTEGRATION_CONTRACT, MULTIMODAL_API_CONTRACT } from './src/shared/apiContract';
import { AaiStore } from './server/db';
import {
  checkBinaryAvailable,
  computeFileSha256,
  ensureVerificationMp4Fixture,
  probeMediaFile,
} from './server/media/ffmpegProcessor';
import { isCloudAiDeploymentApproved, ProviderRegistry } from './server/multimodal/providerAdapter';
import { MultimodalOrchestrator } from './server/multimodal/orchestrator';
import { executeHybridSearch } from './server/search';
import { formatTimestamp } from './src/shared/layers';

const RELEASE_VERSION = '1.0.0-sprint001';

const ALLOWED_EXTENSIONS = new Set([
  '.mp4',
  '.mov',
  '.webm',
  '.mkv',
  '.avi',
  '.mp3',
  '.wav',
  '.m4a',
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
]);

const VALID_MODES = new Set<ProcessingMode>(['economy', 'balanced', 'deep']);
const VALID_LAYERS = new Set<EpistemicLayer>(['E', 'R', 'A', 'S', 'F']);
const VALID_REVIEW_STATUSES = new Set<ReviewStatus>([
  'unreviewed',
  'accepted',
  'rejected',
  'false_positive',
  'bookmarked',
]);
const VALID_CATEGORIES = new Set<MomentCategory>(ALL_MOMENT_CATEGORIES);

function inferMediaKind(ext: string, mime: string): 'video' | 'audio' | 'image' {
  if (['.mp3', '.wav', '.m4a'].includes(ext) || mime.startsWith('audio/')) return 'audio';
  if (['.jpg', '.jpeg', '.png', '.webp'].includes(ext) || mime.startsWith('image/')) return 'image';
  return 'video';
}

function safeResolveInside(baseDir: string, ...segments: string[]): string | null {
  const resolvedBase = path.resolve(baseDir);
  const resolvedTarget = path.resolve(resolvedBase, ...segments);
  if (resolvedTarget === resolvedBase || !resolvedTarget.startsWith(resolvedBase + path.sep)) {
    return null;
  }
  return resolvedTarget;
}

async function bootstrapVerificationFixture(
  store: AaiStore,
  orchestrator: MultimodalOrchestrator
): Promise<void> {
  const existingAssets = store.listAssets();
  if (existingAssets.length > 0) {
    return;
  }

  try {
    const fixture = await ensureVerificationMp4Fixture(store.paths.vaultDir);
    const stat = fs.statSync(fixture.filePath);
    const sha256 = await computeFileSha256(fixture.filePath);
    const probed = await probeMediaFile(fixture.filePath);
    const now = new Date().toISOString();

    const asset = store.insertAsset({
      id: 'asset-fixture-001',
      originalFilename: 'aai_verification_reel_24s.mp4',
      storedFilename: fixture.storedFilename,
      sourceAdapter: 'verification_fixture',
      dataOrigin: 'verification_fixture',
      mediaKind: 'video',
      mimeType: 'video/mp4',
      fileFormat: probed.fileFormat || 'mp4',
      fileSizeBytes: stat.size,
      durationSec: probed.durationSec || 24,
      importDate: now,
      creationDate: probed.creationDate,
      creationDateStatus: probed.creationDateStatus,
      width: probed.width,
      height: probed.height,
      frameRate: probed.frameRate,
      videoCodec: probed.videoCodec,
      audioCodec: probed.audioCodec,
      audioSampleRate: probed.audioSampleRate,
      audioChannels: probed.audioChannels,
      locationMetadata: probed.locationMetadata,
      sha256Hash: sha256,
      isDuplicateOf: null,
      processingStatus: 'imported',
      provenanceNote:
        'Built-in 24-second multi-scene MP4 generated locally via FFmpeg to verify real ingestion, scene detection, keyframe extraction, audio profiling, and epistemic separation. Clearly distinguished from user-uploaded archives.',
      embeddedMetadataJson: JSON.stringify(probed.rawTags),
    });

    store.insertAudit({
      id: `aud-${crypto.randomUUID().slice(0, 8)}`,
      action: 'FIXTURE_INGESTED',
      actor: 'AAI-01 Archivist',
      entityType: 'asset',
      entityId: asset.id,
      details: `Generated real local verification MP4 (${(stat.size / 1024).toFixed(1)} KB, SHA-256 ${sha256.slice(0, 12)}…).`,
      createdAt: now,
    });

    // Run real local 12-stage FFmpeg pipeline immediately on the real MP4 fixture
    await orchestrator.runPipeline({
      assetId: asset.id,
      mode: 'balanced',
      providerId: 'local-ffmpeg-signal',
      cloudAiConsent: false,
    });

    // Seed one illustrative Layer R (Recollection) and Layer S (Symbolism) record clearly marked as fixture examples
    store.insertLayerRecord({
      id: 'lyr-r-fixture-01',
      assetId: asset.id,
      eventId: null,
      layer: 'R',
      title: 'Calibration session context note (Fixture Example)',
      content:
        'Example human recollection entry showing how personal field context is recorded separately from FFmpeg Layer E measurements without overwriting source evidence.',
      startSec: 6.0,
      endSec: 12.0,
      authorType: 'human_reviewer',
      authorName: 'Archive Owner (Fixture Sample)',
      providerId: null,
      modelName: null,
      sourceReference: 'aai_verification_reel_24s.mp4 @ 00:06.0–00:12.0',
      confidence: null,
      uncertaintyDisclosure: 'Human recollection — subjective personal context.',
      revisionCount: 1,
      createdAt: now,
      updatedAt: now,
    });

    store.insertLayerRecord({
      id: 'lyr-s-fixture-01',
      assetId: asset.id,
      eventId: null,
      layer: 'S',
      title: 'Threshold luminance motif (Fixture Example)',
      content:
        'Example symbolic association linking the 16s exposure flicker to creative themes of signal disruption. Strictly Layer S; physical cause remains ordinary lighting/codec mechanics.',
      startSec: 16.0,
      endSec: 19.0,
      authorType: 'human_reviewer',
      authorName: 'Archive Owner (Fixture Sample)',
      providerId: null,
      modelName: null,
      sourceReference: 'aai_verification_reel_24s.mp4 @ 00:16.0–00:19.0',
      confidence: null,
      uncertaintyDisclosure: 'Symbolic/creative association only — never treated as verified supernatural activity.',
      revisionCount: 1,
      createdAt: now,
      updatedAt: now,
    });
  } catch (err) {
    console.error('[AAI] Failed to bootstrap verification fixture:', err);
  }
}

export async function createAppServer(): Promise<express.Express> {
  const app = express();
  const store = new AaiStore();
  const registry = new ProviderRegistry();
  const orchestrator = new MultimodalOrchestrator(store, registry);

  await bootstrapVerificationFixture(store, orchestrator);

  app.use(express.json({ limit: '4mb' }));

  // Compatibility bridge: serve canonical /api/v1/* routes alongside existing /api/* clients
  app.use((req, _res, next) => {
    if (req.url === '/api/v1' || req.url.startsWith('/api/v1/')) {
      req.url = req.url.replace(/^\/api\/v1\b/, '/api');
    }
    next();
  });

  const uploadStorage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, store.paths.vaultDir),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || '').toLowerCase();
      const safeExt = ALLOWED_EXTENSIONS.has(ext) ? ext : '.bin';
      cb(null, `${crypto.randomUUID()}${safeExt}`);
    },
  });

  const upload = multer({
    storage: uploadStorage,
    limits: { fileSize: 150 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      const ext = path.extname(file.originalname || '').toLowerCase();
      if (!ALLOWED_EXTENSIONS.has(ext)) {
        cb(new Error(`Unsupported file extension "${ext}". Allowed: ${Array.from(ALLOWED_EXTENSIONS).join(', ')}`));
        return;
      }
      cb(null, true);
    },
  });

  // 1. Provider Capabilities & API Contract
  app.get('/api/providers', async (_req, res) => {
    try {
      const providers = await registry.detectAllCapabilities();
      res.json({
        providers,
        defaultLocalProvider: 'local-ffmpeg-signal',
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to probe providers' });
    }
  });

  app.get('/api/contract', (_req, res) => {
    res.json({
      version: RELEASE_VERSION,
      schemaVersion: store.getSchemaVersion(),
      apiPrefixes: ['/api', '/api/v1'],
      subsystem: 'Aionic Archive Intelligence — Multimodal Analysis Subsystem',
      geminiContract: {
        ...GEMINI_INTEGRATION_CONTRACT,
        cloudProcessingApproved: isCloudAiDeploymentApproved(),
      },
      endpoints: MULTIMODAL_API_CONTRACT,
    });
  });

  // 1b. Precedence-Safe Timestamped Transcript Search (registered ahead of any /:assetId route)
  app.get('/api/transcripts/search', (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : '';
    const assetIdFilter = typeof req.query.assetId === 'string' && req.query.assetId.trim() ? req.query.assetId.trim() : null;
    const includeNotices = req.query.includeNotices === '1' || req.query.includeNotices === 'true';

    const assets = store.listAssets();
    const assetMap = new Map(assets.map((a) => [a.id, a]));
    const targetAssets = assetIdFilter ? assets.filter((a) => a.id === assetIdFilter) : assets;

    const hits: Array<{
      id: string;
      assetId: string;
      assetFilename: string;
      startSec: number;
      endSec: number;
      text: string;
      speakerLabel: string | null;
      confidence: number | null;
      providerId: string;
      isPlaceholderNotice: boolean;
      sourceReference: string;
    }> = [];

    for (const asset of targetAssets) {
      const segments = store.listTranscripts(asset.id);
      for (const seg of segments) {
        if (!includeNotices && seg.isPlaceholderNotice) continue;
        if (q && !seg.text.toLowerCase().includes(q) && !(seg.speakerLabel || '').toLowerCase().includes(q)) {
          continue;
        }
        const meta = assetMap.get(seg.assetId);
        hits.push({
          id: seg.id,
          assetId: seg.assetId,
          assetFilename: meta?.originalFilename ?? seg.assetId,
          startSec: seg.startSec,
          endSec: seg.endSec,
          text: seg.text,
          speakerLabel: seg.speakerLabel,
          confidence: seg.confidence,
          providerId: seg.providerId,
          isPlaceholderNotice: seg.isPlaceholderNotice,
          sourceReference: `${meta?.originalFilename ?? seg.assetId} @ ${formatTimestamp(seg.startSec)}–${formatTimestamp(seg.endSec)}`,
        });
      }
    }

    res.json({ query: q, totalCount: hits.length, results: hits });
  });

  // 1c. Public Job Progress Endpoint (computed from actual completed stages and chunks)
  app.get('/api/jobs/:jobId', (req, res) => {
    const job = store.getJob(req.params.jobId);
    if (!job) {
      res.status(404).json({ error: 'Processing job not found.' });
      return;
    }
    const totalStages = Math.max(1, job.stages.length);
    const completedStages = job.stages.filter((s) => s.status === 'completed').length;
    const totalChunks = Math.max(1, job.chunkCount);
    const completedChunks = Math.min(totalChunks, Math.max(0, job.completedChunks));
    res.json({
      job,
      progress: {
        completedStages,
        totalStages,
        stageProgressPct: Math.round((completedStages / totalStages) * 100),
        completedChunks,
        chunkCount: totalChunks,
        chunkProgressPct: Math.round((completedChunks / totalChunks) * 100),
      },
    });
  });

  // 2. Asset Listing & Ingestion (AAI-01 Archivist)
  app.get('/api/assets', (_req, res) => {
    res.json({ assets: store.listAssets() });
  });

  app.post('/api/assets/upload', (req, res) => {
    upload.single('file')(req, res, async (uploadErr) => {
      if (uploadErr) {
        res.status(400).json({ error: uploadErr instanceof Error ? uploadErr.message : 'Upload failed' });
        return;
      }
      if (!req.file) {
        res.status(400).json({ error: 'No media file attached. Send multipart field "file".' });
        return;
      }

      const filePath = safeResolveInside(store.paths.vaultDir, req.file.filename);
      if (!filePath) {
        res.status(400).json({ error: 'Invalid upload storage path.' });
        return;
      }

      try {
        const ext = path.extname(req.file.originalname || '').toLowerCase();
        const sha256 = await computeFileSha256(filePath);
        const existingDuplicate = store.findAssetByHash(sha256);
        const mediaKind = inferMediaKind(ext, req.file.mimetype || '');
        const probed = await probeMediaFile(filePath).catch(() => ({
          durationSec: 0,
          fileFormat: ext.replace('.', '') || 'unknown',
          width: null,
          height: null,
          frameRate: null,
          videoCodec: null,
          audioCodec: null,
          audioSampleRate: null,
          audioChannels: null,
          creationDate: null,
          creationDateStatus: 'unknown' as const,
          locationMetadata: null,
          rawTags: {},
        }));

        const now = new Date().toISOString();
        const assetId = `asset-${crypto.randomUUID().slice(0, 8)}`;
        const provenanceNote =
          typeof req.body?.provenanceNote === 'string' && req.body.provenanceNote.trim()
            ? req.body.provenanceNote.trim().slice(0, 400)
            : 'Uploaded directly by archive owner; original source preserved intact in vault.';

        const asset = store.insertAsset({
          id: assetId,
          originalFilename: path.basename(req.file.originalname || req.file.filename),
          storedFilename: req.file.filename,
          sourceAdapter: 'local_upload',
          dataOrigin: 'real_upload',
          mediaKind,
          mimeType: req.file.mimetype || 'application/octet-stream',
          fileFormat: probed.fileFormat,
          fileSizeBytes: req.file.size,
          durationSec: probed.durationSec,
          importDate: now,
          creationDate: probed.creationDate,
          creationDateStatus: probed.creationDateStatus,
          width: probed.width,
          height: probed.height,
          frameRate: probed.frameRate,
          videoCodec: probed.videoCodec,
          audioCodec: probed.audioCodec,
          audioSampleRate: probed.audioSampleRate,
          audioChannels: probed.audioChannels,
          locationMetadata: probed.locationMetadata,
          sha256Hash: sha256,
          isDuplicateOf: existingDuplicate ? existingDuplicate.id : null,
          processingStatus: 'imported',
          provenanceNote,
          embeddedMetadataJson: JSON.stringify(probed.rawTags),
        });

        store.insertAudit({
          id: `aud-${crypto.randomUUID().slice(0, 8)}`,
          action: existingDuplicate ? 'DUPLICATE_ASSET_INGESTED' : 'ASSET_INGESTED',
          actor: 'AAI-01 Archivist',
          entityType: 'asset',
          entityId: asset.id,
          details: existingDuplicate
            ? `Ingested "${asset.originalFilename}" matching SHA-256 of "${existingDuplicate.id}". Original preserved without deletion.`
            : `Ingested "${asset.originalFilename}" (${(asset.fileSizeBytes / 1024).toFixed(1)} KB, SHA-256 ${sha256.slice(0, 12)}…).`,
          createdAt: now,
        });

        res.status(201).json({
          asset,
          duplicateDetected: Boolean(existingDuplicate),
          duplicateOfAssetId: existingDuplicate?.id ?? null,
        });
      } catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to process uploaded asset' });
      }
    });
  });

  // 3. Stream Original Vault Media (supports HTTP Range for frame-accurate <video> seeking)
  app.get('/api/media/:assetId', (req, res) => {
    const asset = store.getAssetWithFile(req.params.assetId);
    if (!asset) {
      res.status(404).json({ error: 'Asset not found.' });
      return;
    }
    const filePath = safeResolveInside(store.paths.vaultDir, asset.storedFilename);
    if (!filePath || !fs.existsSync(filePath)) {
      res.status(404).json({ error: 'Vault file missing on disk.' });
      return;
    }

    const stat = fs.statSync(filePath);
    const total = stat.size;
    const range = req.headers.range;

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : total - 1;
      if (!Number.isFinite(start) || !Number.isFinite(end) || start >= total || end >= total || start > end) {
        res.status(416).setHeader('Content-Range', `bytes */${total}`).end();
        return;
      }
      const chunkSize = end - start + 1;
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${total}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': asset.mimeType || 'video/mp4',
      });
      fs.createReadStream(filePath, { start, end }).pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Length': total,
        'Content-Type': asset.mimeType || 'video/mp4',
        'Accept-Ranges': 'bytes',
      });
      fs.createReadStream(filePath).pipe(res);
    }
  });

  // 4. Serve Extracted Keyframe Images (confined strictly inside data/keyframes/)
  app.get('/api/keyframes/:assetId/:filename', (req, res) => {
    const { assetId, filename } = req.params;
    if (!/^[a-zA-Z0-9._-]+$/.test(assetId) || !/^[a-zA-Z0-9._-]+$/.test(filename)) {
      res.status(400).json({ error: 'Invalid keyframe path identifier.' });
      return;
    }
    const kfPath = safeResolveInside(store.paths.keyframesDir, assetId, filename);
    if (!kfPath || !fs.existsSync(kfPath)) {
      res.status(404).json({ error: 'Keyframe image not found.' });
      return;
    }
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    fs.createReadStream(kfPath).pipe(res);
  });

  // 5. Hydrated Asset Workspace
  app.get('/api/assets/:assetId/workspace', (req, res) => {
    const assetWithFile = store.getAssetWithFile(req.params.assetId);
    if (!assetWithFile) {
      res.status(404).json({ error: 'Asset not found.' });
      return;
    }
    const { storedFilename: _s, ...asset } = assetWithFile;
    const rankingConfig = store.getRankingConfig();
    const decisions = store.listReviewDecisions();
    const rawEvents = store.listEvents(asset.id);
    const events = rankDetectedEvents(rawEvents, rankingConfig, decisions);

    res.json({
      asset,
      keyframes: store.listKeyframes(asset.id),
      transcripts: store.listTranscripts(asset.id),
      events,
      layers: store.listLayerRecords(asset.id),
      jobs: store.listJobs(asset.id),
      modelRuns: store.listModelRuns(asset.id),
      revisions: store.listRevisions(40),
      rankingConfig,
    });
  });

  // 6. Pre-Flight Cost & Resource Estimation (§18)
  app.post('/api/analysis/preflight', (req, res) => {
    const assetId = typeof req.body?.assetId === 'string' ? req.body.assetId : '';
    const mode = req.body?.mode as ProcessingMode;
    const useCloudAi = Boolean(req.body?.useCloudAi);

    if (!VALID_MODES.has(mode)) {
      res.status(400).json({ error: 'Invalid processing mode. Use economy, balanced, or deep.' });
      return;
    }
    const asset = store.getAssetWithFile(assetId);
    if (!asset) {
      res.status(404).json({ error: 'Asset not found.' });
      return;
    }

    const estimate = estimateProcessingCost(asset.durationSec, asset.fileSizeBytes, mode, useCloudAi);
    res.json({ estimate });
  });

  // 7. Run 12-Stage Multimodal Processing Pipeline
  app.post('/api/analysis/run', async (req, res) => {
    const assetId = typeof req.body?.assetId === 'string' ? req.body.assetId : '';
    const mode = (req.body?.mode as ProcessingMode) || 'balanced';
    const providerId = typeof req.body?.providerId === 'string' ? req.body.providerId : 'local-ffmpeg-signal';
    const cloudAiConsent = Boolean(req.body?.cloudAiConsent);
    const simulateInterruptAtStage =
      typeof req.body?.simulateInterruptAtStage === 'string' ? req.body.simulateInterruptAtStage : undefined;

    if (!VALID_MODES.has(mode)) {
      res.status(400).json({ error: 'Invalid processing mode. Must be economy, balanced, or deep.' });
      return;
    }

    try {
      const result = await orchestrator.runPipeline({
        assetId,
        mode,
        providerId,
        cloudAiConsent,
        simulateInterruptAtStage: simulateInterruptAtStage as never,
      });
      const rankingConfig = store.getRankingConfig();
      const decisions = store.listReviewDecisions();
      res.json({
        ...result,
        events: rankDetectedEvents(result.events, rankingConfig, decisions),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Pipeline execution failed.';
      const statusCode = msg.includes('cloud consent') ? 403 : msg.includes('Interrupted') ? 409 : 400;
      res.status(statusCode).json({ error: msg, jobs: store.listJobs(assetId) });
    }
  });

  // 8. Resume Interrupted/Failed Pipeline Job (§5 & §20 Criterion #14)
  app.post('/api/analysis/jobs/:jobId/resume', async (req, res) => {
    const existing = store.getJob(req.params.jobId);
    if (!existing) {
      res.status(404).json({ error: 'Processing job not found.' });
      return;
    }
    const resumedFromStage = existing.stages.find((s) => s.status !== 'completed')?.stageId ?? 'present_review';
    try {
      const result = await orchestrator.runPipeline({
        assetId: existing.assetId,
        mode: existing.mode,
        providerId: existing.providerId,
        cloudAiConsent: existing.cloudAiAuthorized,
        resumeJobId: existing.id,
      });
      const rankingConfig = store.getRankingConfig();
      const decisions = store.listReviewDecisions();
      res.json({
        ...result,
        resumedFromStage,
        events: rankDetectedEvents(result.events, rankingConfig, decisions),
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to resume job.' });
    }
  });

  // 8b. On-Demand Real Speech Transcription (AAI-03 Listener — Gemini 3.5 Transcribe / Local Whisper)
  app.post('/api/assets/:assetId/transcribe', async (req, res) => {
    const providerId =
      typeof req.body?.providerId === 'string' && req.body.providerId.trim()
        ? req.body.providerId.trim()
        : 'google-gemini-transcribe';
    const cloudAiConsent = Boolean(req.body?.cloudAiConsent);

    try {
      const result = await orchestrator.runSpeechTranscription({
        assetId: req.params.assetId,
        providerId,
        cloudAiConsent,
      });
      res.json(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Speech transcription failed.';
      const statusCode =
        msg.includes('cloud consent') || msg.includes('disabled pending approval')
          ? 403
          : msg.includes('not found')
            ? 404
            : msg.includes('unavailable') || msg.includes('GEMINI_API_KEY')
              ? 503
              : 400;
      res.status(statusCode).json({ error: msg });
    }
  });

  // 9. Human Review Mutation on Detected Event (Preserves Layer E Evidence)
  app.patch('/api/events/:eventId', (req, res) => {
    const existing = store.getEvent(req.params.eventId);
    if (!existing) {
      res.status(404).json({ error: 'Detected event not found.' });
      return;
    }

    const patch: Parameters<AaiStore['updateEventReview']>[1] = {};
    if (req.body?.reviewStatus !== undefined) {
      if (!VALID_REVIEW_STATUSES.has(req.body.reviewStatus)) {
        res.status(400).json({ error: 'Invalid reviewStatus.' });
        return;
      }
      patch.reviewStatus = req.body.reviewStatus;
    }
    if (req.body?.classification !== undefined) {
      if (!VALID_CATEGORIES.has(req.body.classification)) {
        res.status(400).json({ error: 'Invalid classification category.' });
        return;
      }
      patch.classification = req.body.classification;
    }
    if (req.body?.startSec !== undefined) {
      const s = Number(req.body.startSec);
      if (!Number.isFinite(s) || s < 0) {
        res.status(400).json({ error: 'startSec must be a non-negative number.' });
        return;
      }
      patch.startSec = Number(s.toFixed(2));
    }
    if (req.body?.endSec !== undefined) {
      const e = Number(req.body.endSec);
      if (!Number.isFinite(e) || e <= (patch.startSec ?? existing.startSec)) {
        res.status(400).json({ error: 'endSec must be greater than startSec.' });
        return;
      }
      patch.endSec = Number(e.toFixed(2));
    }
    if (req.body?.userAnnotations !== undefined) {
      patch.userAnnotations = String(req.body.userAnnotations).slice(0, 2000);
    }
    if (req.body?.assignedProject !== undefined) {
      patch.assignedProject = req.body.assignedProject ? String(req.body.assignedProject).slice(0, 120) : null;
    }

    const updated = store.updateEventReview(existing.id, patch);
    if (!updated) {
      res.status(404).json({ error: 'Event update failed.' });
      return;
    }

    const now = new Date().toISOString();
    const changedFields = Object.keys(patch).join(', ') || 'review';
    const revision = {
      id: `rev-${crypto.randomUUID().slice(0, 8)}`,
      entityType: 'event' as const,
      entityId: updated.id,
      fieldChanged: changedFields,
      previousValue: JSON.stringify({
        reviewStatus: existing.reviewStatus,
        classification: existing.classification,
        startSec: existing.startSec,
        endSec: existing.endSec,
      }),
      newValue: JSON.stringify({
        reviewStatus: updated.reviewStatus,
        classification: updated.classification,
        startSec: updated.startSec,
        endSec: updated.endSec,
      }),
      changedBy: 'Archive Reviewer',
      reason: 'Human review workbench update (Layer E observable evidence preserved intact).',
      createdAt: now,
    };
    store.insertRevision(revision);

    if (patch.reviewStatus || patch.classification) {
      store.insertReviewDecision({
        id: `dec-${crypto.randomUUID().slice(0, 8)}`,
        eventId: updated.id,
        assetId: updated.assetId,
        decision: updated.reviewStatus,
        previousClassification: existing.classification,
        correctedClassification: updated.classification,
        note: updated.userAnnotations,
        createdAt: now,
      });
    }

    store.insertAudit({
      id: `aud-${crypto.randomUUID().slice(0, 8)}`,
      action: 'EVENT_REVIEWED',
      actor: 'Archive Reviewer',
      entityType: 'detected_event',
      entityId: updated.id,
      details: `Updated ${changedFields} -> status=${updated.reviewStatus}, class=${updated.classification}.`,
      createdAt: now,
    });

    const rankingConfig = store.getRankingConfig();
    const ranked = rankDetectedEvents([updated], rankingConfig, store.listReviewDecisions())[0];
    res.json({ event: ranked, revision });
  });

  // 10. Bulk Review Action (§11)
  app.post('/api/events/bulk-review', (req, res) => {
    const rawIds: string[] = Array.isArray(req.body?.eventIds) ? req.body.eventIds.map(String) : [];
    const eventIds = Array.from(new Set(rawIds)).slice(0, 500);
    const reviewStatus = req.body?.reviewStatus as ReviewStatus;
    if (eventIds.length === 0 || !VALID_REVIEW_STATUSES.has(reviewStatus)) {
      res.status(400).json({ error: 'Provide non-empty eventIds array and valid reviewStatus.' });
      return;
    }

    const updatedIds: string[] = [];
    const now = new Date().toISOString();
    for (const id of eventIds) {
      const existing = store.getEvent(id);
      if (!existing) continue;
      const updated = store.updateEventReview(id, { reviewStatus });
      if (updated) {
        updatedIds.push(id);
        store.insertReviewDecision({
          id: `dec-${crypto.randomUUID().slice(0, 8)}`,
          eventId: id,
          assetId: existing.assetId,
          decision: reviewStatus,
          previousClassification: existing.classification,
          correctedClassification: existing.classification,
          note: 'Bulk review action',
          createdAt: now,
        });
        store.insertRevision({
          id: `rev-${crypto.randomUUID().slice(0, 8)}`,
          entityType: 'event',
          entityId: id,
          fieldChanged: 'reviewStatus',
          previousValue: JSON.stringify({ reviewStatus: existing.reviewStatus }),
          newValue: JSON.stringify({ reviewStatus: updated.reviewStatus }),
          changedBy: 'Archive Reviewer',
          reason: `Bulk review action -> ${reviewStatus} (Layer E observable evidence preserved intact).`,
          createdAt: now,
        });
      }
    }

    store.insertAudit({
      id: `aud-${crypto.randomUUID().slice(0, 8)}`,
      action: 'BULK_REVIEW',
      actor: 'Archive Reviewer',
      entityType: 'detected_event',
      entityId: updatedIds.join(','),
      details: `Bulk-updated ${updatedIds.length} event(s) to "${reviewStatus}".`,
      createdAt: now,
    });

    res.json({ updatedCount: updatedIds.length, updatedIds });
  });

  // 11. Create Epistemic Layer Record (E / A / R / S / F with strict validation)
  app.post('/api/layers', (req, res) => {
    const assetId = typeof req.body?.assetId === 'string' ? req.body.assetId : '';
    const layer = req.body?.layer as EpistemicLayer;
    const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
    const content = typeof req.body?.content === 'string' ? req.body.content.trim() : '';
    const sourceReference = typeof req.body?.sourceReference === 'string' ? req.body.sourceReference.trim() : '';
    const eventId = typeof req.body?.eventId === 'string' && req.body.eventId ? req.body.eventId : null;
    const startSec =
      req.body?.startSec !== undefined && req.body?.startSec !== null && req.body?.startSec !== ''
        ? Number(req.body.startSec)
        : null;
    const endSec =
      req.body?.endSec !== undefined && req.body?.endSec !== null && req.body?.endSec !== ''
        ? Number(req.body.endSec)
        : null;

    if (!store.getAssetWithFile(assetId)) {
      res.status(404).json({ error: 'Target asset not found.' });
      return;
    }

    if (!VALID_LAYERS.has(layer)) {
      res.status(400).json({ error: 'Layer must be one of E, A, R, S, or F.' });
      return;
    }

    const validation = validateLayerRecordInput({
      layer,
      title,
      content,
      sourceReference,
      startSec,
    });

    if (!validation.valid) {
      res.status(422).json({
        error: validation.errors.join(' '),
        errors: validation.errors,
        warnings: validation.warnings,
        suggestedLayer: validation.suggestedLayer,
      });
      return;
    }

    const now = new Date().toISOString();
    const record: LayerRecord = {
      id: `lyr-${layer.toLowerCase()}-${crypto.randomUUID().slice(0, 8)}`,
      assetId,
      eventId,
      layer,
      title,
      content,
      startSec: startSec !== null && Number.isFinite(startSec) ? startSec : null,
      endSec: endSec !== null && Number.isFinite(endSec) ? endSec : null,
      authorType: 'human_reviewer',
      authorName: typeof req.body?.authorName === 'string' && req.body.authorName.trim()
        ? req.body.authorName.trim().slice(0, 80)
        : 'Archive Owner',
      providerId: null,
      modelName: null,
      sourceReference,
      confidence: null,
      uncertaintyDisclosure:
        layer === 'S'
          ? 'Symbolic association only — not verified physical fact.'
          : layer === 'F'
            ? 'Creative adaptation / fiction draft — linked to source evidence.'
            : layer === 'R'
              ? 'Personal recollection supplied by human reviewer.'
              : null,
      revisionCount: 1,
      createdAt: now,
      updatedAt: now,
    };

    store.insertLayerRecord(record);
    store.insertAudit({
      id: `aud-${crypto.randomUUID().slice(0, 8)}`,
      action: `LAYER_${layer}_CREATED`,
      actor: record.authorName,
      entityType: 'layer_record',
      entityId: record.id,
      details: `Added Layer ${layer} entry "${record.title}" referencing ${record.sourceReference}.`,
      createdAt: now,
    });

    res.status(201).json({ record, warnings: validation.warnings });
  });

  // 12. Configurable Relevance Ranking Config (§7)
  app.get('/api/ranking/config', (_req, res) => {
    res.json({ config: store.getRankingConfig() });
  });

  app.put('/api/ranking/config', (req, res) => {
    const prev = store.getRankingConfig();
    const incoming = req.body as Partial<RankingConfig>;
    const defaults = createDefaultRankingConfig();
    const nextWeights = { ...defaults.categoryWeights, ...(prev.categoryWeights ?? {}) };

    if (incoming.categoryWeights && typeof incoming.categoryWeights === 'object') {
      for (const cat of ALL_MOMENT_CATEGORIES) {
        const val = Number(incoming.categoryWeights[cat]);
        if (Number.isFinite(val)) {
          nextWeights[cat] = Number(Math.max(0, Math.min(2.5, val)).toFixed(2));
        }
      }
    }

    const nextConfig: RankingConfig = {
      id: 'default',
      name: typeof incoming.name === 'string' && incoming.name.trim() ? incoming.name.trim().slice(0, 80) : prev.name,
      categoryWeights: nextWeights,
      modalityCorroborationBoost: Number.isFinite(Number(incoming.modalityCorroborationBoost))
        ? Math.max(0, Math.min(20, Number(incoming.modalityCorroborationBoost)))
        : prev.modalityCorroborationBoost,
      minRelevanceThreshold: Number.isFinite(Number(incoming.minRelevanceThreshold))
        ? Math.max(0, Math.min(95, Number(incoming.minRelevanceThreshold)))
        : prev.minRelevanceThreshold,
      useHumanFeedbackCalibration:
        typeof incoming.useHumanFeedbackCalibration === 'boolean'
          ? incoming.useHumanFeedbackCalibration
          : prev.useHumanFeedbackCalibration,
      feedbackCalibrationStrength: Number.isFinite(Number(incoming.feedbackCalibrationStrength))
        ? Math.max(0, Math.min(1, Number(incoming.feedbackCalibrationStrength)))
        : prev.feedbackCalibrationStrength,
      deprioritiseLowInfo:
        typeof incoming.deprioritiseLowInfo === 'boolean'
          ? incoming.deprioritiseLowInfo
          : prev.deprioritiseLowInfo,
      updatedAt: new Date().toISOString(),
    };

    const saved = store.saveRankingConfig(nextConfig);
    store.insertRevision({
      id: `rev-${crypto.randomUUID().slice(0, 8)}`,
      entityType: 'ranking_config',
      entityId: 'default',
      fieldChanged: 'ranking_weights_and_thresholds',
      previousValue: JSON.stringify({ minThreshold: prev.minRelevanceThreshold, weights: prev.categoryWeights }),
      newValue: JSON.stringify({ minThreshold: saved.minRelevanceThreshold, weights: saved.categoryWeights }),
      changedBy: 'Archive Owner',
      reason: 'Updated configurable relevance ranking profile.',
      createdAt: saved.updatedAt,
    });

    res.json({ config: saved });
  });

  // 13. Hybrid Search & Cross-Recording Retrieval (§9 — supports both POST /search and GET /search)
  const runSearchHandler = (params: {
    query: string;
    assetId?: string;
    category?: string;
    layer?: string;
    reviewStatus?: string;
    minConfidence?: number;
    dataOrigin?: string;
  }) => {
    const assets = store.listAssets();
    const rankingConfig = store.getRankingConfig();
    const decisions = store.listReviewDecisions();
    const events = rankDetectedEvents(store.listEvents(), rankingConfig, decisions);
    const layers = store.listLayerRecords();
    const transcripts = assets.flatMap((a) => store.listTranscripts(a.id));

    return executeHybridSearch({
      query: {
        query: params.query,
        assetId: params.assetId,
        category: (params.category as MomentCategory | 'all') || 'all',
        layer: (params.layer as EpistemicLayer | 'all') || 'all',
        reviewStatus: (params.reviewStatus as ReviewStatus | 'all') || 'all',
        minConfidence: params.minConfidence,
        dataOrigin: (params.dataOrigin as 'real_upload' | 'verification_fixture' | 'all') || 'all',
      },
      assets,
      events,
      layers,
      transcripts,
    });
  };

  app.get('/api/search', (req, res) => {
    const results = runSearchHandler({
      query: typeof req.query.q === 'string' ? req.query.q : typeof req.query.query === 'string' ? req.query.query : '',
      assetId: typeof req.query.assetId === 'string' && req.query.assetId ? req.query.assetId : undefined,
      category: typeof req.query.category === 'string' ? req.query.category : 'all',
      layer: typeof req.query.layer === 'string' ? req.query.layer : 'all',
      reviewStatus: typeof req.query.reviewStatus === 'string' ? req.query.reviewStatus : 'all',
      minConfidence: req.query.minConfidence !== undefined ? Number(req.query.minConfidence) : undefined,
      dataOrigin: typeof req.query.dataOrigin === 'string' ? req.query.dataOrigin : 'all',
    });
    res.json({ results, totalCount: results.length });
  });

  app.post('/api/search', (req, res) => {
    const results = runSearchHandler({
      query: typeof req.body?.query === 'string' ? req.body.query : '',
      assetId: typeof req.body?.assetId === 'string' && req.body.assetId ? req.body.assetId : undefined,
      category: req.body?.category || 'all',
      layer: req.body?.layer || 'all',
      reviewStatus: req.body?.reviewStatus || 'all',
      minConfidence: req.body?.minConfidence !== undefined ? Number(req.body.minConfidence) : undefined,
      dataOrigin: req.body?.dataOrigin || 'all',
    });
    res.json({ results, totalCount: results.length });
  });

  // 14. Governance Audit Ledger, Release Manifest & Integrity Verification (§16)
  app.get('/api/governance/audit', (_req, res) => {
    res.json({
      audits: store.listAudits(100),
      revisions: store.listRevisions(60),
      modelRuns: store.listModelRuns(),
    });
  });

  app.get('/api/governance/release-manifest', async (req, res) => {
    try {
      const [providers, ffmpegAvailable, ffprobeAvailable] = await Promise.all([
        registry.detectAllCapabilities(),
        checkBinaryAvailable('ffmpeg'),
        checkBinaryAvailable('ffprobe'),
      ]);
      const assets = store.listAssets();
      const events = store.listEvents();
      const layers = store.listLayerRecords();
      const modelRuns = store.listModelRuns();
      const audits = store.listAudits(500);
      const apiKey = process.env.GEMINI_API_KEY;
      const apiKeyConfigured = Boolean(apiKey && apiKey.trim() && apiKey !== 'MY_GEMINI_API_KEY');

      const manifest: ReleaseManifest = {
        releaseVersion: RELEASE_VERSION,
        sprintId: 'AAI-Convergence-Sprint-001',
        generatedAt: new Date().toISOString(),
        schemaVersion: store.getSchemaVersion(),
        runtime: {
          nodeVersion: process.version,
          platform: process.platform,
          arch: process.arch,
          ffmpegAvailable,
          ffprobeAvailable,
        },
        geminiContract: {
          sdk: GEMINI_INTEGRATION_CONTRACT.sdk,
          serverSideOnly: GEMINI_INTEGRATION_CONTRACT.serverSideOnly,
          userAgentHeader: GEMINI_INTEGRATION_CONTRACT.userAgentHeader,
          multimodalModel: GEMINI_INTEGRATION_CONTRACT.multimodalModel,
          transcriptionModel: GEMINI_INTEGRATION_CONTRACT.transcriptionModel,
          embeddingModel: GEMINI_INTEGRATION_CONTRACT.embeddingModel,
          forbiddenDeprecatedModels: [...GEMINI_INTEGRATION_CONTRACT.forbiddenDeprecatedModels],
          explicitConsentEnforced: GEMINI_INTEGRATION_CONTRACT.explicitConsentEnforced,
          cloudProcessingApproved: isCloudAiDeploymentApproved(),
          apiKeyConfigured,
        },
        providers,
        archiveSummary: {
          totalAssets: assets.length,
          realUploads: assets.filter((a) => a.dataOrigin === 'real_upload').length,
          verificationFixtures: assets.filter((a) => a.dataOrigin === 'verification_fixture').length,
          totalEvents: events.length,
          totalLayerRecords: layers.length,
          totalModelRuns: modelRuns.length,
          totalAuditRecords: audits.length,
          assets: assets.map((a) => ({
            id: a.id,
            originalFilename: a.originalFilename,
            dataOrigin: a.dataOrigin,
            sha256Hash: a.sha256Hash,
            durationSec: a.durationSec,
            processingStatus: a.processingStatus,
          })),
        },
      };

      if (req.query.download === '1') {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="aai_release_manifest_${RELEASE_VERSION}.json"`
        );
        res.send(JSON.stringify(manifest, null, 2));
        return;
      }

      res.json(manifest);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to generate release manifest.' });
    }
  });

  app.post('/api/assets/:assetId/verify-integrity', async (req, res) => {
    const asset = store.getAssetWithFile(req.params.assetId);
    if (!asset) {
      res.status(404).json({ error: 'Asset not found.' });
      return;
    }
    const filePath = safeResolveInside(store.paths.vaultDir, asset.storedFilename);
    if (!filePath || !fs.existsSync(filePath)) {
      res.status(404).json({ error: 'Source file not found in archive vault.' });
      return;
    }
    const recomputedHash = await computeFileSha256(filePath);
    const matches = recomputedHash === asset.sha256Hash;
    store.insertAudit({
      id: `aud-${crypto.randomUUID().slice(0, 8)}`,
      action: 'INTEGRITY_VERIFIED',
      actor: 'AAI-07 Custodian',
      entityType: 'asset',
      entityId: asset.id,
      details: matches
        ? `SHA-256 checksum verified intact (${recomputedHash.slice(0, 16)}…).`
        : `INTEGRITY MISMATCH: expected ${asset.sha256Hash}, measured ${recomputedHash}.`,
      createdAt: new Date().toISOString(),
    });
    res.json({
      assetId: asset.id,
      expectedSha256: asset.sha256Hash,
      measuredSha256: recomputedHash,
      verifiedIntact: matches,
      checkedAt: new Date().toISOString(),
    });
  });

  // 15. Evidence-Linked Exports (§19)
  app.get('/api/assets/:assetId/export', (req, res) => {
    const assetWithFile = store.getAssetWithFile(req.params.assetId);
    if (!assetWithFile) {
      res.status(404).json({ error: 'Asset not found.' });
      return;
    }
    const { storedFilename: _s, ...asset } = assetWithFile;
    const format = String(req.query.format || 'json').toLowerCase();
    const rankingConfig = store.getRankingConfig();
    const events = rankDetectedEvents(store.listEvents(asset.id), rankingConfig, store.listReviewDecisions());
    const layers = store.listLayerRecords(asset.id);
    const transcripts = store.listTranscripts(asset.id);
    const modelRuns = store.listModelRuns(asset.id);

    const safeBase = asset.originalFilename.replace(/[^a-zA-Z0-9._-]/g, '_');
    let body = '';
    let contentType = 'application/json; charset=utf-8';
    let ext = 'json';

    if (format === 'json') {
      body = exportJsonEvidencePackage({ asset, events, layers, transcripts, modelRuns });
      contentType = 'application/json; charset=utf-8';
      ext = 'json';
    } else if (format === 'csv') {
      body = exportCsvEventRegister(asset, events);
      contentType = 'text/csv; charset=utf-8';
      ext = 'csv';
    } else if (format === 'srt') {
      body = exportSubtitlesSrt(transcripts);
      contentType = 'text/plain; charset=utf-8';
      ext = 'srt';
    } else if (format === 'vtt') {
      body = exportSubtitlesVtt(transcripts);
      contentType = 'text/vtt; charset=utf-8';
      ext = 'vtt';
    } else if (format === 'md' || format === 'markdown') {
      body = exportMarkdownReport({ asset, events, layers, transcripts });
      contentType = 'text/markdown; charset=utf-8';
      ext = 'md';
    } else {
      res.status(400).json({ error: 'Unsupported export format. Use json, csv, srt, vtt, or md.' });
      return;
    }

    const exportCreatedAt = new Date().toISOString();
    store.recordExport({
      id: `exp-${crypto.randomUUID().slice(0, 8)}`,
      assetId: asset.id,
      format: ext,
      sourceSha256: asset.sha256Hash,
      eventCount: events.length,
      layerCount: layers.length,
      createdAt: exportCreatedAt,
    });
    store.insertAudit({
      id: `aud-${crypto.randomUUID().slice(0, 8)}`,
      action: 'EXPORT_GENERATED',
      actor: 'AAI-07 Custodian',
      entityType: 'asset',
      entityId: asset.id,
      details: `Exported ${ext.toUpperCase()} package for "${asset.originalFilename}" (${events.length} events, ${layers.length} layer entries).`,
      createdAt: exportCreatedAt,
    });

    if (req.query.preview === '1') {
      res.json({ filename: `${safeBase}_aai.${ext}`, format: ext, content: body });
      return;
    }

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${safeBase}_aai.${ext}"`);
    res.send(body);
  });

  // Mount Vite middleware in development, static dist in production
  const isProd = process.env.NODE_ENV === 'production';
  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  return app;
}

// Start server when run directly
const PORT = Number(process.env.PORT || 3000);
createAppServer()
  .then((app) => {
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`[AAI] Multimodal Analysis Subsystem running at http://0.0.0.0:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('[AAI] Fatal startup error:', err);
    process.exit(1);
  });
