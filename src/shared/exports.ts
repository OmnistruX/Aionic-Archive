import {
  Asset,
  DetectedEvent,
  EPISTEMIC_LAYERS,
  LayerRecord,
  MOMENT_CATEGORIES,
  ModelRun,
  TranscriptSegment,
} from './types';
import { formatTimestamp } from './layers';

function pad2(n: number): string {
  return String(Math.floor(n)).padStart(2, '0');
}

function pad3(n: number): string {
  return String(Math.floor(n)).padStart(3, '0');
}

export function formatSrtTime(sec: number): string {
  const safe = Math.max(0, sec);
  const hrs = Math.floor(safe / 3600);
  const mins = Math.floor((safe % 3600) / 60);
  const secs = Math.floor(safe % 60);
  const ms = Math.round((safe - Math.floor(safe)) * 1000);
  return `${pad2(hrs)}:${pad2(mins)}:${pad2(secs)},${pad3(Math.min(999, ms))}`;
}

export function formatVttTime(sec: number): string {
  return formatSrtTime(sec).replace(',', '.');
}

function escapeCsvCell(value: string | number | null | undefined): string {
  const str = value === null || value === undefined ? '' : String(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function exportJsonEvidencePackage(params: {
  asset: Asset;
  events: DetectedEvent[];
  layers: LayerRecord[];
  transcripts: TranscriptSegment[];
  modelRuns: ModelRun[];
}): string {
  const payload = {
    schemaVersion: 'aai.evidence-package.v1',
    exportedAt: new Date().toISOString(),
    governanceNotice:
      'Layer E (Evidence) is strictly separated from Layer A (Analysis), Layer R (Recollection), Layer S (Symbolism), and Layer F (Fiction). Relevance scores represent prioritisation estimates, not verified proof.',
    sourceAsset: {
      id: params.asset.id,
      originalFilename: params.asset.originalFilename,
      dataOrigin: params.asset.dataOrigin,
      sha256Hash: params.asset.sha256Hash,
      durationSec: params.asset.durationSec,
      resolution: params.asset.width && params.asset.height ? `${params.asset.width}x${params.asset.height}` : null,
      frameRate: params.asset.frameRate,
      importDate: params.asset.importDate,
      creationDate: params.asset.creationDate,
      creationDateStatus: params.asset.creationDateStatus,
      provenanceNote: params.asset.provenanceNote,
    },
    modelProvenance: params.modelRuns.map((run) => ({
      runId: run.id,
      providerId: run.providerId,
      modelName: run.modelName,
      modality: run.modality,
      status: run.status,
      executedAt: run.createdAt,
      config: run.configJson,
    })),
    significantMoments: params.events.map((e) => ({
      eventId: e.id,
      sourceAssetId: e.assetId,
      startSec: e.startSec,
      endSec: e.endSec,
      classification: e.classification,
      reviewStatus: e.reviewStatus,
      estimatedRelevanceScore: e.estimatedRelevanceScore,
      scoreInterpretationNote: 'Prioritisation estimate only; not proof of event occurrence as interpreted.',
      confidenceScore: e.confidenceScore,
      uncertaintyNote: e.uncertaintyNote,
      detectionMethod: e.detectionMethod,
      providerId: e.providerId,
      modelName: e.modelName,
      layerE_observableDescription: e.observableDescription,
      layerA_analyticalSummary: e.analyticalSummary,
      reasonForSelection: e.reasonForSelection,
      ordinaryExplanations: e.ordinaryExplanations,
      relevantTranscript: e.relevantTranscript,
      userAnnotations: e.userAnnotations,
    })),
    epistemicLayers: {
      E_evidence: params.layers.filter((l) => l.layer === 'E'),
      A_analysis: params.layers.filter((l) => l.layer === 'A'),
      R_recollection: params.layers.filter((l) => l.layer === 'R'),
      S_symbolism: params.layers.filter((l) => l.layer === 'S'),
      F_fiction: params.layers.filter((l) => l.layer === 'F'),
    },
    transcriptSegments: params.transcripts,
  };

  return JSON.stringify(payload, null, 2);
}

export function exportCsvEventRegister(asset: Asset, events: DetectedEvent[]): string {
  const headers = [
    'event_id',
    'source_asset_id',
    'source_filename',
    'source_sha256',
    'data_origin',
    'start_timestamp',
    'end_timestamp',
    'classification',
    'review_status',
    'estimated_relevance_score_prioritisation_only',
    'confidence_score',
    'detection_method',
    'provider_id',
    'model_name',
    'layer_e_observable_evidence',
    'layer_a_analysis',
    'reason_for_selection',
    'ordinary_explanations',
    'user_annotations',
  ];

  const rows = events.map((e) =>
    [
      e.id,
      e.assetId,
      asset.originalFilename,
      asset.sha256Hash,
      e.dataOrigin,
      formatTimestamp(e.startSec),
      formatTimestamp(e.endSec),
      MOMENT_CATEGORIES[e.classification]?.label ?? e.classification,
      e.reviewStatus,
      e.estimatedRelevanceScore,
      e.confidenceScore ?? '',
      e.detectionMethod,
      e.providerId,
      e.modelName ?? '',
      e.observableDescription,
      e.analyticalSummary,
      e.reasonForSelection,
      e.ordinaryExplanations.join(' | '),
      e.userAnnotations,
    ]
      .map(escapeCsvCell)
      .join(',')
  );

  return [headers.join(','), ...rows].join('\n');
}

export function exportSubtitlesSrt(transcripts: TranscriptSegment[]): string {
  if (transcripts.length === 0) {
    return '1\n00:00:00,000 --> 00:00:02,000\n[No speech transcript segments available for this asset]\n';
  }
  return transcripts
    .map((seg, idx) => {
      const prefix = seg.speakerLabel ? `[${seg.speakerLabel}] ` : '';
      return `${idx + 1}\n${formatSrtTime(seg.startSec)} --> ${formatSrtTime(seg.endSec)}\n${prefix}${seg.text.trim()}\n`;
    })
    .join('\n');
}

export function exportSubtitlesVtt(transcripts: TranscriptSegment[]): string {
  const header = 'WEBVTT\n\n';
  if (transcripts.length === 0) {
    return `${header}00:00:00.000 --> 00:00:02.000\n[No speech transcript segments available for this asset]\n`;
  }
  const body = transcripts
    .map((seg) => {
      const prefix = seg.speakerLabel ? `<v ${seg.speakerLabel}>` : '';
      return `${formatVttTime(seg.startSec)} --> ${formatVttTime(seg.endSec)}\n${prefix}${seg.text.trim()}\n`;
    })
    .join('\n');
  return header + body;
}

export function exportMarkdownReport(params: {
  asset: Asset;
  events: DetectedEvent[];
  layers: LayerRecord[];
  transcripts: TranscriptSegment[];
}): string {
  const { asset, events, layers, transcripts } = params;
  const lines: string[] = [
    `# Aionic Archive Intelligence — Evidence-Linked Analysis Report`,
    '',
    `## Source Provenance`,
    `- **Asset ID:** \`${asset.id}\``,
    `- **Filename:** ${asset.originalFilename}`,
    `- **Data Origin:** ${asset.dataOrigin === 'real_upload' ? 'User-uploaded source media' : 'Built-in FFmpeg verification MP4 fixture'}`,
    `- **SHA-256 Hash:** \`${asset.sha256Hash}\``,
    `- **Duration:** ${formatTimestamp(asset.durationSec)}`,
    `- **Creation Date:** ${asset.creationDate ?? 'Unknown'} (${asset.creationDateStatus})`,
    '',
    `> **Epistemic Integrity Notice:** Direct observable evidence (Layer E) is strictly separated from machine/human analysis (Layer A), personal recollection (Layer R), symbolism (Layer S), and fiction (Layer F). Relevance scores are prioritisation estimates, not proof.`,
    '',
    `## Ranked Significant Moments (${events.length})`,
    '',
  ];

  for (const e of events) {
    lines.push(
      `### [${formatTimestamp(e.startSec)} – ${formatTimestamp(e.endSec)}] ${MOMENT_CATEGORIES[e.classification]?.label ?? e.classification}`,
      `- **Event ID:** \`${e.id}\` | **Review Status:** ${e.reviewStatus} | **Prioritisation Estimate:** ${e.estimatedRelevanceScore}/100 | **Method:** ${e.detectionMethod} (${e.providerId})`,
      `- **Layer E (Observable Evidence):** ${e.observableDescription}`,
      `- **Layer A (Analysis & Selection Reason):** ${e.analyticalSummary} — *Flagged because:* ${e.reasonForSelection}`
    );
    if (e.ordinaryExplanations.length > 0) {
      lines.push(`- **Ordinary Technical Explanations:** ${e.ordinaryExplanations.join('; ')}`);
    }
    if (e.userAnnotations.trim()) {
      lines.push(`- **Reviewer Annotation:** ${e.userAnnotations.trim()}`);
    }
    lines.push('');
  }

  const orderedLayers: Array<'E' | 'A' | 'R' | 'S' | 'F'> = ['E', 'A', 'R', 'S', 'F'];
  lines.push(`## Structured Epistemic Layers`, '');
  for (const code of orderedLayers) {
    const matching = layers.filter((l) => l.layer === code);
    lines.push(`### ${EPISTEMIC_LAYERS[code].name} (${matching.length})`);
    if (matching.length === 0) {
      lines.push(`_No entries recorded in this layer._`, '');
      continue;
    }
    for (const item of matching) {
      const ts = item.startSec !== null ? ` [${formatTimestamp(item.startSec)}]` : '';
      lines.push(`- **${item.title}**${ts}: ${item.content} _(Source: ${item.sourceReference}; Author: ${item.authorName})_`);
    }
    lines.push('');
  }

  lines.push(`## Timestamped Transcript (${transcripts.length} segments)`, '');
  if (transcripts.length === 0) {
    lines.push('_No transcript segments available._');
  } else {
    for (const seg of transcripts) {
      lines.push(`- \`[${formatTimestamp(seg.startSec)} – ${formatTimestamp(seg.endSec)}]\` ${seg.text}`);
    }
  }

  return lines.join('\n');
}
