import { useState } from 'react';
import { motion } from 'framer-motion';
import { X } from 'lucide-react';
import { useStore, type Product, type Modifier } from '../../store';
import { getImageSrc } from '../../lib/image';

export function ProductModal({ product, onClose, tabletLandscape = false }: { product: Product, onClose: () => void, tabletLandscape?: boolean }) {
  const { addToCart } = useStore();
  const [quantity, setQuantity] = useState(1);
  const [selectedModifiers, setSelectedModifiers] = useState<Modifier[]>([]);
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<string[]>([]);

  const handleAdd = () => {
    // Validação de grupos obrigatórios
    const missingGroups = product.modifierGroups?.filter(group => {
      const selectedInGroup = selectedModifiers.filter(m => group.modifiers.some(gm => gm.id === m.id));
      return group.isRequired && selectedInGroup.length < group.minChoices;
    }) || [];

    if (missingGroups.length > 0) {
      setErrors(missingGroups.map(g => `O grupo "${g.name}" exige pelo menos ${g.minChoices} escolha(s).`));
      return;
    }

    addToCart(product, quantity, selectedModifiers, notes);
    onClose();
  };

  const totalPrice = (product.price + selectedModifiers.reduce((acc: number, m: any) => acc + m.price, 0)) * quantity;

  return (
    <>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} className="fixed inset-0 bg-black/95 backdrop-blur-3xl z-[700]" />
      <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }} className={`fixed inset-0 z-[750] flex items-center justify-center pointer-events-none font-['Outfit'] ${tabletLandscape ? 'p-5' : 'p-12'}`}>
        <div className={`glass-card w-full flex overflow-hidden pointer-events-auto border-white/10 shadow-2xl ${tabletLandscape ? 'max-w-none h-full' : 'max-w-6xl h-[85vh]'}`}>
          <div className={`w-1/2 relative ${tabletLandscape ? 'block' : 'hidden lg:block'}`}>
             <img src={getImageSrc(product.image)} className="w-full h-full object-cover" />
             <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-transparent opacity-80" />
             <div className={`absolute ${tabletLandscape ? 'bottom-10 left-10 right-10' : 'bottom-16 left-16'}`}>
                <span className="text-[10px] font-black uppercase tracking-[0.4em] text-primary mb-2 block">{product.categoryName}</span>
                <h2 className={`${tabletLandscape ? 'text-5xl' : 'text-7xl'} font-black tracking-tighter italic text-white mb-4 leading-none`}>{product.name}</h2>
                <p className={`${tabletLandscape ? 'text-base' : 'text-xl'} text-gray-400 font-medium max-w-md italic`}>"{product.description || 'Uma obra prima gastronômica curada especialmente para o Becoartes.'}"</p>
             </div>
          </div>
          <div className={`${tabletLandscape ? 'w-1/2 p-8' : 'w-full lg:w-1/2 p-12'} flex flex-col overflow-hidden bg-[#0a0a0c]/80 relative`}>
             <button onClick={onClose} className={`${tabletLandscape ? 'top-5 right-5 p-3' : 'top-8 right-8 p-4'} absolute glass rounded-full hover:bg-white/10 text-white z-[400]`}><X size={tabletLandscape ? 24 : 32}/></button>
             <div className={`justify-between items-center mb-8 ${tabletLandscape ? 'hidden' : 'flex lg:hidden'}`}>
                <h2 className="text-4xl font-black italic">{product.name}</h2>
             </div>

             <div className={`flex-1 overflow-y-auto custom-scrollbar pr-4 ${tabletLandscape ? 'space-y-6' : 'space-y-10'}`}>
                {product.modifierGroups?.map(group => {
                  const selectedInGroup = selectedModifiers.filter(m => group.modifiers.some(gm => gm.id === m.id));
                  const isSingle = group.maxChoices === 1;

                  return (
                    <div key={group.id} className="space-y-4">
                      <div className="flex justify-between items-center sticky top-0 bg-[#0a0a0c]/90 py-2 z-10 backdrop-blur-md">
                        <div>
                          <h4 className="text-sm font-black uppercase tracking-widest text-white">{group.name}</h4>
                          <p className="text-[10px] text-gray-500 font-bold uppercase">
                            {isSingle ? 'Escolha 1' : `Escolha de ${group.minChoices} a ${group.maxChoices}`}
                          </p>
                        </div>
                        {group.isRequired && (
                          <span className="bg-primary/20 text-primary px-3 py-1 rounded-lg text-[10px] font-black uppercase">Obrigatório</span>
                        )}
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {group.modifiers.map(m => {
                          const isSelected = selectedModifiers.find(sm => sm.id === m.id);
                          return (
                            <button 
                              key={m.id} 
                              onClick={() => {
                                if (isSelected) {
                                  setSelectedModifiers(selectedModifiers.filter(sm => sm.id !== m.id));
                                } else {
                                  if (isSingle) {
                                    // Remover outros do mesmo grupo
                                    const filtered = selectedModifiers.filter(sm => !group.modifiers.some(gm => gm.id === sm.id));
                                    setSelectedModifiers([...filtered, m]);
                                  } else {
                                    if (selectedInGroup.length < group.maxChoices) {
                                      setSelectedModifiers([...selectedModifiers, m]);
                                    }
                                  }
                                }
                              }}
                              className={`${tabletLandscape ? 'p-4' : 'p-5'} rounded-2xl border text-left transition-all ${isSelected ? 'bg-primary border-primary shadow-lg shadow-primary/20' : 'glass border-white/5 hover:bg-white/5'}`}
                            >
                              <div className="flex justify-between items-center">
                                <span className="font-bold text-sm">{m.name}</span>
                                {m.price > 0 && <span className="text-[10px] font-black opacity-60">+ R$ {m.price.toFixed(2)}</span>}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}

                <div className="space-y-4">
                   <h4 className="text-sm font-black uppercase tracking-widest text-white">Observações Especiais</h4>
                   <textarea 
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Ex: sem cebola, ponto menos, gelo e limão..."
                    className="w-full glass p-6 rounded-3xl border-white/10 outline-none focus:border-primary transition-all text-sm font-medium min-h-[120px] resize-none"
                   />
                </div>
             </div>

             {errors.length > 0 && (
               <div className="mt-4 p-4 bg-rose-500/10 border border-rose-500/20 rounded-2xl">
                 {errors.map((e, i) => <p key={i} className="text-rose-400 text-xs font-bold flex items-center gap-2">⚠️ {e}</p>)}
               </div>
             )}

             <div className={`${tabletLandscape ? 'mt-5 pt-5 space-y-4' : 'mt-8 pt-8 space-y-6'} border-t border-white/10`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4 glass p-2 rounded-2xl border-white/5">
                     <button onClick={() => setQuantity(Math.max(1, quantity - 1))} className="w-10 h-10 flex items-center justify-center font-black text-xl hover:text-primary transition-all">-</button>
                     <span className="text-xl font-black w-8 text-center">{quantity}</span>
                     <button onClick={() => setQuantity(quantity + 1)} className="w-10 h-10 flex items-center justify-center font-black text-xl hover:text-primary transition-all">+</button>
                  </div>
                  <div className="text-right">
                     <p className="text-[10px] font-black uppercase text-gray-500 mb-1">Total do Item</p>
                     <p className={`${tabletLandscape ? 'text-3xl' : 'text-4xl'} font-black text-accent tracking-tighter`}>R$ {totalPrice.toFixed(2)}</p>
                  </div>
                </div>

                <button 
                onClick={handleAdd}
                className={`w-full btn-beco btn-beco-purple ${tabletLandscape ? 'py-5 text-lg rounded-2xl' : 'py-8 text-2xl rounded-3xl'} font-black tracking-widest shadow-xl shadow-primary/20 flex items-center justify-center gap-4`}
              >
                ADICIONAR AO PEDIDO
              </button>
             </div>
          </div>
        </div>
      </motion.div>
    </>
  );
}
