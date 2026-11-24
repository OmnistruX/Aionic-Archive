import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyShiftRangeSelection,
  getSelectionSummary,
  pruneHiddenSelection,
  selectEventsByStatus,
  toggleSelectAllVisible,
  toggleSelectionId,
} from './selection';

test('toggleSelectionId adds and removes IDs cleanly', () => {
  const step1 = toggleSelectionId([], 'e1');
  assert.deepEqual(step1, ['e1']);
  const step2 = toggleSelectionId(step1, 'e2');
  assert.deepEqual(step2, ['e1', 'e2']);
  const step3 = toggleSelectionId(step2, 'e1');
  assert.deepEqual(step3, ['e2']);
});

test('getSelectionSummary tracks all, some (indeterminate), and pruned visible counts', () => {
  const visible = ['e1', 'e2', 'e3'];
  const partial = getSelectionSummary(visible, ['e1', 'e99']);
  assert.equal(partial.visibleSelectedCount, 1);
  assert.equal(partial.someVisibleSelected, true);
  assert.equal(partial.allVisibleSelected, false);
  assert.deepEqual(partial.visibleSelectedIds, ['e1']);

  const full = getSelectionSummary(visible, ['e1', 'e2', 'e3']);
  assert.equal(full.allVisibleSelected, true);
  assert.equal(full.someVisibleSelected, false);
});

test('toggleSelectAllVisible selects all when partial/empty and clears when all selected', () => {
  const visible = ['e1', 'e2', 'e3'];
  assert.deepEqual(toggleSelectAllVisible(visible, ['e1']), ['e1', 'e2', 'e3']);
  assert.deepEqual(toggleSelectAllVisible(visible, ['e1', 'e2', 'e3']), []);
});

test('applyShiftRangeSelection selects inclusive range in either direction', () => {
  const visible = ['e1', 'e2', 'e3', 'e4', 'e5'];
  assert.deepEqual(applyShiftRangeSelection(visible, ['e2'], 'e2', 'e4'), ['e2', 'e3', 'e4']);
  assert.deepEqual(applyShiftRangeSelection(visible, ['e4'], 'e4', 'e1'), ['e1', 'e2', 'e3', 'e4']);
});

test('pruneHiddenSelection strips filtered-out IDs and selectEventsByStatus matches status', () => {
  assert.deepEqual(pruneHiddenSelection(['e2', 'e3'], ['e1', 'e2', 'e4']), ['e2']);
  const ids = selectEventsByStatus(
    [
      { id: 'e1', reviewStatus: 'unreviewed' },
      { id: 'e2', reviewStatus: 'accepted' },
      { id: 'e3', reviewStatus: 'unreviewed' },
    ],
    'unreviewed'
  );
  assert.deepEqual(ids, ['e1', 'e3']);
});
