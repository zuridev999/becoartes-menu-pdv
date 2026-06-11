import type { CSSProperties } from 'react';

interface PdvTickerProps {
  enabled?: boolean;
  text?: string;
}

export function PdvTicker({ enabled = true, text }: PdvTickerProps) {
  const message = text?.trim();

  if (!enabled || !message) {
    return null;
  }

  const durationSeconds = Math.min(90, Math.max(36, Math.round(message.length / 2.4)));
  const tickerStyle = {
    '--pdv-ticker-duration': `${durationSeconds}s`,
  } as CSSProperties;

  return (
    <section className="mb-6 overflow-hidden rounded-[1.75rem] border border-amber-300/25 bg-gradient-to-r from-amber-400/15 via-primary/15 to-emerald-400/10 shadow-2xl shadow-black/20">
      <div className="flex items-center gap-3 px-4 sm:px-5 py-3">
        <span className="shrink-0 rounded-full bg-amber-300 text-black px-3 py-1 text-[9px] sm:text-[10px] font-black uppercase tracking-[0.18em]">
          Operação
        </span>
        <div className="min-w-0 flex-1 overflow-hidden">
          <div className="pdv-ticker-track flex w-max items-center gap-10 whitespace-nowrap" style={tickerStyle}>
            {[0, 1, 2].map((item) => (
              <span key={item} className="inline-flex items-center gap-10 text-xs sm:text-sm font-black uppercase tracking-[0.16em] text-amber-50">
                {message}
                <span className="h-2 w-2 rounded-full bg-amber-300 shadow-lg shadow-amber-300/40" />
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
