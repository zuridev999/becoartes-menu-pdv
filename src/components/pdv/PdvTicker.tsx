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
    <section className="mb-6 overflow-hidden rounded-[1.75rem] border border-yellow-300/40 bg-gradient-to-r from-red-950 via-red-700 to-red-950 shadow-2xl shadow-red-950/30">
      <div className="flex items-center gap-3 px-4 sm:px-5 py-3.5">
        <span className="shrink-0 rounded-full bg-yellow-300 text-red-950 px-3.5 py-1.5 text-[10px] sm:text-[11px] font-black uppercase tracking-[0.18em]">
          Operação
        </span>
        <div className="min-w-0 flex-1 overflow-hidden">
          <div className="pdv-ticker-track flex w-max items-center gap-10 whitespace-nowrap" style={tickerStyle}>
            {[0, 1, 2].map((item) => (
              <span key={item} className="inline-flex items-center gap-10 text-sm sm:text-base font-black uppercase tracking-[0.16em] text-yellow-200 drop-shadow">
                {message}
                <span className="h-2.5 w-2.5 rounded-full bg-yellow-300 shadow-lg shadow-yellow-300/50" />
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
