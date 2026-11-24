import test from 'node:test';
import assert from 'node:assert/strict';
import {
  exportCsvEventRegister,
  exportJsonEvidencePackage,
  exportMarkdownReport,
  exportSubtitlesSrt,
  exportSubtitlesVtt,
} from './exports';
import { Asset, DetectedEvent, LayerRecord, TranscriptSegment } from './types';

const sampleAsset: Asset = {
  id: 'asset-test-1',
  originalFilename: 'coastal_reel.mp4',
  sourceAdapter: 'local_upload',
  dataOrigin: 'real_upload',
  mediaKind: 'video',
  mimeType: 'video/mp4',
  fileFormat: 'mp4',
  fileSizeBytes: 102400,
  durationSec: 24,
  importDate: '2026-01-01T00:00:00Z',
  creationDate: null,
  creationDateStatus: 'unknown',
  width: 640,
  height: 360,
  frameRate: 24,
  videoCodec: 'h264',
  audioCodec: 'aac',
  audioSampleRate: 44100,
  audioChannels: 1,
  locationMetadata: null,
  sha256Hash: 'abc123def456',
  isDuplicateOf: null,
  processingStatus: 'completed',
  provenanceNote: 'Test upload',
  embeddedMetadataJson: '{}',
  mediaUrl: '/api/media/asset-test-1',
};

const sampleEvents: DetectedEvent[] = [
  {
    id: 'evt-1',
    assetId: 'asset-test-1',
    startSec: 16,
    endSec: 19,
    thumbnailUrl: null,
    observableDescription: 'Rapid luminance oscillation, "high contrast" frames.',
    analyticalSummary: 'Likely auto-exposure flicker.',
    relevantTranscript: '',
    detectionMethod: 'FFmpeg Scene/Audio Signal Detector',
    providerId: 'local-ffmpeg-signal',
    modelName: 'ffmpeg-v1',
    baseSignalStrength: 0.85,
    estimatedRelevanceScore: 74,
    confidenceScore: 0.82,
    uncertaintyNote: 'Visual signal only.',
    reasonForSelection: '3 rapid cuts in 2s.',
    ordinaryExplanations: ['Auto-exposure flicker'],
    classification: 'technical_irregularity',
    reviewStatus: 'accepted',
    userAnnotations: 'Checked on waveform monitor.',
    assignedProject: null,
    tags: ['flicker'],
    modalities: ['visual'],
    dataOrigin: 'real_upload',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  },
];

const sampleLayers: LayerRecord[] = [
  {
    id: 'lyr-e-1',
    assetId: 'asset-test-1',
    eventId: 'evt-1',
    layer: 'E',
    title: 'Measured flicker',
    content: 'Luma jumped every 3 frames.',
    startSec: 16,
    endSec: 19,
    authorType: 'system_detector',
    authorName: 'AAI-02',
    providerId: 'local-ffmpeg-signal',
    modelName: 'ffmpeg-v1',
    sourceReference: 'coastal_reel.mp4 @ 00:16.0',
    confidence: 0.9,
    uncertaintyDisclosure: null,
    revisionCount: 1,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  },
];

const sampleTranscripts: TranscriptSegment[] = [
  {
    id: 'tr-1',
    assetId: 'asset-test-1',
    startSec: 1.5,
    endSec: 4.25,
    text: 'Testing coastal microphone placement.',
    speakerLabel: 'Speaker 1',
    confidence: 0.91,
    providerId: 'local-whisper-asr',
    isPlaceholderNotice: false,
  },
];

test('JSON evidence package separates epistemic layers and includes SHA-256 provenance', () => {
  const json = exportJsonEvidencePackage({
    asset: sampleAsset,
    events: sampleEvents,
    layers: sampleLayers,
    transcripts: sampleTranscripts,
    modelRuns: [],
  });
  const parsed = JSON.parse(json);
  assert.equal(parsed.sourceAsset.sha256Hash, 'abc123def456');
  assert.equal(parsed.epistemicLayers.E_evidence.length, 1);
  assert.equal(parsed.epistemicLayers.S_symbolism.length, 0);
  assert.match(parsed.significantMoments[0].scoreInterpretationNote, /prioritisation estimate/i);
});

test('CSV event register escapes quotes and commas cleanly', () => {
  const csv = exportCsvEventRegister(sampleAsset, sampleEvents);
  assert.ok(csv.includes('"Rapid luminance oscillation, ""high contrast"" frames."'));
  assert.ok(csv.includes('abc123def456'));
});

test('SRT and VTT format timestamps accurately', () => {
  const srt = exportSubtitlesSrt(sampleTranscripts);
  assert.ok(srt.includes('00:00:01,500 --> 00:00:04,250'));
  const vtt = exportSubtitlesVtt(sampleTranscripts);
  assert.ok(vtt.startsWith('WEBVTT'));
  assert.ok(vtt.includes('00:00:01.500 --> 00:00:04.250'));
});

test('Markdown report preserves distinct layer headings', () => {
  const md = exportMarkdownReport({
    asset: sampleAsset,
    events: sampleEvents,
    layers: sampleLayers,
    transcripts: sampleTranscripts,
  });
  assert.ok(md.includes('### Layer E: Evidence (1)'));
  assert.ok(md.includes('### Layer S: Symbolism (0)'));
});
