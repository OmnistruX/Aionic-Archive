import test from 'node:test';
import assert from 'node:assert/strict';
import { matchTranscriptToWindow, parseTranscriptionOutput } from './transcript';

test('parseTranscriptionOutput parses structured JSON segments and clamps timestamps', () => {
  const raw = JSON.stringify({
    hasSpeech: true,
    segments: [
      { startSec: 6.2, endSec: 9.8, speakerLabel: 'Narrator', text: 'Camera check on the pier.', confidence: 0.94 },
      { startSec: 1.0, endSec: 3.5, speakerLabel: 'Host', text: 'Tape rolling now.', confidence: 0.91 },
      { startSec: 22.0, endSec: 30.0, speakerLabel: null, text: 'End of reel.', confidence: 0.85 },
    ],
  });

  const out = parseTranscriptionOutput(raw, 24);
  assert.equal(out.length, 3);
  assert.equal(out[0].startSec, 1.0);
  assert.equal(out[0].text, 'Tape rolling now.');
  assert.equal(out[0].isPlaceholderNotice, false);
  assert.equal(out[2].endSec, 24);
});

test('parseTranscriptionOutput discloses no-speech audio honestly without fabricating dialogue', () => {
  const raw = JSON.stringify({ hasSpeech: false, segments: [] });
  const out = parseTranscriptionOutput(raw, 24);
  assert.equal(out.length, 1);
  assert.equal(out[0].isPlaceholderNotice, true);
  assert.match(out[0].text, /no intelligible spoken dialogue/i);

  const plainNoSpeech = parseTranscriptionOutput('NO_SPEECH', 24);
  assert.equal(plainNoSpeech.length, 1);
  assert.equal(plainNoSpeech[0].isPlaceholderNotice, true);
  assert.match(plainNoSpeech[0].text, /no intelligible spoken dialogue/i);
});

test('parseTranscriptionOutput parses bracketed timestamped lines with speaker labels', () => {
  const raw = [
    '[00:01 - 00:04] Archivist: Testing reel one.',
    '[00:12 - 00:15] Engineer: Lights flicker on channel two.',
  ].join('\n');

  const out = parseTranscriptionOutput(raw, 20);
  assert.equal(out.length, 2);
  assert.equal(out[0].startSec, 1);
  assert.equal(out[0].endSec, 4);
  assert.equal(out[0].speakerLabel, 'Archivist');
  assert.equal(out[1].startSec, 12);
  assert.equal(out[1].text, 'Lights flicker on channel two.');
});

test('matchTranscriptToWindow joins overlapping verbatim speech and ignores system notices', () => {
  const segments = [
    { startSec: 0, endSec: 2, text: '[System notice]', isPlaceholderNotice: true },
    { startSec: 1, endSec: 5, text: 'First spoken sentence.', isPlaceholderNotice: false },
    { startSec: 5.5, endSec: 9, text: 'Second overlapping phrase.', isPlaceholderNotice: false },
    { startSec: 14, endSec: 16, text: 'Unrelated later remark.', isPlaceholderNotice: false },
  ];

  const matched = matchTranscriptToWindow(segments, 4.5, 8.0);
  assert.equal(matched, 'First spoken sentence. Second overlapping phrase.');
});
