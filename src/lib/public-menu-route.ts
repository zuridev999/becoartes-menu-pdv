export const isPublicMenuRoute = (hostname: string, pathname: string) =>
  (hostname.toLowerCase() === 'qr.becoartes.com' && /^\/cardapio\/?$/.test(pathname))
  || /^\/qr\/cardapio\/?$/.test(pathname);
