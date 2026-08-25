import { useEffect, useRef, useState } from 'react';

const ADSENSE_CLIENT = import.meta.env.VITE_ADSENSE_CLIENT || 'ca-pub-8099608758666537';
const ADSENSE_SLOT = import.meta.env.VITE_ADSENSE_SLOT || '6877500198';

type GoogleAdPlacement = 'top' | 'mobile-bottom' | 'operational-bottom';

const scriptId = 'becoartes-adsense-script';

function loadAdSense() {
  if (document.getElementById(scriptId)) return;
  const script = document.createElement('script');
  script.id = scriptId;
  script.async = true;
  script.crossOrigin = 'anonymous';
  script.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(ADSENSE_CLIENT)}`;
  document.head.appendChild(script);
}

export function GoogleAdBanner({ placement }: { placement: GoogleAdPlacement }) {
  const [isUnfilled, setIsUnfilled] = useState(false);
  const adRef = useRef<HTMLModElement>(null);

  useEffect(() => {
    loadAdSense();
    const ad = adRef.current;
    if (!ad) return undefined;

    const syncStatus = () => setIsUnfilled(ad.dataset.adStatus === 'unfilled');
    const observer = new MutationObserver(syncStatus);
    observer.observe(ad, { attributes: true, attributeFilter: ['data-ad-status'] });

    const ads = (window as typeof window & { adsbygoogle?: unknown[] }).adsbygoogle ||= [];
    try {
      ads.push({});
    } catch {
      // AdSense can reject a slot while a page is being restored from cache.
    }

    return () => observer.disconnect();
  }, []);

  if (isUnfilled) return null;

  const positionClass = placement === 'top'
    ? 'relative z-[55] w-full border-b border-white/10 bg-zinc-950/95 px-3 py-1.5'
    : placement === 'mobile-bottom'
      ? 'fixed inset-x-0 bottom-0 z-[140] border-t border-white/10 bg-zinc-950/95 px-2 py-1.5 pb-[calc(0.375rem+env(safe-area-inset-bottom))] md:hidden'
      : 'fixed inset-x-0 bottom-0 z-[60] hidden border-t border-white/10 bg-zinc-950/90 px-2 py-1 md:block';

  return (
    <aside className={positionClass} aria-label="Publicidade">
      <ins
        data-beco-google-ad
        ref={adRef}
        className="adsbygoogle mx-auto block min-h-11 w-full max-w-3xl"
        style={{ display: 'block' }}
        data-ad-client={ADSENSE_CLIENT}
        data-ad-slot={ADSENSE_SLOT}
        data-ad-format="auto"
        data-full-width-responsive="true"
      />
    </aside>
  );
}
