import { Bell, History } from 'lucide-react';

type RequestHistoryToggleProps = {
  pendingCount: number;
  resolvedCount: number;
  showingResolved: boolean;
  onToggle: () => void;
};

export function RequestHistoryToggle({
  pendingCount,
  resolvedCount,
  showingResolved,
  onToggle,
}: RequestHistoryToggleProps) {
  if (resolvedCount === 0) return null;

  return (
    <div className="shrink-0 border-t border-white/5 bg-[#0d0d0f] p-3 sm:p-4">
      <button type="button" onClick={onToggle} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-4 text-[10px] font-black uppercase tracking-[0.16em] text-zinc-400 transition-colors hover:bg-white/[0.08] hover:text-white">
        {showingResolved ? <Bell size={15} /> : <History size={15} />}
        {showingResolved ? `Voltar aos pendentes (${pendingCount})` : `Ver atendidos (${resolvedCount})`}
      </button>
    </div>
  );
}
