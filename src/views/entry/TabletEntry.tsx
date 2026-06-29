import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Lock, Tablet as TabletIcon } from 'lucide-react';
import { useStore } from '../../store';
import { AppApi, hasPublicTableAccess, setApiSessionToken, setPublicTableAccess } from '../../lib/api';

interface TabletEntryProps {
  onUnlock: () => void;
}

export function TabletEntry({ onUnlock }: TabletEntryProps) {
  const { tables, setCurrentTableId, currentTableId, syncData } = useStore();
  const [pin, setPin] = useState('');
  const [isPinCorrect, setIsPinCorrect] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    // Se já tiver uma mesa salva no localStorage, pula o PIN (opcional, ou trava)
    // Mas o usuário pediu PIN -> Mesa -> Trava.
    const savedTableId = localStorage.getItem('beco_tablet_table_id') || localStorage.getItem('becoartes_tablet_table_id');
    if (savedTableId && hasPublicTableAccess(savedTableId, 'tablet') && !currentTableId) {
       setCurrentTableId(savedTableId);
       onUnlock();
    }
  }, []);

  const handlePinSubmit = async (digit: string) => {
    const newPin = pin + digit;
    if (newPin.length <= 4) {
      setPin(newPin);
      if (newPin.length === 4) {
        try {
          const result = await AppApi.validateTabletSetupPin(newPin);
          if (result.valid) {
            if (result.sessionToken) {
              setApiSessionToken(result.sessionToken);
              await syncData({ includeCatalog: true });
            }
            setIsPinCorrect(true);
            setError('');
          } else {
            setError('PIN INCORRETO');
            setTimeout(() => setPin(''), 1000);
          }
        } catch {
          setError('PIN INCORRETO');
          setTimeout(() => setPin(''), 1000);
        }
      }
    }
  };

  const handleTableSelect = async (tableId: string) => {
    try {
      const access = await AppApi.createTableAccessToken({ origin: 'tablet', tableId });
      setPublicTableAccess(access);
      setCurrentTableId(tableId);
      onUnlock();
    } catch {
      setError('MESA NÃO AUTORIZADA');
    }
  };

  if (isPinCorrect) {
    return (
      <div className="fixed inset-0 bg-[#0a0a0c] flex items-center justify-center p-8 z-[1000] font-['Outfit']">
        <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="glass-card w-full max-w-4xl p-16 text-center border-white/5">
          <div className="w-24 h-24 bg-gradient-to-tr from-primary to-purple-600 rounded-[2.5rem] flex items-center justify-center shadow-2xl mx-auto mb-10">
            <TabletIcon size={48} className="text-white" />
          </div>
          <h2 className="text-6xl font-black tracking-tighter mb-4 italic">Vincular <span className="text-primary">Mesa</span></h2>
          <p className="text-gray-500 font-bold uppercase tracking-[0.4em] text-xs mb-12">Selecione a mesa fixa deste aparelho</p>
          
          <div className="grid grid-cols-5 md:grid-cols-10 gap-4 mt-12">
            {tables.map(table => (
              <button 
                key={table.id} 
                onClick={() => void handleTableSelect(table.id)}
                className="h-20 rounded-2xl glass border-white/5 font-black text-xl hover:bg-primary hover:text-white transition-all transform hover:scale-110 active:scale-95"
              >
                {table.number}
              </button>
            ))}
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-[#0a0a0c] flex items-center justify-center p-8 z-[2000] font-['Outfit']">
      <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="glass-card w-full max-w-md p-12 text-center border-white/5">
        <div className="w-20 h-20 bg-white/5 rounded-3xl flex items-center justify-center mx-auto mb-8">
          <Lock size={32} className="text-primary" />
        </div>
        <h2 className="text-4xl font-black tracking-tighter mb-2 italic">Acesso Restrito</h2>
        <p className="text-gray-500 font-bold uppercase tracking-widest text-[10px] mb-10">Digite o PIN do Tablet</p>
        
        <div className="flex justify-center gap-4 mb-12">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className={`w-4 h-4 rounded-full border-2 transition-all duration-300 ${pin.length >= i ? 'bg-primary border-primary scale-125' : 'border-white/20'}`} />
          ))}
        </div>

        {error && <p className="text-rose-500 font-black text-[10px] uppercase tracking-widest mb-6 animate-pulse">{error}</p>}

        <div className="grid grid-cols-3 gap-4">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9, '', 0, 'C'].map((num, idx) => (
            <button
              key={idx}
              onClick={() => {
                if (num === 'C') setPin('');
                else if (num !== '') void handlePinSubmit(num.toString());
              }}
              className={`h-16 rounded-2xl flex items-center justify-center text-xl font-black transition-all active:scale-90 ${num === '' ? 'pointer-events-none' : 'glass border-white/5 hover:bg-white/10'}`}
            >
              {num}
            </button>
          ))}
        </div>
      </motion.div>
    </div>
  );
}
