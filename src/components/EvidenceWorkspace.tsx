import React, { useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, ExternalLink, Plus, ShieldAlert } from 'lucide-react';
import {
  Asset,
  DetectedEvent,
  EPISTEMIC_LAYERS,
  EpistemicLayer,
  LayerRecord,
  RevisionEntry,
} from '../shared/types';
import { formatTimestamp } from '../shared/layers';
import { createLayerRecord } from '../lib/api';

interface EvidenceWorkspaceProps {
  asset: Asset;
  layers: LayerRecord[];
  events: DetectedEvent[];
  revisions: RevisionEntry[];
  onJumpToTimestamp: (seconds: number) => void;
  onWorkspaceMutated: () => Promise<void>;
}

const ORDERED_LAYERS: EpistemicLayer[] = ['E', 'A', 'R', 'S', 'F'];

export const EvidenceWorkspace: React.FC<EvidenceWorkspaceProps> = ({
  asset,
  layers,
  events,
  revisions,
  onJumpToTimestamp,
  onWorkspaceMutated,
}) => {
  const [activeLayerFilter, setActiveLayerFilter] = useState<EpistemicLayer | 'ALL'>('ALL');
  const [formLayer, setFormLayer] = useState<EpistemicLayer>('R');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [startSec, setStartSec] = useState('0');
  const [linkedEventId, setLinkedEventId] = useState('');
  const [authorName, setAuthorName] = useState('Archive Owner');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const countsByLayer = useMemo(() => {
    const map: Record<EpistemicLayer, number> = { E: 0, A: 0, R: 0, S: 0, F: 0 };
    for (const r of layers) {
      map[r.layer] = (map[r.layer] ?? 0) + 1;
    }
    return map;
  }, [layers]);

  const visibleLayers = useMemo(() => {
    if (activeLayerFilter === 'ALL') return layers;
    return layers.filter((r) => r.layer === activeLayerFilter);
  }, [layers, activeLayerFilter]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setErrorMsg(null);
    setWarnings([]);
    setSuccessMsg(null);

    const parsedSec = startSec.trim() === '' ? null : Number(startSec);
    const sourceReference = `${asset.originalFilename} @ ${
      parsedSec !== null && Number.isFinite(parsedSec) ? formatTimestamp(parsedSec) : 'Full Asset'
    }`;

    try {
      const res = await createLayerRecord({
        assetId: asset.id,
        eventId: linkedEventId || null,
        layer: formLayer,
        title,
        content,
        sourceReference,
        startSec: parsedSec,
        authorName,
      });
      setTitle('');
      setContent('');
      setWarnings(res.warnings);
      setSuccessMsg(`Recorded new ${EPISTEMIC_LAYERS[formLayer].name} entry (${res.record.id}) with source reference.`);
      await onWorkspaceMutated();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to save layer record.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="pb-4 border-b border-[#1F2538]">
        <h1 className="text-xl font-semibold text-slate-50">
          Evidence & Interpretation Architecture (Layers E · A · R · S · F)
        </h1>
        <p className="text-xs text-slate-400 mt-1 max-w-3xl leading-relaxed">
          Observable source facts (Layer E) remain strictly segregated from machine/human analysis (Layer A), personal recollection (Layer R), symbolic association (Layer S), and creative adaptation (Layer F). Information never silently migrates between layers.
        </p>
      </div>

      {/* Interactive Layer Filter Tabs */}
      <div className="flex flex-wrap items-center gap-1.5 p-1 rounded-lg bg-[#111521] border border-[#22283C] w-fit">
        <button
          type="button"
          onClick={() => setActiveLayerFilter('ALL')}
          className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
            activeLayerFilter === 'ALL'
              ? 'bg-[#1F263D] text-white'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          All Layers ({layers.length})
        </button>
        {ORDERED_LAYERS.map((code) => (
          <button
            key={code}
            type="button"
            onClick={() => setActiveLayerFilter(code)}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
              activeLayerFilter === code
                ? 'bg-[#1F263D] text-white'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {code}: {EPISTEMIC_LAYERS[code].shortLabel} ({countsByLayer[code]})
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* Left 7 cols: Segregated Layer Entries */}
        <div className="xl:col-span-7 space-y-4">
          {activeLayerFilter !== 'ALL' && (
            <div className="p-4 rounded-xl bg-[#111521] border border-[#22283C] text-xs space-y-1">
              <div className={`font-semibold ${EPISTEMIC_LAYERS[activeLayerFilter].accentClass}`}>
                {EPISTEMIC_LAYERS[activeLayerFilter].name}
              </div>
              <p className="text-slate-300 leading-relaxed">
                {EPISTEMIC_LAYERS[activeLayerFilter].definition}
              </p>
              <p className="text-slate-500">
                Governance rule: {EPISTEMIC_LAYERS[activeLayerFilter].provenanceRule}
              </p>
            </div>
          )}

          <div className="rounded-xl bg-[#111521] border border-[#22283C] divide-y divide-[#1D2335]">
            {visibleLayers.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-400">
                No records exist in this epistemic layer for {asset.originalFilename} yet.
              </div>
            ) : (
              visibleLayers.map((rec) => {
                const meta = EPISTEMIC_LAYERS[rec.layer];
                return (
                  <article key={rec.id} className="p-4 space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className={`font-mono text-xs font-semibold ${meta.accentClass} shrink-0`}>
                          [{rec.layer} · {meta.shortLabel}]
                        </span>
                        <h3 className="text-sm font-medium text-slate-100 truncate">{rec.title}</h3>
                      </div>
                      {rec.startSec !== null && (
                        <button
                          type="button"
                          onClick={() => onJumpToTimestamp(rec.startSec!)}
                          className="inline-flex items-center gap-1 font-mono text-xs tabular-nums text-cyan-300 hover:underline shrink-0"
                        >
                          <ExternalLink className="w-3 h-3" />
                          {formatTimestamp(rec.startSec)}
                        </button>
                      )}
                    </div>

                    <p className="text-xs text-slate-200 leading-relaxed">{rec.content}</p>

                    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-slate-400 font-mono tabular-nums pt-0.5">
                      <span>Source: {rec.sourceReference}</span>
                      <span aria-hidden="true">·</span>
                      <span>Author: {rec.authorName}</span>
                      {rec.modelName && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span>Model: {rec.modelName}</span>
                        </>
                      )}
                      {rec.confidence !== null && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span>Conf {(rec.confidence * 100).toFixed(0)}%</span>
                        </>
                      )}
                    </div>

                    {rec.uncertaintyDisclosure && (
                      <p className="text-[11px] text-slate-500 italic">{rec.uncertaintyDisclosure}</p>
                    )}
                  </article>
                );
              })
            )}
          </div>
        </div>

        {/* Right 5 cols: Add Structured Layer Entry Form + Revision History */}
        <div className="xl:col-span-5 space-y-5">
          <section className="rounded-xl bg-[#111521] border border-[#22283C] p-5 space-y-4">
            <div>
              <h2 className="text-sm font-semibold text-slate-100">
                Record Epistemic Layer Entry
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Server-side guardrails block speculative, diagnostic, or supernatural claims from entering Layer E.
              </p>
            </div>

            {errorMsg && (
              <div
                role="alert"
                className="flex items-start gap-2 p-3 rounded-lg bg-[#1F131A] border border-rose-500/40 text-xs text-rose-200"
              >
                <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                <span>{errorMsg}</span>
              </div>
            )}

            {warnings.length > 0 && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-[#1B1710] border border-amber-500/40 text-xs text-amber-200">
                <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <span>{warnings.join(' ')}</span>
              </div>
            )}

            {successMsg && (
              <div
                role="status"
                className="flex items-start gap-2 p-3 rounded-lg bg-[#131A26] border border-cyan-500/40 text-xs text-cyan-100"
              >
                <CheckCircle2 className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
                <span>{successMsg}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-3 text-xs">
              <div className="space-y-1">
                <label htmlFor="layer-select" className="text-slate-400 block">
                  Target Epistemic Layer
                </label>
                <select
                  id="layer-select"
                  value={formLayer}
                  onChange={(e) => setFormLayer(e.target.value as EpistemicLayer)}
                  className="w-full px-3 py-2 rounded-md bg-[#0B0E17] border border-[#242B42] text-slate-100"
                >
                  {ORDERED_LAYERS.map((code) => (
                    <option key={code} value={code}>
                      {EPISTEMIC_LAYERS[code].name}
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-slate-500 leading-snug pt-0.5">
                  {EPISTEMIC_LAYERS[formLayer].provenanceRule}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <label className="space-y-1 block">
                  <span className="text-slate-400 block">Timestamp (sec)</span>
                  <input
                    type="number"
                    step="0.1"
                    min={0}
                    max={Math.max(1, asset.durationSec)}
                    value={startSec}
                    onChange={(e) => setStartSec(e.target.value)}
                    className="w-full px-2.5 py-2 rounded-md bg-[#0B0E17] border border-[#242B42] font-mono tabular-nums text-slate-100"
                  />
                </label>

                <label className="space-y-1 block">
                  <span className="text-slate-400 block">Author Attribution</span>
                  <input
                    type="text"
                    value={authorName}
                    onChange={(e) => setAuthorName(e.target.value)}
                    className="w-full px-2.5 py-2 rounded-md bg-[#0B0E17] border border-[#242B42] text-slate-100"
                  />
                </label>
              </div>

              <label className="space-y-1 block">
                <span className="text-slate-400 block">Linked Significant Moment (Optional)</span>
                <select
                  value={linkedEventId}
                  onChange={(e) => setLinkedEventId(e.target.value)}
                  className="w-full px-2.5 py-2 rounded-md bg-[#0B0E17] border border-[#242B42] text-slate-100"
                >
                  <option value="">None — link directly to asset timestamp</option>
                  {events.map((evt) => (
                    <option key={evt.id} value={evt.id}>
                      [{formatTimestamp(evt.startSec)}] {evt.classification.replace(/_/g, ' ')} ({evt.id})
                    </option>
                  ))}
                </select>
              </label>

              <label className="space-y-1 block">
                <span className="text-slate-400 block">Entry Title</span>
                <input
                  type="text"
                  required
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Concise heading for this observation or recollection"
                  className="w-full px-2.5 py-2 rounded-md bg-[#0B0E17] border border-[#242B42] text-slate-100 placeholder:text-slate-600"
                />
              </label>

              <label className="space-y-1 block">
                <span className="text-slate-400 block">Structured Content</span>
                <textarea
                  rows={4}
                  required
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder="Describe observable detail, personal memory, symbolic motif, or creative adaptation…"
                  className="w-full px-2.5 py-2 rounded-md bg-[#0B0E17] border border-[#242B42] text-slate-100 placeholder:text-slate-600"
                />
              </label>

              <button
                type="submit"
                disabled={submitting}
                className="w-full inline-flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg bg-violet-600 hover:bg-violet-500 text-white font-medium transition-colors disabled:opacity-50"
              >
                <Plus className="w-3.5 h-3.5" />
                {submitting ? 'Validating & Saving…' : `Append to Layer ${formLayer}`}
              </button>
            </form>
          </section>

          {/* Revision History */}
          <section className="rounded-xl bg-[#111521] border border-[#22283C] p-5 space-y-3">
            <h2 className="text-sm font-semibold text-slate-100">
              Revision History (Principle #5)
            </h2>
            {revisions.length === 0 ? (
              <p className="text-xs text-slate-400">No review or ranking revisions recorded yet.</p>
            ) : (
              <div className="divide-y divide-[#1C2234] max-h-64 overflow-y-auto">
                {revisions.slice(0, 12).map((rev) => (
                  <div key={rev.id} className="py-2.5 text-xs space-y-0.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-slate-200 font-medium">
                        {rev.entityType} · {rev.fieldChanged}
                      </span>
                      <span className="font-mono text-[11px] tabular-nums text-slate-500">
                        {new Date(rev.createdAt).toLocaleTimeString()}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-400">{rev.reason}</p>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
};
