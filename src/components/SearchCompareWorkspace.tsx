import React, { useEffect, useState } from 'react';
import { ExternalLink, Search } from 'lucide-react';
import {
  ALL_MOMENT_CATEGORIES,
  Asset,
  EPISTEMIC_LAYERS,
  EpistemicLayer,
  HybridSearchResult,
  MOMENT_CATEGORIES,
  MomentCategory,
  ReviewStatus,
} from '../shared/types';
import { formatTimestamp } from '../shared/layers';
import { runHybridSearch } from '../lib/api';

interface SearchCompareWorkspaceProps {
  assets: Asset[];
  onJumpToAssetTimestamp: (assetId: string, seconds: number) => void;
}

const EXAMPLE_QUERIES = [
  'flicker',
  'scene boundary',
  'audio silence',
  'calibration',
  'threshold motif',
];

export const SearchCompareWorkspace: React.FC<SearchCompareWorkspaceProps> = ({
  assets,
  onJumpToAssetTimestamp,
}) => {
  const [queryText, setQueryText] = useState('');
  const [layer, setLayer] = useState<EpistemicLayer | 'all'>('all');
  const [category, setCategory] = useState<MomentCategory | 'all'>('all');
  const [reviewStatus, setReviewStatus] = useState<ReviewStatus | 'all'>('all');
  const [results, setResults] = useState<HybridSearchResult[]>([]);
  const [loading, setLoading] = useState(false);

  const [compareLeftId, setCompareLeftId] = useState<string>(assets[0]?.id ?? '');
  const [compareRightId, setCompareRightId] = useState<string>(assets[1]?.id ?? assets[0]?.id ?? '');

  const executeSearch = async (overrideQuery?: string) => {
    setLoading(true);
    try {
      const q = overrideQuery !== undefined ? overrideQuery : queryText;
      const res = await runHybridSearch({
        query: q,
        layer,
        category,
        reviewStatus,
      });
      setResults(res.results);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    executeSearch();
  }, [layer, category, reviewStatus]);

  const leftAsset = assets.find((a) => a.id === compareLeftId) ?? assets[0];
  const rightAsset = assets.find((a) => a.id === compareRightId) ?? assets[1] ?? assets[0];

  return (
    <div className="space-y-6">
      <div className="pb-4 border-b border-[#1F2538]">
        <h1 className="text-xl font-semibold text-slate-50">
          Hybrid Archive Search & Comparison
        </h1>
        <p className="text-xs text-slate-400 mt-1">
          Searches across transcripts, visual observations, epistemic layers (E/A/R/S/F), and semantic domain synonyms with timestamped source citations.
        </p>
      </div>

      {/* Search Bar & Filters */}
      <section className="rounded-xl bg-[#111521] border border-[#22283C] p-5 space-y-4">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            executeSearch();
          }}
          className="flex flex-col sm:flex-row gap-3"
        >
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="search"
              aria-label="Search archive observations, transcripts, and events"
              value={queryText}
              onChange={(e) => setQueryText(e.target.value)}
              placeholder="Search keywords, visual irregularities, audio shifts, or layer notes…"
              className="w-full pl-9 pr-3 py-2.5 text-xs rounded-lg bg-[#0B0E17] border border-[#242B42] text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-violet-400"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="px-5 py-2.5 text-xs font-medium rounded-lg bg-violet-600 hover:bg-violet-500 text-white whitespace-nowrap shrink-0 disabled:opacity-50"
          >
            {loading ? 'Searching…' : 'Search Archive'}
          </button>
        </form>

        <div className="flex flex-wrap items-center gap-3 text-xs">
          <select
            aria-label="Filter by epistemic layer"
            value={layer}
            onChange={(e) => setLayer(e.target.value as EpistemicLayer | 'all')}
            className="px-3 py-2 rounded-lg bg-[#0B0E17] border border-[#242B42] text-slate-200"
          >
            <option value="all">All Layers (E/A/R/S/F)</option>
            {(['E', 'A', 'R', 'S', 'F'] as EpistemicLayer[]).map((l) => (
              <option key={l} value={l}>
                {EPISTEMIC_LAYERS[l].name}
              </option>
            ))}
          </select>

          <select
            aria-label="Filter by moment classification"
            value={category}
            onChange={(e) => setCategory(e.target.value as MomentCategory | 'all')}
            className="px-3 py-2 rounded-lg bg-[#0B0E17] border border-[#242B42] text-slate-200"
          >
            <option value="all">All Classifications</option>
            {ALL_MOMENT_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {MOMENT_CATEGORIES[c].label}
              </option>
            ))}
          </select>

          <select
            aria-label="Filter by review status"
            value={reviewStatus}
            onChange={(e) => setReviewStatus(e.target.value as ReviewStatus | 'all')}
            className="px-3 py-2 rounded-lg bg-[#0B0E17] border border-[#242B42] text-slate-200"
          >
            <option value="all">Any Review Status</option>
            <option value="unreviewed">Unreviewed</option>
            <option value="accepted">Accepted</option>
            <option value="bookmarked">Bookmarked</option>
            <option value="rejected">Rejected</option>
            <option value="false_positive">False positive</option>
          </select>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
          <span>Try query:</span>
          {EXAMPLE_QUERIES.map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => {
                setQueryText(q);
                executeSearch(q);
              }}
              className="text-cyan-300 hover:text-cyan-200 underline underline-offset-2 whitespace-nowrap"
            >
              {q}
            </button>
          ))}
        </div>
      </section>

      {/* Search Results Table */}
      <section className="rounded-xl bg-[#111521] border border-[#22283C] overflow-hidden">
        <div className="px-5 py-3.5 border-b border-[#1F2538] flex items-center justify-between text-xs">
          <h2 className="font-semibold text-slate-100">Retrieved Source-Linked Hits</h2>
          <span className="font-mono tabular-nums text-slate-400">
            {results.length} result{results.length === 1 ? '' : 's'}
          </span>
        </div>

        {results.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-400">
            No matching archive entries found for the current query and filter criteria.
          </div>
        ) : (
          <div className="divide-y divide-[#1D2335]">
            {results.map((hit) => (
              <div key={`${hit.resultType}-${hit.id}`} className="p-4 flex items-start gap-4">
                {hit.thumbnailUrl && (
                  <img
                    src={hit.thumbnailUrl}
                    alt={hit.sourceReference}
                    referrerPolicy="no-referrer"
                    className="w-20 h-12 rounded object-cover border border-[#242B42] shrink-0 bg-[#080A12]"
                  />
                )}
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className={`font-mono text-xs font-semibold shrink-0 ${
                          EPISTEMIC_LAYERS[hit.layer].accentClass
                        }`}
                      >
                        [Layer {hit.layer}]
                      </span>
                      <span className="text-sm font-medium text-slate-100 truncate">
                        {hit.title}
                      </span>
                    </div>
                    <span className="font-mono text-xs tabular-nums text-slate-400 shrink-0">
                      Match {hit.matchScore}%
                    </span>
                  </div>
                  <p className="text-xs text-slate-300 leading-relaxed line-clamp-2">
                    {hit.excerpt}
                  </p>
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-[11px] font-mono tabular-nums text-slate-400">
                    <span>
                      {hit.sourceReference} · {hit.resultType.replace('_', ' ')} ·{' '}
                      {hit.dataOrigin === 'real_upload' ? 'Uploaded' : 'Verification Fixture'}
                    </span>
                    {hit.startSec !== null && (
                      <button
                        type="button"
                        onClick={() => onJumpToAssetTimestamp(hit.assetId, hit.startSec!)}
                        className="inline-flex items-center gap-1 text-cyan-300 hover:underline whitespace-nowrap"
                      >
                        <ExternalLink className="w-3 h-3" />
                        Inspect at {formatTimestamp(hit.startSec)}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Side-by-Side Recording Comparison (§9 & §11) */}
      <section className="rounded-xl bg-[#111521] border border-[#22283C] p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-100">Side-by-Side Recording Comparison</h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Compare technical codecs, checksums, and visual streams across two vault recordings.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[
            { label: 'Recording A', selected: leftAsset, onChange: setCompareLeftId },
            { label: 'Recording B', selected: rightAsset, onChange: setCompareRightId },
          ].map((slot) => (
            <div key={slot.label} className="space-y-3 p-4 rounded-lg bg-[#0B0E17] border border-[#1E2436]">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-slate-300">{slot.label}</span>
                <select
                  aria-label={`Select ${slot.label}`}
                  value={slot.selected?.id ?? ''}
                  onChange={(e) => slot.onChange(e.target.value)}
                  className="px-2.5 py-1.5 text-xs rounded bg-[#111521] border border-[#242B42] text-slate-200 max-w-[240px]"
                >
                  {assets.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.originalFilename}
                    </option>
                  ))}
                </select>
              </div>
              {slot.selected && (
                <>
                  {slot.selected.mediaKind === 'video' && (
                    <video
                      key={slot.selected.id}
                      src={slot.selected.mediaUrl}
                      controls
                      preload="metadata"
                      className="w-full aspect-video rounded bg-black object-contain"
                    />
                  )}
                  <dl className="grid grid-cols-2 gap-2 text-[11px] font-mono tabular-nums text-slate-400">
                    <div>
                      <dt className="text-slate-500 font-sans">Duration</dt>
                      <dd className="text-slate-200">{formatTimestamp(slot.selected.durationSec)}</dd>
                    </div>
                    <div>
                      <dt className="text-slate-500 font-sans">Resolution</dt>
                      <dd className="text-slate-200">
                        {slot.selected.width ? `${slot.selected.width}x${slot.selected.height}` : 'n/a'}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-slate-500 font-sans">Codec</dt>
                      <dd className="text-slate-200">
                        {slot.selected.videoCodec ?? '-'} / {slot.selected.audioCodec ?? '-'}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-slate-500 font-sans">SHA-256</dt>
                      <dd className="text-slate-200 truncate">{slot.selected.sha256Hash.slice(0, 14)}</dd>
                    </div>
                  </dl>
                </>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
};
