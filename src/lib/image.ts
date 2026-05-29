const FALLBACK_IMAGE =
  'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 800 600%22%3E%3Crect width=%22800%22 height=%22600%22 fill=%22%230a0a0c%22/%3E%3Ccircle cx=%22400%22 cy=%22300%22 r=%22118%22 fill=%22%2324143b%22/%3E%3Cpath d=%22M260 390h280l-82-105-58 70-44-54z%22 fill=%22%238b5cf6%22 opacity=%22.65%22/%3E%3Ccircle cx=%22498%22 cy=%22222%22 r=%2232%22 fill=%22%23f6c76f%22/%3E%3C/svg%3E';

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

export const getImageSrc = (src?: string | null) => {
  const value = src?.trim();
  return value ? normalizeExternalImageUrl(value) : FALLBACK_IMAGE;
};

export const fallbackImageSrc = FALLBACK_IMAGE;
