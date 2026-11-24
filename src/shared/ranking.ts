import {
  ALL_MOMENT_CATEGORIES,
  DetectedEvent,
  MOMENT_CATEGORIES,
  MomentCategory,
  PreFlightEstimate,
  ProcessingMode,
  RankingConfig,
  ReviewDecision,
  ScoreBreakdownItem,
} from './types';

export function createDefaultRankingConfig(): RankingConfig {
  const categoryWeights = {} as Record<MomentCategory, number>;
  for (const cat of ALL_MOMENT_CATEGORIES) {
    categoryWeights[cat] = MOMENT_CATEGORIES[cat].defaultWeight;
  }
  return {
    id: 'default',
    name: 'Balanced Archival Discovery',
    categoryWeights,
    modalityCorroborationBoost: 7,
    minRelevanceThreshold: 25,
    useHumanFeedbackCalibration: true,
    feedbackCalibrationStrength: 0.35,
    deprioritiseLowInfo: true,
    updatedAt: new Date().toISOString(),
  };
}

export interface CategoryFeedbackStats {
  accepted: number;
  rejected: number;
  falsePositive: number;
  netMultiplier: number; // bounded 0.65 .. 1.35
}

/**
 * Computes per-category calibration multipliers from prior human review decisions.
 * Feedback informs future prioritisation estimates only; it never mutates Layer E evidence.
 */
export function buildFeedbackCalibration(
  decisions: ReviewDecision[],
  strength: number
): Record<MomentCategory, CategoryFeedbackStats> {
  const clampedStrength = Math.max(0, Math.min(1, strength));
  const stats = {} as Record<MomentCategory, CategoryFeedbackStats>;

  for (const cat of ALL_MOMENT_CATEGORIES) {
    stats[cat] = { accepted: 0, rejected: 0, falsePositive: 0, netMultiplier: 1 };
  }

  for (const d of decisions) {
    const bucket = stats[d.correctedClassification];
    if (!bucket) continue;
    if (d.decision === 'accepted' || d.decision === 'bookmarked') {
      bucket.accepted += 1;
    } else if (d.decision === 'rejected') {
      bucket.rejected += 1;
    } else if (d.decision === 'false_positive') {
      bucket.falsePositive += 1;
    }
  }

  for (const cat of ALL_MOMENT_CATEGORIES) {
    const b = stats[cat];
    const total = b.accepted + b.rejected + b.falsePositive;
    if (total === 0) {
      b.netMultiplier = 1;
      continue;
    }
    // Positive acceptance raises priority mildly; false positives penalise slightly stronger than rejections
    const netSignal = (b.accepted - b.rejected * 0.8 - b.falsePositive * 1.15) / (total + 2);
    const delta = netSignal * 0.45 * clampedStrength;
    b.netMultiplier = Number(Math.max(0.65, Math.min(1.35, 1 + delta)).toFixed(3));
  }

  return stats;
}

export interface ComputedScoreResult {
  estimatedRelevanceScore: number;
  meetsThreshold: boolean;
  breakdown: ScoreBreakdownItem[];
  isPrioritisationEstimateOnly: true;
}

/**
 * Deterministic relevance score calculator.
 * Scores represent prioritisation estimates (0..100), never proof that an event occurred as interpreted.
 */
export function computeRelevanceScore(
  event: Pick<
    DetectedEvent,
    | 'baseSignalStrength'
    | 'classification'
    | 'modalities'
    | 'confidenceScore'
    | 'ordinaryExplanations'
    | 'reviewStatus'
    | 'relevantTranscript'
  >,
  config: RankingConfig,
  feedbackStats?: Record<MomentCategory, CategoryFeedbackStats>
): ComputedScoreResult {
  const breakdown: ScoreBreakdownItem[] = [];

  const signalClamped = Math.max(0, Math.min(1, event.baseSignalStrength));
  const basePoints = signalClamped * 58;
  breakdown.push({
    factor: 'Base signal strength',
    contribution: Number(basePoints.toFixed(1)),
    detail: `Normalized detector signal ${(signalClamped * 100).toFixed(0)}%`,
  });

  const weight = config.categoryWeights[event.classification] ?? 1.0;
  const weightedBase = basePoints * weight;
  const weightDelta = weightedBase - basePoints;
  breakdown.push({
    factor: `Category weight (${MOMENT_CATEGORIES[event.classification].label})`,
    contribution: Number(weightDelta.toFixed(1)),
    detail: `Configured multiplier x${weight.toFixed(2)}`,
  });

  let running = weightedBase;

  // Multi-modality corroboration bonus (each additional independent modality above 1)
  const uniqueModalities = Array.from(new Set(event.modalities));
  const extraModalities = Math.max(0, uniqueModalities.length - 1);
  const modalityBonus = extraModalities * Math.max(0, Math.min(20, config.modalityCorroborationBoost));
  if (modalityBonus > 0) {
    running += modalityBonus;
    breakdown.push({
      factor: 'Multimodal corroboration',
      contribution: Number(modalityBonus.toFixed(1)),
      detail: `${uniqueModalities.join(' + ')} (${uniqueModalities.length} modalities)`,
    });
  }

  // Confidence factor (mild adjustment when confidence is explicitly known)
  if (event.confidenceScore !== null && Number.isFinite(event.confidenceScore)) {
    const confClamped = Math.max(0, Math.min(1, event.confidenceScore));
    const confAdj = (confClamped - 0.5) * 14;
    running += confAdj;
    breakdown.push({
      factor: 'Detector confidence calibration',
      contribution: Number(confAdj.toFixed(1)),
      detail: `Reported confidence ${(confClamped * 100).toFixed(0)}%`,
    });
  }

  // Low-information deprioritisation
  if (config.deprioritiseLowInfo && event.classification === 'low_information_footage') {
    const penalty = -18;
    running += penalty;
    breakdown.push({
      factor: 'Low-information deprioritisation',
      contribution: penalty,
      detail: 'Active rule reduces repetitive/low-signal segments',
    });
  }

  // Human feedback calibration
  if (config.useHumanFeedbackCalibration && feedbackStats) {
    const catStat = feedbackStats[event.classification];
    if (catStat && catStat.netMultiplier !== 1) {
      const calibrated = running * catStat.netMultiplier;
      const delta = calibrated - running;
      running = calibrated;
      breakdown.push({
        factor: 'Human review calibration',
        contribution: Number(delta.toFixed(1)),
        detail: `Prior reviews (${catStat.accepted} accepted, ${catStat.rejected + catStat.falsePositive} rejected/FP) -> x${catStat.netMultiplier.toFixed(2)}`,
      });
    }
  }

  // Explicit human bookmark boost / false-positive suppression
  if (event.reviewStatus === 'bookmarked') {
    running += 10;
    breakdown.push({
      factor: 'User bookmark',
      contribution: 10,
      detail: 'Explicitly bookmarked by archive owner',
    });
  } else if (event.reviewStatus === 'false_positive') {
    running *= 0.25;
    breakdown.push({
      factor: 'Marked false positive',
      contribution: Number((-running * 3).toFixed(1)),
      detail: 'Suppressed in ranking while preserving audit record',
    });
  }

  const finalScore = Math.max(0, Math.min(100, Math.round(running)));

  return {
    estimatedRelevanceScore: finalScore,
    meetsThreshold: finalScore >= config.minRelevanceThreshold,
    breakdown,
    isPrioritisationEstimateOnly: true,
  };
}

export function rankDetectedEvents(
  events: DetectedEvent[],
  config: RankingConfig,
  decisions: ReviewDecision[] = []
): DetectedEvent[] {
  const feedbackStats = config.useHumanFeedbackCalibration
    ? buildFeedbackCalibration(decisions, config.feedbackCalibrationStrength)
    : undefined;

  return events
    .map((evt) => {
      const computed = computeRelevanceScore(evt, config, feedbackStats);
      return {
        ...evt,
        estimatedRelevanceScore: computed.estimatedRelevanceScore,
        scoreBreakdown: computed.breakdown,
      };
    })
    .sort((a, b) => {
      if (b.estimatedRelevanceScore !== a.estimatedRelevanceScore) {
        return b.estimatedRelevanceScore - a.estimatedRelevanceScore;
      }
      return a.startSec - b.startSec;
    });
}

/**
 * Pre-flight resource & cost estimator per Master Spec §18.
 * Never initiates paid API calls; presents transparent estimates before execution.
 */
export function estimateProcessingCost(
  durationSec: number,
  fileSizeBytes: number,
  mode: ProcessingMode,
  useCloudAi: boolean
): PreFlightEstimate {
  const safeDuration = Math.max(1, durationSec);
  const chunkDurationSec = mode === 'economy' ? 300 : mode === 'balanced' ? 180 : 90;
  const chunkCount = Math.max(1, Math.ceil(safeDuration / chunkDurationSec));

  const keyframesPerMinute = mode === 'economy' ? 2 : mode === 'balanced' ? 6 : 15;
  const rawFrames = Math.ceil((safeDuration / 60) * keyframesPerMinute);
  const estimatedKeyframes = Math.max(
    mode === 'economy' ? 3 : mode === 'balanced' ? 6 : 10,
    Math.min(mode === 'economy' ? 12 : mode === 'balanced' ? 24 : 48, rawFrames)
  );

  const mb = Math.max(0.5, fileSizeBytes / (1024 * 1024));
  const modeMultiplier = mode === 'economy' ? 0.35 : mode === 'balanced' ? 0.65 : 1.25;
  const estimatedLocalSeconds = Math.max(2, Math.round(mb * 0.25 + safeDuration * 0.12 * modeMultiplier));

  const tokensPerFrame = 280;
  const overheadTokens = 1400;
  const estimatedCloudTokens = useCloudAi ? estimatedKeyframes * tokensPerFrame + overheadTokens : 0;

  // Indicative low-cost multimodal token band (USD)
  const lowUsd = (estimatedCloudTokens / 1_000_000) * 0.15;
  const highUsd = (estimatedCloudTokens / 1_000_000) * 0.6;
  const estimatedCostRangeUsd = useCloudAi
    ? `$${lowUsd.toFixed(4)} – $${highUsd.toFixed(4)} (estimate)`
    : '$0.00 (Local-only processing)';

  const notes: string[] = [
    mode === 'economy'
      ? 'Economy mode: FFprobe metadata, sparse scene keyframes, and local audio envelope analysis.'
      : mode === 'balanced'
        ? 'Balanced mode: Scene-aware keyframe extraction, acoustic shift detection, and selective multimodal synthesis.'
        : 'Deep Analysis mode: Dense keyframe sampling, granular scene/audio anomaly sweeps, and comprehensive multimodal context.',
    `Chunked processing plan: ${chunkCount} chunk${chunkCount > 1 ? 's' : ''} (${chunkDurationSec}s window).`,
  ];

  if (useCloudAi) {
    notes.push('Cloud AI opt-in selected: extracted keyframes and metadata will be sent to Google Gemini (gemini-4-hydrogen) only after explicit confirmation.');
  } else {
    notes.push('Local-first privacy active: no frames or audio leave this machine.');
  }

  return {
    mode,
    durationSec: safeDuration,
    estimatedKeyframes,
    chunkCount,
    estimatedLocalSeconds,
    cloudProviderSelected: useCloudAi,
    estimatedCloudTokens,
    estimatedCostRangeUsd,
    requiresExplicitConsent: useCloudAi,
    notes,
  };
}
