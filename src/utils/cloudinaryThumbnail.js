export const generateVideoThumbnail = (videoUrl, seconds = 3) => {
  if (!videoUrl) return null;

  return videoUrl
    .replace("/upload/", `/upload/so_${seconds}/`)
    .replace(".mp4", ".jpg");
};
