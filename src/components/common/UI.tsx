import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

export class AntigravityErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean, error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="fixed inset-0 bg-[#0a0a0c] flex flex-col items-center justify-center p-12 text-center z-[5000] font-['Outfit']">
          <div className="w-24 h-24 bg-rose-500/20 rounded-full flex items-center justify-center text-rose-500 mb-8 animate-pulse">
            <AlertTriangle size={48} />
          </div>
          <h1 className="text-5xl font-black text-white mb-4 italic tracking-tighter">Ops! Sistema em <span className="text-rose-500">Pane</span></h1>
          <p className="text-gray-500 max-w-md text-lg font-medium mb-12">Detectamos uma anomalia na gravidade do código. Nossos técnicos espaciais já foram notificados.</p>
          <div className="glass p-6 rounded-2xl border-rose-500/20 mb-12 max-w-2xl">
             <code className="text-rose-400 text-sm font-mono">{this.state.error?.message}</code>
          </div>
          <button 
            onClick={() => window.location.reload()}
            className="btn-beco btn-beco-purple px-12 py-6 text-xl flex items-center gap-4"
          >
            <RefreshCw size={24} /> Reiniciar Sistema
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export function Badge({ children, color = 'purple' }: { children: React.ReactNode, color?: 'purple' | 'yellow' | 'emerald' | 'rose' | 'amber' }) {
  const colors = {
    purple: 'bg-primary/10 text-primary border-primary/20',
    yellow: 'bg-accent/10 text-accent border-accent/20',
    emerald: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    rose: 'bg-rose-500/10 text-rose-400 border-rose-500/20',
    amber: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  };
  return (
    <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${colors[color as keyof typeof colors]}`}>
      {children}
    </span>
  );
}
