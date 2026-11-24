import { EpistemicLayer, EPISTEMIC_LAYERS, LayerRecord, MomentCategory } from './types';

export interface LayerValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  suggestedLayer?: EpistemicLayer;
}

const SPECULATIVE_EVIDENCE_PATTERNS: Array<{ pattern: RegExp; reason: string; suggestedLayer: EpistemicLayer }> = [
  {
    pattern: /\b(ghost|spirit|supernatural|paranormal|haunted|telepath|psychic|portal|divine intervention|miracle|orb entity)\b/i,
    reason: 'Supernatural or symbolic framing cannot be stored in Layer E (Evidence). Use Layer S (Symbolism) or Layer F (Fiction).',
    suggestedLayer: 'S',
  },
  {
    pattern: /\b(definitely lied|secretly intended|hidden motive|mentally ill|diagnosed with|psychosis|delusional|narcissist)\b/i,
    reason: 'Mental-state diagnoses and unobservable hidden intentions are prohibited in Layer E (Evidence) per Governance §16.',
    suggestedLayer: 'A',
  },
  {
    pattern: /\b(i remember|reminds me of|back when we|my childhood|symbolizes|archetype|metaphor for)\b/i,
    reason: 'Personal memories and symbolic associations belong in Layer R (Recollection) or Layer S (Symbolism), not Layer E.',
    suggestedLayer: 'R',
  },
];

export const ORDINARY_TECHNICAL_EXPLANATIONS: Record<string, string[]> = {
  flicker: [
    'Auto-exposure hunting or shutter speed beat against artificial lighting (50/60Hz AC flicker)',
    'Variable frame rate drop or inter-frame codec bitrate dip',
    'Sensor gain adjustment during rapid luminance transition',
  ],
  reflection: [
    'Internal lens element flare or off-axis light source reflection',
    'Glass/window reflection or specular highlight on airborne dust particle',
    'Infrared or low-light sensor blooming',
  ],
  compression: [
    'Keyframe (I-frame) interval macroblocking or motion-vector smear',
    'Bitrate starvation during high-motion scene transition',
    'Chroma subsampling artifact on saturated edges',
  ],
  audio: [
    'Microphone gain auto-leveling, wind buffeting, or handling contact noise',
    'RF interference, ground-loop hum, or acoustic clipping at peak SPL',
    'Audio codec frame boundary drop or sample-rate clock drift',
  ],
  default: [
    'Lighting variation or automatic camera exposure/white-balance adjustment',
    'Video compression artifact, motion blur, or rolling-shutter distortion',
    'Optical reflection, lens dust, or recording hardware transient',
  ],
};

export function buildOrdinaryExplanations(signalHint: string): string[] {
  const lower = signalHint.toLowerCase();
  if (lower.includes('flicker') || lower.includes('exposure') || lower.includes('luminance')) {
    return ORDINARY_TECHNICAL_EXPLANATIONS.flicker;
  }
  if (lower.includes('reflect') || lower.includes('orb') || lower.includes('light') || lower.includes('flare')) {
    return ORDINARY_TECHNICAL_EXPLANATIONS.reflection;
  }
  if (lower.includes('compress') || lower.includes('block') || lower.includes('blur') || lower.includes('artifact')) {
    return ORDINARY_TECHNICAL_EXPLANATIONS.compression;
  }
  if (lower.includes('audio') || lower.includes('clip') || lower.includes('hum') || lower.includes('noise') || lower.includes('rms')) {
    return ORDINARY_TECHNICAL_EXPLANATIONS.audio;
  }
  return ORDINARY_TECHNICAL_EXPLANATIONS.default;
}

/**
 * Validates that a record obeys AAI §8 Evidence & Interpretation Architecture
 * and §16 Governance constraints.
 */
export function validateLayerRecordInput(input: {
  layer: EpistemicLayer;
  title: string;
  content: string;
  sourceReference: string;
  startSec?: number | null;
  classification?: MomentCategory;
  ordinaryExplanations?: string[];
}): LayerValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  let suggestedLayer: EpistemicLayer | undefined;

  if (!EPISTEMIC_LAYERS[input.layer]) {
    errors.push(`Unknown epistemic layer "${String(input.layer)}". Must be E, R, A, S, or F.`);
  }

  if (!input.title.trim()) {
    errors.push('Record title is required.');
  }

  if (!input.content.trim() || input.content.trim().length < 8) {
    errors.push('Observation or entry content must be at least 8 characters.');
  }

  if (!input.sourceReference.trim()) {
    errors.push('Every entry must preserve an explicit source reference (Principle #2).');
  }

  if (input.layer === 'E') {
    for (const rule of SPECULATIVE_EVIDENCE_PATTERNS) {
      if (rule.pattern.test(input.content) || rule.pattern.test(input.title)) {
        errors.push(rule.reason);
        suggestedLayer = rule.suggestedLayer;
      }
    }
    if (input.startSec === null || input.startSec === undefined || input.startSec < 0) {
      warnings.push('Layer E observations should anchor to a specific non-negative source timestamp when referencing time-based media.');
    }
  }

  if (input.layer === 'S' && /\b(proves|confirmed fact|scientifically verified|undeniable evidence)\b/i.test(input.content)) {
    warnings.push('Layer S (Symbolism) records personal or archetypal meaning and should avoid framing symbolic meaning as verified physical proof.');
  }

  if (
    input.classification === 'technical_irregularity' &&
    (!input.ordinaryExplanations || input.ordinaryExplanations.length === 0)
  ) {
    warnings.push('Technical irregularities must include ordinary technical explanations (lighting, compression, reflections, motion blur, or recording artefacts).');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    suggestedLayer,
  };
}

/**
 * Guard against silent migration of information between layers (§8).
 * Any cross-layer transition requires creating a new explicit record in the target layer
 * referencing the original record, never silently mutating the original's layer code.
 */
export function assertNoSilentLayerMigration(
  existing: Pick<LayerRecord, 'id' | 'layer'>,
  attemptedLayer: EpistemicLayer
): { allowed: boolean; reason: string } {
  if (existing.layer !== attemptedLayer) {
    return {
      allowed: false,
      reason: `Silent migration from Layer ${existing.layer} to Layer ${attemptedLayer} is prohibited by AAI Principle §8. Create a linked record in Layer ${attemptedLayer} referencing "${existing.id}" instead.`,
    };
  }
  return { allowed: true, reason: 'Layer unchanged.' };
}

export function formatTimestamp(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds < 0) {
    return '00:00.0';
  }
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  const secStr = secs.toFixed(1).padStart(4, '0');
  if (hrs > 0) {
    return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${secStr}`;
  }
  return `${String(mins).padStart(2, '0')}:${secStr}`;
}
