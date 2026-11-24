import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertNoSilentLayerMigration,
  buildOrdinaryExplanations,
  formatTimestamp,
  validateLayerRecordInput,
} from './layers';

test('Layer E rejects supernatural claims and recommends Layer S', () => {
  const res = validateLayerRecordInput({
    layer: 'E',
    title: 'Light anomaly',
    content: 'This proves a supernatural ghost entity appeared near the hallway.',
    sourceReference: 'reel.mp4 @ 00:16.0',
    startSec: 16,
  });

  assert.equal(res.valid, false);
  assert.equal(res.suggestedLayer, 'S');
  assert.ok(res.errors.length > 0);
});

test('Layer E accepts directly observable measurements with source references', () => {
  const res = validateLayerRecordInput({
    layer: 'E',
    title: 'Luminance spike measured',
    content: 'Frame luminance oscillated between 28 and 230 luma units over 3.0 seconds.',
    sourceReference: 'reel.mp4 @ 00:16.0–00:19.0',
    startSec: 16,
  });

  assert.equal(res.valid, true);
  assert.equal(res.errors.length, 0);
});

test('assertNoSilentLayerMigration blocks silent cross-layer mutation', () => {
  const blocked = assertNoSilentLayerMigration({ id: 'lyr-e-1', layer: 'E' }, 'S');
  assert.equal(blocked.allowed, false);
  assert.match(blocked.reason, /prohibited/i);

  const same = assertNoSilentLayerMigration({ id: 'lyr-r-1', layer: 'R' }, 'R');
  assert.equal(same.allowed, true);
});

test('buildOrdinaryExplanations supplies technical hypotheses for visual irregularities', () => {
  const flicker = buildOrdinaryExplanations('rapid exposure flicker');
  assert.ok(flicker.length >= 2);
  assert.ok(flicker.some((item) => /exposure|lighting|codec/i.test(item)));
});

test('formatTimestamp formats short and multi-hour durations cleanly', () => {
  assert.equal(formatTimestamp(16.5), '00:16.5');
  assert.equal(formatTimestamp(3665.2), '01:01:05.2');
});
