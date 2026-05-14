import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Maximize, Download, Smartphone } from 'lucide-react';

export function PWAHandler() {
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [isFullscreen, setIsFullscreen] = useState(document.fullscreenElement !== null);
  const [showInstallBanner, setShowInstallBanner] = useState(false);
  const [wakeLock, setWakeLock] = useState<any>(null);

  useEffect(() => {
    // 1. Listen for Fullscreen Change
    const handleFsChange = () => setIsFullscreen(document.fullscreenElement !== null);
    document.addEventListener('fullscreenchange', handleFsChange);

    // 2. Listen for PWA Install Prompt
    const handleBeforeInstall = (e: any) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setShowInstallBanner(true);
    };
    window.addEventListener('beforeinstallprompt', handleBeforeInstall);

    // 3. Wake Lock Logic
    const requestWakeLock = async () => {
      try {
        if ('wakeLock' in navigator) {
          const wl = await (navigator as any).wakeLock.request('screen');
          setWakeLock(wl);
          console.log('💡 Wake Lock active');
        }
      } catch (err) {
        console.error('Wake Lock error:', err);
      }
    };

    requestWakeLock();

    return () => {
      document.removeEventListener('fullscreenchange', handleFsChange);
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
      if (wakeLock) wakeLock.release();
    };
  }, []);

  const enterFullscreen = () => {
    const doc = document.documentElement as any;
    const request = doc.requestFullscreen || doc.webkitRequestFullscreen || doc.msRequestFullscreen;
    if (request) request.call(doc);
  };

  const handleInstall = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        setShowInstallBanner(false);
      }
      setDeferredPrompt(null);
    }
  };

  return (
    <>
      <AnimatePresence>
        {/* Fullscreen Overlay - Mandatory when not in FS */}
        {!isFullscreen && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[9999] bg-black/90 backdrop-blur-xl flex flex-col items-center justify-center p-12 text-center"
          >
            <div className="w-32 h-32 bg-primary/20 rounded-full flex items-center justify-center text-primary mb-8 animate-pulse">
               <Maximize size={64} />
            </div>
            <h2 className="text-5xl font-black text-white mb-6 uppercase tracking-tighter">Modo Tablet</h2>
            <p className="text-gray-400 text-xl max-w-md mb-12 uppercase font-bold tracking-widest leading-relaxed">Toque abaixo para entrar em tela cheia e otimizar a experiência do cardápio.</p>
            <button 
              onClick={enterFullscreen}
              className="btn-beco btn-beco-purple px-16 py-8 text-2xl font-black rounded-[2.5rem] shadow-2xl shadow-primary/40 active:scale-95 transition-all"
            >
              ENTRAR EM TELA CHEIA
            </button>
          </motion.div>
        )}

        {/* Install Banner - Suggestive but persistent for admins */}
        {showInstallBanner && isFullscreen && (
          <motion.div 
            initial={{ y: 100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            className="fixed bottom-12 left-12 right-12 z-[5000] glass p-8 rounded-[2.5rem] border border-white/10 flex items-center justify-between shadow-3xl bg-black/60 backdrop-blur-3xl"
          >
            <div className="flex items-center gap-6">
               <div className="w-16 h-16 bg-white/10 rounded-2xl flex items-center justify-center text-primary">
                  <Smartphone size={32} />
               </div>
               <div>
                  <h4 className="text-xl font-black text-white uppercase tracking-tighter">Instalar Aplicativo</h4>
                  <p className="text-sm text-gray-400 font-bold uppercase tracking-widest">Para usar em modo quiosque, instale na tela inicial.</p>
               </div>
            </div>
            <div className="flex gap-4">
               <button onClick={() => setShowInstallBanner(false)} className="px-8 py-4 text-xs font-black uppercase text-gray-500 hover:text-white transition-colors">Depois</button>
               <button 
                 onClick={handleInstall}
                 className="btn-beco btn-beco-purple px-10 py-5 text-sm font-black rounded-2xl flex items-center gap-3"
               >
                 <Download size={18} /> INSTALAR AGORA
               </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
