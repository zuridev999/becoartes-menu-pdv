import { useEffect, useRef, type ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';
export function ProductEditorFrame({ title, productName, onClose, children, footer, tabs }: { title: string; productName: string; onClose: () => void; children: ReactNode; footer: ReactNode; tabs: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose); close.current = onClose;
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close.current(); }
      if (e.key !== 'Tab') return;
      const all = Array.from(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, a[href]') || []).filter(el => el.getClientRects().length);
      const first = all[0], last = all.at(-1);
      if (e.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) { e.preventDefault(); last?.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
    };
    const node = ref.current; node?.addEventListener('keydown', key);
    return () => { node?.removeEventListener('keydown', key); before?.focus(); };
  }, []);
  return <div className="product-editor-backdrop"><div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title} className="product-editor-panel">
    <header className="product-editor-header"><button type="button" className="editor-icon" aria-label="Voltar ao catálogo" onClick={onClose}><ArrowLeft size={23}/></button><div><h3>{title}</h3><p>{productName || 'Novo item no catálogo'}</p></div></header>
    {tabs}<div className="product-editor-body">{children}</div><footer className="product-editor-footer">{footer}</footer>
  </div></div>;
}
