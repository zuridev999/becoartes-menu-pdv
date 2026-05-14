import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

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

  return null;
}
