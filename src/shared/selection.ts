import { DetectedEvent, ReviewStatus } from './types';

export interface SelectionSummary {
  visibleSelectedIds: string[];
  visibleSelectedCount: number;
  totalVisible: number;
  allVisibleSelected: boolean;
  someVisibleSelected: boolean;
}

export function pruneHiddenSelection(visibleIds: string[], selectedIds: string[]): string[] {
  const visibleSet = new Set(visibleIds);
  return selectedIds.filter((id) => visibleSet.has(id));
}

export function getSelectionSummary(visibleIds: string[], selectedIds: string[]): SelectionSummary {
  const visibleSelectedIds = pruneHiddenSelection(visibleIds, selectedIds);
  const visibleSelectedCount = visibleSelectedIds.length;
  const totalVisible = visibleIds.length;
  return {
    visibleSelectedIds,
    visibleSelectedCount,
    totalVisible,
    allVisibleSelected: totalVisible > 0 && visibleSelectedCount === totalVisible,
    someVisibleSelected: visibleSelectedCount > 0 && visibleSelectedCount < totalVisible,
  };
}

export function toggleSelectionId(selectedIds: string[], id: string): string[] {
  return selectedIds.includes(id)
    ? selectedIds.filter((item) => item !== id)
    : [...selectedIds, id];
}

export function toggleSelectAllVisible(visibleIds: string[], selectedIds: string[]): string[] {
  const summary = getSelectionSummary(visibleIds, selectedIds);
  if (summary.allVisibleSelected) {
    return [];
  }
  return [...visibleIds];
}

export function applyShiftRangeSelection(
  visibleIds: string[],
  selectedIds: string[],
  anchorId: string | null,
  targetId: string
): string[] {
  if (!anchorId) {
    return toggleSelectionId(selectedIds, targetId);
  }
  const startIdx = visibleIds.indexOf(anchorId);
  const endIdx = visibleIds.indexOf(targetId);
  if (startIdx === -1 || endIdx === -1) {
    return toggleSelectionId(selectedIds, targetId);
  }
  const low = Math.min(startIdx, endIdx);
  const high = Math.max(startIdx, endIdx);
  const rangeIds = visibleIds.slice(low, high + 1);
  const merged = new Set([...pruneHiddenSelection(visibleIds, selectedIds), ...rangeIds]);
  return visibleIds.filter((id) => merged.has(id));
}

export function selectEventsByStatus(
  visibleEvents: Pick<DetectedEvent, 'id' | 'reviewStatus'>[],
  status: ReviewStatus
): string[] {
  return visibleEvents.filter((e) => e.reviewStatus === status).map((e) => e.id);
}
