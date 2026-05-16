import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Lock, ChevronRight, User } from 'lucide-react';
import { useStore } from '../../store';
import { getPermissionLabel } from '../../lib/permissions';

export function PinLoginModal() {
  const { sellers, login, addNotification } = useStore();
  const [selectedSeller, setSelectedSeller] = useState<any>(null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState(false);

  const handleLogin = async () => {
    const success = await login(pin, selectedSeller?.id);
    if (success) {
      addNotification(`Bem-vindo!`, 'info');
    } else {
      setError(true);
      setPin('');
      setTimeout(() => setError(false), 500);
    }
  };

  const addDigit = (digit: string) => {
    if (pin.length < 4) setPin(pin + digit);
  };

  const removeDigit = () => {
    setPin(pin.slice(0, -1));
  };

  return (
    <div className="fixed inset-0 bg-[#0a0a0c] z-[1000] flex items-center justify-center p-8 font-['Outfit']">
      <div className="glass-card w-full max-w-6xl h-[80vh] flex overflow-hidden border-white/10 shadow-2xl">
         {/* Seleção de Vendedor */}
         <div className="w-1/2 p-16 border-r border-white/5 flex flex-col">
            <h2 className="text-5xl font-black italic tracking-tighter mb-12">Quem está <span className="text-primary">Operando?</span></h2>
            <div className="flex-1 overflow-y-auto space-y-4 pr-4 custom-scrollbar">
               {sellers.filter(s => s.status === 'active').map(s => (
                 <button 
                   key={s.id} 
                   onClick={() => { setSelectedSeller(s); setPin(''); }}
                   className={`w-full p-8 rounded-[2.5rem] border text-left transition-all flex items-center gap-6 ${selectedSeller?.id === s.id ? 'bg-primary border-primary shadow-2xl shadow-primary/20 scale-[1.05]' : 'glass border-white/5 opacity-50 hover:opacity-100'}`}
                 >
                   <div className="w-16 h-16 bg-white/10 rounded-3xl flex items-center justify-center text-2xl font-black">{s.name.charAt(0)}</div>
                   <div>
                      <p className="font-black text-2xl">{s.name}</p>
                      <p className="text-xs uppercase font-black tracking-widest text-white/50">{getPermissionLabel(s)}</p>
                   </div>
                 </button>
               ))}
            </div>
         </div>

         {/* Teclado PIN */}
         <div className="w-1/2 p-16 bg-black/20 flex flex-col items-center justify-center">
            <AnimatePresence mode="wait">
               {selectedSeller ? (
                 <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} className="w-full max-w-sm text-center">
                    <div className="w-20 h-20 bg-primary/20 rounded-3xl flex items-center justify-center text-primary mx-auto mb-8 shadow-inner"><Lock size={32}/></div>
                    <h3 className="text-3xl font-black mb-2 italic">Olá, {selectedSeller.name}!</h3>
                    <p className="text-gray-500 font-bold mb-12">Insira seu PIN de 4 dígitos</p>

                    <div className="flex justify-center gap-4 mb-16">
                       {[0, 1, 2, 3].map(i => (
                         <motion.div 
                           key={i} 
                           animate={error ? { x: [0, -10, 10, -10, 10, 0] } : {}}
                           className={`w-16 h-20 rounded-2xl border-2 flex items-center justify-center text-4xl font-black ${pin[i] ? 'bg-primary border-primary text-white shadow-xl shadow-primary/30' : 'border-white/10 text-transparent'}`}
                         >
                           {pin[i] ? '•' : ''}
                         </motion.div>
                       ))}
                    </div>

                    <div className="grid grid-cols-3 gap-4 mb-12">
                       {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(num => (
                         <button key={num} onClick={() => addDigit(num.toString())} className="h-20 glass rounded-2xl font-black text-3xl hover:bg-white/10 active:scale-95 transition-all">{num}</button>
                       ))}
                       <button onClick={removeDigit} className="h-20 glass rounded-2xl font-black text-xl hover:bg-rose-500/10 text-rose-500">APAGAR</button>
                       <button onClick={() => addDigit('0')} className="h-20 glass rounded-2xl font-black text-3xl hover:bg-white/10">0</button>
                       <button onClick={handleLogin} disabled={pin.length < 4} className="h-20 bg-primary rounded-2xl font-black text-xl hover:shadow-2xl hover:shadow-primary/40 disabled:opacity-30 transition-all flex items-center justify-center"><ChevronRight size={32}/></button>
                    </div>
                 </motion.div>
               ) : (
                 <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center">
                    <div className="w-32 h-32 bg-white/5 rounded-full flex items-center justify-center text-white/20 mx-auto mb-10"><User size={64}/></div>
                    <p className="text-2xl font-black italic text-gray-600">Selecione um operador<br/>para começar</p>
                 </motion.div>
               )}
            </AnimatePresence>
         </div>
      </div>
    </div>
  );
}
