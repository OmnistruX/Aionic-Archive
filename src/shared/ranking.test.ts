import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildFeedbackCalibration,
  computeRelevanceScore,
  createDefaultRankingConfig,
  estimateProcessingCost,
  rankDetectedEvents,
} from './ranking';
import { DetectedEvent, ReviewDecision } from './types';

function makeEvent(overrides: Partial<DetectedEvent> = {}): DetectedEvent {
  return {
    id: 'evt-1',
    assetId: 'asset-1',
    startSec: 5,
    endSec: 9,
    thumbnailUrl: null,
    observableDescription: 'Observable frame delta.',
    analyticalSummary: 'Scene shift.',
    relevantTranscript: '',
    detectionMethod: 'FFmpeg',
    providerId: 'local-ffmpeg-signal',
    modelName: 'ffmpeg-v1',
    baseSignalStrength: 0.75,
    estimatedRelevanceScore: 50,
    confidenceScore: 0.8,
    uncertaintyNote: 'Visual delta only.',
    reasonForSelection: 'Threshold crossed.',
    ordinaryExplanations: [],
    classification: 'environmental_change',
    reviewStatus: 'unreviewed',
    userAnnotations: '',
    assignedProject: null,
    tags: [],
    modalities: ['visual'],
    dataOrigin: 'real_upload',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

test('computeRelevanceScore applies category weights and marks prioritisation-only', () => {
  const cfg = createDefaultRankingConfig();
  const baseEvent = makeEvent({ classification: 'environmental_change', baseSignalStrength: 0.7 });

  const lowCfg = { ...cfg, categoryWeights: { ...cfg.categoryWeights, environmental_change: 0.5 } };
  const highCfg = { ...cfg, categoryWeights: { ...cfg.categoryWeights, environmental_change: 1.8 } };

  const lowScore = computeRelevanceScore(baseEvent, lowCfg);
  const highScore = computeRelevanceScore(baseEvent, highCfg);

  assert.equal(lowScore.isPrioritisationEstimateOnly, true);
  assert.ok(highScore.estimatedRelevanceScore > lowScore.estimatedRelevanceScore);
  assert.ok(highScore.estimatedRelevanceScore <= 100);
  assert.ok(lowScore.estimatedRelevanceScore >= 0);
});

test('multimodal corroboration boosts score when multiple independent modalities agree', () => {
  const cfg = createDefaultRankingConfig();
  const single = makeEvent({ modalities: ['visual'] });
  const multi = makeEvent({ modalities: ['visual', 'audio', 'transcript'] });

  const s1 = computeRelevanceScore(single, cfg);
  const s2 = computeRelevanceScore(multi, cfg);
  assert.ok(s2.estimatedRelevanceScore > s1.estimatedRelevanceScore);
});

test('human review feedback calibrates category multiplier without mutating Layer E evidence', () => {
  const cfg = createDefaultRankingConfig();
  const decisions: ReviewDecision[] = [
    {
      id: 'd1',
      eventId: 'e1',
      assetId: 'a1',
      decision: 'accepted',
      previousClassification: 'technical_irregularity',
      correctedClassification: 'technical_irregularity',
      note: '',
      createdAt: '2026-01-01T00:00:00Z',
    },
    {
      id: 'd2',
      eventId: 'e2',
      assetId: 'a1',
      decision: 'false_positive',
      previousClassification: 'location_transition',
      correctedClassification: 'location_transition',
      note: '',
      createdAt: '2026-01-01T00:00:00Z',
    },
  ];

  const cal = buildFeedbackCalibration(decisions, 0.8);
  assert.ok(cal.technical_irregularity.netMultiplier > 1);
  assert.ok(cal.location_transition.netMultiplier < 1);

  const equalWeightCfg = {
    ...cfg,
    categoryWeights: {
      ...cfg.categoryWeights,
      technical_irregularity: 1.0,
      location_transition: 1.0,
    },
  };
  const eA = makeEvent({ id: 'eA', classification: 'technical_irregularity', observableDescription: 'Original Layer E' });
  const eB = makeEvent({ id: 'eB', classification: 'location_transition', observableDescription: 'Original Layer E B' });
  const ranked = rankDetectedEvents([eB, eA], equalWeightCfg, decisions);

  assert.equal(ranked[0].id, 'eA');
  assert.equal(ranked[0].observableDescription, 'Original Layer E');
});

test('estimateProcessingCost enforces $0 local-only vs explicit consent for cloud AI', () => {
  const localEst = estimateProcessingCost(3600, 500 * 1024 * 1024, 'economy', false);
  assert.equal(localEst.requiresExplicitConsent, false);
  assert.equal(localEst.estimatedCloudTokens, 0);
  assert.ok(localEst.chunkCount >= 12);

  const deepCloudEst = estimateProcessingCost(3600, 500 * 1024 * 1024, 'deep', true);
  assert.equal(deepCloudEst.requiresExplicitConsent, true);
  assert.ok(deepCloudEst.estimatedCloudTokens > 0);
  assert.ok(deepCloudEst.chunkCount > localEst.chunkCount);
});
