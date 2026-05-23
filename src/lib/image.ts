const buildFallbackImage = () => {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600">
      <defs>
        <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stop-color="#1b1028"/>
          <stop offset="0.56" stop-color="#0a0a0c"/>
          <stop offset="1" stop-color="#2d1556"/>
        </linearGradient>
        <radialGradient id="glow" cx="50%" cy="38%" r="62%">
          <stop offset="0" stop-color="#8b5cf6" stop-opacity="0.58"/>
          <stop offset="1" stop-color="#8b5cf6" stop-opacity="0"/>
        </radialGradient>
      </defs>
      <rect width="800" height="600" fill="url(#bg)"/>
      <rect width="800" height="600" fill="url(#glow)"/>
      <path d="M97 413c77-102 135-137 201-86 56 43 99 28 144-19 67-70 167-46 206 38 31 67-4 141-77 165H157c-74-21-105-64-60-98Z" fill="#8b5cf6" opacity=".28"/>
      <circle cx="626" cy="126" r="65" fill="#facc15" opacity=".88"/>
      <path d="M289 381h222l-63-82-47 57-35-43z" fill="#ffffff" opacity=".78"/>
      <circle cx="492" cy="244" r="25" fill="#facc15"/>
    </svg>
  `;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
};

export const FALLBACK_IMAGE = buildFallbackImage();

export const getImageSrc = (src?: string | null) => {
  const value = src?.trim();
  if (!value) return FALLBACK_IMAGE;
  if (/^(https?:|data:|blob:)/i.test(value)) return value;
  if (value.startsWith('/')) return value;
  if (value.startsWith('images/')) return `/${value}`;
  return `/images/${value}`;
};

export const applyImageFallback = (image: HTMLImageElement) => {
  if (image.src === FALLBACK_IMAGE) return;
  image.onerror = null;
  image.src = FALLBACK_IMAGE;
};
