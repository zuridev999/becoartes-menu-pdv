import { useState, useEffect, useRef, type FormEvent } from 'react';
import { Clock, CheckCircle2, X, AlertCircle, ChefHat, LockKeyhole, Maximize2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useStore, type Seller } from '../../store';
import { AppApi, setApiSessionToken } from '../../lib/api';
import { APP_BUILD_LABEL, getAppLabel } from '../../lib/version';

const KITCHEN_SYNC_INTERVAL_MS = 5000;

function KitchenPinGate({ onUnlock }: { onUnlock: () => void }) {
  const { login } = useStore();
  const stationLabel = getAppLabel() === 'Bar' ? 'BAR' : 'COZINHA';
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const submitPin = async (event?: FormEvent) => {
    event?.preventDefault();
    if (pin.length < 4 || isSubmitting) return;

    setIsSubmitting(true);
    setError('');

    try {
      const allowed = await login(pin);
      if (allowed) {
        setPin('');
        onUnlock();
        return;
      }
      const setupResult = await AppApi.validateTabletSetupPin(pin);
      if (setupResult.valid) {
        setApiSessionToken(setupResult.sessionToken || null);
        const kitchenSeller: Seller = setupResult.seller || {
          id: 'kitchen-setup',
          name: stationLabel,
          nickname: stationLabel,
          pin: '',
          status: 'active',
          role: 'atendente',
          permission: 'operator',
        };
        useStore.setState({ currentSeller: kitchenSeller });
        setPin('');
        onUnlock();
        return;
      }
      setError('PIN não autorizado nesta rede.');
      setPin('');
    } catch (error) {
      setError(error instanceof Error ? error.message : 'PIN não autorizado nesta rede.');
      setPin('');
    } finally {
      setIsSubmitting(false);
    }
  };

  const addDigit = (digit: string) => {
    if (pin.length >= 4 || isSubmitting) return;
    setError('');
    setPin(current => `${current}${digit}`.slice(0, 4));
  };

  return (
    <div className="fixed inset-0 z-[900] bg-[#09090b] text-white font-['Outfit'] flex items-center justify-center p-4 sm:p-8 uppercase">
      <form onSubmit={submitPin} className="w-full max-w-md glass rounded-[2rem] sm:rounded-[2.5rem] p-6 sm:p-10 border-white/10 shadow-2xl">
        <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-[1.5rem] sm:rounded-[2rem] bg-primary/15 text-primary flex items-center justify-center mb-6 sm:mb-8">
          <LockKeyhole size={32} />
        </div>
        <p className="text-[10px] font-black tracking-[0.35em] text-primary mb-3">{stationLabel} SEGURO</p>
        <h1 className="text-4xl sm:text-5xl font-black italic tracking-tighter mb-6 sm:mb-10">Digite o PIN</h1>

        <input
          value={pin}
          onChange={(event) => setPin(event.target.value.replace(/\D/g, '').slice(0, 4))}
          inputMode="numeric"
          pattern="[0-9]*"
          autoFocus
          className={`w-full glass py-5 sm:py-6 rounded-3xl text-center text-4xl sm:text-5xl font-black tracking-[0.45em] sm:tracking-[0.6em] outline-none border-2 transition-all ${
            error ? 'border-rose-500 text-rose-400' : 'border-white/10 focus:border-primary'
          }`}
          placeholder="••••"
        />

        {error && <p className="mt-4 text-rose-400 text-[10px] font-black tracking-widest">{error}</p>}

        <div className="grid grid-cols-3 gap-2.5 sm:gap-3 mt-6 sm:mt-8">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(digit => (
            <button
              type="button"
              key={digit}
              onClick={() => addDigit(digit)}
              className="h-14 sm:h-16 rounded-2xl glass border-white/5 text-2xl font-black hover:bg-white/10 active:scale-95 transition-all"
            >
              {digit}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setPin('')}
            className="h-14 sm:h-16 rounded-2xl glass border-white/5 text-xs font-black text-rose-400 hover:bg-rose-500/10 active:scale-95 transition-all"
          >
            LIMPAR
          </button>
          <button
            type="button"
            onClick={() => addDigit('0')}
            className="h-14 sm:h-16 rounded-2xl glass border-white/5 text-2xl font-black hover:bg-white/10 active:scale-95 transition-all"
          >
            0
          </button>
          <button
            type="submit"
            disabled={pin.length < 4 || isSubmitting}
            className="h-14 sm:h-16 rounded-2xl btn-beco btn-beco-purple text-xs font-black disabled:opacity-30"
          >
            {isSubmitting ? '...' : 'ENTRAR'}
          </button>
        </div>
      </form>
    </div>
  );
}

function KitchenOrderCard({ order, index, onClick }: { order: any, index: number, onClick: () => void }) {
  const [elapsedMs, setElapsedMs] = useState(0);
  const { serverTimeOffset } = useStore();

  useEffect(() => {
    const updateTimer = () => {
      if (!order.createdAt) return;
      const createdDate = new Date(order.createdAt);
      if (isNaN(createdDate.getTime())) return;
      const serverNow = new Date().getTime() + serverTimeOffset;
      setElapsedMs(Math.max(0, serverNow - createdDate.getTime()));
    };
    updateTimer();
    const timer = setInterval(updateTimer, 1000);
    return () => clearInterval(timer);
  }, [order.createdAt]);

  const mins = Math.floor(elapsedMs / 60000);
  const secs = Math.floor((elapsedMs % 60000) / 1000);
  const timeText = `${mins}:${secs.toString().padStart(2, '0')}`;
  const isWarning = mins >= 10 && mins < 20;
  const isDanger = mins >= 20;

  return (
    <motion.div 
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      onClick={onClick}
      className={`p-4 sm:p-6 pt-5 sm:pt-6 cursor-pointer relative border-2 sm:border-[3px] rounded-[1.75rem] sm:rounded-[2.5rem] transition-all duration-300 min-h-[260px] sm:h-full flex flex-col shadow-lg uppercase ${
        isDanger ? 'bg-red-600 border-red-700 text-black shadow-red-200' : 
        isWarning ? 'bg-amber-400 border-amber-500 text-black shadow-amber-100' : 
        'bg-white border-gray-100 text-black'
      }`}
    >
      {/* Sequence Number */}
      <div className="absolute -top-3 -left-3 sm:-top-6 sm:-left-6 w-10 h-10 sm:w-16 sm:h-16 bg-black text-white rounded-full flex items-center justify-center font-black text-2xl sm:text-4xl shadow-2xl z-20 border-2 sm:border-4 border-white">
        {index}
      </div>

      <div className="flex justify-between items-start gap-3 mb-4 sm:mb-6">
        <h3 className="text-3xl sm:text-6xl font-black italic tracking-tighter leading-none">Mesa {order.tableNumber}</h3>
        <div className="flex items-center gap-2 font-black text-black">
          <Clock size={20} className="sm:w-7 sm:h-7" />
          <span className="text-xl sm:text-3xl">{timeText}</span>
        </div>
      </div>

      <div className="flex-1 overflow-hidden mt-2 sm:mt-4">
        <p className="text-[10px] sm:text-sm font-black uppercase tracking-[0.25em] sm:tracking-[0.3em] mb-3 sm:mb-4 opacity-40">{order.items.length} Itens no Pedido</p>
        <div className={`mt-2 ${order.items.length > 5 ? 'grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3' : 'space-y-2 sm:space-y-3'}`}>
          {order.items.slice(0, 10).map((item: any, idx: number) => (
            <div key={idx} className="flex gap-3 items-start min-w-0">
              <span className="font-black text-xl sm:text-2xl text-black shrink-0 leading-none">{item.quantity}X</span>
              <div className="min-w-0 flex-1">
                <span className="font-black text-base sm:text-lg tracking-tighter truncate leading-none block">{item.name}</span>
                {item.selectedModifiers && item.selectedModifiers.length > 0 && (
                  <div className="mt-2 space-y-1.5">
                    <span className="inline-flex px-3 py-1.5 rounded-lg bg-black text-white text-xs font-black uppercase tracking-widest leading-none">
                      ADICIONAIS
                    </span>
                    {item.selectedModifiers.slice(0, 3).map((modifier: any, modifierIdx: number) => (
                      <span key={modifierIdx} className="block text-lg font-black leading-tight text-black uppercase tracking-tighter">
                        {item.quantity}X {modifier.name}
                      </span>
                    ))}
                    {item.selectedModifiers.length > 3 && (
                      <span className="px-2 py-1 rounded-lg bg-black/10 text-black text-[10px] font-black uppercase tracking-widest leading-none">
                        +{item.selectedModifiers.length - 3}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}
          {order.items.length > 10 && (
            <p className="text-base sm:text-xl font-black mt-4 sm:ml-12 text-red-600 animate-pulse">+ {order.items.length - 10} OUTROS ITENS...</p>
          )}
        </div>
        
        {order.items.some((i: any) => i.notes) && (
          <div className="mt-4 sm:mt-6 p-4 sm:p-5 bg-red-600 rounded-2xl sm:rounded-3xl shadow-xl border-2 sm:border-4 border-white animate-pulse">
            <p className="text-[10px] font-black uppercase text-white mb-2 tracking-[0.2em]">Observações do Pedido:</p>
            <div className="space-y-1">
              {order.items.filter((i: any) => i.notes).map((item: any, idx: number) => (
                <p key={idx} className="text-lg sm:text-2xl font-black text-white leading-tight">
                  !! {item.name}: {item.notes}
                </p>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className={`mt-4 pt-4 border-t flex justify-between items-center gap-2 ${isDanger ? 'border-black/20' : 'border-black/5'}`}>
        <span className="text-[10px] font-black uppercase tracking-widest opacity-40">Clique para abrir</span>
        <span className="px-3 py-1 rounded-full text-[10px] font-black uppercase bg-black/10 text-black">
          {isDanger ? 'Atrasado' : isWarning ? 'Atenção' : 'Normal'}
        </span>
      </div>
    </motion.div>
  );
}

function KitchenOrderDetailModal({ order, onClose, onComplete }: { order: any, onClose: () => void, onComplete: () => Promise<void> | void }) {
  const [showConfirm, setShowConfirm] = useState(false);
  const [isCompleting, setIsCompleting] = useState(false);
  const [completeError, setCompleteError] = useState('');

  const confirmComplete = async () => {
    if (isCompleting) return;
    setIsCompleting(true);
    setCompleteError('');
    try {
      await onComplete();
    } catch (error) {
      setCompleteError(error instanceof Error ? error.message : 'Erro ao finalizar pedido.');
    } finally {
      setIsCompleting(false);
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-[500] flex items-center justify-center p-3 sm:p-6 bg-black/60 backdrop-blur-md"
    >
      <motion.div 
        initial={{ scale: 0.9, y: 50 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.9, y: 50 }}
        className="w-full max-w-5xl bg-white rounded-[2rem] sm:rounded-[3rem] shadow-3xl overflow-hidden flex flex-col max-h-[94dvh] sm:max-h-[90vh] uppercase"
      >
        <div className="p-4 sm:p-10 border-b border-gray-100 flex justify-between items-center gap-4 bg-gray-50/50">
          <div className="flex items-center gap-4 sm:gap-8 min-w-0">
             <div className="w-12 h-12 sm:w-20 sm:h-20 shrink-0 bg-black/5 rounded-2xl sm:rounded-[2rem] flex items-center justify-center text-black">
                <Clock size={28} className="sm:w-10 sm:h-10" />
             </div>
             <div className="min-w-0">
                <h2 className="text-3xl sm:text-6xl font-black italic tracking-tighter text-black leading-none">Mesa {order.tableNumber}</h2>
                <p className="text-black/60 font-black uppercase tracking-[0.2em] sm:tracking-[0.3em] text-[10px] sm:text-sm truncate">Preparando Agora</p>
             </div>
          </div>
          <button onClick={onClose} className="p-4 sm:p-6 bg-gray-100 rounded-full hover:bg-rose-50 text-black transition-all shrink-0">
            <X size={28} className="sm:w-10 sm:h-10" />
          </button>
        </div>         <div className="flex-1 overflow-y-auto p-4 sm:p-12 custom-scrollbar bg-white">
            <div className="grid grid-cols-1 gap-4 sm:gap-6">
               {order.items.map((item: any, idx: number) => (
                 <div key={idx} className="p-4 sm:p-8 bg-gray-50 rounded-[1.5rem] sm:rounded-[2.5rem] border-2 border-gray-100 flex flex-col justify-between shadow-sm">
                    <div>
                      <div className="flex items-center gap-4 sm:gap-8">
                         <div className="w-14 h-14 sm:w-20 sm:h-20 shrink-0 bg-white shadow-md border-2 border-gray-100 rounded-2xl sm:rounded-[1.5rem] flex items-center justify-center text-2xl sm:text-4xl font-black text-black">
                           {item.quantity}X
                         </div>
                         <h4 className="text-2xl sm:text-5xl font-black tracking-tighter text-black leading-tight uppercase">{item.name}</h4>
                      </div>

                      {item.selectedModifiers && item.selectedModifiers.length > 0 && (
                        <div className="mt-5 sm:mt-6 sm:ml-28 space-y-3">
                          <span className="inline-flex px-4 sm:px-5 py-2 sm:py-2.5 bg-black text-white rounded-xl text-sm sm:text-xl font-black uppercase tracking-widest leading-none">
                            ADICIONAIS:
                          </span>
                          <div className="space-y-2">
                            {item.selectedModifiers.map((m: any, mIdx: number) => (
                              <p key={mIdx} className="text-2xl sm:text-5xl font-black tracking-tighter text-black leading-tight uppercase">
                                {item.quantity}X {m.name}
                              </p>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    {item.notes && (
                      <div className="mt-5 sm:mt-6 p-4 sm:p-6 bg-rose-50 border-2 border-rose-100 rounded-[1.5rem] sm:ml-28">
                         <p className="text-xs font-black uppercase text-rose-600 mb-2 tracking-[0.3em]">Observação do Cliente:</p>
                         <p className="text-lg sm:text-2xl font-bold text-black italic">"{item.notes}"</p>
                      </div>
                    )}
                 </div>
               ))}
            </div>
        </div>

        <div className="p-4 sm:p-10 bg-gray-50 border-t border-gray-100">
           <button 
             onClick={() => setShowConfirm(true)}
             className="w-full py-5 sm:py-8 bg-black text-white rounded-[1.5rem] sm:rounded-[2rem] text-lg sm:text-3xl font-black uppercase tracking-widest shadow-xl transition-all active:scale-[0.98] flex items-center justify-center gap-3 sm:gap-4"
           >
             <CheckCircle2 size={28} className="sm:w-9 sm:h-9" /> Finalizar Pedido
           </button>
        </div>

        <AnimatePresence>
          {showConfirm && (
            <motion.div 
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="absolute inset-0 z-[600] bg-white/95 backdrop-blur-sm flex items-center justify-center p-4 sm:p-10"
            >
              <div className="text-center max-w-2xl">
                 <div className="w-16 h-16 sm:w-24 sm:h-24 bg-black/5 text-black rounded-full flex items-center justify-center mx-auto mb-6 sm:mb-8">
                    <AlertCircle size={42} className="sm:w-[60px] sm:h-[60px]" />
                 </div>
                 <h3 className="text-3xl sm:text-5xl font-black mb-8 sm:mb-12 leading-tight text-black">Confirmar finalização de todos os itens?</h3>
                 {completeError && (
                   <p className="mb-6 rounded-2xl bg-rose-50 border-2 border-rose-100 px-5 py-4 text-sm font-black text-rose-600 uppercase tracking-widest">
                     {completeError}
                   </p>
                 )}
                 <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-6">
                    <button 
                      onClick={confirmComplete}
                      disabled={isCompleting}
                      className="py-5 sm:py-8 bg-black text-white rounded-[1.5rem] sm:rounded-[2rem] text-base sm:text-xl font-black uppercase tracking-widest shadow-lg disabled:opacity-50"
                    >
                      {isCompleting ? 'Finalizando...' : 'Sim, finalizar'}
                    </button>
                    <button 
                      onClick={() => setShowConfirm(false)}
                      className="py-5 sm:py-8 bg-gray-100 text-black rounded-[1.5rem] sm:rounded-[2rem] text-base sm:text-xl font-black uppercase tracking-widest"
                    >
                      Não, voltar
                    </button>
                 </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </motion.div>
  );
}

export function KitchenView() {
  const { kitchenOrders, updateKitchenOrderStatus, syncData, currentSeller } = useStore();
  const stationLabel = getAppLabel() === 'Bar' ? 'bar' : 'cozinha';
  const stationTitle = getAppLabel() === 'Bar' ? 'Bar' : 'Cozinha';
  const [selectedOrder, setSelectedOrder] = useState<any>(null);
  const [soundReady, setSoundReady] = useState(false);
  const [isKitchenUnlocked, setIsKitchenUnlocked] = useState(false);
  const lastOrderIds = useRef<string[]>([]);
  const hasInitializedOrderTracking = useRef(false);
  const audioCtxRef = useRef<AudioContext | null>(null);

  const activeOrders = kitchenOrders.filter((o: any) => o.status !== 'ready');
  const activeOrderIds = activeOrders.map((o: any) => o.id).join('|');

  // Auto-sync curto: a cozinha precisa reagir em segundos, não em ciclos longos.
  useEffect(() => {
    if (!isKitchenUnlocked) return;

    let isSyncing = false;

    const runSync = async (reason: string) => {
      if (isSyncing) return;
      isSyncing = true;
      try {
        console.log(`Kitchen syncing: ${reason}`);
        await syncData();
      } catch (error) {
        console.warn(`Falha ao sincronizar ${stationLabel}:`, error);
      } finally {
        isSyncing = false;
      }
    };

    const interval = setInterval(() => {
      runSync('interval');
    }, KITCHEN_SYNC_INTERVAL_MS);

    const handleResume = () => {
      if (!document.hidden) runSync('resume');
    };

    window.addEventListener('focus', handleResume);
    window.addEventListener('online', handleResume);
    document.addEventListener('visibilitychange', handleResume);
    runSync('mount');

    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', handleResume);
      window.removeEventListener('online', handleResume);
      document.removeEventListener('visibilitychange', handleResume);
    };
  }, [syncData, isKitchenUnlocked]);

  useEffect(() => {
    if (!currentSeller) {
      setIsKitchenUnlocked(false);
      setSoundReady(false);
    }
  }, [currentSeller]);

  const getAudioContext = async (shouldResume = false) => {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return null;

    if (!audioCtxRef.current) {
      audioCtxRef.current = new AudioContextClass();
    }

    if (shouldResume && audioCtxRef.current.state === 'suspended') {
      await audioCtxRef.current.resume();
    }

    return audioCtxRef.current;
  };

  const unlockKitchenSound = async () => {
    try {
      const audioCtx = await getAudioContext(true);
      setSoundReady(audioCtx?.state === 'running');
    } catch (error) {
      console.warn(`Falha ao ativar som do ${stationLabel}:`, error);
      setSoundReady(false);
    }
  };

  useEffect(() => {
    if (!isKitchenUnlocked) return;

    const handleFirstInteraction = () => {
      unlockKitchenSound();
    };

    window.addEventListener('pointerdown', handleFirstInteraction, { once: true });
    window.addEventListener('keydown', handleFirstInteraction, { once: true });

    return () => {
      window.removeEventListener('pointerdown', handleFirstInteraction);
      window.removeEventListener('keydown', handleFirstInteraction);
    };
  }, [isKitchenUnlocked]);

  // Função para tocar o sininho (Web Audio API)
  const playBellSound = async () => {
    try {
      const audioCtx = await getAudioContext(true);
      if (!audioCtx) return;
      
      if (audioCtx.state === 'suspended') {
        console.warn(`AudioContext suspenso. Clique em Ativar Som no ${stationLabel}.`);
        setSoundReady(false);
        return;
      }
      setSoundReady(true);

      const playDing = (time: number) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        
        osc.type = 'sine'; 
        osc.frequency.setValueAtTime(1046.50, time); 
        osc.frequency.exponentialRampToValueAtTime(523.25, time + 0.5); 
        
        gain.gain.setValueAtTime(0, time);
        gain.gain.linearRampToValueAtTime(0.3, time + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.01, time + 0.6);
        
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        
        osc.start(time);
        osc.stop(time + 0.6);
      };

      let startTime = audioCtx.currentTime + 0.1;
      for (let set = 0; set < 4; set++) {
        for (let ding = 0; ding < 3; ding++) {
          playDing(startTime);
          startTime += 0.25;
        }
        startTime += 1.5;
      }
    } catch (e) {
      console.warn("Erro ao reproduzir som:", e);
    }
  };

  // Detectar Novos Pedidos
  useEffect(() => {
    if (!isKitchenUnlocked) return;

    const currentIds = activeOrders.map(o => o.id);
    const hasNewOrder = currentIds.some(id => !lastOrderIds.current.includes(id));
    
    if (!hasInitializedOrderTracking.current) {
      lastOrderIds.current = currentIds;
      hasInitializedOrderTracking.current = true;
      return;
    }

    if (hasNewOrder) {
      console.log("Novo pedido detectado. Tocando sininho...");
      playBellSound();
    }
    
    lastOrderIds.current = currentIds;
  }, [activeOrderIds, isKitchenUnlocked]);

  const requestFullscreen = async () => {
    try {
      const root = document.documentElement as HTMLElement & {
        webkitRequestFullscreen?: () => Promise<void> | void;
      };
      if (document.fullscreenElement) return;
      if (root.requestFullscreen) await root.requestFullscreen();
      else if (root.webkitRequestFullscreen) await root.webkitRequestFullscreen();
    } catch (error) {
      console.warn('Falha ao ativar tela cheia da cozinha:', error);
    }
  };

  if (!isKitchenUnlocked || !currentSeller) {
    return <KitchenPinGate onUnlock={() => setIsKitchenUnlocked(true)} />;
  }
  
  return (
    <div className="p-2 sm:p-4 bg-[#09090b] h-[100dvh] text-white font-['Outfit'] overflow-hidden flex flex-col uppercase">
      <button
        onClick={requestFullscreen}
        className="fixed top-3 left-3 sm:top-8 sm:left-8 z-[400] w-11 h-11 sm:w-14 sm:h-14 rounded-2xl glass border-white/5 text-white/80 hover:text-white hover:bg-white/10 transition-all flex items-center justify-center shadow-2xl"
        title="Ativar tela cheia"
      >
        <Maximize2 size={20} className="sm:w-6 sm:h-6" />
      </button>

      {/* Status Indicator */}
      <div className="fixed top-3 right-3 left-16 sm:left-auto sm:top-8 sm:right-8 z-[400] flex items-center justify-end gap-2 sm:gap-4 px-3 sm:px-6 py-2 sm:py-3 glass rounded-2xl border-white/5 shadow-2xl">
        <div className="relative">
          <div className="w-3 h-3 bg-emerald-500 rounded-full" />
          <div className="absolute inset-0 w-3 h-3 bg-emerald-500 rounded-full animate-ping" />
        </div>
        <span className="hidden sm:inline text-[10px] font-black uppercase tracking-widest text-emerald-400 truncate">
          {getAppLabel()} {APP_BUILD_LABEL}
        </span>
        <button
          onClick={unlockKitchenSound}
          className={`px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all whitespace-nowrap ${
            soundReady ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-400 text-black'
          }`}
        >
          {soundReady ? 'Som Ativo' : 'Ativar Som'}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto sm:overflow-x-auto sm:overflow-y-hidden custom-scrollbar pt-16 sm:pt-4 pb-4 px-2 sm:px-4">
        {activeOrders.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-rows-2 sm:grid-flow-col gap-4 sm:gap-10 min-h-full sm:h-full sm:min-w-full" style={{ gridAutoColumns: 'min(520px, calc(40vw - 24px))' }}>
            {activeOrders.map((order: any, idx: number) => (
              <KitchenOrderCard 
                key={order.id} 
                order={order} 
                index={idx + 1}
                onClick={() => setSelectedOrder(order)} 
              />
            ))}
          </div>
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-center opacity-30 px-6">
            <ChefHat size={64} className="mb-6 sm:mb-8 sm:w-20 sm:h-20" />
            <h2 className="text-3xl sm:text-5xl font-black italic tracking-tighter mb-4">Nenhum Pedido Pendente</h2>
            <p className="text-[10px] font-black uppercase tracking-[0.28em] sm:tracking-[0.4em]">Aguardando novas comandas do {stationTitle}...</p>
          </div>
        )}
      </div>

      <AnimatePresence>
        {selectedOrder && (
          <KitchenOrderDetailModal 
            order={selectedOrder} 
            onClose={() => setSelectedOrder(null)}
            onComplete={async () => {
              await updateKitchenOrderStatus(selectedOrder.id, 'ready');
              await syncData();
              setSelectedOrder(null);
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
