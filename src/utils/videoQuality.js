const QUALITY_HEIGHTS_DESC = [2160, 1440, 1080, 720, 480, 360, 240, 144];
const FALLBACK_MANUAL_QUALITIES = ["1080p", "720p", "480p"];
const CLOUDINARY_VIDEO_UPLOAD_MARKER = "/video/upload/";

const parsePositiveInt = (value) => {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const toManualQualityLabel = (height) => `${height}p`;

const toCanonicalQuality = (value) => {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) return null;

  if (normalized === "auto") return "AUTO";
  if (normalized === "max" || normalized === "original" || normalized === "source") {
    return "MAX";
  }

  const rawNumber = normalized.endsWith("p")
    ? normalized.slice(0, -1)
    : normalized;
  const height = parsePositiveInt(rawNumber);
  if (!height) return null;

  if (!QUALITY_HEIGHTS_DESC.includes(height)) {
    return null;
  }

  return toManualQualityLabel(height);
};

const manualQualitySortDesc = (a, b) => {
  const aHeight = parsePositiveInt(String(a).replace(/p$/i, ""));
  const bHeight = parsePositiveInt(String(b).replace(/p$/i, ""));
  if (!aHeight && !bHeight) return 0;
  if (!aHeight) return 1;
  if (!bHeight) return -1;
  return bHeight - aHeight;
};

export const buildAvailableManualQualitiesFromHeight = (sourceHeight) => {
  const height = parsePositiveInt(sourceHeight);
  if (!height) return [...FALLBACK_MANUAL_QUALITIES];

  const filtered = QUALITY_HEIGHTS_DESC
    .filter((candidate) => candidate <= height)
    .map(toManualQualityLabel);

  if (filtered.length > 0) {
    return filtered;
  }

  return ["144p"];
};

export const normalizeAvailableQualities = (availableQualities, sourceHeight) => {
  const normalized = Array.isArray(availableQualities)
    ? availableQualities
        .map(toCanonicalQuality)
        .filter(Boolean)
    : [];

  const manualSet = new Set(
    normalized.filter((quality) => quality.endsWith("p"))
  );

  if (manualSet.size === 0) {
    for (const quality of buildAvailableManualQualitiesFromHeight(sourceHeight)) {
      manualSet.add(quality);
    }
  }

  const manualQualities = [...manualSet].sort(manualQualitySortDesc);

  return ["AUTO", "MAX", ...manualQualities];
};

const applyCloudinaryVideoTransformation = (sourceUrl, transformation) => {
  if (!sourceUrl || typeof sourceUrl !== "string") {
    return sourceUrl || null;
  }

  const markerIndex = sourceUrl.indexOf(CLOUDINARY_VIDEO_UPLOAD_MARKER);
  if (markerIndex === -1) {
    return sourceUrl;
  }

  const prefix = sourceUrl.slice(
    0,
    markerIndex + CLOUDINARY_VIDEO_UPLOAD_MARKER.length
  );
  const suffix = sourceUrl
    .slice(markerIndex + CLOUDINARY_VIDEO_UPLOAD_MARKER.length)
    .replace(/^\/+/, "");
  const cleanedTransformation = String(transformation || "")
    .trim()
    .replace(/^\/+|\/+$/g, "");

  if (!cleanedTransformation) {
    return `${prefix}${suffix}`;
  }

  return `${prefix}${cleanedTransformation}/${suffix}`;
};

export const buildAutoPlaybackUrl = (sourceUrl, currentPlaybackUrl = null) => {
  if (!sourceUrl) {
    return currentPlaybackUrl || null;
  }

  // Use progressive auto-quality URL for broad browser/video-tag compatibility.
  // `sp_auto` can resolve to adaptive manifests that many plain players can't load directly.
  return applyCloudinaryVideoTransformation(sourceUrl, "q_auto:good");
};

const buildManualQualityPlaybackUrl = (sourceUrl, qualityLabel) => {
  if (!sourceUrl) return null;

  if (qualityLabel === "MAX") {
    return sourceUrl;
  }

  const canonical = toCanonicalQuality(qualityLabel);
  if (!canonical || canonical === "AUTO" || canonical === "MAX") {
    return sourceUrl;
  }

  const height = parsePositiveInt(canonical.replace(/p$/i, ""));
  if (!height) {
    return sourceUrl;
  }

  return applyCloudinaryVideoTransformation(
    sourceUrl,
    `c_limit,h_${height},q_auto:good`
  );
};

export const buildQualityUrls = ({
  sourceUrl,
  playbackUrl,
  availableQualities,
}) => {
  const normalizedQualities = normalizeAvailableQualities(availableQualities);
  const urls = {};

  const autoUrl = buildAutoPlaybackUrl(sourceUrl, playbackUrl) || sourceUrl || null;
  urls.AUTO = autoUrl;
  urls.MAX = sourceUrl || autoUrl;

  for (const quality of normalizedQualities) {
    if (quality === "AUTO" || quality === "MAX") continue;
    urls[quality] = buildManualQualityPlaybackUrl(sourceUrl || autoUrl, quality);
  }

  return urls;
};

export const resolveRequestedQuality = (requestedQuality, availableQualities) => {
  const normalizedQualities = normalizeAvailableQualities(availableQualities);
  const requested = toCanonicalQuality(requestedQuality);

  if (requested && normalizedQualities.includes(requested)) {
    return requested;
  }

  if (normalizedQualities.includes("AUTO")) {
    return "AUTO";
  }

  return normalizedQualities[0];
};

export const buildVideoStreamingPayload = ({
  sourceUrl,
  playbackUrl,
  availableQualities,
  requestedQuality,
  sourceHeight,
}) => {
  const normalizedQualities = normalizeAvailableQualities(
    availableQualities,
    sourceHeight
  );
  const qualityUrls = buildQualityUrls({
    sourceUrl,
    playbackUrl,
    availableQualities: normalizedQualities,
  });
  const selectedQuality = resolveRequestedQuality(
    requestedQuality,
    normalizedQualities
  );
  const selectedPlaybackUrl =
    qualityUrls[selectedQuality] ||
    qualityUrls.AUTO ||
    playbackUrl ||
    sourceUrl ||
    null;

  return {
    defaultQuality: "AUTO",
    selectedQuality,
    selectedPlaybackUrl,
    masterPlaylistUrl: qualityUrls.AUTO || selectedPlaybackUrl,
    availableQualities: normalizedQualities,
    qualityUrls,
  };
};
