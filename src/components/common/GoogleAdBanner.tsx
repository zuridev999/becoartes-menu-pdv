import { useEffect, useRef, useState } from 'react';

const ADSENSE_CLIENT = import.meta.env.VITE_ADSENSE_CLIENT || 'ca-pub-8099608758666537';
const ADSENSE_SLOT = import.meta.env.VITE_ADSENSE_SLOT || '6877500198';
const MOBILE_AD_HEIGHT_PROPERTY = '--beco-mobile-ad-height';

type GoogleAdPlacement = 'top' | 'operational-top' | 'mobile-bottom' | 'operational-bottom';
type GoogleAdStatus = 'pending' | 'filled' | 'unfilled';

export function GoogleAdBanner({ placement }: { placement: GoogleAdPlacement }) {
  const [status, setStatus] = useState<GoogleAdStatus>('pending');
  const adRef = useRef<HTMLModElement>(null);
  const containerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const ad = adRef.current;
    if (!ad) return undefined;

    const syncStatus = () => {
      if (ad.dataset.adStatus === 'filled') {
        setStatus('filled');
      } else if (ad.dataset.adStatus === 'unfilled' || ad.dataset.adStatus === 'unfill-optimized') {
        setStatus('unfilled');
      }
    };
    const observer = new MutationObserver(syncStatus);
    observer.observe(ad, { attributes: true, attributeFilter: ['data-ad-status'] });

    const ads = (window as typeof window & { adsbygoogle?: unknown[] }).adsbygoogle ||= [];
    try {
      ads.push({});
    } catch {
      // AdSense can reject a slot while a page is being restored from cache.
    }

    return () => {
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    if (placement !== 'mobile-bottom' || status !== 'filled' || !containerRef.current) {
      if (placement === 'mobile-bottom') {
        document.documentElement.style.removeProperty(MOBILE_AD_HEIGHT_PROPERTY);
      }
      return undefined;
    }

    const container = containerRef.current;
    const syncHeight = () => {
      const height = Math.ceil(container.getBoundingClientRect().height);
      document.documentElement.style.setProperty(MOBILE_AD_HEIGHT_PROPERTY, `${height}px`);
    };
    const resizeObserver = new ResizeObserver(syncHeight);
    resizeObserver.observe(container);
    syncHeight();

    return () => {
      resizeObserver.disconnect();
      document.documentElement.style.removeProperty(MOBILE_AD_HEIGHT_PROPERTY);
    };
  }, [placement, status]);

  if (status === 'unfilled') return null;

  const filledClass = placement === 'operational-top'
    ? 'sticky top-0 z-[55] w-full border-b border-white/10 bg-zinc-950/95 px-3 py-1.5 backdrop-blur'
    : placement === 'top'
    ? 'relative z-[55] w-full border-b border-white/10 bg-zinc-950/95 px-3 py-1.5'
    : placement === 'mobile-bottom'
      ? 'fixed inset-x-0 bottom-0 z-[140] border-t border-white/10 bg-zinc-950/95 px-2 py-1.5 pb-[calc(0.375rem+env(safe-area-inset-bottom))] md:hidden'
      : 'fixed bottom-0 left-1/2 z-[60] hidden w-full max-w-3xl -translate-x-1/2 border border-b-0 border-white/10 bg-zinc-950/95 px-2 py-1 md:block';
  const pendingClass = placement === 'operational-top'
    ? 'sticky top-0 z-[55] min-h-[50px] w-full border-b border-white/10 bg-zinc-950/95 px-3 py-1.5 backdrop-blur sm:min-h-[90px]'
    : placement === 'top'
      ? 'relative z-[55] min-h-[50px] w-full border-b border-white/10 bg-zinc-950/95 px-3 py-1.5 sm:min-h-[90px]'
      : placement === 'mobile-bottom'
        ? 'fixed inset-x-0 bottom-0 z-[140] min-h-[50px] border-t border-white/10 bg-zinc-950/95 px-2 py-1.5 pb-[calc(0.375rem+env(safe-area-inset-bottom))] md:hidden'
        : 'fixed bottom-0 left-1/2 z-[60] hidden min-h-[90px] w-full max-w-3xl -translate-x-1/2 border border-b-0 border-white/10 bg-zinc-950/95 px-2 py-1 md:block';
  const positionClass = status === 'filled' ? filledClass : pendingClass;

  return (
    <aside
      ref={containerRef}
      className={positionClass}
      data-ad-placement={placement}
      data-ad-render-status={status}
      aria-label="Publicidade"
    >
      <ins
        data-beco-google-ad
        ref={adRef}
        className="adsbygoogle mx-auto block w-full max-w-3xl"
        style={{ display: 'block' }}
        data-ad-client={ADSENSE_CLIENT}
        data-ad-slot={ADSENSE_SLOT}
        data-ad-format="auto"
        data-full-width-responsive="true"
      />
    </aside>
  );
}
