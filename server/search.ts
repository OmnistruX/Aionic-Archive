import {
  Asset,
  DetectedEvent,
  HybridSearchQuery,
  HybridSearchResult,
  LayerRecord,
  TranscriptSegment,
} from '../src/shared/types';
import { formatTimestamp } from '../src/shared/layers';

const SEMANTIC_SYNONYM_GROUPS: string[][] = [
  ['flicker', 'flash', 'exposure', 'luminance', 'strobe', 'artifact', 'irregularity', 'glitch'],
  ['transition', 'cut', 'boundary', 'location', 'scene', 'shift', 'change', 'environment'],
  ['sound', 'audio', 'music', 'tone', 'harmonic', 'silence', 'acoustic', 'volume', 'performance'],
  ['documentary', 'footage', 'editorial', 'visual', 'framing', 'shot', 'cinematic'],
  ['memory', 'recollection', 'remember', 'personal', 'note', 'archive'],
  ['symbol', 'symbolic', 'archetype', 'metaphor', 'meaning', 'motif'],
];

function expandQueryTokens(rawQuery: string): { exactTerms: string[]; expandedTerms: string[] } {
  const exactTerms = rawQuery
    .toLowerCase()
    .split(/[^a-z0-9_-]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);

  const expandedSet = new Set<string>(exactTerms);
  for (const term of exactTerms) {
    for (const group of SEMANTIC_SYNONYM_GROUPS) {
      if (group.some((w) => w.includes(term) || term.includes(w))) {
        for (const syn of group) expandedSet.add(syn);
      }
    }
  }

  return {
    exactTerms,
    expandedTerms: Array.from(expandedSet),
  };
}

function scoreTextMatch(
  text: string,
  exactTerms: string[],
  expandedTerms: string[]
): { score: number; matchedTerms: string[] } {
  if (exactTerms.length === 0) {
    return { score: 50, matchedTerms: [] };
  }
  const lower = text.toLowerCase();
  const matched = new Set<string>();
  let score = 0;

  for (const term of exactTerms) {
    if (lower.includes(term)) {
      score += 28;
      matched.add(term);
    }
  }
  for (const syn of expandedTerms) {
    if (!exactTerms.includes(syn) && lower.includes(syn)) {
      score += 11;
      matched.add(syn);
    }
  }

  return {
    score: Math.min(100, score),
    matchedTerms: Array.from(matched),
  };
}

export function executeHybridSearch(params: {
  query: HybridSearchQuery;
  assets: Asset[];
  events: DetectedEvent[];
  layers: LayerRecord[];
  transcripts: TranscriptSegment[];
}): HybridSearchResult[] {
  const { query, assets, events, layers, transcripts } = params;
  const assetMap = new Map(assets.map((a) => [a.id, a]));
  const { exactTerms, expandedTerms } = expandQueryTokens(query.query || '');
  const results: HybridSearchResult[] = [];

  // 1. Search Detected Events (Layer A + Layer E observable text + annotations + tags)
  if (!query.layer || query.layer === 'all' || query.layer === 'A' || query.layer === 'E') {
    for (const evt of events) {
      if (query.assetId && evt.assetId !== query.assetId) continue;
      if (query.category && query.category !== 'all' && evt.classification !== query.category) continue;
      if (query.reviewStatus && query.reviewStatus !== 'all' && evt.reviewStatus !== query.reviewStatus) continue;
      if (query.dataOrigin && query.dataOrigin !== 'all' && evt.dataOrigin !== query.dataOrigin) continue;
      if (query.minConfidence !== undefined && (evt.confidenceScore ?? 0) < query.minConfidence) continue;

      const asset = assetMap.get(evt.assetId);
      if (!asset) continue;

      const haystack = [
        evt.classification.replace(/_/g, ' '),
        evt.observableDescription,
        evt.analyticalSummary,
        evt.reasonForSelection,
        evt.relevantTranscript,
        evt.userAnnotations,
        evt.tags.join(' '),
        evt.ordinaryExplanations.join(' '),
        asset.originalFilename,
      ].join(' ');

      const match = scoreTextMatch(haystack, exactTerms, expandedTerms);
      if (exactTerms.length > 0 && match.score === 0) continue;

      results.push({
        resultType: 'event',
        id: evt.id,
        assetId: evt.assetId,
        assetFilename: asset.originalFilename,
        startSec: evt.startSec,
        endSec: evt.endSec,
        thumbnailUrl: evt.thumbnailUrl,
        layer: 'A',
        classification: evt.classification,
        reviewStatus: evt.reviewStatus,
        title: `${evt.classification.replace(/_/g, ' ')} (${evt.estimatedRelevanceScore}/100 estimate)`,
        excerpt: `${evt.observableDescription} — ${evt.analyticalSummary}`,
        matchScore: match.score,
        matchedTerms: match.matchedTerms,
        sourceReference: `${asset.originalFilename} @ ${formatTimestamp(evt.startSec)}–${formatTimestamp(evt.endSec)}`,
        dataOrigin: evt.dataOrigin,
      });
    }
  }

  // 2. Search Epistemic Layer Records (E / A / R / S / F)
  if (!query.category || query.category === 'all') {
    if (!query.reviewStatus || query.reviewStatus === 'all') {
      for (const rec of layers) {
        if (query.assetId && rec.assetId !== query.assetId) continue;
        if (query.layer && query.layer !== 'all' && rec.layer !== query.layer) continue;
        if (query.minConfidence !== undefined && (rec.confidence ?? 0) < query.minConfidence) continue;

        const asset = assetMap.get(rec.assetId);
        if (!asset) continue;
        if (query.dataOrigin && query.dataOrigin !== 'all' && asset.dataOrigin !== query.dataOrigin) continue;

        const haystack = `${rec.title} ${rec.content} ${rec.sourceReference} ${rec.authorName} ${asset.originalFilename}`;
        const match = scoreTextMatch(haystack, exactTerms, expandedTerms);
        if (exactTerms.length > 0 && match.score === 0) continue;

        results.push({
          resultType: 'layer_record',
          id: rec.id,
          assetId: rec.assetId,
          assetFilename: asset.originalFilename,
          startSec: rec.startSec,
          endSec: rec.endSec,
          thumbnailUrl: null,
          layer: rec.layer,
          classification: null,
          reviewStatus: null,
          title: rec.title,
          excerpt: rec.content,
          matchScore: match.score,
          matchedTerms: match.matchedTerms,
          sourceReference: rec.sourceReference,
          dataOrigin: asset.dataOrigin,
        });
      }
    }
  }

  // 3. Search Transcript Segments (Layer E verbatim speech / notices)
  if (
    (!query.layer || query.layer === 'all' || query.layer === 'E') &&
    (!query.category || query.category === 'all') &&
    (!query.reviewStatus || query.reviewStatus === 'all')
  ) {
    for (const seg of transcripts) {
      if (query.assetId && seg.assetId !== query.assetId) continue;
      if (query.minConfidence !== undefined && (seg.confidence ?? 0) < query.minConfidence) continue;
      const asset = assetMap.get(seg.assetId);
      if (!asset) continue;
      if (query.dataOrigin && query.dataOrigin !== 'all' && asset.dataOrigin !== query.dataOrigin) continue;

      const match = scoreTextMatch(`${seg.text} ${seg.speakerLabel ?? ''}`, exactTerms, expandedTerms);
      if (exactTerms.length > 0 && match.score === 0) continue;

      results.push({
        resultType: 'transcript',
        id: seg.id,
        assetId: seg.assetId,
        assetFilename: asset.originalFilename,
        startSec: seg.startSec,
        endSec: seg.endSec,
        thumbnailUrl: null,
        layer: 'E',
        classification: null,
        reviewStatus: null,
        title: seg.isPlaceholderNotice ? 'Transcript capability disclosure' : `Transcript (${seg.speakerLabel ?? 'Speaker'})`,
        excerpt: seg.text,
        matchScore: match.score,
        matchedTerms: match.matchedTerms,
        sourceReference: `${asset.originalFilename} @ ${formatTimestamp(seg.startSec)}–${formatTimestamp(seg.endSec)}`,
        dataOrigin: asset.dataOrigin,
      });
    }
  }

  return results.sort((a, b) => {
    if (b.matchScore !== a.matchScore) return b.matchScore - a.matchScore;
    return (a.startSec ?? 0) - (b.startSec ?? 0);
  });
}
