import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Maximize, Download, Smartphone } from 'lucide-react';

export function PWAHandler() {
  const [isFullscreen, setIsFullscreen] = useState(document.fullscreenElement !== null);
  const [wakeLock, setWakeLock] = useState<any>(null);

  useEffect(() => {
    const handleFsChange = () => setIsFullscreen(document.fullscreenElement !== null);
    document.addEventListener('fullscreenchange', handleFsChange);
    document.addEventListener('webkitfullscreenchange', handleFsChange);

    const requestWakeLock = async () => {
      try {
        if ('wakeLock' in navigator) {
          const wl = await (navigator as any).wakeLock.request('screen');
          setWakeLock(wl);
        }
      } catch (err) {}
    };

    requestWakeLock();

    return () => {
      document.removeEventListener('fullscreenchange', handleFsChange);
      document.removeEventListener('webkitfullscreenchange', handleFsChange);
      if (wakeLock) wakeLock.release();
    };
  }, []);

  const enterFullscreen = () => {
    const doc = document.documentElement as any;
    const request = doc.requestFullscreen || doc.webkitRequestFullscreen || doc.mozRequestFullScreen || doc.msRequestFullscreen;
    if (request) {
      request.call(doc).catch(() => {
        // Fallback or ignore if denied
      });
    }
  };

  return (
    <>
      <AnimatePresence>
        {!isFullscreen && (
          <motion.div 
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[9999] bg-black/95 backdrop-blur-2xl flex flex-col items-center justify-center p-12 text-center"
          >
            <div className="w-32 h-32 bg-primary/20 rounded-full flex items-center justify-center text-primary mb-8 animate-pulse">
               <Maximize size={64} />
            </div>
            <h2 className="text-5xl font-black text-white mb-6 uppercase tracking-tighter">Modo Tablet</h2>
            <p className="text-gray-400 text-xl max-w-md mb-12 uppercase font-bold tracking-widest leading-relaxed">
              Toque abaixo para ativar o modo quiosque e otimizar a experiência do cardápio.
            </p>
            <button 
              onClick={enterFullscreen}
              className="btn-beco btn-beco-purple px-16 py-8 text-2xl font-black rounded-[2.5rem] shadow-2xl shadow-primary/40 active:scale-95 transition-all"
            >
              ATIVAR MODO TABLET
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
