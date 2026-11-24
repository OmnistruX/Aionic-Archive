import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Bookmark,
  Check,
  ExternalLink,
  RotateCcw,
  Sliders,
  X,
  AlertTriangle,
} from 'lucide-react';
import {
  ALL_MOMENT_CATEGORIES,
  DetectedEvent,
  MOMENT_CATEGORIES,
  MomentCategory,
  RankingConfig,
  ReviewStatus,
} from '../shared/types';
import { createDefaultRankingConfig } from '../shared/ranking';
import { formatTimestamp } from '../shared/layers';
import {
  applyShiftRangeSelection,
  getSelectionSummary,
  pruneHiddenSelection,
  selectEventsByStatus,
  toggleSelectAllVisible,
  toggleSelectionId,
} from '../shared/selection';
import { bulkReviewEvents, saveRankingConfig, updateEventReview } from '../lib/api';

interface MomentsWorkspaceProps {
  events: DetectedEvent[];
  rankingConfig: RankingConfig;
  selectedEventId: string | null;
  onSelectEventId: (id: string | null) => void;
  onJumpToTimestamp: (seconds: number) => void;
  onWorkspaceMutated: () => Promise<void>;
}

export const MomentsWorkspace: React.FC<MomentsWorkspaceProps> = ({
  events,
  rankingConfig,
  selectedEventId,
  onSelectEventId,
  onJumpToTimestamp,
  onWorkspaceMutated,
}) => {
  const [draftConfig, setDraftConfig] = useState<RankingConfig>(rankingConfig);
  const [showRanker, setShowRanker] = useState(true);
  const [categoryFilter, setCategoryFilter] = useState<MomentCategory | 'all'>('all');
  const [statusFilter, setStatusFilter] = useState<ReviewStatus | 'all'>('all');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [lastAnchorId, setLastAnchorId] = useState<string | null>(null);
  const [savingConfig, setSavingConfig] = useState(false);
  const [savingEvent, setSavingEvent] = useState(false);
  const [feedbackBanner, setFeedbackBanner] = useState<string | null>(null);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const selectAllRef = useRef<HTMLInputElement | null>(null);
  const shiftKeyRef = useRef(false);

  // Sync when server rankingConfig changes
  useEffect(() => {
    setDraftConfig(rankingConfig);
  }, [rankingConfig]);

  const filteredEvents = useMemo(() => {
    return events.filter((e) => {
      if (categoryFilter !== 'all' && e.classification !== categoryFilter) return false;
      if (statusFilter !== 'all' && e.reviewStatus !== statusFilter) return false;
      return true;
    });
  }, [events, categoryFilter, statusFilter]);

  const visibleIds = useMemo(() => filteredEvents.map((e) => e.id), [filteredEvents]);
  const selectionSummary = useMemo(
    () => getSelectionSummary(visibleIds, selectedIds),
    [visibleIds, selectedIds]
  );
  const unreviewedVisibleCount = useMemo(
    () => filteredEvents.filter((e) => e.reviewStatus === 'unreviewed').length,
    [filteredEvents]
  );

  // Keep indeterminate checkbox state synced and prune hidden selections when filters change
  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = selectionSummary.someVisibleSelected;
    }
  }, [selectionSummary.someVisibleSelected]);

  useEffect(() => {
    setSelectedIds((prev) => {
      const pruned = pruneHiddenSelection(visibleIds, prev);
      return pruned.length === prev.length ? prev : pruned;
    });
  }, [visibleIds]);

  const activeEvent =
    filteredEvents.find((e) => e.id === selectedEventId) ??
    events.find((e) => e.id === selectedEventId) ??
    filteredEvents[0] ??
    null;

  const [editStart, setEditStart] = useState<string>('');
  const [editEnd, setEditEnd] = useState<string>('');
  const [editClass, setEditClass] = useState<MomentCategory>('potential_documentary_material');
  const [editAnnotation, setEditAnnotation] = useState<string>('');
  const [editProject, setEditProject] = useState<string>('');

  React.useEffect(() => {
    if (activeEvent) {
      setEditStart(String(activeEvent.startSec));
      setEditEnd(String(activeEvent.endSec));
      setEditClass(activeEvent.classification);
      setEditAnnotation(activeEvent.userAnnotations);
      setEditProject(activeEvent.assignedProject ?? '');
    }
  }, [activeEvent?.id, activeEvent?.updatedAt]);

  const handleApplyRanking = async () => {
    setSavingConfig(true);
    setFeedbackBanner(null);
    try {
      await saveRankingConfig(draftConfig);
      await onWorkspaceMutated();
      setFeedbackBanner('Updated relevance ranking weights and recalculated prioritisation estimates.');
    } finally {
      setSavingConfig(false);
    }
  };

  const handleResetRanking = async () => {
    const def = createDefaultRankingConfig();
    setDraftConfig(def);
    setSavingConfig(true);
    try {
      await saveRankingConfig(def);
      await onWorkspaceMutated();
      setFeedbackBanner('Reset ranking configuration to default archival weights.');
    } finally {
      setSavingConfig(false);
    }
  };

  const handleQuickDecision = async (eventId: string, reviewStatus: ReviewStatus) => {
    setSavingEvent(true);
    setFeedbackBanner(null);
    try {
      await updateEventReview(eventId, { reviewStatus });
      await onWorkspaceMutated();
      setFeedbackBanner(`Marked moment ${eventId} as "${reviewStatus.replace('_', ' ')}". Layer E evidence preserved.`);
    } finally {
      setSavingEvent(false);
    }
  };

  const handleSaveDetails = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeEvent) return;
    setSavingEvent(true);
    setFeedbackBanner(null);
    try {
      await updateEventReview(activeEvent.id, {
        startSec: Number(editStart),
        endSec: Number(editEnd),
        classification: editClass,
        userAnnotations: editAnnotation,
        assignedProject: editProject.trim() || null,
      });
      await onWorkspaceMutated();
      setFeedbackBanner(`Saved boundaries, classification, and annotations for ${activeEvent.id}.`);
    } finally {
      setSavingEvent(false);
    }
  };

  const handleBulkAction = async (status: ReviewStatus) => {
    const targetIds = selectionSummary.visibleSelectedIds;
    if (targetIds.length === 0) return;
    setSavingEvent(true);
    setFeedbackBanner(null);
    setErrorBanner(null);
    try {
      const res = await bulkReviewEvents(targetIds, status);
      setSelectedIds([]);
      setLastAnchorId(null);
      await onWorkspaceMutated();
      const actionVerb =
        status === 'accepted'
          ? 'approved'
          : status === 'rejected'
            ? 'rejected'
            : status === 'bookmarked'
              ? 'bookmarked'
              : 'marked as false positive';
      setFeedbackBanner(
        `Bulk ${actionVerb} ${res.updatedCount} detection${res.updatedCount === 1 ? '' : 's'}. Layer E evidence preserved.`
      );
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Bulk review update failed.');
    } finally {
      setSavingEvent(false);
    }
  };

  const handleToggleRowCheckbox = (id: string, shiftKey: boolean) => {
    setSelectedIds((prev) =>
      shiftKey
        ? applyShiftRangeSelection(visibleIds, prev, lastAnchorId, id)
        : toggleSelectionId(prev, id)
    );
    setLastAnchorId(id);
  };

  const handleToggleSelectAll = () => {
    setSelectedIds((prev) => toggleSelectAllVisible(visibleIds, prev));
    setLastAnchorId(null);
  };

  const handleSelectUnreviewed = () => {
    setSelectedIds(selectEventsByStatus(filteredEvents, 'unreviewed'));
    setLastAnchorId(null);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-[#1F2538]">
        <div>
          <h1 className="text-xl font-semibold text-slate-50">
            Significant Moments & Configurable Ranking
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            AI relevance scores are prioritisation estimates, not proof. Human review feedback calibrates ranking without altering Layer E evidence.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowRanker((v) => !v)}
          className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium rounded-lg bg-[#171C2C] hover:bg-[#20273D] border border-[#28304A] text-slate-200 whitespace-nowrap shrink-0"
        >
          <Sliders className="w-3.5 h-3.5 text-cyan-300" />
          {showRanker ? 'Hide Ranking Controls' : 'Configure Ranking Weights'}
        </button>
      </div>

      {feedbackBanner && (
        <div
          role="status"
          className="px-4 py-2.5 text-xs rounded-lg bg-[#131A26] border border-cyan-500/40 text-cyan-100"
        >
          {feedbackBanner}
        </div>
      )}

      {errorBanner && (
        <div
          role="alert"
          className="flex items-start gap-2 px-4 py-2.5 text-xs rounded-lg bg-[#1F131A] border border-rose-500/40 text-rose-200"
        >
          <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
          <span>{errorBanner}</span>
        </div>
      )}

      {/* Configurable Relevance Ranking Engine Panel */}
      {showRanker && (
        <section className="rounded-xl bg-[#111521] border border-[#22283C] p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-100">
                Configurable Relevance Ranking Engine
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Adjust category multipliers (0.0x – 2.5x), multimodal corroboration boost, and human feedback calibration.
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={handleResetRanking}
                disabled={savingConfig}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md bg-[#191F31] hover:bg-[#222A42] text-slate-300 whitespace-nowrap"
              >
                <RotateCcw className="w-3 h-3" />
                Reset Defaults
              </button>
              <button
                type="button"
                onClick={handleApplyRanking}
                disabled={savingConfig}
                className="px-4 py-1.5 text-xs font-medium rounded-md bg-violet-600 hover:bg-violet-500 text-white whitespace-nowrap disabled:opacity-50"
              >
                {savingConfig ? 'Recalculating…' : 'Apply & Re-rank'}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-5 gap-y-3 pt-1">
            {ALL_MOMENT_CATEGORIES.map((cat) => {
              const weight = draftConfig.categoryWeights[cat] ?? 1.0;
              return (
                <div key={cat} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <label htmlFor={`weight-${cat}`} className="text-slate-300 truncate pr-2">
                      {MOMENT_CATEGORIES[cat].label}
                    </label>
                    <span className="font-mono tabular-nums text-cyan-300 shrink-0">
                      {weight.toFixed(2)}x
                    </span>
                  </div>
                  <input
                    id={`weight-${cat}`}
                    type="range"
                    min={0}
                    max={2.5}
                    step={0.05}
                    value={weight}
                    onChange={(e) =>
                      setDraftConfig((prev) => ({
                        ...prev,
                        categoryWeights: {
                          ...prev.categoryWeights,
                          [cat]: Number(e.target.value),
                        },
                      }))
                    }
                    className="w-full accent-violet-500 h-1.5 bg-[#1E2438] rounded-lg cursor-pointer"
                  />
                </div>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-6 pt-3 border-t border-[#1D2335] text-xs">
            <label className="flex items-center gap-2.5 text-slate-300">
              <span>Min threshold:</span>
              <input
                type="number"
                min={0}
                max={95}
                value={draftConfig.minRelevanceThreshold}
                onChange={(e) =>
                  setDraftConfig((prev) => ({
                    ...prev,
                    minRelevanceThreshold: Number(e.target.value),
                  }))
                }
                className="w-16 px-2 py-1 rounded bg-[#0B0E17] border border-[#242B42] font-mono tabular-nums text-slate-100"
              />
            </label>

            <label className="flex items-center gap-2.5 text-slate-300">
              <span>Corroboration boost:</span>
              <input
                type="number"
                min={0}
                max={20}
                value={draftConfig.modalityCorroborationBoost}
                onChange={(e) =>
                  setDraftConfig((prev) => ({
                    ...prev,
                    modalityCorroborationBoost: Number(e.target.value),
                  }))
                }
                className="w-16 px-2 py-1 rounded bg-[#0B0E17] border border-[#242B42] font-mono tabular-nums text-slate-100"
              />
            </label>

            <label className="inline-flex items-center gap-2 text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={draftConfig.useHumanFeedbackCalibration}
                onChange={(e) =>
                  setDraftConfig((prev) => ({
                    ...prev,
                    useHumanFeedbackCalibration: e.target.checked,
                  }))
                }
                className="accent-violet-500"
              />
              <span>Calibrate with human review history</span>
            </label>

            <label className="inline-flex items-center gap-2 text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={draftConfig.deprioritiseLowInfo}
                onChange={(e) =>
                  setDraftConfig((prev) => ({
                    ...prev,
                    deprioritiseLowInfo: e.target.checked,
                  }))
                }
                className="accent-violet-500"
              />
              <span>Deprioritise low-information footage</span>
            </label>
          </div>
        </section>
      )}

      {/* Filter Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <select
            aria-label="Filter by classification"
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value as MomentCategory | 'all')}
            className="px-3 py-2 text-xs rounded-lg bg-[#111521] border border-[#22283C] text-slate-200"
          >
            <option value="all">All 12 classifications</option>
            {ALL_MOMENT_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {MOMENT_CATEGORIES[c].label}
              </option>
            ))}
          </select>

          <select
            aria-label="Filter by review status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as ReviewStatus | 'all')}
            className="px-3 py-2 text-xs rounded-lg bg-[#111521] border border-[#22283C] text-slate-200"
          >
            <option value="all">All review statuses</option>
            <option value="unreviewed">Unreviewed</option>
            <option value="accepted">Accepted</option>
            <option value="bookmarked">Bookmarked</option>
            <option value="rejected">Rejected</option>
            <option value="false_positive">False positive</option>
          </select>

          <span className="text-xs font-mono tabular-nums text-slate-400">
            Showing {filteredEvents.length} of {events.length}
          </span>
        </div>
      </div>

      {/* Main Split: Ranked Moment Register + Selected Moment Review Workbench */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* Ranked List with Dedicated Bulk Selection Header */}
        <div className="xl:col-span-7 rounded-xl bg-[#111521] border border-[#22283C] overflow-hidden">
          <div
            role="region"
            aria-label="Bulk selection actions"
            className="px-4 py-3 bg-[#0D101B] border-b border-[#1F2538] flex flex-wrap items-center justify-between gap-3"
          >
            <div className="flex flex-wrap items-center gap-3">
              <label className="inline-flex items-center gap-2.5 text-xs text-slate-200 cursor-pointer select-none">
                <input
                  ref={selectAllRef}
                  type="checkbox"
                  aria-label="Select all visible detections"
                  checked={selectionSummary.allVisibleSelected}
                  disabled={filteredEvents.length === 0}
                  onChange={handleToggleSelectAll}
                  className="w-4 h-4 rounded accent-violet-500 cursor-pointer disabled:opacity-40"
                />
                <span className="font-medium whitespace-nowrap">Select all visible</span>
              </label>

              <span className="font-mono text-xs tabular-nums text-slate-400 whitespace-nowrap">
                {selectionSummary.visibleSelectedCount} of {selectionSummary.totalVisible} selected
              </span>

              {unreviewedVisibleCount > 0 && (
                <button
                  type="button"
                  onClick={handleSelectUnreviewed}
                  className="text-xs text-cyan-300 hover:text-cyan-200 underline underline-offset-2 whitespace-nowrap shrink-0"
                >
                  Select unreviewed ({unreviewedVisibleCount})
                </button>
              )}

              {selectionSummary.visibleSelectedCount > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setSelectedIds([]);
                    setLastAnchorId(null);
                  }}
                  className="text-xs text-slate-400 hover:text-slate-200 whitespace-nowrap shrink-0"
                >
                  Clear
                </button>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs">
              <button
                type="button"
                disabled={savingEvent || selectionSummary.visibleSelectedCount === 0}
                onClick={() => handleBulkAction('accepted')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md font-medium bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-200 border border-cyan-500/40 transition-colors whitespace-nowrap shrink-0 disabled:opacity-35 disabled:cursor-not-allowed"
              >
                <Check className="w-3.5 h-3.5" />
                Approve Selected
              </button>
              <button
                type="button"
                disabled={savingEvent || selectionSummary.visibleSelectedCount === 0}
                onClick={() => handleBulkAction('rejected')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md font-medium bg-[#1A2033] hover:bg-[#242C44] text-slate-200 border border-[#2B334D] transition-colors whitespace-nowrap shrink-0 disabled:opacity-35 disabled:cursor-not-allowed"
              >
                <X className="w-3.5 h-3.5" />
                Reject Selected
              </button>
              <button
                type="button"
                disabled={savingEvent || selectionSummary.visibleSelectedCount === 0}
                onClick={() => handleBulkAction('bookmarked')}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-[#171C2C] hover:bg-[#21283F] text-violet-200 border border-violet-500/35 transition-colors whitespace-nowrap shrink-0 disabled:opacity-35 disabled:cursor-not-allowed"
              >
                <Bookmark className="w-3.5 h-3.5" />
                Bookmark
              </button>
              <button
                type="button"
                disabled={savingEvent || selectionSummary.visibleSelectedCount === 0}
                onClick={() => handleBulkAction('false_positive')}
                className="px-2.5 py-1.5 rounded-md bg-rose-500/15 hover:bg-rose-500/25 text-rose-200 border border-rose-500/35 transition-colors whitespace-nowrap shrink-0 disabled:opacity-35 disabled:cursor-not-allowed"
              >
                False Positive
              </button>
            </div>
          </div>

          <div className="divide-y divide-[#1D2335]">
          {filteredEvents.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-400">
              No detected moments match the active filters.
            </div>
          ) : (
            filteredEvents.map((evt, index) => {
              const isSelected = activeEvent?.id === evt.id;
              const isChecked = selectionSummary.visibleSelectedIds.includes(evt.id);
              const belowThreshold = evt.estimatedRelevanceScore < draftConfig.minRelevanceThreshold;
              const categoryLabel = MOMENT_CATEGORIES[evt.classification]?.label ?? evt.classification;
              return (
                <div
                  key={evt.id}
                  className={`p-4 transition-colors ${
                    isChecked
                      ? 'bg-[#161E33]'
                      : isSelected
                        ? 'bg-[#171C2E]'
                        : 'hover:bg-[#141826]'
                  } ${belowThreshold ? 'opacity-65' : ''}`}
                >
                  <div className="flex items-start gap-3">
                    <label className="pt-0.5 pr-0.5 cursor-pointer shrink-0">
                      <input
                        type="checkbox"
                        aria-label={`Select detection ${index + 1}: ${categoryLabel} at ${formatTimestamp(evt.startSec)}`}
                        checked={isChecked}
                        onMouseDown={(e) => {
                          shiftKeyRef.current = e.shiftKey;
                        }}
                        onKeyDown={(e) => {
                          shiftKeyRef.current = e.shiftKey;
                        }}
                        onChange={() => {
                          handleToggleRowCheckbox(evt.id, shiftKeyRef.current);
                          shiftKeyRef.current = false;
                        }}
                        className="w-4 h-4 rounded accent-violet-500 cursor-pointer"
                      />
                    </label>
                    {evt.thumbnailUrl && (
                      <img
                        src={evt.thumbnailUrl}
                        alt={`Preview at ${formatTimestamp(evt.startSec)}`}
                        referrerPolicy="no-referrer"
                        className="w-20 h-12 rounded object-cover border border-[#252C42] shrink-0 bg-[#080A12]"
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <button
                          type="button"
                          onClick={() => onSelectEventId(evt.id)}
                          className="text-left text-sm font-medium text-slate-100 hover:text-cyan-300 transition-colors"
                        >
                          {index + 1}. {categoryLabel}
                        </button>
                        <span className="font-mono text-xs tabular-nums text-cyan-300 shrink-0">
                          {evt.estimatedRelevanceScore}/100 est.
                        </span>
                      </div>

                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-400 mt-1 font-mono tabular-nums">
                        <span>
                          {formatTimestamp(evt.startSec)} – {formatTimestamp(evt.endSec)}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span
                          className={
                            evt.reviewStatus === 'accepted'
                              ? 'text-cyan-300'
                              : evt.reviewStatus === 'rejected'
                                ? 'text-amber-300'
                                : evt.reviewStatus === 'bookmarked'
                                  ? 'text-violet-300'
                                  : evt.reviewStatus === 'false_positive'
                                    ? 'text-rose-400'
                                    : 'text-slate-400'
                          }
                        >
                          {evt.reviewStatus === 'accepted'
                            ? 'approved'
                            : evt.reviewStatus.replace('_', ' ')}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>{evt.providerId}</span>
                        {evt.confidenceScore !== null && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>conf {(evt.confidenceScore * 100).toFixed(0)}%</span>
                          </>
                        )}
                      </div>

                      <p className="text-xs text-slate-300 mt-2 line-clamp-2 leading-relaxed">
                        <span className="text-cyan-300/90 font-medium">Evidence (E): </span>
                        {evt.observableDescription}
                      </p>

                      <div className="flex flex-wrap items-center gap-3 mt-2.5 text-xs">
                        <button
                          type="button"
                          onClick={() => onJumpToTimestamp(evt.startSec)}
                          className="inline-flex items-center gap-1 text-cyan-300 hover:text-cyan-200 whitespace-nowrap"
                        >
                          <ExternalLink className="w-3 h-3" />
                          Jump to {formatTimestamp(evt.startSec)}
                        </button>
                        <button
                          type="button"
                          disabled={savingEvent}
                          onClick={() => handleQuickDecision(evt.id, 'accepted')}
                          className="inline-flex items-center gap-1 text-slate-300 hover:text-white whitespace-nowrap"
                        >
                          <Check className="w-3 h-3 text-cyan-400" />
                          Accept
                        </button>
                        <button
                          type="button"
                          disabled={savingEvent}
                          onClick={() => handleQuickDecision(evt.id, 'bookmarked')}
                          className="inline-flex items-center gap-1 text-slate-300 hover:text-white whitespace-nowrap"
                        >
                          <Bookmark className="w-3 h-3 text-violet-400" />
                          Bookmark
                        </button>
                        <button
                          type="button"
                          disabled={savingEvent}
                          onClick={() => handleQuickDecision(evt.id, 'false_positive')}
                          className="inline-flex items-center gap-1 text-slate-400 hover:text-rose-300 whitespace-nowrap"
                        >
                          <X className="w-3 h-3" />
                          False Positive
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          )}
          </div>
        </div>

        {/* Selected Event Explanation & Boundary Editor */}
        <div className="xl:col-span-5 rounded-xl bg-[#111521] border border-[#22283C] p-5 space-y-5">
          {!activeEvent ? (
            <p className="text-xs text-slate-400">Select a detected moment to inspect evidence, score breakdown, and review controls.</p>
          ) : (
            <>
              <div className="flex items-start justify-between gap-3 pb-3 border-b border-[#1D2335]">
                <div>
                  <h2 className="text-sm font-semibold text-slate-100">
                    Moment Review & Selection Rationale
                  </h2>
                  <p className="text-[11px] font-mono tabular-nums text-slate-400 mt-0.5">
                    {activeEvent.id} · {formatTimestamp(activeEvent.startSec)}–{formatTimestamp(activeEvent.endSec)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onJumpToTimestamp(activeEvent.startSec)}
                  className="px-3 py-1.5 text-xs font-medium rounded-md bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-200 border border-cyan-500/40 whitespace-nowrap shrink-0"
                >
                  Preview Frame
                </button>
              </div>

              {/* Strict Layer E vs Layer A Distinction */}
              <div className="space-y-3 text-xs">
                <div className="p-3.5 rounded-lg bg-[#0B0E17] border border-[#1E2436] space-y-1">
                  <div className="font-medium text-cyan-300">
                    Layer E: Observable Evidence (Immutable Source Finding)
                  </div>
                  <p className="text-slate-200 leading-relaxed">{activeEvent.observableDescription}</p>
                </div>

                <div className="p-3.5 rounded-lg bg-[#0B0E17] border border-[#1E2436] space-y-1.5">
                  <div className="font-medium text-violet-300">
                    Layer A: Analysis & Reason for Selection
                  </div>
                  <p className="text-slate-200 leading-relaxed">{activeEvent.analyticalSummary}</p>
                  <p className="text-slate-400 leading-relaxed">
                    <strong className="text-slate-300">Why flagged:</strong> {activeEvent.reasonForSelection}
                  </p>
                  <p className="text-slate-400 leading-relaxed">
                    <strong className="text-slate-300">Uncertainty disclosure:</strong> {activeEvent.uncertaintyNote}
                  </p>
                </div>

                {activeEvent.ordinaryExplanations.length > 0 && (
                  <div className="p-3.5 rounded-lg bg-[#1A1710] border border-amber-500/35 space-y-1.5">
                    <div className="flex items-center gap-1.5 font-medium text-amber-300">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                      <span>Ordinary Technical Explanations (Governance §8)</span>
                    </div>
                    <ul className="list-disc pl-4 space-y-1 text-amber-100/90">
                      {activeEvent.ordinaryExplanations.map((exp, i) => (
                        <li key={i}>{exp}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              {/* Score Breakdown */}
              {activeEvent.scoreBreakdown && activeEvent.scoreBreakdown.length > 0 && (
                <div className="space-y-2 pt-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-slate-200">Prioritisation Score Breakdown</span>
                    <span className="font-mono tabular-nums text-cyan-300">
                      {activeEvent.estimatedRelevanceScore}/100
                    </span>
                  </div>
                  <div className="divide-y divide-[#1C2234] rounded-lg bg-[#0B0E17] border border-[#1E2436] px-3">
                    {activeEvent.scoreBreakdown.map((item, idx) => (
                      <div key={idx} className="py-2 flex items-center justify-between gap-2 text-[11px]">
                        <div className="min-w-0">
                          <div className="text-slate-200">{item.factor}</div>
                          <div className="text-slate-500 truncate">{item.detail}</div>
                        </div>
                        <span
                          className={`font-mono tabular-nums shrink-0 ${
                            item.contribution >= 0 ? 'text-cyan-300' : 'text-rose-300'
                          }`}
                        >
                          {item.contribution >= 0 ? `+${item.contribution}` : item.contribution}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Boundary, Classification & Annotation Form */}
              <form onSubmit={handleSaveDetails} className="space-y-3 pt-3 border-t border-[#1D2335] text-xs">
                <div className="grid grid-cols-2 gap-3">
                  <label className="space-y-1 block">
                    <span className="text-slate-400 block">Start (sec)</span>
                    <input
                      type="number"
                      step="0.1"
                      min={0}
                      value={editStart}
                      onChange={(e) => setEditStart(e.target.value)}
                      className="w-full px-2.5 py-2 rounded-md bg-[#0B0E17] border border-[#242B42] font-mono tabular-nums text-slate-100"
                    />
                  </label>
                  <label className="space-y-1 block">
                    <span className="text-slate-400 block">End (sec)</span>
                    <input
                      type="number"
                      step="0.1"
                      min={0}
                      value={editEnd}
                      onChange={(e) => setEditEnd(e.target.value)}
                      className="w-full px-2.5 py-2 rounded-md bg-[#0B0E17] border border-[#242B42] font-mono tabular-nums text-slate-100"
                    />
                  </label>
                </div>

                <label className="space-y-1 block">
                  <span className="text-slate-400 block">Correct Classification</span>
                  <select
                    value={editClass}
                    onChange={(e) => setEditClass(e.target.value as MomentCategory)}
                    className="w-full px-2.5 py-2 rounded-md bg-[#0B0E17] border border-[#242B42] text-slate-100"
                  >
                    {ALL_MOMENT_CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {MOMENT_CATEGORIES[c].label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="space-y-1 block">
                  <span className="text-slate-400 block">Assign to Project / Sequence</span>
                  <input
                    type="text"
                    value={editProject}
                    onChange={(e) => setEditProject(e.target.value)}
                    placeholder="e.g. Coastal Documentary Reel 01"
                    className="w-full px-2.5 py-2 rounded-md bg-[#0B0E17] border border-[#242B42] text-slate-100 placeholder:text-slate-600"
                  />
                </label>

                <label className="space-y-1 block">
                  <span className="text-slate-400 block">Reviewer Annotation</span>
                  <textarea
                    rows={3}
                    value={editAnnotation}
                    onChange={(e) => setEditAnnotation(e.target.value)}
                    placeholder="Add review notes without altering Layer E evidence…"
                    className="w-full px-2.5 py-2 rounded-md bg-[#0B0E17] border border-[#242B42] text-slate-100 placeholder:text-slate-600"
                  />
                </label>

                <button
                  type="submit"
                  disabled={savingEvent}
                  className="w-full py-2.5 px-4 rounded-lg bg-violet-600 hover:bg-violet-500 text-white font-medium transition-colors disabled:opacity-50"
                >
                  {savingEvent ? 'Saving Review Revision…' : 'Save Review Changes'}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
