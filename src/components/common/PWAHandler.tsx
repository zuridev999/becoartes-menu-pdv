import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Maximize } from 'lucide-react';

export function PWAHandler() {
  const wakeLockRef = useRef<{ release: () => Promise<void> } | null>(null);
  const [showReentryOverlay, setShowReentryOverlay] = useState(false);

  const requestFs = useCallback(() => {
    const root = document.documentElement as HTMLElement & {
      webkitRequestFullscreen?: () => Promise<void>;
      mozRequestFullScreen?: () => Promise<void>;
      msRequestFullscreen?: () => Promise<void>;
    };
    const request = root.requestFullscreen
      || root.webkitRequestFullscreen
      || root.mozRequestFullScreen
      || root.msRequestFullscreen;
    if (request) {
      request.call(root).catch((error: unknown) => console.error('Fullscreen error:', error));
    }
  }, []);

  const exitFs = useCallback(() => {
    const fullscreenDocument = document as Document & {
      webkitExitFullscreen?: () => Promise<void>;
      mozCancelFullScreen?: () => Promise<void>;
      msExitFullscreen?: () => Promise<void>;
    };
    const exit = fullscreenDocument.exitFullscreen
      || fullscreenDocument.webkitExitFullscreen
      || fullscreenDocument.mozCancelFullScreen
      || fullscreenDocument.msExitFullscreen;
    if (exit) {
      exit.call(fullscreenDocument).catch((error: unknown) => console.error('Exit Fullscreen error:', error));
    }
  }, []);

  useEffect(() => {
    const fullscreenDocument = document as Document & {
      webkitFullscreenElement?: Element | null;
      mozFullScreenElement?: Element | null;
      msFullscreenElement?: Element | null;
    };
    const handleFsChange = () => {
      const isFs = Boolean(
        document.fullscreenElement
        || fullscreenDocument.webkitFullscreenElement
        || fullscreenDocument.mozFullScreenElement
        || fullscreenDocument.msFullscreenElement,
      );
      
      // Se saiu do fullscreen e não foi por comando intencional recente, mostra overlay discreto
      if (!isFs) {
        setShowReentryOverlay(true);
      } else {
        setShowReentryOverlay(false);
      }
    };

    document.addEventListener('fullscreenchange', handleFsChange);
    document.addEventListener('webkitfullscreenchange', handleFsChange);
    document.addEventListener('mozfullscreenchange', handleFsChange);
    document.addEventListener('MSFullscreenChange', handleFsChange);

    const requestWakeLock = async () => {
      // 1. Suporte para Fully Kiosk Browser (API Nativa)
      const kioskWindow = window as Window & {
        fully?: {
          setKeepScreenOn: (enabled: boolean) => void;
          setKioskMode: (enabled: boolean) => void;
          lockDown: (enabled: boolean) => void;
        };
      };
      if (kioskWindow.fully) {
        try {
          kioskWindow.fully.setKeepScreenOn(true);
          kioskWindow.fully.setKioskMode(true);
          kioskWindow.fully.lockDown(true);
        } catch {
          // Fully Kiosk is optional; the browser wake lock remains the fallback.
        }
      }

      // 2. Wake Lock padrão (Navegador)
      try {
        if ('wakeLock' in navigator) {
          const manager = navigator.wakeLock as WakeLock;
          wakeLockRef.current = await manager.request('screen');
        }
      } catch {
        wakeLockRef.current = null;
      }
    };

    requestWakeLock();

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        requestWakeLock();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Escutar comandos globais de fullscreen (opcional, ou via store)
    const handleGlobalFullscreen = (event: Event) => {
      const detail = (event as CustomEvent<'request' | 'exit'>).detail;
      if (detail === 'request') requestFs();
      if (detail === 'exit') exitFs();
    };
    window.addEventListener('beco-fullscreen', handleGlobalFullscreen);

    return () => {
      document.removeEventListener('fullscreenchange', handleFsChange);
      document.removeEventListener('webkitfullscreenchange', handleFsChange);
      document.removeEventListener('mozfullscreenchange', handleFsChange);
      document.removeEventListener('MSFullscreenChange', handleFsChange);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('beco-fullscreen', handleGlobalFullscreen);
      void wakeLockRef.current?.release();
      wakeLockRef.current = null;
    };
  }, [exitFs, requestFs]);

  return (
    <AnimatePresence>
      {showReentryOverlay && (
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={requestFs}
          className="fixed bottom-6 right-6 z-[9999] bg-black/80 backdrop-blur-xl border-2 border-primary/30 p-6 rounded-[2rem] shadow-2xl flex items-center gap-4 cursor-pointer hover:bg-black transition-all active:scale-95"
        >
          <div className="w-12 h-12 bg-primary/20 rounded-full flex items-center justify-center text-primary animate-pulse">
            <Maximize size={24} />
          </div>
          <div>
            <p className="text-white font-black text-sm uppercase tracking-tighter">Modo Quiosque Desativado</p>
            <p className="text-primary font-bold text-[10px] uppercase tracking-widest">Toque para voltar à tela cheia</p>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
