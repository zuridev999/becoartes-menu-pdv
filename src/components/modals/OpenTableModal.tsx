import { useState } from 'react';
import { motion } from 'framer-motion';
import { X, ChevronRight } from 'lucide-react';
import { useStore } from '../../store';

export function OpenTableModal({ onClose }: { onClose: () => void }) {
  const { tables, sellers, openTable, currentSeller } = useStore();
  const [selectedTableId, setSelectedTableId] = useState('');
  const [selectedSellerId, setSelectedSellerId] = useState(currentSeller?.id || '');

  const handleOpen = async () => {
    if (!selectedTableId || !selectedSellerId) return;
    await openTable(selectedTableId, [], 'pdv', selectedSellerId);
    onClose();
  };

  return (
    <>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} className="fixed inset-0 bg-black/95 backdrop-blur-2xl z-[500]" />
      <motion.div initial={{ y: 50, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 50, opacity: 0 }} className="fixed inset-0 z-[550] flex items-center justify-center p-12 pointer-events-none font-['Outfit']">
         <div className="glass-card w-full max-w-4xl p-16 pointer-events-auto border-white/10 shadow-2xl">
            <div className="flex justify-between items-center mb-16">
               <h2 className="text-6xl font-black italic tracking-tighter">Abrir <span className="text-primary">Mesa</span></h2>
               <button onClick={onClose} className="p-4 glass rounded-2xl hover:text-rose-500"><X size={32}/></button>
            </div>

            <div className="grid grid-cols-2 gap-16">
               <div>
                  <h4 className="text-xs font-black uppercase tracking-widest text-gray-500 mb-8 flex items-center gap-4"><div className="w-2 h-2 bg-primary rounded-full"/> Atendente Responsável</h4>
                  <div className="space-y-4 max-h-96 overflow-y-auto pr-4 custom-scrollbar">
                     {sellers.filter((s: any) => s.status === 'active').map((s: any) => (
                       <button 
                         key={s.id} 
                         onClick={() => setSelectedSellerId(s.id)}
                         className={`w-full p-6 rounded-[2rem] border text-left transition-all flex items-center gap-6 ${selectedSellerId === s.id ? 'bg-primary border-primary shadow-xl shadow-primary/20 scale-[1.02]' : 'glass border-white/5 opacity-40 hover:opacity-100'}`}
                       >
                         <div className="w-12 h-12 bg-white/10 rounded-2xl flex items-center justify-center font-black">{s.name.charAt(0)}</div>
                         <div><p className="font-black text-xl">{s.name}</p><p className="text-[10px] uppercase font-black tracking-widest text-white/50">{s.role}</p></div>
                       </button>
                     ))}
                  </div>
               </div>

               <div>
                  <h4 className="text-xs font-black uppercase tracking-widest text-gray-500 mb-8 flex items-center gap-4"><div className="w-2 h-2 bg-accent rounded-full"/> Selecione a Mesa</h4>
                  <div className="grid grid-cols-4 gap-4 max-h-96 overflow-y-auto pr-4 custom-scrollbar">
                     {tables.filter((t: any) => t.status === 'available').map((t: any) => (
                       <button 
                         key={t.id} 
                         onClick={() => setSelectedTableId(t.id)}
                         className={`h-24 rounded-[2rem] border transition-all font-black text-2xl flex items-center justify-center ${selectedTableId === t.id ? 'bg-accent border-accent text-black shadow-xl shadow-accent/20 scale-110' : 'glass border-white/5 opacity-40 hover:opacity-100'}`}
                       >
                         {t.number}
                       </button>
                     ))}
                  </div>
               </div>
            </div>

            <button 
               disabled={!selectedTableId || !selectedSellerId}
               onClick={handleOpen}
               className="w-full btn-beco btn-beco-purple py-10 text-3xl font-black mt-16 shadow-2xl shadow-primary/30 disabled:opacity-20 flex items-center justify-center gap-6 group"
            >
               INICIAR ATENDIMENTO <ChevronRight className="group-hover:translate-x-2 transition-transform" size={32}/>
            </button>
         </div>
      </motion.div>
    </>
  );
}
