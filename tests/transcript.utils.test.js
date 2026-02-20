import {
  filterTranscriptSegments,
  parseTranscriptInput,
  resolveTranscriptForRead,
} from "../src/utils/transcript.js";

describe("Transcript utilities", () => {
  test("parses SRT text into normalized segments", () => {
    const srt = `1
00:00:01,000 --> 00:00:03,000
Hello everyone

2
00:00:03,200 --> 00:00:05,500
Welcome back`;

    const parsed = parseTranscriptInput({ transcript: srt });

    expect(parsed.segmentCount).toBe(2);
    expect(parsed.segments[0].startMs).toBe(1000);
    expect(parsed.segments[1].text).toContain("Welcome back");
    expect(parsed.transcriptText.toLowerCase()).toContain("hello everyone");
  });

  test("supports cue-array payload", () => {
    const parsed = parseTranscriptInput({
      cues: [
        { startMs: 0, endMs: 2000, text: "Intro" },
        { startMs: 2100, endMs: 4500, text: "Main topic" },
      ],
    });

    expect(parsed.segmentCount).toBe(2);
    expect(parsed.wordCount).toBeGreaterThan(1);
    expect(parsed.segments[0].startTime).toBe("00:00:00.000");
  });

  test("filters transcript segments by query and time range", () => {
    const transcript = resolveTranscriptForRead({
      transcript: "Alpha beta gamma. Delta epsilon zeta.",
      durationSeconds: 12,
    });

    const filtered = filterTranscriptSegments({
      segments: transcript.segments,
      query: "delta",
      fromMs: 2000,
      toMs: 12000,
    });

    expect(filtered.length).toBe(1);
    expect(filtered[0].text.toLowerCase()).toContain("delta");
  });
});

