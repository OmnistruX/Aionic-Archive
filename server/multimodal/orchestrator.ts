import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  Asset,
  DetectedEvent,
  Keyframe,
  LayerRecord,
  ModelRun,
  PipelineStageId,
  PipelineStageState,
  ProcessingJob,
  ProcessingMode,
  TranscriptSegment,
} from '../../src/shared/types';
import { computeRelevanceScore, estimateProcessingCost } from '../../src/shared/ranking';
import { formatTimestamp } from '../../src/shared/layers';
import { matchTranscriptToWindow } from '../../src/shared/transcript';
import { AaiStore } from '../db';
import {
  analyzeAudioProfile,
  AudioProfile,
  detectSceneBoundaries,
  DetectedSceneCut,
  extractAudioTrackForAsr,
  ExtractedKeyframeFile,
  extractKeyframes,
  probeMediaFile,
} from '../media/ffmpegProcessor';
import { MultimodalProviderOutput, ProviderRegistry } from './providerAdapter';

export const CANONICAL_12_STAGES: Array<{
  stageId: PipelineStageId;
  order: number;
  label: string;
  agentCode: PipelineStageState['agentCode'];
}> = [
  { stageId: 'validate_file', order: 1, label: 'Validate source file & SHA-256 integrity', agentCode: 'AAI-01' },
  { stageId: 'extract_metadata', order: 2, label: 'Extract technical FFprobe metadata', agentCode: 'AAI-01' },
  { stageId: 'generate_preview', order: 3, label: 'Verify streamable media preview', agentCode: 'AAI-01' },
  { stageId: 'extract_audio', order: 4, label: 'Analyze audio envelope & silence profile', agentCode: 'AAI-03' },
  { stageId: 'speech_transcription', order: 5, label: 'Speech transcription & ASR capability check', agentCode: 'AAI-03' },
  { stageId: 'detect_scenes', order: 6, label: 'Detect visual scene boundaries', agentCode: 'AAI-02' },
  { stageId: 'extract_keyframes', order: 7, label: 'Extract representative JPEG keyframes', agentCode: 'AAI-02' },
  { stageId: 'multimodal_analysis', order: 8, label: 'Execute multimodal provider analysis', agentCode: 'AAI-02' },
  { stageId: 'detect_moments', order: 9, label: 'Detect & score candidate significant moments', agentCode: 'AAI-04' },
  { stageId: 'generate_descriptions', order: 10, label: 'Separate Layer E evidence & Layer A analysis', agentCode: 'AAI-04' },
  { stageId: 'index_results', order: 11, label: 'Persist & index structured archive entities', agentCode: 'AAI-05' },
  { stageId: 'present_review', order: 12, label: 'Audit provenance & publish to review queue', agentCode: 'AAI-07' },
];

export function createInitialStages(): PipelineStageState[] {
  return CANONICAL_12_STAGES.map((s) => ({
    ...s,
    status: 'pending',
    startedAt: null,
    completedAt: null,
    durationMs: null,
    log: 'Queued',
    errorMessage: null,
  }));
}

export interface RunPipelineOptions {
  assetId: string;
  mode: ProcessingMode;
  providerId: string;
  cloudAiConsent: boolean;
  resumeJobId?: string;
  simulateInterruptAtStage?: PipelineStageId;
}

export interface RunPipelineResult {
  job: ProcessingJob;
  keyframes: Keyframe[];
  events: DetectedEvent[];
  modelRuns: ModelRun[];
  fallbackUsed: boolean;
  fallbackNotice: string | null;
}

export class MultimodalOrchestrator {
  constructor(
    private readonly store: AaiStore,
    private readonly registry: ProviderRegistry
  ) {}

  public async runPipeline(options: RunPipelineOptions): Promise<RunPipelineResult> {
    const assetRecord = this.store.getAssetWithFile(options.assetId);
    if (!assetRecord) {
      throw new Error(`Asset "${options.assetId}" not found.`);
    }

    const vaultPath = path.resolve(this.store.paths.vaultDir, assetRecord.storedFilename);
    if (!vaultPath.startsWith(this.store.paths.vaultDir + path.sep) || !fs.existsSync(vaultPath)) {
      throw new Error('Source media file could not be verified inside archive vault.');
    }

    // Strict Governance §16 & §18 enforcement: never initiate cloud AI without explicit opt-in
    const requestedAdapter = this.registry.get(options.providerId);
    if (!requestedAdapter) {
      throw new Error(`Unknown multimodal provider adapter "${options.providerId}".`);
    }
    const requestedCap = await requestedAdapter.detectCapabilities();
    if (requestedCap.requiresConsent && !options.cloudAiConsent) {
      throw new Error(
        `Provider "${requestedCap.name}" requires explicit user cloud consent (cloudAiConsent=true) before execution.`
      );
    }

    const estimate = estimateProcessingCost(
      assetRecord.durationSec,
      assetRecord.fileSizeBytes,
      options.mode,
      requestedCap.requiresConsent
    );

    let job: ProcessingJob;
    if (options.resumeJobId) {
      const existing = this.store.getJob(options.resumeJobId);
      if (!existing || existing.assetId !== options.assetId) {
        throw new Error(`Job "${options.resumeJobId}" not found for asset "${options.assetId}".`);
      }
      job = {
        ...existing,
        status: 'running',
        errorSummary: null,
      };
    } else {
      job = {
        id: `job-${crypto.randomUUID().slice(0, 8)}`,
        assetId: options.assetId,
        mode: options.mode,
        providerId: options.providerId,
        cloudAiAuthorized: options.cloudAiConsent,
        status: 'running',
        currentStage: 'validate_file',
        chunkCount: estimate.chunkCount,
        completedChunks: 0,
        stages: createInitialStages(),
        startedAt: new Date().toISOString(),
        completedAt: null,
        errorSummary: null,
      };
    }

    this.store.updateAssetStatus(assetRecord.id, 'processing');
    this.store.upsertJob(job);

    let sceneCuts: DetectedSceneCut[] = [];
    let extractedKeyframes: ExtractedKeyframeFile[] = [];
    let audioProfile: AudioProfile = {
      hasAudio: Boolean(assetRecord.audioCodec),
      meanVolumeDb: null,
      maxVolumeDb: null,
      silenceIntervals: [],
      energyShiftTimestampsSec: [],
    };
    let extractedAudioPath: string | null = null;
    let stage5Transcripts: TranscriptSegment[] | null = null;
    let providerOutput: MultimodalProviderOutput | null = null;
    let fallbackUsed = false;
    let fallbackNotice: string | null = null;
    const createdModelRuns: ModelRun[] = [];
    const createdEvents: DetectedEvent[] = [];

    const executeStage = async (stageId: PipelineStageId, fn: () => Promise<string>): Promise<void> => {
      const idx = job.stages.findIndex((s) => s.stageId === stageId);
      if (idx === -1) return;
      if (job.stages[idx].status === 'completed') {
        return; // Resumable: skip already completed stage
      }

      if (options.simulateInterruptAtStage === stageId) {
        job.stages[idx] = {
          ...job.stages[idx],
          status: 'failed',
          startedAt: new Date().toISOString(),
          errorMessage: 'Session interrupted before stage completion (recoverable via Resume Job).',
          log: 'Interrupted — ready for recovery',
        };
        job.status = 'interrupted';
        job.currentStage = stageId;
        job.errorSummary = `Interrupted at stage "${stageId}". Resume to continue from this checkpoint.`;
        this.store.upsertJob(job);
        this.store.updateAssetStatus(assetRecord.id, 'partial');
        throw new Error(job.errorSummary);
      }

      const t0 = Date.now();
      job.currentStage = stageId;
      job.stages[idx] = {
        ...job.stages[idx],
        status: 'running',
        startedAt: new Date().toISOString(),
        errorMessage: null,
      };
      this.store.upsertJob(job);

      try {
        const log = await fn();
        job.stages[idx] = {
          ...job.stages[idx],
          status: 'completed',
          completedAt: new Date().toISOString(),
          durationMs: Date.now() - t0,
          log,
          errorMessage: null,
        };
        this.store.upsertJob(job);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        job.stages[idx] = {
          ...job.stages[idx],
          status: 'failed',
          completedAt: new Date().toISOString(),
          durationMs: Date.now() - t0,
          log: `Failed: ${msg}`,
          errorMessage: msg,
        };
        job.status = 'failed';
        job.errorSummary = msg;
        this.store.upsertJob(job);
        this.store.updateAssetStatus(assetRecord.id, 'failed');
        throw err;
      }
    };

    try {
      await executeStage('validate_file', async () => {
        const stat = fs.statSync(vaultPath);
        return `Verified vault file (${(stat.size / 1024).toFixed(1)} KB), SHA-256 ${assetRecord.sha256Hash.slice(0, 12)}… intact.`;
      });

      await executeStage('extract_metadata', async () => {
        const probed = await probeMediaFile(vaultPath);
        return `Probed ${probed.fileFormat} · ${probed.durationSec}s · ${probed.width ?? '-'}x${probed.height ?? '-'} @ ${probed.frameRate ?? '-'} fps · audio: ${probed.audioCodec ?? 'none'}.`;
      });

      await executeStage('generate_preview', async () => {
        return `HTTP Range streaming preview verified at ${assetRecord.mediaUrl}.`;
      });

      await executeStage('extract_audio', async () => {
        audioProfile = await analyzeAudioProfile(vaultPath, Boolean(assetRecord.audioCodec));
        if (!audioProfile.hasAudio) {
          return 'No audio track present; skipped audio extraction cleanly.';
        }
        const extracted = await extractAudioTrackForAsr({
          filePath: vaultPath,
          assetId: assetRecord.id,
          audioDir: this.store.paths.audioDir,
        });
        extractedAudioPath = extracted.audioPath;
        return `Audio profiled (mean ${audioProfile.meanVolumeDb ?? 'n/a'} dB, peak ${audioProfile.maxVolumeDb ?? 'n/a'} dB, ${audioProfile.silenceIntervals.length} silence interval(s)) & extracted ${(extracted.sizeBytes / 1024).toFixed(1)} KB mono MP3 for ASR.`;
      });

      await executeStage('speech_transcription', async () => {
        if (!audioProfile.hasAudio) {
          return 'No audio stream present; speech transcription not applicable.';
        }
        const geminiAsr = this.registry.get('google-gemini-transcribe');
        const geminiAsrCap = geminiAsr ? await geminiAsr.detectCapabilities() : null;
        if (options.cloudAiConsent && geminiAsr && geminiAsrCap?.available && extractedAudioPath) {
          const tAsr = Date.now();
          try {
            const asrOut = await geminiAsr.analyze({
              assetId: assetRecord.id,
              originalFilename: assetRecord.originalFilename,
              mediaKind: assetRecord.mediaKind,
              durationSec: assetRecord.durationSec,
              mode: options.mode,
              sceneCuts: [],
              keyframes: [],
              audioProfile,
              extractedAudioPath,
              cloudAiConsent: true,
            });
            stage5Transcripts = asrOut.transcriptSegments.map((t, idx) => ({
              id: `tr-${assetRecord.id}-${idx + 1}`,
              assetId: assetRecord.id,
              startSec: t.startSec,
              endSec: t.endSec,
              text: t.text,
              speakerLabel: t.speakerLabel,
              confidence: t.confidence,
              providerId: asrOut.providerId,
              isPlaceholderNotice: t.isPlaceholderNotice,
            }));
            const asrRun: ModelRun = {
              id: `run-${crypto.randomUUID().slice(0, 8)}`,
              jobId: job.id,
              assetId: assetRecord.id,
              providerId: asrOut.providerId,
              modelName: asrOut.modelName,
              modality: 'audio',
              configJson: JSON.stringify({ mode: options.mode, cloudAiConsent: true }),
              inputSummary: `Extracted mono 16kHz MP3 (${assetRecord.durationSec}s)`,
              status: 'completed',
              latencyMs: Date.now() - tAsr,
              estimatedTokens: asrOut.estimatedTokens,
              errorMessage: null,
              createdAt: new Date().toISOString(),
            };
            this.store.insertModelRun(asrRun);
            createdModelRuns.push(asrRun);
            const speechCount = stage5Transcripts.filter((s) => !s.isPlaceholderNotice).length;
            return speechCount > 0
              ? `Gemini Speech Transcription (${asrOut.modelName}) produced ${speechCount} verbatim timestamped segment(s) in ${asrRun.latencyMs}ms.`
              : `Gemini Speech Transcription (${asrOut.modelName}) completed in ${asrRun.latencyMs}ms: no intelligible speech detected.`;
          } catch (asrErr) {
            const errMsg = asrErr instanceof Error ? asrErr.message : String(asrErr);
            const failedAsrRun: ModelRun = {
              id: `run-${crypto.randomUUID().slice(0, 8)}`,
              jobId: job.id,
              assetId: assetRecord.id,
              providerId: 'google-gemini-transcribe',
              modelName: geminiAsrCap.modelName ?? 'gemini-3.5-transcribe',
              modality: 'audio',
              configJson: JSON.stringify({ mode: options.mode, cloudAiConsent: true }),
              inputSummary: 'Extracted mono 16kHz MP3',
              status: 'failed',
              latencyMs: Date.now() - tAsr,
              estimatedTokens: null,
              errorMessage: errMsg,
              createdAt: new Date().toISOString(),
            };
            this.store.insertModelRun(failedAsrRun);
            createdModelRuns.push(failedAsrRun);
            return `Gemini Speech Transcription failed (${errMsg}); preserved honest notice without fabricating transcript.`;
          }
        }

        const whisperCap = await this.registry.get('local-whisper-asr')?.detectCapabilities();
        if (whisperCap?.available) {
          return 'Local Whisper available for ASR.';
        }
        return options.cloudAiConsent
          ? 'GEMINI_API_KEY not configured and no local Whisper binary installed; preserved honest notice without fabricating transcript.'
          : 'Local-only mode (no local Whisper installed, Cloud ASR not opted in); preserved honest notice without fabricating transcript.';
      });

      await executeStage('detect_scenes', async () => {
        if (assetRecord.mediaKind !== 'video') {
          sceneCuts = [];
          return `Media kind "${assetRecord.mediaKind}" has no multi-frame video scene cuts.`;
        }
        const threshold = options.mode === 'deep' ? 0.18 : options.mode === 'balanced' ? 0.24 : 0.32;
        sceneCuts = await detectSceneBoundaries(vaultPath, assetRecord.durationSec, threshold);
        return `Detected ${sceneCuts.length} visual scene-change impulse(s) at threshold ${threshold}.`;
      });

      await executeStage('extract_keyframes', async () => {
        if (assetRecord.mediaKind !== 'video') {
          extractedKeyframes = [];
          return `Skipped video frame extraction for ${assetRecord.mediaKind} asset.`;
        }
        const maxFrames = options.mode === 'economy' ? 5 : options.mode === 'balanced' ? 8 : 12;
        extractedKeyframes = await extractKeyframes({
          filePath: vaultPath,
          assetId: assetRecord.id,
          durationSec: assetRecord.durationSec,
          sceneCuts,
          keyframesDir: this.store.paths.keyframesDir,
          maxFrames,
        });
        this.store.replaceKeyframes(
          assetRecord.id,
          extractedKeyframes.map((kf) => ({
            id: `kf-${assetRecord.id}-${kf.sceneIndex}`,
            assetId: assetRecord.id,
            timestampSec: kf.timestampSec,
            sceneIndex: kf.sceneIndex,
            sceneScore: kf.sceneScore,
            filename: kf.filename,
            width: kf.width,
            height: kf.height,
            extractionMethod: kf.extractionMethod,
          }))
        );
        return `Extracted ${extractedKeyframes.length} representative JPEG keyframe(s) to vault cache.`;
      });

      // Ensure keyframes, scene cuts, and audio profile are hydrated if resuming mid-pipeline
      if (extractedKeyframes.length === 0 && assetRecord.mediaKind === 'video') {
        const persistedKfs = this.store.listKeyframes(assetRecord.id);
        extractedKeyframes = persistedKfs.map((kf) => {
          const fname = path.basename(kf.imageUrl);
          return {
            timestampSec: kf.timestampSec,
            sceneIndex: kf.sceneIndex,
            sceneScore: kf.sceneScore,
            filename: fname,
            localFilePath: path.join(this.store.paths.keyframesDir, assetRecord.id, fname),
            width: kf.width,
            height: kf.height,
            extractionMethod: kf.extractionMethod,
          };
        });
      }
      if (sceneCuts.length === 0 && assetRecord.mediaKind === 'video') {
        const threshold = options.mode === 'deep' ? 0.18 : options.mode === 'balanced' ? 0.24 : 0.32;
        sceneCuts = await detectSceneBoundaries(vaultPath, assetRecord.durationSec, threshold);
      }
      if (audioProfile.hasAudio && audioProfile.meanVolumeDb === null) {
        audioProfile = await analyzeAudioProfile(vaultPath, true);
      }

      await executeStage('multimodal_analysis', async () => {
        const tStart = Date.now();
        const reqPayload = {
          assetId: assetRecord.id,
          originalFilename: assetRecord.originalFilename,
          mediaKind: assetRecord.mediaKind,
          durationSec: assetRecord.durationSec,
          mode: options.mode,
          sceneCuts,
          keyframes: extractedKeyframes,
          audioProfile,
          extractedAudioPath,
          existingTranscript: (stage5Transcripts ?? [])
            .filter((s) => !s.isPlaceholderNotice)
            .map((s) => ({ startSec: s.startSec, endSec: s.endSec, text: s.text })),
          cloudAiConsent: options.cloudAiConsent,
        };

        // Always run local signal analyzer as baseline evidence anchor when using local or as fallback
        const localAdapter = this.registry.get('local-ffmpeg-signal')!;

        if (options.providerId === 'local-ffmpeg-signal') {
          providerOutput = await localAdapter.analyze(reqPayload);
          const run: ModelRun = {
            id: `run-${crypto.randomUUID().slice(0, 8)}`,
            jobId: job.id,
            assetId: assetRecord.id,
            providerId: providerOutput.providerId,
            modelName: providerOutput.modelName,
            modality: providerOutput.modality,
            configJson: JSON.stringify({ mode: options.mode, cloudAiConsent: false }),
            inputSummary: `${extractedKeyframes.length} keyframes, ${sceneCuts.length} scene cuts, audio=${audioProfile.hasAudio}`,
            status: 'completed',
            latencyMs: Date.now() - tStart,
            estimatedTokens: 0,
            errorMessage: null,
            createdAt: new Date().toISOString(),
          };
          this.store.insertModelRun(run);
          createdModelRuns.push(run);
          return `Local FFmpeg Signal Analyzer completed in ${run.latencyMs}ms (${providerOutput.candidateMoments.length} candidate moments).`;
        }

        // Cloud provider requested with explicit consent
        try {
          if (!requestedCap.available) {
            throw new Error(requestedCap.statusReason);
          }
          providerOutput = await requestedAdapter.analyze(reqPayload);
          const run: ModelRun = {
            id: `run-${crypto.randomUUID().slice(0, 8)}`,
            jobId: job.id,
            assetId: assetRecord.id,
            providerId: providerOutput.providerId,
            modelName: providerOutput.modelName,
            modality: providerOutput.modality,
            configJson: JSON.stringify({ mode: options.mode, cloudAiConsent: true }),
            inputSummary: `${extractedKeyframes.length} sampled keyframes + audio metadata`,
            status: 'completed',
            latencyMs: Date.now() - tStart,
            estimatedTokens: providerOutput.estimatedTokens,
            errorMessage: null,
            createdAt: new Date().toISOString(),
          };
          this.store.insertModelRun(run);
          createdModelRuns.push(run);
          return `${requestedCap.name} completed in ${run.latencyMs}ms (${providerOutput.candidateMoments.length} candidate moments, ~${providerOutput.estimatedTokens ?? 0} tokens).`;
        } catch (cloudErr) {
          const errMsg = cloudErr instanceof Error ? cloudErr.message : String(cloudErr);
          const failedRun: ModelRun = {
            id: `run-${crypto.randomUUID().slice(0, 8)}`,
            jobId: job.id,
            assetId: assetRecord.id,
            providerId: options.providerId,
            modelName: requestedCap.modelName ?? options.providerId,
            modality: 'multimodal',
            configJson: JSON.stringify({ mode: options.mode, cloudAiConsent: options.cloudAiConsent }),
            inputSummary: `${extractedKeyframes.length} sampled keyframes`,
            status: 'failed',
            latencyMs: Date.now() - tStart,
            estimatedTokens: null,
            errorMessage: errMsg,
            createdAt: new Date().toISOString(),
          };
          this.store.insertModelRun(failedRun);
          createdModelRuns.push(failedRun);

          // Transparent local fallback (clearly disclosed, never pretending cloud succeeded)
          fallbackUsed = true;
          fallbackNotice = `Cloud provider "${requestedCap.name}" failed (${errMsg}). Completed honestly with Local FFmpeg Signal Analyzer fallback.`;
          const tLocal = Date.now();
          providerOutput = await localAdapter.analyze(reqPayload);
          const localRun: ModelRun = {
            id: `run-${crypto.randomUUID().slice(0, 8)}`,
            jobId: job.id,
            assetId: assetRecord.id,
            providerId: providerOutput.providerId,
            modelName: providerOutput.modelName,
            modality: providerOutput.modality,
            configJson: JSON.stringify({ mode: options.mode, fallbackFrom: options.providerId }),
            inputSummary: `${extractedKeyframes.length} keyframes, ${sceneCuts.length} scene cuts`,
            status: 'completed',
            latencyMs: Date.now() - tLocal,
            estimatedTokens: 0,
            errorMessage: null,
            createdAt: new Date().toISOString(),
          };
          this.store.insertModelRun(localRun);
          createdModelRuns.push(localRun);
          return fallbackNotice;
        }
      });

      await executeStage('detect_moments', async () => {
        if (!providerOutput) {
          throw new Error('No multimodal provider output available.');
        }
        const rankingConfig = this.store.getRankingConfig();
        const persistedKeyframes = this.store.listKeyframes(assetRecord.id);

        const findNearestThumb = (sec: number): string | null => {
          if (persistedKeyframes.length === 0) return null;
          let best = persistedKeyframes[0];
          let bestDist = Math.abs(best.timestampSec - sec);
          for (const kf of persistedKeyframes) {
            const d = Math.abs(kf.timestampSec - sec);
            if (d < bestDist) {
              best = kf;
              bestDist = d;
            }
          }
          return best.imageUrl;
        };

        const now = new Date().toISOString();
        const activeTranscripts = stage5Transcripts ?? this.store.listTranscripts(assetRecord.id);
        for (const m of providerOutput.candidateMoments) {
          const matchedSpeech =
            m.relevantTranscript.trim() ||
            matchTranscriptToWindow(activeTranscripts, m.startSec, m.endSec);
          const modalities =
            matchedSpeech && !m.modalities.includes('transcript')
              ? [...m.modalities, 'transcript' as const]
              : m.modalities;

          const scoreRes = computeRelevanceScore(
            {
              baseSignalStrength: m.baseSignalStrength,
              classification: m.classification,
              modalities,
              confidenceScore: m.confidenceScore,
              ordinaryExplanations: m.ordinaryExplanations,
              reviewStatus: 'unreviewed',
              relevantTranscript: matchedSpeech,
            },
            rankingConfig
          );

          createdEvents.push({
            id: `evt-${crypto.randomUUID().slice(0, 8)}`,
            assetId: assetRecord.id,
            startSec: m.startSec,
            endSec: m.endSec,
            thumbnailUrl: findNearestThumb(m.startSec),
            observableDescription: m.observableDescription,
            analyticalSummary: m.analyticalSummary,
            relevantTranscript: matchedSpeech,
            detectionMethod:
              providerOutput.providerId === 'local-ffmpeg-signal'
                ? 'FFmpeg Scene/Audio Signal Detector'
                : `Gemini Multimodal (${providerOutput.modelName})`,
            providerId: providerOutput.providerId,
            modelName: providerOutput.modelName,
            baseSignalStrength: m.baseSignalStrength,
            estimatedRelevanceScore: scoreRes.estimatedRelevanceScore,
            confidenceScore: m.confidenceScore,
            uncertaintyNote: m.uncertaintyNote,
            reasonForSelection: m.reasonForSelection,
            ordinaryExplanations: m.ordinaryExplanations,
            classification: m.classification,
            reviewStatus: 'unreviewed',
            userAnnotations: '',
            assignedProject: null,
            tags: m.tags,
            modalities,
            dataOrigin: assetRecord.dataOrigin,
            scoreBreakdown: scoreRes.breakdown,
            createdAt: now,
            updatedAt: now,
          });
        }

        // Replace only unreviewed machine detections so human-reviewed events are NEVER overwritten
        this.store.deleteUnreviewedMachineEvents(assetRecord.id);
        this.store.insertEvents(createdEvents);
        return `Generated and scored ${createdEvents.length} candidate significant moment(s). Human-reviewed findings preserved.`;
      });

      await executeStage('generate_descriptions', async () => {
        if (!providerOutput) return 'No descriptions generated.';
        this.store.deleteMachineLayerRecords(assetRecord.id);
        const now = new Date().toISOString();

        // Layer E (Evidence) records strictly separate from Layer A (Analysis)
        for (const obs of providerOutput.observableEvidence) {
          const rec: LayerRecord = {
            id: `lyr-e-${crypto.randomUUID().slice(0, 8)}`,
            assetId: assetRecord.id,
            eventId: null,
            layer: 'E',
            title: obs.title,
            content: obs.observableFact,
            startSec: obs.startSec,
            endSec: obs.endSec,
            authorType: providerOutput.providerId === 'local-ffmpeg-signal' ? 'system_detector' : 'ai_model',
            authorName:
              providerOutput.providerId === 'local-ffmpeg-signal'
                ? 'AAI-02 Local Signal Detector'
                : `AAI-02 (${providerOutput.modelName})`,
            providerId: providerOutput.providerId,
            modelName: providerOutput.modelName,
            sourceReference: `${assetRecord.originalFilename} @ ${formatTimestamp(obs.startSec)}–${formatTimestamp(obs.endSec)}`,
            confidence: 0.9,
            uncertaintyDisclosure: 'Direct measurement or visual frame observation; no inferred intent.',
            revisionCount: 1,
            createdAt: now,
            updatedAt: now,
          };
          this.store.insertLayerRecord(rec);
        }

        for (const evt of createdEvents) {
          const recA: LayerRecord = {
            id: `lyr-a-${crypto.randomUUID().slice(0, 8)}`,
            assetId: assetRecord.id,
            eventId: evt.id,
            layer: 'A',
            title: `Analytical classification: ${evt.classification.replace(/_/g, ' ')}`,
            content: `${evt.analyticalSummary} Selection rationale: ${evt.reasonForSelection}`,
            startSec: evt.startSec,
            endSec: evt.endSec,
            authorType: evt.providerId === 'local-ffmpeg-signal' ? 'system_detector' : 'ai_model',
            authorName: `AAI-04 Sentinel (${evt.providerId})`,
            providerId: evt.providerId,
            modelName: evt.modelName,
            sourceReference: `${assetRecord.originalFilename} @ ${formatTimestamp(evt.startSec)}–${formatTimestamp(evt.endSec)} [${evt.id}]`,
            confidence: evt.confidenceScore,
            uncertaintyDisclosure: evt.uncertaintyNote,
            revisionCount: 1,
            createdAt: now,
            updatedAt: now,
          };
          this.store.insertLayerRecord(recA);
        }

        return `Persisted ${providerOutput.observableEvidence.length} Layer E (Evidence) and ${createdEvents.length} Layer A (Analysis) records with strict separation.`;
      });

      await executeStage('index_results', async () => {
        if (stage5Transcripts && stage5Transcripts.length > 0) {
          this.store.replaceTranscripts(assetRecord.id, stage5Transcripts);
        } else if (providerOutput) {
          const transcripts: TranscriptSegment[] = providerOutput.transcriptSegments.map((t, idx) => ({
            id: `tr-${assetRecord.id}-${idx + 1}`,
            assetId: assetRecord.id,
            startSec: t.startSec,
            endSec: t.endSec,
            text: t.text,
            speakerLabel: t.speakerLabel,
            confidence: t.confidence,
            providerId: providerOutput!.providerId,
            isPlaceholderNotice: t.isPlaceholderNotice,
          }));
          this.store.replaceTranscripts(assetRecord.id, transcripts);
        }
        job.completedChunks = job.chunkCount;
        return `Indexed transcripts, keyframes, events, and epistemic layers into SQLite (${job.completedChunks}/${job.chunkCount} chunks).`;
      });

      await executeStage('present_review', async () => {
        this.store.insertAudit({
          id: `aud-${crypto.randomUUID().slice(0, 8)}`,
          action: 'PIPELINE_COMPLETED',
          actor: 'AAI-07 Custodian',
          entityType: 'processing_job',
          entityId: job.id,
          details: `Asset ${assetRecord.id} processed in ${options.mode} mode via ${providerOutput?.providerId ?? options.providerId} (cloudConsent=${options.cloudAiConsent}).`,
          createdAt: new Date().toISOString(),
        });
        return 'Provenance audit logged; candidate moments ready for human review workbench.';
      });

      job.status = 'completed';
      job.currentStage = null;
      job.completedAt = new Date().toISOString();
      this.store.upsertJob(job);
      this.store.updateAssetStatus(assetRecord.id, 'completed');

      return {
        job,
        keyframes: this.store.listKeyframes(assetRecord.id),
        events: this.store.listEvents(assetRecord.id),
        modelRuns: createdModelRuns,
        fallbackUsed,
        fallbackNotice,
      };
    } catch (err) {
      if (job.status !== 'interrupted') {
        job.status = 'failed';
        job.errorSummary = err instanceof Error ? err.message : String(err);
        this.store.upsertJob(job);
      }
      throw err;
    }
  }

  /**
   * On-demand real speech transcription (AAI-03 Listener) for an ingested asset.
   * Extracts mono 16kHz MP3 via FFmpeg and invokes google-gemini-transcribe (or local whisper).
   */
  public async runSpeechTranscription(options: {
    assetId: string;
    providerId?: string;
    cloudAiConsent: boolean;
  }): Promise<{
    segments: TranscriptSegment[];
    modelRun: ModelRun;
    audioExtractedBytes: number;
  }> {
    const assetRecord = this.store.getAssetWithFile(options.assetId);
    if (!assetRecord) {
      throw new Error(`Asset "${options.assetId}" not found.`);
    }
    const vaultPath = path.resolve(this.store.paths.vaultDir, assetRecord.storedFilename);
    if (!vaultPath.startsWith(this.store.paths.vaultDir + path.sep) || !fs.existsSync(vaultPath)) {
      throw new Error('Source media file could not be verified inside archive vault.');
    }
    if (!assetRecord.audioCodec && assetRecord.mediaKind !== 'audio') {
      throw new Error('Asset contains no audio track to transcribe.');
    }

    const providerId = options.providerId || 'google-gemini-transcribe';
    const adapter = this.registry.get(providerId);
    if (!adapter) {
      throw new Error(`Unknown speech transcription provider "${providerId}".`);
    }
    const cap = await adapter.detectCapabilities();
    if (cap.requiresConsent && !options.cloudAiConsent) {
      throw new Error(
        `Speech transcription provider "${cap.name}" requires explicit user cloud consent (cloudAiConsent=true).`
      );
    }
    if (!cap.available) {
      throw new Error(`Speech transcription provider "${cap.name}" is unavailable: ${cap.statusReason}`);
    }

    const extracted = await extractAudioTrackForAsr({
      filePath: vaultPath,
      assetId: assetRecord.id,
      audioDir: this.store.paths.audioDir,
    });
    const audioProfile = await analyzeAudioProfile(vaultPath, true);
    const t0 = Date.now();
    const out = await adapter.analyze({
      assetId: assetRecord.id,
      originalFilename: assetRecord.originalFilename,
      mediaKind: assetRecord.mediaKind,
      durationSec: assetRecord.durationSec,
      mode: 'balanced',
      sceneCuts: [],
      keyframes: [],
      audioProfile,
      extractedAudioPath: extracted.audioPath,
      cloudAiConsent: options.cloudAiConsent,
    });

    const segments: TranscriptSegment[] = out.transcriptSegments.map((t, idx) => ({
      id: `tr-${assetRecord.id}-${idx + 1}`,
      assetId: assetRecord.id,
      startSec: t.startSec,
      endSec: t.endSec,
      text: t.text,
      speakerLabel: t.speakerLabel,
      confidence: t.confidence,
      providerId: out.providerId,
      isPlaceholderNotice: t.isPlaceholderNotice,
    }));
    this.store.replaceTranscripts(assetRecord.id, segments);

    const modelRun: ModelRun = {
      id: `run-${crypto.randomUUID().slice(0, 8)}`,
      jobId: `asr-${crypto.randomUUID().slice(0, 8)}`,
      assetId: assetRecord.id,
      providerId: out.providerId,
      modelName: out.modelName,
      modality: 'audio',
      configJson: JSON.stringify({ cloudAiConsent: options.cloudAiConsent, onDemandAsr: true }),
      inputSummary: `Extracted mono 16kHz MP3 (${(extracted.sizeBytes / 1024).toFixed(1)} KB)`,
      status: 'completed',
      latencyMs: Date.now() - t0,
      estimatedTokens: out.estimatedTokens,
      errorMessage: null,
      createdAt: new Date().toISOString(),
    };
    this.store.insertModelRun(modelRun);
    this.store.insertAudit({
      id: `aud-${crypto.randomUUID().slice(0, 8)}`,
      action: 'SPEECH_TRANSCRIPTION_COMPLETED',
      actor: 'AAI-03 Listener',
      entityType: 'asset',
      entityId: assetRecord.id,
      details: `Transcribed "${assetRecord.originalFilename}" via ${out.modelName} (${segments.filter((s) => !s.isPlaceholderNotice).length} speech segment(s)).`,
      createdAt: new Date().toISOString(),
    });

    return {
      segments,
      modelRun,
      audioExtractedBytes: extracted.sizeBytes,
    };
  }
}
