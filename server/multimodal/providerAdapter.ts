import fs from 'node:fs';
import { GoogleGenAI, Type } from '@google/genai';
import {
  ALL_MOMENT_CATEGORIES,
  MomentCategory,
  ProcessingMode,
  ProviderCapability,
} from '../../src/shared/types';
import { buildOrdinaryExplanations } from '../../src/shared/layers';
import { GEMINI_INTEGRATION_CONTRACT } from '../../src/shared/apiContract';
import { parseTranscriptionOutput } from '../../src/shared/transcript';
import { AudioProfile, checkBinaryAvailable, DetectedSceneCut, ExtractedKeyframeFile } from '../media/ffmpegProcessor';

/**
 * Hard deployment-level approval gate per Sprint AAI-MVP-01 governance:
 * Cloud processing and paid API calls remain disabled by default pending explicit approval
 * (requires AAI_ALLOW_CLOUD_AI=true in server environment AND per-run cloudAiConsent=true).
 */
export function isCloudAiDeploymentApproved(): boolean {
  return String(process.env.AAI_ALLOW_CLOUD_AI || '').toLowerCase() === 'true';
}

export interface MultimodalAnalysisRequest {
  assetId: string;
  originalFilename: string;
  mediaKind: 'video' | 'audio' | 'image';
  durationSec: number;
  mode: ProcessingMode;
  sceneCuts: DetectedSceneCut[];
  keyframes: ExtractedKeyframeFile[];
  audioProfile: AudioProfile;
  extractedAudioPath?: string | null;
  existingTranscript?: Array<{ startSec: number; endSec: number; text: string }>;
  cloudAiConsent: boolean;
}

export interface ProviderObservation {
  startSec: number;
  endSec: number;
  title: string;
  observableFact: string;
}

export interface ProviderCandidateMoment {
  startSec: number;
  endSec: number;
  classification: MomentCategory;
  observableDescription: string;
  analyticalSummary: string;
  reasonForSelection: string;
  baseSignalStrength: number;
  confidenceScore: number | null;
  uncertaintyNote: string;
  ordinaryExplanations: string[];
  modalities: Array<'visual' | 'audio' | 'transcript' | 'metadata'>;
  relevantTranscript: string;
  tags: string[];
}

export interface ProviderTranscriptDraft {
  startSec: number;
  endSec: number;
  text: string;
  speakerLabel: string | null;
  confidence: number | null;
  isPlaceholderNotice: boolean;
}

export interface MultimodalProviderOutput {
  providerId: string;
  modelName: string;
  modality: 'visual' | 'audio' | 'multimodal' | 'signal_analysis';
  observableEvidence: ProviderObservation[];
  candidateMoments: ProviderCandidateMoment[];
  transcriptSegments: ProviderTranscriptDraft[];
  estimatedTokens: number | null;
}

export interface IMultimodalProviderAdapter {
  readonly id: string;
  readonly name: string;
  detectCapabilities(): Promise<ProviderCapability>;
  analyze(request: MultimodalAnalysisRequest): Promise<MultimodalProviderOutput>;
}

/**
 * 1. Local Signal & FFmpeg Visual/Audio Analysis Adapter (always local-first, $0 cloud cost).
 * Produces genuine observable facts (Layer E) from real FFmpeg scene cuts, keyframe pacing,
 * and acoustic volume/silence boundaries without fabricating dialogue or unseen content.
 */
export class LocalSignalAdapter implements IMultimodalProviderAdapter {
  public readonly id = 'local-ffmpeg-signal';
  public readonly name = 'Local FFmpeg Signal & Scene Analyzer';

  public async detectCapabilities(): Promise<ProviderCapability> {
    const hasFfmpeg = await checkBinaryAvailable('ffmpeg');
    const hasFfprobe = await checkBinaryAvailable('ffprobe');
    const available = hasFfmpeg && hasFfprobe;
    return {
      id: this.id,
      name: this.name,
      kind: 'local_signal',
      available,
      requiresConsent: false,
      isPaidOrMetered: false,
      modelName: 'ffmpeg-scdet-volumedetect-v1',
      supportedModalities: ['video_frames', 'audio_signal'],
      statusReason: available
        ? 'FFmpeg and FFprobe binaries detected locally. Ready for zero-cost local video/audio analysis.'
        : 'FFmpeg or FFprobe binary not found in PATH.',
      limitations: [
        'Measures genuine pixel scene deltas, frame pacing, and acoustic volume/silence shifts.',
        'Does not perform semantic object recognition or speech-to-text transcription without a vision/ASR model.',
      ],
      environmentVarRequired: null,
    };
  }

  public async analyze(request: MultimodalAnalysisRequest): Promise<MultimodalProviderOutput> {
    const observableEvidence: ProviderObservation[] = [];
    const candidateMoments: ProviderCandidateMoment[] = [];
    const duration = Math.max(1, request.durationSec);

    // 1. Scene boundary analysis
    if (request.sceneCuts.length > 0) {
      // Detect rapid consecutive cuts (flicker / technical irregularity) vs normal scene transitions
      const clusters: Array<{ startSec: number; endSec: number; cuts: DetectedSceneCut[] }> = [];
      for (const cut of request.sceneCuts) {
        const last = clusters[clusters.length - 1];
        if (last && cut.timestampSec - last.endSec <= 2.4) {
          last.endSec = cut.timestampSec;
          last.cuts.push(cut);
        } else {
          clusters.push({ startSec: cut.timestampSec, endSec: cut.timestampSec, cuts: [cut] });
        }
      }

      for (let idx = 0; idx < clusters.length; idx++) {
        const cluster = clusters[idx];
        const isRapidIrregularity = cluster.cuts.length >= 2;
        const startSec = Number(Math.max(0, cluster.startSec - 0.3).toFixed(2));
        const endSec = Number(Math.min(duration, cluster.endSec + (isRapidIrregularity ? 1.5 : 2.5)).toFixed(2));

        if (isRapidIrregularity) {
          const obs = `FFmpeg scene-delta filter measured ${cluster.cuts.length} rapid pixel-luminance discontinuities between ${startSec}s and ${endSec}s (threshold >0.24).`;
          observableEvidence.push({
            startSec,
            endSec,
            title: 'Rapid luminance / frame discontinuity cluster',
            observableFact: obs,
          });
          candidateMoments.push({
            startSec,
            endSec,
            classification: 'technical_irregularity',
            observableDescription: obs,
            analyticalSummary:
              'High-frequency frame discontinuity cluster consistent with exposure flicker, rapid flash, or codec artifact.',
            reasonForSelection: `Clustered ${cluster.cuts.length} rapid scene-change impulses within ${(endSec - startSec).toFixed(1)}s.`,
            baseSignalStrength: 0.86,
            confidenceScore: 0.82,
            uncertaintyNote:
              'Local pixel-delta analysis confirms visual luminance change only; cannot determine optical or physical cause without visual inspection.',
            ordinaryExplanations: buildOrdinaryExplanations('flicker exposure luminance'),
            modalities: request.audioProfile.hasAudio ? ['visual', 'audio'] : ['visual'],
            relevantTranscript: '',
            tags: ['luminance-shift', 'rapid-cut', 'local-signal'],
          });
        } else {
          const classification: MomentCategory =
            idx === 0 ? 'location_transition' : idx === 1 ? 'environmental_change' : 'potential_documentary_material';
          const obs = `FFmpeg detected an inter-frame visual boundary at ${cluster.startSec}s (scene score ${cluster.cuts[0].sceneScore.toFixed(2)}).`;
          observableEvidence.push({
            startSec,
            endSec,
            title: `Visual scene boundary #${idx + 1}`,
            observableFact: obs,
          });
          candidateMoments.push({
            startSec,
            endSec,
            classification,
            observableDescription: obs,
            analyticalSummary:
              classification === 'location_transition'
                ? 'Distinct visual composition change indicating a new shot, camera angle, or scene boundary.'
                : classification === 'environmental_change'
                  ? 'Broad frame-wide color/luminance shift consistent with a lighting or environmental transition.'
                  : 'Sustained new visual framing candidate for editorial or documentary review.',
            reasonForSelection: `Pixel-delta scene score (${cluster.cuts[0].sceneScore.toFixed(2)}) exceeded configured boundary threshold.`,
            baseSignalStrength: 0.72,
            confidenceScore: 0.78,
            uncertaintyNote:
              'Detected purely from visual frame deltas; semantic context requires human review or opted-in multimodal vision analysis.',
            ordinaryExplanations: [],
            modalities: ['visual'],
            relevantTranscript: '',
            tags: ['scene-cut', 'visual-boundary'],
          });
        }
      }
    } else if (request.keyframes.length > 0) {
      // Single continuous shot or image
      const obs = `Media contains ${request.keyframes.length} extracted visual frames with no abrupt scene cuts above threshold across ${duration.toFixed(1)}s.`;
      observableEvidence.push({
        startSec: 0,
        endSec: duration,
        title: 'Continuous visual take',
        observableFact: obs,
      });
      candidateMoments.push({
        startSec: 0,
        endSec: Math.min(duration, 5),
        classification: 'potential_documentary_material',
        observableDescription: obs,
        analyticalSummary: 'Single continuous shot without hard cuts; flagged for opening frame inspection.',
        reasonForSelection: 'Opening visual anchor extracted for manual review.',
        baseSignalStrength: 0.55,
        confidenceScore: 0.65,
        uncertaintyNote: 'No hard scene boundaries detected; may contain subtle motion or dialogue requiring vision/ASR.',
        ordinaryExplanations: [],
        modalities: ['visual', 'metadata'],
        relevantTranscript: '',
        tags: ['continuous-shot'],
      });
    }

    // 2. Audio envelope & silence-to-sound transition analysis
    if (request.audioProfile.hasAudio) {
      const { meanVolumeDb, maxVolumeDb, silenceIntervals } = request.audioProfile;
      const audioFact = `FFmpeg audio analysis measured mean volume ${meanVolumeDb ?? 'unknown'} dB, peak ${maxVolumeDb ?? 'unknown'} dB, and ${silenceIntervals.length} silence interval(s) below -34 dB.`;
      observableEvidence.push({
        startSec: 0,
        endSec: duration,
        title: 'Acoustic loudness & silence profile',
        observableFact: audioFact,
      });

      for (const silence of silenceIntervals) {
        if (silence.endSec < duration - 0.5) {
          const onsetEnd = Number(Math.min(duration, silence.endSec + 3.0).toFixed(2));
          candidateMoments.push({
            startSec: silence.endSec,
            endSec: onsetEnd,
            classification: 'music_or_performance',
            observableDescription: `Audio signal rose above -34 dB threshold at ${silence.endSec}s following ${silence.durationSec.toFixed(1)}s of silence.`,
            analyticalSummary:
              'Acoustic re-entry after quiet pause; candidate for speech onset, musical cue, or ambient shift.',
            reasonForSelection: `Detected clear silence-to-signal boundary at ${silence.endSec}s (prior quiet gap ${silence.durationSec.toFixed(1)}s).`,
            baseSignalStrength: 0.76,
            confidenceScore: 0.74,
            uncertaintyNote:
              'Acoustic energy rise confirms sound onset only; local signal analyzer cannot distinguish speech from music without ASR.',
            ordinaryExplanations: [],
            modalities: ['audio'],
            relevantTranscript: '',
            tags: ['audio-onset', 'silence-boundary'],
          });
        } else if (silence.durationSec >= 3.0) {
          candidateMoments.push({
            startSec: silence.startSec,
            endSec: silence.endSec,
            classification: 'low_information_footage',
            observableDescription: `Audio remained below -34 dB for ${silence.durationSec.toFixed(1)}s (${silence.startSec}s–${silence.endSec}s) with no scene cuts.`,
            analyticalSummary: 'Extended quiet/static segment candidate for deprioritisation during archive triage.',
            reasonForSelection: `Sustained low acoustic energy (${silence.durationSec.toFixed(1)}s) at end of recording.`,
            baseSignalStrength: 0.42,
            confidenceScore: 0.8,
            uncertaintyNote: 'Silent footage can still carry visual significance; review before discarding.',
            ordinaryExplanations: [],
            modalities: ['audio', 'visual'],
            relevantTranscript: '',
            tags: ['quiet-segment', 'low-signal'],
          });
        }
      }
    }

    // 3. Honest transcript disclosure (never fabricate dialogue)
    const transcriptSegments: ProviderTranscriptDraft[] = [
      {
        startSec: 0,
        endSec: Math.min(duration, 2),
        text: request.audioProfile.hasAudio
          ? '[Local speech-to-text engine not installed; audio energy was profiled locally without fabricating dialogue. Enable Cloud Gemini opt-in or attach local Whisper for speech transcription.]'
          : '[Source asset contains no audio track.]',
        speakerLabel: 'System Notice',
        confidence: null,
        isPlaceholderNotice: true,
      },
    ];

    return {
      providerId: this.id,
      modelName: 'ffmpeg-scdet-volumedetect-v1',
      modality: 'signal_analysis',
      observableEvidence,
      candidateMoments,
      transcriptSegments,
      estimatedTokens: 0,
    };
  }
}

/**
 * 2. Google Gemini Multimodal Adapter (@google/genai, gemini-4-hydrogen).
 * Strictly server-side, requires explicit user cloudAiConsent=true and process.env.GEMINI_API_KEY.
 * Analyzes actual extracted JPEG keyframes + audio metrics with structured JSON schema output.
 */
export class GeminiMultimodalAdapter implements IMultimodalProviderAdapter {
  public readonly id = 'google-gemini-multimodal';
  public readonly name = `Google Gemini Multimodal (${GEMINI_INTEGRATION_CONTRACT.multimodalModel})`;
  private readonly modelName = GEMINI_INTEGRATION_CONTRACT.multimodalModel;

  public async detectCapabilities(): Promise<ProviderCapability> {
    const key = process.env.GEMINI_API_KEY;
    const configured = Boolean(key && key.trim() && key !== 'MY_GEMINI_API_KEY');
    const approved = isCloudAiDeploymentApproved();
    return {
      id: this.id,
      name: this.name,
      kind: 'cloud_multimodal',
      available: configured && approved,
      requiresConsent: true,
      isPaidOrMetered: true,
      modelName: this.modelName,
      supportedModalities: ['video_frames', 'structured_json'],
      statusReason: !approved
        ? 'Cloud processing and paid API calls are disabled pending explicit approval (set AAI_ALLOW_CLOUD_AI=true to enable).'
        : configured
          ? 'GEMINI_API_KEY configured and AAI_ALLOW_CLOUD_AI=true. Available when user explicitly authorizes cloud processing.'
          : 'GEMINI_API_KEY is not configured in server environment secrets.',
      limitations: [
        'Disabled by default pending explicit deployment approval (AAI_ALLOW_CLOUD_AI=true) and per-run user consent.',
        'Analyzes sampled keyframes and extracted audio metadata; visual details between sampled keyframes may be missed.',
        'Does not perform biometric facial recognition of unknown individuals.',
      ],
      environmentVarRequired: 'GEMINI_API_KEY + AAI_ALLOW_CLOUD_AI=true',
    };
  }

  public async analyze(request: MultimodalAnalysisRequest): Promise<MultimodalProviderOutput> {
    if (!isCloudAiDeploymentApproved()) {
      throw new Error(
        'Cloud processing and paid calls are disabled pending approval (set AAI_ALLOW_CLOUD_AI=true on server to enable).'
      );
    }
    if (!request.cloudAiConsent) {
      throw new Error('Cloud AI processing was not authorized by the user (cloudAiConsent=false).');
    }
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
      throw new Error('GEMINI_API_KEY is not configured in server environment secrets.');
    }

    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });

    const maxFramesForMode = request.mode === 'economy' ? 4 : request.mode === 'balanced' ? 8 : 12;
    const selectedFrames = request.keyframes.slice(0, maxFramesForMode);

    const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [];

    for (const kf of selectedFrames) {
      if (fs.existsSync(kf.localFilePath)) {
        const bytes = fs.readFileSync(kf.localFilePath);
        parts.push({
          text: `Keyframe #${kf.sceneIndex} at timestamp ${kf.timestampSec}s (extraction: ${kf.extractionMethod}, sceneScore: ${kf.sceneScore}):`,
        });
        parts.push({
          inlineData: {
            mimeType: 'image/jpeg',
            data: bytes.toString('base64'),
          },
        });
      }
    }

    const transcriptContext =
      request.existingTranscript && request.existingTranscript.length > 0
        ? `Verbatim timestamped speech transcript (Layer E): ${JSON.stringify(request.existingTranscript.slice(0, 60))}.`
        : 'Verbatim speech transcript: none supplied.';

    const promptText = [
      `Analyze the supplied extracted keyframes and technical metadata for audiovisual asset "${request.originalFilename}" (duration ${request.durationSec}s).`,
      `Audio profile: hasAudio=${request.audioProfile.hasAudio}, meanVolumeDb=${request.audioProfile.meanVolumeDb}, maxVolumeDb=${request.audioProfile.maxVolumeDb}, silenceIntervals=${JSON.stringify(request.audioProfile.silenceIntervals)}.`,
      `Scene cuts detected by FFmpeg: ${JSON.stringify(request.sceneCuts)}.`,
      transcriptContext,
      '',
      'STRICT EPISTEMIC RULES (Aionic Archive Intelligence §3, §8, §16):',
      '1. Never fabricate dialogue, unseen events, or hidden intentions.',
      '2. Never identify unknown people biometrically and never diagnose mental states.',
      '3. Separate Layer E observableDescription (strictly what is directly visible/measurable in the supplied frames) from Layer A analyticalSummary (interpretation/editorial significance).',
      '4. For any technical_irregularity (flicker, flash, artifact, reflection, blur), ALWAYS provide ordinaryExplanations (lighting, compression, reflections, motion blur, recording artefacts) and never claim supernatural causes.',
      `5. Use only these exact classification values: ${ALL_MOMENT_CATEGORIES.join(', ')}.`,
      '6. Provide 3 to 6 concise, non-overlapping candidate moments grounded strictly in the provided timestamps.',
    ].join('\n');

    parts.push({ text: promptText });

    const response = await ai.models.generateContent({
      model: this.modelName,
      contents: { parts },
      config: {
        systemInstruction:
          'You are the AAI-02 Observer & AAI-04 Sentinel multimodal analysis engine. Return strictly grounded, conservative, evidence-separated JSON observations.',
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            observableEvidence: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  startSec: { type: Type.NUMBER },
                  endSec: { type: Type.NUMBER },
                  title: { type: Type.STRING },
                  observableFact: { type: Type.STRING },
                },
                required: ['startSec', 'endSec', 'title', 'observableFact'],
              },
            },
            candidateMoments: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  startSec: { type: Type.NUMBER },
                  endSec: { type: Type.NUMBER },
                  classification: { type: Type.STRING },
                  observableDescription: { type: Type.STRING },
                  analyticalSummary: { type: Type.STRING },
                  reasonForSelection: { type: Type.STRING },
                  baseSignalStrength: { type: Type.NUMBER },
                  confidenceScore: { type: Type.NUMBER },
                  uncertaintyNote: { type: Type.STRING },
                  ordinaryExplanations: {
                    type: Type.ARRAY,
                    items: { type: Type.STRING },
                  },
                  tags: {
                    type: Type.ARRAY,
                    items: { type: Type.STRING },
                  },
                },
                required: [
                  'startSec',
                  'endSec',
                  'classification',
                  'observableDescription',
                  'analyticalSummary',
                  'reasonForSelection',
                  'baseSignalStrength',
                  'confidenceScore',
                  'uncertaintyNote',
                ],
              },
            },
          },
          required: ['observableEvidence', 'candidateMoments'],
        },
      },
    });

    const rawText = (response.text ?? '{}').trim();
    const parsed = JSON.parse(rawText) as {
      observableEvidence?: ProviderObservation[];
      candidateMoments?: Array<{
        startSec: number;
        endSec: number;
        classification: string;
        observableDescription: string;
        analyticalSummary: string;
        reasonForSelection: string;
        baseSignalStrength: number;
        confidenceScore: number;
        uncertaintyNote: string;
        ordinaryExplanations?: string[];
        tags?: string[];
      }>;
    };

    const validSet = new Set<string>(ALL_MOMENT_CATEGORIES);
    const moments: ProviderCandidateMoment[] = (parsed.candidateMoments ?? []).map((m) => {
      const classification: MomentCategory = validSet.has(m.classification)
        ? (m.classification as MomentCategory)
        : 'potential_documentary_material';
      const ordinaryExplanations =
        classification === 'technical_irregularity'
          ? m.ordinaryExplanations && m.ordinaryExplanations.length > 0
            ? m.ordinaryExplanations
            : buildOrdinaryExplanations(m.observableDescription)
          : m.ordinaryExplanations ?? [];

      return {
        startSec: Math.max(0, Math.min(request.durationSec, Number(m.startSec) || 0)),
        endSec: Math.max(
          Math.max(0, Number(m.startSec) || 0) + 0.5,
          Math.min(request.durationSec, Number(m.endSec) || request.durationSec)
        ),
        classification,
        observableDescription: String(m.observableDescription || '').trim(),
        analyticalSummary: String(m.analyticalSummary || '').trim(),
        reasonForSelection: String(m.reasonForSelection || 'Flagged by Gemini multimodal frame analysis.').trim(),
        baseSignalStrength: Math.max(0.1, Math.min(1, Number(m.baseSignalStrength) || 0.65)),
        confidenceScore: Math.max(0.05, Math.min(0.99, Number(m.confidenceScore) || 0.7)),
        uncertaintyNote:
          String(m.uncertaintyNote || '').trim() ||
          'Derived from sampled keyframes only; continuous motion and spoken audio between frames require direct review.',
        ordinaryExplanations,
        modalities: request.audioProfile.hasAudio ? ['visual', 'audio', 'metadata'] : ['visual', 'metadata'],
        relevantTranscript: '',
        tags: Array.isArray(m.tags) ? m.tags.slice(0, 6).map(String) : ['gemini-multimodal'],
      };
    });

    const usageMeta = (response as { usageMetadata?: { totalTokenCount?: number } }).usageMetadata;

    return {
      providerId: this.id,
      modelName: this.modelName,
      modality: 'multimodal',
      observableEvidence: (parsed.observableEvidence ?? []).map((o) => ({
        startSec: Math.max(0, Math.min(request.durationSec, Number(o.startSec) || 0)),
        endSec: Math.max(0, Math.min(request.durationSec, Number(o.endSec) || request.durationSec)),
        title: String(o.title || 'Visual observation'),
        observableFact: String(o.observableFact || ''),
      })),
      candidateMoments: moments,
      transcriptSegments: [
        {
          startSec: 0,
          endSec: Math.min(request.durationSec, 2),
          text: '[Multimodal keyframe analysis completed via Gemini (gemini-4-hydrogen). Separate audio ASR transcription is required for verbatim speech text.]',
          speakerLabel: 'System Notice',
          confidence: null,
          isPlaceholderNotice: true,
        },
      ],
      estimatedTokens: usageMeta?.totalTokenCount ?? selectedFrames.length * 280 + 1200,
    };
  }
}

/**
 * 3. OpenAI Multimodal Adapter — honest capability detector (never fakes output when unconfigured).
 */
export class OpenAIMultimodalAdapter implements IMultimodalProviderAdapter {
  public readonly id = 'openai-multimodal';
  public readonly name = 'OpenAI Multimodal Vision & Language Adapter';

  public async detectCapabilities(): Promise<ProviderCapability> {
    const configured = Boolean(process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.trim());
    return {
      id: this.id,
      name: this.name,
      kind: 'cloud_multimodal',
      available: false, // Explicit disclosure: HTTP integration stubbed until SDK/key enabled
      requiresConsent: true,
      isPaidOrMetered: true,
      modelName: configured ? 'gpt-4o (adapter ready for activation)' : null,
      supportedModalities: ['video_frames', 'structured_json'],
      statusReason: configured
        ? 'OPENAI_API_KEY detected, but active OpenAI transport is intentionally disabled in MVP build; use Gemini or Local FFmpeg.'
        : 'OPENAI_API_KEY is not configured. Disclosed honestly rather than simulated.',
      limitations: [
        'Capability-detected adapter slot ready for canonical AAI multi-provider routing.',
        'Requires explicit cloud consent and OPENAI_API_KEY activation.',
      ],
      environmentVarRequired: 'OPENAI_API_KEY',
    };
  }

  public async analyze(): Promise<MultimodalProviderOutput> {
    throw new Error(
      'OpenAI Multimodal Adapter is not active in this deployment (OPENAI_API_KEY unconfigured or transport disabled). Select Local FFmpeg Signal or Google Gemini.'
    );
  }
}

/**
 * 4. Azure AI Vision/OpenAI Adapter — honest capability detector.
 */
export class AzureAIAdapter implements IMultimodalProviderAdapter {
  public readonly id = 'azure-ai-multimodal';
  public readonly name = 'Microsoft Azure AI Vision & Video Indexer Adapter';

  public async detectCapabilities(): Promise<ProviderCapability> {
    const configured = Boolean(process.env.AZURE_AI_API_KEY && process.env.AZURE_AI_ENDPOINT);
    return {
      id: this.id,
      name: this.name,
      kind: 'cloud_multimodal',
      available: false,
      requiresConsent: true,
      isPaidOrMetered: true,
      modelName: null,
      supportedModalities: ['video_frames', 'audio_signal', 'structured_json'],
      statusReason: configured
        ? 'Azure credentials present, transport pending Phase 2 activation.'
        : 'AZURE_AI_API_KEY and AZURE_AI_ENDPOINT are not configured.',
      limitations: [
        'Enterprise cloud provider adapter slot per Master Spec §6.',
        'Unavailable capabilities are disclosed transparently.',
      ],
      environmentVarRequired: 'AZURE_AI_API_KEY',
    };
  }

  public async analyze(): Promise<MultimodalProviderOutput> {
    throw new Error('Azure AI Adapter is not configured in this environment.');
  }
}

/**
 * 5. Local Whisper Speech Recognition Adapter — probes local whisper binary.
 */
export class LocalSpeechWhisperAdapter implements IMultimodalProviderAdapter {
  public readonly id = 'local-whisper-asr';
  public readonly name = 'Local Whisper Speech Recognition';

  public async detectCapabilities(): Promise<ProviderCapability> {
    const hasWhisper = (await checkBinaryAvailable('whisper')) || (await checkBinaryAvailable('whisper-cpp'));
    return {
      id: this.id,
      name: this.name,
      kind: 'local_speech',
      available: hasWhisper,
      requiresConsent: false,
      isPaidOrMetered: false,
      modelName: hasWhisper ? 'whisper-local-base' : null,
      supportedModalities: ['speech_transcription'],
      statusReason: hasWhisper
        ? 'Local Whisper binary detected on host.'
        : 'No local whisper / whisper-cpp binary installed in this runtime container.',
      limitations: [
        'Install whisper.cpp or faster-whisper locally to unlock zero-cost offline speech transcription.',
      ],
      environmentVarRequired: null,
    };
  }

  public async analyze(): Promise<MultimodalProviderOutput> {
    throw new Error('Local Whisper binary is not installed in this container.');
  }
}

/**
 * 2b. Google Gemini Speech Transcription Adapter (@google/genai, gemini-3.5-transcribe).
 * Strictly server-side, requires explicit cloudAiConsent=true and process.env.GEMINI_API_KEY.
 * Transcribes extracted mono 16kHz MP3 audio into grounded timestamped segments without fabricating dialogue.
 */
export class GeminiSpeechTranscriptionAdapter implements IMultimodalProviderAdapter {
  public readonly id = 'google-gemini-transcribe';
  public readonly name = `Google Gemini Speech Transcription (${GEMINI_INTEGRATION_CONTRACT.transcriptionModel})`;
  private readonly modelName = GEMINI_INTEGRATION_CONTRACT.transcriptionModel;

  public async detectCapabilities(): Promise<ProviderCapability> {
    const key = process.env.GEMINI_API_KEY;
    const configured = Boolean(key && key.trim() && key !== 'MY_GEMINI_API_KEY');
    const approved = isCloudAiDeploymentApproved();
    const hasFfmpeg = await checkBinaryAvailable('ffmpeg');
    return {
      id: this.id,
      name: this.name,
      kind: 'cloud_speech',
      available: configured && approved && hasFfmpeg,
      requiresConsent: true,
      isPaidOrMetered: true,
      modelName: this.modelName,
      supportedModalities: ['speech_transcription', 'structured_json'],
      statusReason: !approved
        ? 'Cloud processing and paid API calls are disabled pending explicit approval (set AAI_ALLOW_CLOUD_AI=true to enable).'
        : !hasFfmpeg
          ? 'FFmpeg is required to extract audio tracks for speech transcription.'
          : configured
            ? 'GEMINI_API_KEY configured, AAI_ALLOW_CLOUD_AI=true, and FFmpeg ready for timestamped speech transcription.'
            : 'GEMINI_API_KEY is not configured in server environment secrets.',
      limitations: [
        'Disabled by default pending explicit deployment approval (AAI_ALLOW_CLOUD_AI=true) and per-run user consent.',
        'Discloses non-speech / tone-only tracks honestly without fabricating spoken words.',
        'Inline audio payloads are capped for responsiveness; long archival reels should be chunked.',
      ],
      environmentVarRequired: 'GEMINI_API_KEY + AAI_ALLOW_CLOUD_AI=true',
    };
  }

  public async analyze(request: MultimodalAnalysisRequest): Promise<MultimodalProviderOutput> {
    if (!isCloudAiDeploymentApproved()) {
      throw new Error(
        'Cloud processing and paid calls are disabled pending approval (set AAI_ALLOW_CLOUD_AI=true on server to enable).'
      );
    }
    if (!request.cloudAiConsent) {
      throw new Error('Cloud speech transcription was not authorized by the user (cloudAiConsent=false).');
    }
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
      throw new Error('GEMINI_API_KEY is not configured in server environment secrets.');
    }
    if (!request.extractedAudioPath || !fs.existsSync(request.extractedAudioPath)) {
      throw new Error('No extracted audio file available for speech transcription.');
    }

    const audioBytes = fs.readFileSync(request.extractedAudioPath);
    if (audioBytes.byteLength > 18 * 1024 * 1024) {
      throw new Error('Extracted audio exceeds inline 18 MB limit; split into smaller chunks before transcribing.');
    }

    const audioPart = {
      inlineData: {
        mimeType: 'audio/mp3',
        data: audioBytes.toString('base64'),
      },
    };
    const promptPart = {
      text: [
        `Transcribe all intelligible human speech in "${request.originalFilename}" (duration ${request.durationSec}s).`,
        'Format each spoken utterance on its own line as: [MM:SS - MM:SS] Speaker: verbatim words',
        'CRITICAL HONESTY RULE: If the audio contains only music, test tones, static, or silence with no intelligible human speech, reply with the exact token: NO_SPEECH. NEVER fabricate dialogue.',
      ].join('\n'),
    };

    const callTranscribe = async (model: string, apiVersion?: string) => {
      const ai = new GoogleGenAI({
        apiKey,
        ...(apiVersion ? { apiVersion } : {}),
        httpOptions: {
          headers: {
            'User-Agent': GEMINI_INTEGRATION_CONTRACT.userAgentHeader,
          },
        },
      });
      return ai.models.generateContent({
        model,
        contents: { parts: [audioPart, promptPart] },
      });
    };

    let executedModel: string = this.modelName;
    let response;
    try {
      // Canonical gemini-3.5-transcribe runs on v1beta without JSON mode
      response = await callTranscribe(this.modelName, 'v1beta');
    } catch (primaryErr) {
      const msg = primaryErr instanceof Error ? primaryErr.message : String(primaryErr);
      if (msg.includes('NOT_FOUND') || msg.includes('404')) {
        executedModel = GEMINI_INTEGRATION_CONTRACT.multimodalModel;
        response = await callTranscribe(executedModel);
      } else {
        throw primaryErr;
      }
    }

    const rawText = (response.text ?? '').trim();
    const parsedSegments = parseTranscriptionOutput(rawText, request.durationSec);
    const usageMeta = (response as { usageMetadata?: { totalTokenCount?: number } }).usageMetadata;

    return {
      providerId: this.id,
      modelName: executedModel,
      modality: 'audio',
      observableEvidence: parsedSegments
        .filter((s) => !s.isPlaceholderNotice)
        .map((s, idx) => ({
          startSec: s.startSec,
          endSec: s.endSec,
          title: `Verbatim speech segment #${idx + 1}`,
          observableFact: `${s.speakerLabel ? `${s.speakerLabel}: ` : ''}"${s.text}"`,
        })),
      candidateMoments: [],
      transcriptSegments: parsedSegments,
      estimatedTokens: usageMeta?.totalTokenCount ?? Math.ceil(request.durationSec * 32),
    };
  }
}

export class ProviderRegistry {
  private readonly adapters: Map<string, IMultimodalProviderAdapter> = new Map();

  constructor() {
    this.register(new LocalSignalAdapter());
    this.register(new GeminiMultimodalAdapter());
    this.register(new GeminiSpeechTranscriptionAdapter());
    this.register(new OpenAIMultimodalAdapter());
    this.register(new AzureAIAdapter());
    this.register(new LocalSpeechWhisperAdapter());
  }

  public register(adapter: IMultimodalProviderAdapter): void {
    this.adapters.set(adapter.id, adapter);
  }

  public get(id: string): IMultimodalProviderAdapter | undefined {
    return this.adapters.get(id);
  }

  public async detectAllCapabilities(): Promise<ProviderCapability[]> {
    const list: ProviderCapability[] = [];
    for (const adapter of this.adapters.values()) {
      list.push(await adapter.detectCapabilities());
    }
    return list;
  }
}
