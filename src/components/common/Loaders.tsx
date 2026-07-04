import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Loader2 } from 'lucide-react';
import { useStore } from '../../store';
import { fallbackImageSrc, getImageSrc } from '../../lib/image';

const DEFAULT_SLIDESHOW_IMAGES = [
  '/slideshow/beco-drinks.jpg',
  '/slideshow/beco-food.jpg',
  '/slideshow/beco-bar.jpg'
];

export function PremiumLoader({ onComplete, isLoading }: { onComplete: () => void, isLoading: boolean }) {
  const { settings } = useStore();
  const configuredImages = settings.tablet.bannerUrls.filter(url => url.trim() !== '');
  const bannerImages = configuredImages.length > 0 ? configuredImages : DEFAULT_SLIDESHOW_IMAGES;

  useEffect(() => {
    const hasLoaded = sessionStorage.getItem('beco_loaded');
    if (hasLoaded && !isLoading) {
      onComplete();
    } else if (!isLoading) {
      // Breve o suficiente para operação, mantendo só um respiro visual na primeira carga.
      const timer = setTimeout(() => {
        sessionStorage.setItem('beco_loaded', 'true');
        onComplete();
      }, 700);
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
  const [failedImages, setFailedImages] = useState<Record<string, boolean>>({});
  const normalizedImages = images.map(getImageSrc).filter(Boolean);
  const availableImages = normalizedImages.filter((src) => !failedImages[src]);

  useEffect(() => {
    if (availableImages.length === 0) return;
    const timer = setInterval(() => {
      setIndex((prev) => (prev + 1) % availableImages.length);
    }, interval);
    return () => clearInterval(timer);
  }, [availableImages.length, interval]);

  if (normalizedImages.length === 0) return null;

  const currentSrc = availableImages[index % Math.max(availableImages.length, 1)] || fallbackImageSrc;

  return (
    <div className="absolute inset-0 overflow-hidden">
      <AnimatePresence mode="wait">
        <motion.img 
          key={`${index}-${currentSrc}`}
          src={currentSrc}
          onError={() => {
            if (currentSrc === fallbackImageSrc) return;
            setFailedImages((prev) => ({ ...prev, [currentSrc]: true }));
            setIndex(0);
          }}
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
