const MAX_TRANSCRIPT_TEXT_CHARS = 120000;
const MAX_SEGMENTS = 4000;
const MIN_SEGMENT_DURATION_MS = 500;
const DEFAULT_SEGMENT_DURATION_MS = 3000;
const MAX_SEGMENT_TEXT_CHARS = 500;

const normalizeText = (value) => String(value ?? "").trim();

export const formatMsToTimestamp = (ms) => {
  const safe = Math.max(0, Math.floor(Number(ms) || 0));
  const hours = Math.floor(safe / 3600000);
  const minutes = Math.floor((safe % 3600000) / 60000);
  const seconds = Math.floor((safe % 60000) / 1000);
  const millis = safe % 1000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(
    seconds
  ).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
};

const parseTimestampToMs = (value) => {
  if (value === null || value === undefined || value === "") return null;

  if (typeof value === "number" && Number.isFinite(value)) {
    if (Number.isInteger(value)) {
      return value >= 1000 ? Math.floor(value) : Math.floor(value * 1000);
    }
    return Math.floor(value * 1000);
  }

  const raw = normalizeText(value);
  if (!raw) return null;

  if (/^\d+$/.test(raw)) {
    const numeric = Number(raw);
    if (!Number.isFinite(numeric)) return null;
    return numeric >= 1000 ? Math.floor(numeric) : Math.floor(numeric * 1000);
  }

  if (/^\d+\.\d+$/.test(raw)) {
    const numeric = Number(raw);
    if (!Number.isFinite(numeric)) return null;
    return Math.floor(numeric * 1000);
  }

  const normalized = raw.replace(",", ".");
  const parts = normalized.split(":");
  if (parts.length < 2 || parts.length > 3) return null;

  const [hoursPart, minutesPart, secondsPart] =
    parts.length === 2 ? ["0", parts[0], parts[1]] : parts;

  const hours = Number(hoursPart);
  const minutes = Number(minutesPart);
  const seconds = Number(secondsPart);

  if (![hours, minutes, seconds].every(Number.isFinite)) return null;
  if (hours < 0 || minutes < 0 || minutes >= 60 || seconds < 0 || seconds >= 60.999) return null;

  return Math.floor(hours * 3600000 + minutes * 60000 + seconds * 1000);
};

const parseSrtVttLikeSegments = (raw) => {
  const blocks = String(raw || "")
    .replace(/\r/g, "")
    .split(/\n\s*\n/g)
    .map((block) =>
      block
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
    )
    .filter((lines) => lines.length > 0);

  const segments = [];

  for (const block of blocks) {
    let lines = [...block];

    if (/^webvtt/i.test(lines[0])) continue;
    if (/^\d+$/.test(lines[0])) lines = lines.slice(1);
    if (lines.length === 0) continue;

    let timeLineIndex = lines.findIndex((line) => line.includes("-->"));
    if (timeLineIndex === -1) continue;

    const timeLine = lines[timeLineIndex];
    const [left, rightRaw] = timeLine.split("-->");
    const right = normalizeText(rightRaw).split(/\s+/)[0];

    const startMs = parseTimestampToMs(left);
    const endMs = parseTimestampToMs(right);
    if (startMs === null || endMs === null || endMs <= startMs) continue;

    const text = normalizeText(lines.slice(timeLineIndex + 1).join(" "));
    if (!text) continue;

    segments.push({
      startMs,
      endMs,
      text: text.length > MAX_SEGMENT_TEXT_CHARS ? text.slice(0, MAX_SEGMENT_TEXT_CHARS) : text,
    });
  }

  return segments;
};

const splitPlainTextToSegments = (text, durationSeconds = null) => {
  const cleanText = normalizeText(text).slice(0, MAX_TRANSCRIPT_TEXT_CHARS);
  if (!cleanText) return [];

  const rawChunks = cleanText
    .split(/(?<=[.!?])\s+|\n+/)
    .map((chunk) => normalizeText(chunk))
    .filter(Boolean);

  const chunks = rawChunks.length > 0 ? rawChunks : [cleanText];
  const totalDurationMs =
    Number.isFinite(Number(durationSeconds)) && Number(durationSeconds) > 0
      ? Math.floor(Number(durationSeconds) * 1000)
      : chunks.length * DEFAULT_SEGMENT_DURATION_MS;

  const totalChars = chunks.reduce((sum, chunk) => sum + chunk.length, 0) || 1;

  let cursor = 0;
  const segments = [];
  for (const chunk of chunks.slice(0, MAX_SEGMENTS)) {
    const ratio = chunk.length / totalChars;
    const durationMs = Math.max(MIN_SEGMENT_DURATION_MS, Math.floor(totalDurationMs * ratio));
    const startMs = cursor;
    const endMs = startMs + durationMs;
    cursor = endMs;

    segments.push({
      startMs,
      endMs,
      text: chunk.length > MAX_SEGMENT_TEXT_CHARS ? chunk.slice(0, MAX_SEGMENT_TEXT_CHARS) : chunk,
    });
  }

  return segments;
};

const normalizeCueText = (value) => {
  const text = normalizeText(value);
  if (!text) return "";
  return text.length > MAX_SEGMENT_TEXT_CHARS ? text.slice(0, MAX_SEGMENT_TEXT_CHARS) : text;
};

export const normalizeTranscriptSegments = (segmentsInput, durationSeconds = null) => {
  if (!Array.isArray(segmentsInput)) return [];

  const normalized = [];
  let previousEnd = 0;

  for (const rawCue of segmentsInput.slice(0, MAX_SEGMENTS)) {
    if (!rawCue || typeof rawCue !== "object") continue;

    const text = normalizeCueText(
      rawCue.text ?? rawCue.content ?? rawCue.value ?? rawCue.line ?? ""
    );
    if (!text) continue;

    let startMs =
      parseTimestampToMs(rawCue.startMs) ??
      parseTimestampToMs(rawCue.start) ??
      parseTimestampToMs(rawCue.from) ??
      parseTimestampToMs(rawCue.startTime) ??
      null;

    let endMs =
      parseTimestampToMs(rawCue.endMs) ??
      parseTimestampToMs(rawCue.end) ??
      parseTimestampToMs(rawCue.to) ??
      parseTimestampToMs(rawCue.endTime) ??
      null;

    if (startMs === null) {
      startMs = previousEnd;
    }

    if (endMs === null) {
      const hintedDuration =
        parseTimestampToMs(rawCue.durationMs) ??
        parseTimestampToMs(rawCue.duration) ??
        DEFAULT_SEGMENT_DURATION_MS;
      endMs = startMs + Math.max(MIN_SEGMENT_DURATION_MS, hintedDuration);
    }

    if (endMs <= startMs) {
      endMs = startMs + MIN_SEGMENT_DURATION_MS;
    }

    if (durationSeconds && Number.isFinite(Number(durationSeconds)) && Number(durationSeconds) > 0) {
      const totalMs = Math.floor(Number(durationSeconds) * 1000);
      startMs = Math.min(Math.max(0, startMs), totalMs);
      endMs = Math.min(Math.max(startMs + MIN_SEGMENT_DURATION_MS, endMs), totalMs);
    }

    normalized.push({ startMs, endMs, text });
    previousEnd = endMs;
  }

  normalized.sort((a, b) => a.startMs - b.startMs);

  return normalized.map((segment, index) => ({
    index: index + 1,
    startMs: segment.startMs,
    endMs: segment.endMs,
    startTime: formatMsToTimestamp(segment.startMs),
    endTime: formatMsToTimestamp(segment.endMs),
    text: segment.text,
  }));
};

const buildTranscriptTextFromSegments = (segments) =>
  segments
    .map((segment) => normalizeText(segment?.text))
    .filter(Boolean)
    .join(" ")
    .slice(0, MAX_TRANSCRIPT_TEXT_CHARS);

export const parseTranscriptInput = ({
  transcript = "",
  cues = null,
  durationSeconds = null,
}) => {
  if (Array.isArray(cues) && cues.length > 0) {
    const segments = normalizeTranscriptSegments(cues, durationSeconds);
    const transcriptText = buildTranscriptTextFromSegments(segments);
    return {
      transcriptText,
      segments,
      wordCount: transcriptText ? transcriptText.split(/\s+/).filter(Boolean).length : 0,
      segmentCount: segments.length,
    };
  }

  const rawTranscript = normalizeText(transcript);
  if (!rawTranscript) {
    return {
      transcriptText: "",
      segments: [],
      wordCount: 0,
      segmentCount: 0,
    };
  }

  const srtSegments = rawTranscript.includes("-->") ? parseSrtVttLikeSegments(rawTranscript) : [];
  const normalizedSegments =
    srtSegments.length > 0
      ? normalizeTranscriptSegments(srtSegments, durationSeconds)
      : normalizeTranscriptSegments(splitPlainTextToSegments(rawTranscript, durationSeconds), durationSeconds);

  const transcriptText = normalizedSegments.length
    ? buildTranscriptTextFromSegments(normalizedSegments)
    : rawTranscript.slice(0, MAX_TRANSCRIPT_TEXT_CHARS);

  return {
    transcriptText,
    segments: normalizedSegments,
    wordCount: transcriptText ? transcriptText.split(/\s+/).filter(Boolean).length : 0,
    segmentCount: normalizedSegments.length,
  };
};

export const resolveTranscriptForRead = ({
  transcript = "",
  segments = null,
  durationSeconds = null,
}) => {
  const segmentArray = Array.isArray(segments) ? segments : [];
  if (segmentArray.length > 0) {
    const normalized = normalizeTranscriptSegments(segmentArray, durationSeconds);
    const transcriptText = normalizeText(transcript) || buildTranscriptTextFromSegments(normalized);
    return {
      transcriptText,
      segments: normalized,
      wordCount: transcriptText ? transcriptText.split(/\s+/).filter(Boolean).length : 0,
      segmentCount: normalized.length,
    };
  }

  return parseTranscriptInput({
    transcript,
    cues: null,
    durationSeconds,
  });
};

export const filterTranscriptSegments = ({
  segments = [],
  query = "",
  fromMs = null,
  toMs = null,
}) => {
  let filtered = Array.isArray(segments) ? [...segments] : [];

  if (Number.isFinite(fromMs) && fromMs >= 0) {
    filtered = filtered.filter((segment) => segment.endMs >= fromMs);
  }

  if (Number.isFinite(toMs) && toMs >= 0) {
    filtered = filtered.filter((segment) => segment.startMs <= toMs);
  }

  const q = normalizeText(query).toLowerCase();
  if (q) {
    filtered = filtered.filter((segment) => segment.text.toLowerCase().includes(q));
  }

  return filtered;
};

export const parseTimeQueryToMs = (value) => {
  if (value === undefined || value === null || value === "") return null;
  return parseTimestampToMs(value);
};
