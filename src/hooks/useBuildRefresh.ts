import { useEffect } from 'react';
import { APP_COMMIT } from '../lib/version';

const sameCommit = (current: string, latest: string) => (
  current === latest || current.startsWith(latest) || latest.startsWith(current)
);

export const useBuildRefresh = (enabled = true) => {
  useEffect(() => {
    if (!enabled || !APP_COMMIT) return undefined;
    let cancelled = false;

    const refreshIfOutdated = async () => {
      if (document.visibilityState === 'hidden') return;
      try {
        const response = await fetch(`/api/health?build=${Date.now()}`, { cache: 'no-store' });
        if (!response.ok) return;
        const health = await response.json() as { commit?: string };
        const latestCommit = String(health.commit || '').trim();
        if (!cancelled && latestCommit && !sameCommit(APP_COMMIT, latestCommit)) {
          window.location.reload();
        }
      } catch {
        // A falta momentânea de rede não deve interromper o QR.
      }
    };

    void refreshIfOutdated();
    const onVisible = () => { void refreshIfOutdated(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('pageshow', onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('pageshow', onVisible);
    };
  }, [enabled]);
};
