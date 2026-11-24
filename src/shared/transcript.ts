import { TranscriptSegment } from './types';

export interface ParsedTranscriptDraft {
  startSec: number;
  endSec: number;
  text: string;
  speakerLabel: string | null;
  confidence: number | null;
  isPlaceholderNotice: boolean;
}

function parseTimestampToken(raw: string): number | null {
  const cleaned = raw.trim();
  const hms = cleaned.match(/^(\d{1,2}):(\d{2}):(\d{2}(?:\.\d+)?)$/);
  if (hms) {
    return Number(hms[1]) * 3600 + Number(hms[2]) * 60 + Number(hms[3]);
  }
  const ms = cleaned.match(/^(\d{1,2}):(\d{2}(?:\.\d+)?)$/);
  if (ms) {
    return Number(ms[1]) * 60 + Number(ms[2]);
  }
  const secOnly = cleaned.match(/^(\d+(?:\.\d+)?)s?$/);
  if (secOnly) {
    return Number(secOnly[1]);
  }
  return null;
}

function clampTime(sec: number, maxDuration: number): number {
  if (!Number.isFinite(sec) || sec < 0) return 0;
  if (maxDuration <= 0) return Number(sec.toFixed(2));
  return Number(Math.min(maxDuration, sec).toFixed(2));
}

/**
 * Parses structured JSON or timestamped plain-text ASR output into normalized,
 * strictly bounded transcript segments. Never fabricates speech when audio has no dialogue.
 */
export function parseTranscriptionOutput(
  rawText: string,
  durationSec: number
): ParsedTranscriptDraft[] {
  const safeDuration = Math.max(0.5, Number.isFinite(durationSec) ? durationSec : 1);
  const trimmed = rawText.trim();
  const normalizedLower = trimmed.toLowerCase();
  if (
    !trimmed ||
    trimmed === 'NO_SPEECH' ||
    trimmed === '[NO_SPEECH]' ||
    /^\[?\s*(no\s+(intelligible\s+)?(human\s+)?speech|silence\s+only|non-speech|no\s+spoken\s+dialogue)/i.test(
      normalizedLower
    )
  ) {
    return [
      {
        startSec: 0,
        endSec: Math.min(safeDuration, 2),
        text: '[Speech transcription completed: no intelligible spoken dialogue detected in audio track.]',
        speakerLabel: 'ASR Notice',
        confidence: null,
        isPlaceholderNotice: true,
      },
    ];
  }

  // 1. Try structured JSON output (preferred contract for gemini-3.5-transcribe)
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed) as
        | {
            hasSpeech?: boolean;
            segments?: Array<{
              startSec?: number;
              endSec?: number;
              text?: string;
              speakerLabel?: string | null;
              confidence?: number | null;
            }>;
          }
        | Array<{
            startSec?: number;
            endSec?: number;
            text?: string;
            speakerLabel?: string | null;
            confidence?: number | null;
          }>;

      const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed.segments) ? parsed.segments : [];
      const hasSpeechFlag = Array.isArray(parsed) ? list.length > 0 : parsed.hasSpeech !== false;

      const normalized: ParsedTranscriptDraft[] = [];
      for (const item of list) {
        const text = String(item.text || '').trim();
        if (!text) continue;
        const startSec = clampTime(Number(item.startSec ?? 0), safeDuration);
        const rawEnd = Number(item.endSec ?? startSec + 2);
        const endSec = clampTime(Math.max(startSec + 0.25, rawEnd), safeDuration);
        normalized.push({
          startSec,
          endSec,
          text,
          speakerLabel: item.speakerLabel ? String(item.speakerLabel).trim() : null,
          confidence:
            typeof item.confidence === 'number' && Number.isFinite(item.confidence)
              ? Number(Math.max(0, Math.min(1, item.confidence)).toFixed(2))
              : null,
          isPlaceholderNotice: false,
        });
      }

      if (!hasSpeechFlag || normalized.length === 0) {
        return [
          {
            startSec: 0,
            endSec: Math.min(safeDuration, 2),
            text: '[Speech transcription completed: no intelligible spoken dialogue detected in audio track.]',
            speakerLabel: 'ASR Notice',
            confidence: null,
            isPlaceholderNotice: true,
          },
        ];
      }

      return normalized.sort((a, b) => a.startSec - b.startSec);
    } catch {
      // Fall through to line-based timestamp parsing
    }
  }

  // 2. Parse timestamped lines like "[00:02 - 00:05] Speaker 1: Hello" or "[00:02] Hello"
  const lines = trimmed
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const lineResults: ParsedTranscriptDraft[] = [];
  const lineRegex =
    /^\[?(\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?)\s*(?:[-–—>to]+\s*(\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?))?\]?\s*(?:([A-Za-z0-9 _-]{1,28}):\s*)?(.+)$/;

  for (const line of lines) {
    const match = line.match(lineRegex);
    if (!match) continue;
    const startParsed = parseTimestampToken(match[1]);
    if (startParsed === null) continue;
    const endParsed = match[2] ? parseTimestampToken(match[2]) : null;
    const speaker = match[3] ? match[3].trim() : null;
    const text = match[4].trim();
    if (!text) continue;

    const startSec = clampTime(startParsed, safeDuration);
    const endSec = clampTime(
      endParsed !== null && endParsed > startSec ? endParsed : Math.min(safeDuration, startSec + 3),
      safeDuration
    );
    lineResults.push({
      startSec,
      endSec,
      text,
      speakerLabel: speaker,
      confidence: null,
      isPlaceholderNotice: false,
    });
  }

  if (lineResults.length > 0) {
    return lineResults.sort((a, b) => a.startSec - b.startSec);
  }

  // 3. Plain un-timestamped speech output (single segment spanning recording)
  return [
    {
      startSec: 0,
      endSec: Number(safeDuration.toFixed(2)),
      text: trimmed,
      speakerLabel: 'Speaker',
      confidence: null,
      isPlaceholderNotice: false,
    },
  ];
}

/**
 * Joins verbatim (non-placeholder) transcript segments that overlap [startSec, endSec].
 */
export function matchTranscriptToWindow(
  segments: Array<Pick<TranscriptSegment, 'startSec' | 'endSec' | 'text' | 'isPlaceholderNotice'>>,
  startSec: number,
  endSec: number
): string {
  const realSegments = segments.filter((s) => !s.isPlaceholderNotice && s.text.trim().length > 0);
  if (realSegments.length === 0) return '';

  const matching = realSegments.filter((s) => s.endSec >= startSec && s.startSec <= endSec);
  return matching.map((s) => s.text.trim()).join(' ').trim();
}
