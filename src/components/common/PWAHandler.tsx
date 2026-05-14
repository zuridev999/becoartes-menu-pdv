import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Maximize } from 'lucide-react';

export function PWAHandler() {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [wakeLock, setWakeLock] = useState<any>(null);
  const [showReentryOverlay, setShowReentryOverlay] = useState(false);

  useEffect(() => {
    const handleFsChange = () => {
      const isFs = !!(document.fullscreenElement || (document as any).webkitFullscreenElement || (document as any).mozFullScreenElement || (document as any).msFullscreenElement);
      setIsFullscreen(isFs);
      
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
      try {
        if ('wakeLock' in navigator) {
          const wl = await (navigator as any).wakeLock.request('screen');
          setWakeLock(wl);
          console.log('💡 Wake Lock ativo');
        }
      } catch (err) {
        console.error('Wake Lock error:', err);
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
    const handleGlobalFullscreen = (e: any) => {
      if (e.detail === 'request') requestFs();
      if (e.detail === 'exit') exitFs();
    };
    window.addEventListener('beco-fullscreen', handleGlobalFullscreen);

    return () => {
      document.removeEventListener('fullscreenchange', handleFsChange);
      document.removeEventListener('webkitfullscreenchange', handleFsChange);
      document.removeEventListener('mozfullscreenchange', handleFsChange);
      document.removeEventListener('MSFullscreenChange', handleFsChange);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('beco-fullscreen', handleGlobalFullscreen);
      if (wakeLock) wakeLock.release();
    };
  }, []);

  const requestFs = () => {
    const doc = document.documentElement as any;
    const request = doc.requestFullscreen || doc.webkitRequestFullscreen || doc.mozRequestFullScreen || doc.msRequestFullscreen;
    if (request) {
      request.call(doc).catch((err: any) => console.error("Fullscreen error:", err));
    }
  };

  const exitFs = () => {
    const doc = document as any;
    const exit = doc.exitFullscreen || doc.webkitExitFullscreen || doc.mozCancelFullScreen || doc.msExitFullscreen;
    if (exit) {
      exit.call(doc).catch((err: any) => console.error("Exit Fullscreen error:", err));
    }
  };

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
