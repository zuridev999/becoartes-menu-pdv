const FALLBACK_IMAGE =
  '/slideshow/beco-food.jpg';

const normalizeExternalImageUrl = (value: string) => {
  const trimmed = value.trim();

  const driveMatch = trimmed.match(/drive\.google\.com\/file\/d\/([^/]+)/);
  if (driveMatch?.[1]) {
    return `https://drive.google.com/uc?export=view&id=${driveMatch[1]}`;
  }

  try {
    const url = new URL(trimmed);
    const driveId = url.hostname.includes('drive.google.com') ? url.searchParams.get('id') : null;
    if (driveId) return `https://drive.google.com/uc?export=view&id=${driveId}`;

    if (url.hostname.includes('dropbox.com')) {
      url.searchParams.set('raw', '1');
      url.searchParams.delete('dl');
      return url.toString();
    }
  } catch {
    return trimmed;
  }

  return trimmed;
};

export const getImageSrc = (src?: string | null, width?: 320 | 640 | 960) => {
  const value = src?.trim();
  if (width && value?.startsWith('/menu-image?')) return `${value}&w=${width}`;
  if (width && /^\/(images|slideshow)\/.+\.(png|jpe?g|webp)$/i.test(value || '')) {
    return `/menu-image?asset=${encodeURIComponent(value!)}&w=${width}`;
  }
  return value ? normalizeExternalImageUrl(value) : FALLBACK_IMAGE;
};

export const fallbackImageSrc = FALLBACK_IMAGE;

export const applyImageFallback = (event: { currentTarget: HTMLImageElement }) => {
  const image = event.currentTarget;
  if (image.src.includes(FALLBACK_IMAGE)) return;
  image.onerror = null;
  image.src = FALLBACK_IMAGE;
};
