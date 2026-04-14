// Capture a thumbnail from the Three.js canvas
export function captureCanvasThumbnail(maxSize = 128): string | null {
  const canvas = document.querySelector('canvas');
  if (!canvas) return null;

  // Create a smaller canvas for the thumbnail
  const thumb = document.createElement('canvas');
  const aspect = canvas.width / canvas.height;
  if (aspect > 1) {
    thumb.width = maxSize;
    thumb.height = Math.round(maxSize / aspect);
  } else {
    thumb.height = maxSize;
    thumb.width = Math.round(maxSize * aspect);
  }

  const ctx = thumb.getContext('2d');
  if (!ctx) return null;

  ctx.drawImage(canvas, 0, 0, thumb.width, thumb.height);
  return thumb.toDataURL('image/webp', 0.7);
}
