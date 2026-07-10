import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Loader2 } from 'lucide-react';
import { fallbackImageSrc, getImageSrc } from '../../lib/image';

export function PremiumLoader({ onComplete, isLoading }: { onComplete: () => void, isLoading: boolean }) {
  useEffect(() => {
    const hasLoaded = sessionStorage.getItem('beco_loaded');
    if (hasLoaded && !isLoading) {
      onComplete();
    } else if (!isLoading) {
      const timer = setTimeout(() => {
        sessionStorage.setItem('beco_loaded', 'true');
        onComplete();
      }, 250);
      return () => clearTimeout(timer);
    }
  }, [onComplete, isLoading]);

  return (
    <motion.div 
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[1000] flex flex-col items-center justify-center overflow-hidden bg-[#0a0a0c] p-6 font-['Outfit']"
    >
      <img src="/favicon.svg" alt="Becoartes" className="mb-6 h-14 w-14 rounded-2xl" />
      <div className="text-center">
        <p className="text-[10px] font-black uppercase tracking-[0.24em] text-primary">Becoartes</p>
        <h2 className="mt-2 text-2xl font-black text-white">Preparando a operação</h2>
        <div className="mt-4 flex items-center justify-center gap-3 text-zinc-400" role="status" aria-live="polite">
          {isLoading ? (
             <>
               <Loader2 className="animate-spin" size={20} />
               <p className="text-xs font-bold">Carregando dados atualizados...</p>
             </>
          ) : (
             <p className="text-xs font-bold text-emerald-300">Pronto.</p>
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
