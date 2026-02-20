import {
  buildAutoPlaybackUrl,
  buildVideoStreamingPayload,
  normalizeAvailableQualities,
} from "../src/utils/videoQuality.js";

const SOURCE_URL =
  "https://res.cloudinary.com/demo/video/upload/v123/videos/user-1/sample-video.mp4";

describe("Video quality utilities", () => {
  it("builds normalized qualities from source height", () => {
    const qualities = normalizeAvailableQualities([], 720);

    expect(qualities[0]).toBe("AUTO");
    expect(qualities[1]).toBe("MAX");
    expect(qualities).toContain("720p");
    expect(qualities).toContain("480p");
    expect(qualities).not.toContain("1080p");
  });

  it("resolves selected quality and URL map", () => {
    const payload = buildVideoStreamingPayload({
      sourceUrl: SOURCE_URL,
      playbackUrl: buildAutoPlaybackUrl(SOURCE_URL),
      availableQualities: ["AUTO", "MAX", "1080p", "720p", "480p"],
      requestedQuality: "720",
    });

    expect(payload.selectedQuality).toBe("720p");
    expect(payload.qualityUrls["720p"]).toContain("h_720");
    expect(payload.qualityUrls.AUTO).toContain("/video/upload/q_auto:good/");
    expect(payload.qualityUrls.MAX).toBe(SOURCE_URL);
  });

  it("falls back to AUTO when requested quality is unsupported", () => {
    const payload = buildVideoStreamingPayload({
      sourceUrl: SOURCE_URL,
      playbackUrl: buildAutoPlaybackUrl(SOURCE_URL),
      availableQualities: ["AUTO", "MAX", "720p", "480p"],
      requestedQuality: "4k",
    });

    expect(payload.selectedQuality).toBe("AUTO");
    expect(payload.selectedPlaybackUrl).toBe(payload.qualityUrls.AUTO);
  });
});
