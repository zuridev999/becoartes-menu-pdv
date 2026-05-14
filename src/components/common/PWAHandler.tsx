import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Maximize, Download, Smartphone } from 'lucide-react';

export function PWAHandler() {
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [isFullscreen, setIsFullscreen] = useState(
    document.fullscreenElement !== null || 
    (window.navigator as any).standalone === true ||
    window.matchMedia('(display-mode: standalone)').matches
  );
  const [showInstallBanner, setShowInstallBanner] = useState(false);
  const [isIOS] = useState(/iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream);
  const [wakeLock, setWakeLock] = useState<any>(null);

  useEffect(() => {
    const handleFsChange = () => {
      setIsFullscreen(
        document.fullscreenElement !== null || 
        (window.navigator as any).standalone === true ||
        window.matchMedia('(display-mode: standalone)').matches
      );
    };
    document.addEventListener('fullscreenchange', handleFsChange);
    document.addEventListener('webkitfullscreenchange', handleFsChange);

    const handleBeforeInstall = (e: any) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setShowInstallBanner(true);
    };
    window.addEventListener('beforeinstallprompt', handleBeforeInstall);

    // No iOS, mostramos o banner de instalação manualmente se não estiver em standalone
    if (isIOS && !(window.navigator as any).standalone) {
      setShowInstallBanner(true);
    }

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
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
      if (wakeLock) wakeLock.release();
    };
  }, [isIOS]);

  const enterFullscreen = () => {
    if (isIOS) {
       // No iOS (Safari), não há Fullscreen API para o documento.
       // A única forma é "Adicionar à Tela de Início".
       setShowInstallBanner(true);
       return;
    }
    const doc = document.documentElement as any;
    const request = doc.requestFullscreen || doc.webkitRequestFullscreen || doc.mozRequestFullScreen || doc.msRequestFullscreen;
    if (request) request.call(doc);
  };

  const handleInstall = async () => {
    if (isIOS) {
      alert('Para instalar: Toque no ícone de Compartilhar (quadrado com seta) e selecione "Adicionar à Tela de Início".');
      return;
    }
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') setShowInstallBanner(false);
      setDeferredPrompt(null);
    }
  };

  return (
    <>
      <AnimatePresence>
        {/* Fullscreen Overlay - Mandatory when not in FS/Standalone */}
        {!isFullscreen && (
          <motion.div 
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[9999] bg-black/95 backdrop-blur-2xl flex flex-col items-center justify-center p-12 text-center"
          >
            <div className="w-32 h-32 bg-primary/20 rounded-full flex items-center justify-center text-primary mb-8 animate-pulse">
               <Maximize size={64} />
            </div>
            <h2 className="text-5xl font-black text-white mb-6 uppercase tracking-tighter">
              {isIOS ? 'Instalação Necessária' : 'Modo Tablet'}
            </h2>
            <p className="text-gray-400 text-xl max-w-md mb-12 uppercase font-bold tracking-widest leading-relaxed">
              {isIOS 
                ? 'Para usar no tablet, você deve adicionar este site à sua "Tela de Início" usando o menu do Safari.' 
                : 'Toque abaixo para entrar em tela cheia e otimizar a experiência do cardápio.'}
            </p>
            <button 
              onClick={enterFullscreen}
              className="btn-beco btn-beco-purple px-16 py-8 text-2xl font-black rounded-[2.5rem] shadow-2xl shadow-primary/40 active:scale-95 transition-all"
            >
              {isIOS ? 'COMO INSTALAR' : 'ENTRAR EM TELA CHEIA'}
            </button>
          </motion.div>
        )}

        {/* Install Banner */}
        {showInstallBanner && isFullscreen && (
          <motion.div 
            initial={{ y: 100, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
            className="fixed bottom-12 left-12 right-12 z-[5000] glass p-10 rounded-[3rem] border-2 border-primary/30 flex items-center justify-between shadow-[0_0_50px_rgba(0,0,0,0.5)] bg-black/80 backdrop-blur-3xl"
          >
            <div className="flex items-center gap-8">
               <div className="w-20 h-20 bg-primary/20 rounded-3xl flex items-center justify-center text-primary">
                  <Smartphone size={40} />
               </div>
               <div className="text-left">
                  <h4 className="text-3xl font-black text-white uppercase tracking-tighter mb-1">Configurar Quiosque</h4>
                  <p className="text-lg text-gray-400 font-bold uppercase tracking-widest">
                    {isIOS ? 'Adicione à Tela de Início para modo Fullscreen.' : 'Instale na tela inicial para bloquear o navegador.'}
                  </p>
               </div>
            </div>
            <button 
              onClick={handleInstall}
              className="btn-beco btn-beco-purple px-14 py-7 text-xl font-black rounded-3xl flex items-center gap-4"
            >
              <Download size={24} /> {isIOS ? 'VER INSTRUÇÕES' : 'INSTALAR AGORA'}
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
