import { useState } from 'react';
import { motion } from 'framer-motion';
import { Check, X } from 'lucide-react';
import { useStore, type Product, type Modifier } from '../../store';
import { getImageSrc } from '../../lib/image';

export function ProductModal({
  product,
  onClose,
  tabletLandscape = false,
}: {
  product: Product;
  onClose: () => void;
  tabletLandscape?: boolean;
}) {
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
  const formatCurrency = (value: number) => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const modalShellClass = tabletLandscape
    ? 'p-3 sm:p-4'
    : 'p-12';
  const modalCardClass = tabletLandscape
    ? 'w-[min(1120px,calc(100vw-24px))] max-h-[calc(100dvh-24px)] min-h-[min(560px,calc(100svh-24px))] flex-col min-[760px]:flex-row'
    : 'w-full max-w-6xl h-[85vh]';
  const mediaPanelClass = tabletLandscape
    ? 'block h-[34%] min-h-[170px] max-h-[260px] w-full min-[760px]:h-auto min-[760px]:max-h-none min-[760px]:w-[50%] min-[760px]:min-w-[50%]'
    : 'w-1/2 hidden lg:block';
  const contentPanelClass = tabletLandscape
    ? 'flex-1 min-h-0 min-w-0 p-5 sm:p-6 min-[900px]:p-8'
    : 'w-full lg:w-1/2 p-12';

  return (
    <>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} className="fixed inset-0 bg-black/95 backdrop-blur-3xl z-[700]" />
      <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }} className={`fixed inset-0 z-[750] flex items-center justify-center pointer-events-none font-['Outfit'] ${modalShellClass}`}>
        <div className={`glass-card flex overflow-hidden pointer-events-auto border-white/10 shadow-2xl ${modalCardClass}`}>
          <div className={`relative shrink-0 overflow-hidden ${mediaPanelClass}`}>
             <img src={getImageSrc(product.image)} className="w-full h-full object-cover" />
             <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-transparent opacity-80" />
             <div className={tabletLandscape ? 'absolute bottom-5 left-5 right-5 min-[900px]:bottom-10 min-[900px]:left-10 min-[900px]:right-10' : 'absolute bottom-16 left-16'}>
                <span className="text-[10px] font-black uppercase tracking-[0.4em] text-primary mb-2 block">{product.categoryName}</span>
                <h2 className={`${tabletLandscape ? 'text-3xl min-[900px]:text-5xl' : 'text-7xl'} font-black tracking-tighter italic text-white mb-2 min-[900px]:mb-4 leading-none`}>{product.name}</h2>
                <p className={`${tabletLandscape ? 'hidden min-[900px]:block text-base max-w-sm' : 'text-xl max-w-md'} text-gray-400 font-medium italic`}>"{product.description || 'Uma obra prima gastronômica curada especialmente para o Becoartes.'}"</p>
             </div>
          </div>
          <div className={`${contentPanelClass} flex flex-col overflow-hidden bg-[#0a0a0c]/80 relative`}>
             <button onClick={onClose} className={`${tabletLandscape ? 'top-5 right-5 p-3' : 'top-8 right-8 p-4'} absolute glass rounded-full hover:bg-white/10 text-white z-[400]`}><X size={tabletLandscape ? 24 : 32}/></button>
             <div className="flex justify-between items-center mb-8 lg:hidden">
                <h2 className="text-4xl font-black italic">{product.name}</h2>
             </div>

             <div className={`flex-1 min-h-0 overflow-y-auto custom-scrollbar pr-3 min-[900px]:pr-4 ${tabletLandscape ? 'space-y-4 min-[900px]:space-y-6' : 'space-y-10'}`}>
                {product.modifierGroups?.map(group => {
                  const selectedInGroup = selectedModifiers.filter(m => group.modifiers.some(gm => gm.id === m.id));
                  const isSingle = group.maxChoices === 1;

                  return (
                    <div key={group.id} className="space-y-5">
                      <div className="flex justify-between items-start sticky top-0 bg-[#0a0a0c]/95 py-3 z-10 backdrop-blur-md">
                        <div>
                          <h4 className="text-lg font-black uppercase tracking-[0.12em] text-white leading-tight pr-4">{group.name}</h4>
                          <p className="mt-2 flex items-center gap-2 text-[10px] text-gray-500 font-black uppercase tracking-[0.16em]">
                            <span className="w-2 h-2 rounded-full bg-accent shadow-[0_0_16px_rgba(255,210,30,0.8)]" />
                            {isSingle ? 'Escolha 1 adicional' : `Escolha de ${group.minChoices} a ${group.maxChoices}`}
                          </p>
                        </div>
                        {group.isRequired && (
                          <span className="bg-accent text-black px-3 py-2 rounded-full text-[9px] font-black uppercase tracking-widest shadow-lg shadow-accent/20">Obrigatório</span>
                        )}
                      </div>
                      <div className="grid grid-cols-1 gap-4">
                        {group.modifiers.map(m => {
                          const isSelected = selectedModifiers.find(sm => sm.id === m.id);
                          return (
                            <motion.button
                              key={m.id} 
                              type="button"
                              animate={isSelected ? { y: 0 } : { y: [0, -5, 0] }}
                              transition={isSelected ? { duration: 0.15 } : { repeat: Infinity, duration: 1.45, ease: 'easeInOut' }}
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
                              className={`w-full ${tabletLandscape ? 'min-h-[78px] grid-cols-[48px_1fr_auto] gap-4 p-4' : 'min-h-[88px] grid-cols-[54px_1fr_auto] gap-5 p-5'} grid items-center rounded-[1.7rem] border text-left transition-all ${
                                isSelected
                                  ? 'bg-gradient-to-br from-primary to-[#6f2dff] border-primary text-white shadow-2xl shadow-primary/30'
                                  : 'bg-gradient-to-br from-accent to-[#ffad1f] border-accent text-black shadow-xl shadow-accent/20 hover:scale-[1.015]'
                              }`}
                            >
                              <div className={`${tabletLandscape ? 'w-12 h-12' : 'w-[54px] h-[54px]'} rounded-2xl flex items-center justify-center border text-xl font-black ${
                                isSelected ? 'bg-white text-primary border-white' : 'bg-black/10 text-black border-black/10'
                              }`}>
                                {isSelected ? <Check size={26} strokeWidth={5} /> : '+'}
                              </div>
                              <div className="min-w-0">
                                <span className={`block font-black ${tabletLandscape ? 'text-lg' : 'text-xl'} tracking-tight leading-tight`}>{m.name}</span>
                                <span className={`mt-1 block text-[10px] font-black uppercase tracking-[0.16em] ${isSelected ? 'text-white/65' : 'text-black/55'}`}>
                                  {isSelected ? 'Selecionado, toque para remover' : 'Toque para adicionar'}
                                </span>
                              </div>
                              {m.price > 0 && <span className={`${tabletLandscape ? 'text-lg' : 'text-xl'} font-black whitespace-nowrap ${isSelected ? 'text-accent' : 'text-black'}`}>+ {formatCurrency(m.price)}</span>}
                            </motion.button>
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

             <div className={`${tabletLandscape ? 'mt-4 pt-4 space-y-3 min-[900px]:mt-5 min-[900px]:pt-5 min-[900px]:space-y-4' : 'mt-8 pt-8 space-y-6'} border-t border-white/10 shrink-0`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4 glass p-2 rounded-2xl border-white/5">
                     <button onClick={() => setQuantity(Math.max(1, quantity - 1))} className="w-10 h-10 flex items-center justify-center font-black text-xl hover:text-primary transition-all">-</button>
                     <span className="text-xl font-black w-8 text-center">{quantity}</span>
                     <button onClick={() => setQuantity(quantity + 1)} className="w-10 h-10 flex items-center justify-center font-black text-xl hover:text-primary transition-all">+</button>
                  </div>
                  <div className="text-right">
                     <p className="text-[10px] font-black uppercase text-gray-500 mb-1">Total do Item</p>
                     <p className={`${tabletLandscape ? 'text-3xl' : 'text-4xl'} font-black text-accent tracking-tighter`}>{formatCurrency(totalPrice)}</p>
                  </div>
                </div>

                <button 
                onClick={handleAdd}
                className={`${tabletLandscape ? 'py-5 min-[900px]:py-6 text-sm min-[900px]:text-base' : 'py-8 text-2xl'} w-full btn-beco btn-beco-purple font-black tracking-widest rounded-3xl shadow-xl shadow-primary/20 flex items-center justify-center gap-4`}
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
