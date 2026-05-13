import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Loader2 } from 'lucide-react';
import { useStore } from '../../store';

export function PremiumLoader({ onComplete, isLoading }: { onComplete: () => void, isLoading: boolean }) {
  const { settings } = useStore();
  const bannerImages = settings.tablet.bannerUrls.filter(url => url.trim() !== '');

  useEffect(() => {
    const hasLoaded = sessionStorage.getItem('beco_loaded');
    if (hasLoaded && !isLoading) {
      onComplete();
    } else if (!isLoading) {
      // Se terminou de carregar os dados, esperamos um pouco mais para o slideshow brilhar
      const timer = setTimeout(() => {
        sessionStorage.setItem('beco_loaded', 'true');
        onComplete();
      }, 5000); // 5 segundos de "show" na primeira carga
      return () => clearTimeout(timer);
    }
  }, [onComplete, isLoading]);

  return (
    <motion.div 
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-[#0a0a0c] flex flex-col items-center justify-center z-[1000] font-['Outfit'] overflow-hidden"
    >
      {/* Slideshow de Fundo */}
      {bannerImages.length > 0 && (
        <div className="absolute inset-0 z-0">
          <Slideshow images={bannerImages} interval={5000} />
          <div className="absolute inset-0 bg-black/40" />
        </div>
      )}

      <div className="relative z-10 mb-12">
        <motion.div 
          initial={{ rotate: 0, scale: 0.8 }}
          animate={{ rotate: 360, scale: 1 }}
          transition={{ duration: 1.5, ease: "anticipate" }}
          className="w-32 h-32 bg-gradient-to-tr from-primary to-purple-600 rounded-[2.5rem] flex items-center justify-center shadow-[0_0_50px_rgba(139,92,246,0.3)]"
        >
          <span className="text-5xl font-black text-white">B</span>
        </motion.div>
        <div className="absolute inset-[-20px] border border-primary/20 rounded-[3.5rem] animate-pulse" />
      </div>

      <div className="relative z-10 text-center">
        <h2 className="text-5xl font-black tracking-tighter mb-4 text-white italic">
          BECOARTES <span className="text-primary">PDV</span>
        </h2>
        <div className="flex items-center justify-center gap-4 text-white/50">
          {isLoading ? (
             <>
               <Loader2 className="animate-spin" size={20} />
               <p className="text-[10px] font-black uppercase tracking-[0.5em]">Sincronizando Galáxia...</p>
             </>
          ) : (
             <p className="text-[10px] font-black uppercase tracking-[0.5em] text-accent animate-pulse">Prepare o seu Coração...</p>
          )}
        </div>
      </div>
    </motion.div>
  );
}

export function Slideshow({ images, interval = 10000 }: { images: string[], interval?: number }) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (!images || images.length === 0) return;
    const timer = setInterval(() => {
      setIndex((prev) => (prev + 1) % images.length);
    }, interval);
    return () => clearInterval(timer);
  }, [images.length, interval]);

  if (!images || images.length === 0) return null;

  return (
    <div className="absolute inset-0 overflow-hidden">
      <AnimatePresence mode="wait">
        <motion.img 
          key={index}
          src={images[index]} 
          initial={{ opacity: 0, scale: 1.05 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          transition={{ duration: 2, ease: "easeInOut" }}
          className="w-full h-full object-cover" 
          alt="Slideshow" 
        />
      </AnimatePresence>
    </div>
  );
}
