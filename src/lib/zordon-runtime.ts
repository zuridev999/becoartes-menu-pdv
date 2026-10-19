export const zordonRuntime = import.meta.env.VITE_ZORDON_MODE === 'true';
export function pdvBasePath() { return zordonRuntime ? window.location.pathname.match(/^\/os\/pdv\/[^/]+/)?.[0] || '' : ''; }
export function pdvPathname() { return window.location.pathname.slice(pdvBasePath().length) || '/pdv'; }
export function pdvPath(path: string) { return `${pdvBasePath()}${path.startsWith('/') ? path : `/${path}`}`; }
export function publicPdvBase() { return `${window.location.origin}${pdvBasePath()}`; }

if (zordonRuntime) {
  const base = pdvBasePath(); const tenant = base.split('/').at(-1) || 'default';
  const fetchOriginal = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const originalUrl = input instanceof Request ? input.url : String(input);
    const url = new URL(originalUrl, location.href);
    if (url.origin === location.origin && url.pathname.startsWith('/api/')) url.pathname = `${base}${url.pathname}`;
    return fetchOriginal(input instanceof Request ? new Request(url, input) : url, init);
  };
  for (const method of ['getItem', 'setItem', 'removeItem'] as const) {
    const original = Storage.prototype[method];
    Object.defineProperty(Storage.prototype, method, { value: function (key: string, ...args: string[]) {
      return Reflect.apply(original, this, [`zordon:${tenant}:${key}`, ...args]);
    }, configurable: true });
  }
}
