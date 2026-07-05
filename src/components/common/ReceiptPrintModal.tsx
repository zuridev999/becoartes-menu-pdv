import { useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Menu, Printer, X } from 'lucide-react';
import { buildReceiptHtml, type ReceiptData, type ReceiptPaperWidth } from '../../lib/receiptPrint';

type ReceiptPrintModalProps = {
  data: ReceiptData | null;
  onClose: () => void;
};

const STORAGE_KEY = 'becoartes.receiptPaperWidth';

const getInitialPaperWidth = (): ReceiptPaperWidth => {
  if (typeof window === 'undefined') return 58;
  return window.localStorage.getItem(STORAGE_KEY) === '80' ? 80 : 58;
};

export function ReceiptPrintModal({ data, onClose }: ReceiptPrintModalProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [paperWidth, setPaperWidth] = useState<ReceiptPaperWidth>(getInitialPaperWidth);
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  const html = useMemo(() => (
    data ? buildReceiptHtml(data, { paperWidth, autoPrint: false }) : ''
  ), [data, paperWidth]);

  const choosePaperWidth = (nextWidth: ReceiptPaperWidth) => {
    setPaperWidth(nextWidth);
    setIsMenuOpen(false);
    window.localStorage.setItem(STORAGE_KEY, String(nextWidth));
  };

  const handlePrint = () => {
    const contentWindow = iframeRef.current?.contentWindow;
    if (!contentWindow) return;
    contentWindow.focus();
    contentWindow.print();
  };

  return (
    <AnimatePresence>
      {data && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[950] flex items-center justify-center bg-black/80 p-3 backdrop-blur-xl sm:p-6"
        >
          <motion.div
            initial={{ scale: 0.96, y: 18 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.96, y: 18 }}
            className="flex h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-[1.5rem] border border-white/10 bg-[#0b0b0d] shadow-2xl shadow-black/50"
          >
            <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3 sm:px-5">
              <div className="min-w-0">
                <p className="truncate text-lg font-black uppercase tracking-tight text-white">Impressão da conta</p>
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500">
                  Papel {paperWidth}mm
                </p>
              </div>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setIsMenuOpen((current) => !current)}
                    className="grid h-11 w-11 place-items-center rounded-xl border border-white/10 bg-white/[0.04] text-zinc-200 transition-all hover:border-primary/40 hover:text-white"
                    title="Escolher largura do papel"
                  >
                    <Menu size={18} />
                  </button>
                  {isMenuOpen && (
                    <div className="absolute right-0 top-12 z-10 w-44 overflow-hidden rounded-2xl border border-white/10 bg-[#151519] p-1 shadow-2xl shadow-black/50">
                      {[58, 80].map((width) => (
                        <button
                          key={width}
                          type="button"
                          onClick={() => choosePaperWidth(width as ReceiptPaperWidth)}
                          className={`w-full rounded-xl px-3 py-3 text-left text-[11px] font-black uppercase tracking-widest transition-all ${
                            paperWidth === width
                              ? 'bg-primary text-white'
                              : 'text-zinc-400 hover:bg-white/5 hover:text-white'
                          }`}
                        >
                          Papel {width}mm
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={handlePrint}
                  className="inline-flex h-11 items-center gap-2 rounded-xl bg-primary px-4 text-[11px] font-black uppercase tracking-widest text-white shadow-xl shadow-primary/20 transition-all hover:brightness-110"
                >
                  <Printer size={16} />
                  Imprimir
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="grid h-11 w-11 place-items-center rounded-xl border border-white/10 bg-white/[0.04] text-zinc-300 transition-all hover:border-rose-400/40 hover:text-white"
                  title="Fechar"
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-auto bg-zinc-200 p-4 sm:p-6">
              <div
                className="mx-auto min-h-full bg-white shadow-2xl"
                style={{ width: paperWidth === 58 ? '58mm' : '80mm' }}
              >
                <iframe
                  ref={iframeRef}
                  title="Preview da conta"
                  srcDoc={html}
                  className="block h-[72vh] w-full border-0 bg-white"
                />
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
