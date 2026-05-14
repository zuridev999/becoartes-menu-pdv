import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { X, Wallet, CreditCard, Banknote, Trash2, CheckCircle2, ChevronRight } from 'lucide-react';
import { useStore, type Table as TableType } from '../../store';

interface Payment {
  method: 'credit' | 'debit' | 'cash' | 'pix';
  amount: number;
}

export function CheckoutModal({ table, onClose }: { table: TableType, onClose: () => void }) {
  const { closeBill, settings, addNotification, sellers, currentSeller } = useStore();
  const [selectedSellerId, setSelectedSellerId] = useState<string>(currentSeller?.id || '');
  const [serviceFeeEnabled, setServiceFeeEnabled] = useState(true);
  const [serviceFeePercent] = useState(settings.serviceTax || 13);
  const [discountValue, setDiscountValue] = useState(0);
  const [discountType, setDiscountType] = useState<'fixed' | 'percent'>('fixed');
  const [discountReason] = useState('');
  const [payments, setPayments] = useState<Payment[]>([]);
  const [currentMethod, setCurrentMethod] = useState<Payment['method']>('credit');
  
  const subtotal = table.orders.reduce((acc: number, o: any) => {
    const itemPrice = o.price + o.selectedModifiers.reduce((mAcc: number, m: any) => mAcc + m.price, 0);
    return acc + (itemPrice * o.quantity);
  }, 0);

  const feeValue = serviceFeeEnabled ? subtotal * (serviceFeePercent / 100) : 0;
  const discountAmountValue = discountType === 'fixed' ? discountValue : subtotal * (discountValue / 100);
  const totalFinal = subtotal + feeValue - discountAmountValue;
  const paidTotal = payments.reduce((acc: number, p: any) => acc + p.amount, 0);
  const remaining = Math.max(0, totalFinal - paidTotal);
  const change = Math.max(0, paidTotal - totalFinal);

  const [currentAmount, setCurrentAmount] = useState<string>(remaining.toString());

  useEffect(() => {
    if (Number(currentAmount) === 0 || currentAmount === '') {
      setCurrentAmount(remaining.toFixed(2));
    }
  }, [remaining]);

  const handleAddPayment = () => {
    const val = Number(currentAmount);
    if (val <= 0) return;
    setPayments([...payments, { method: currentMethod, amount: val }]);
    setCurrentAmount('');
  };

  const handleFinish = async () => {
    const seller = sellers.find(s => s.id === selectedSellerId);
    await closeBill({
      tableId: table.id,
      tableNumber: table.number,
      sellerId: selectedSellerId,
      sellerName: seller?.name || 'Sistema',
      subtotal,
      serviceFee: feeValue,
      discount: discountAmountValue,
      discountReason,
      total: totalFinal,
      payments
    });
    addNotification(`Conta da Mesa ${table.number} fechada com sucesso!`, 'info');
    onClose();
  };

  return (
    <>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} className="fixed inset-0 bg-black/90 backdrop-blur-3xl z-[400]" />
      <motion.div initial={{ y: 100, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 100, opacity: 0 }} className="fixed inset-0 z-[450] flex items-center justify-center p-12 pointer-events-none font-['Outfit']">
        <div className="glass-card w-full max-w-7xl h-[90vh] flex overflow-hidden pointer-events-auto border-white/10 shadow-2xl">
           {/* Esquerda: Resumo */}
           <div className="w-1/3 p-12 bg-white/5 flex flex-col border-r border-white/5">
              <div className="flex justify-between items-center mb-12">
                 <h2 className="text-4xl font-black italic tracking-tighter">Resumo <span className="text-primary">Mesa {table.number}</span></h2>
                 <button onClick={onClose} className="p-3 glass rounded-xl hover:text-rose-500"><X size={24}/></button>
              </div>

              <div className="flex-1 overflow-y-auto space-y-6 pr-4 custom-scrollbar">
                 {table.orders.map((o: any, idx: number) => {
                   const modifiersTotal = o.selectedModifiers?.reduce((mAcc: number, m: any) => mAcc + m.price, 0) || 0;
                   return (
                    <div key={idx} className="space-y-2 pb-4 border-b border-white/5">
                       <div className="flex justify-between items-start">
                          <div>
                             <p className="font-bold text-lg">{o.quantity}x {o.name}</p>
                             <p className="text-[10px] text-gray-500 uppercase font-black">{o.categoryName || o.category}</p>
                          </div>
                          <p className="font-black text-white/70">R$ {((o.price + modifiersTotal) * o.quantity).toFixed(2)}</p>
                       </div>
                       {o.selectedModifiers?.length > 0 && (
                         <div className="flex flex-wrap gap-1">
                           {o.selectedModifiers.map((m: any) => (
                             <span key={m.id} className="text-[9px] font-black bg-white/5 px-2 py-0.5 rounded text-gray-400">+{m.name}</span>
                           ))}
                         </div>
                       )}
                       {o.notes && (
                         <p className="text-[10px] text-rose-400 font-bold italic">"{o.notes}"</p>
                       )}
                    </div>
                   );
                 })}
              </div>

              <div className="mt-12 space-y-4 pt-12 border-t border-white/10">
                 <div className="flex justify-between text-gray-400 font-bold"><span>Subtotal</span><span>R$ {subtotal.toFixed(2)}</span></div>
                 <div className="flex justify-between text-gray-400 font-bold items-center">
                    <button onClick={() => setServiceFeeEnabled(!serviceFeeEnabled)} className={`flex items-center gap-2 ${serviceFeeEnabled ? 'text-primary' : 'text-gray-600'}`}>
                       <div className={`w-4 h-4 rounded border flex items-center justify-center ${serviceFeeEnabled ? 'bg-primary border-primary' : 'border-gray-600'}`}>
                          {serviceFeeEnabled && <CheckCircle2 size={10} className="text-white"/>}
                       </div>
                       Taxa ({serviceFeePercent}%)
                    </button>
                    <span>R$ {feeValue.toFixed(2)}</span>
                 </div>
                 <div className="flex justify-between text-rose-400 font-bold"><span>Desconto</span><span>- R$ {discountAmountValue.toFixed(2)}</span></div>
                 <div className="flex justify-between text-4xl font-black text-accent pt-4 border-t border-white/5 italic tracking-tighter"><span>Total</span><span>R$ {totalFinal.toFixed(2)}</span></div>
              </div>
           </div>

           {/* Direita: Pagamento */}
           <div className="flex-1 p-16 flex flex-col bg-[#0d0d0f] overflow-y-auto custom-scrollbar">
              <div className="grid grid-cols-2 gap-16 mb-16">
                 <div>
                    <h4 className="text-xs font-black uppercase tracking-widest text-gray-500 mb-6">Operador Responsável</h4>
                    <select 
                       value={selectedSellerId} 
                       onChange={(e) => setSelectedSellerId(e.target.value)}
                       className="w-full glass p-5 rounded-2xl border-white/10 outline-none font-bold text-lg bg-transparent"
                    >
                       <option value="">Selecione o Vendedor</option>
                        {sellers.filter((s: any) => s.status === 'active').map((s: any) => (
                         <option key={s.id} value={s.id} className="bg-[#0d0d0f]">{s.name}</option>
                       ))}
                    </select>
                 </div>
                 <div>
                    <h4 className="text-xs font-black uppercase tracking-widest text-gray-500 mb-6">Desconto Especial</h4>
                    <div className="flex gap-4">
                       <input 
                         type="number" 
                         value={discountValue} 
                         onChange={(e) => setDiscountValue(Number(e.target.value))}
                         className="flex-1 glass p-5 rounded-2xl border-white/10 outline-none font-bold text-lg"
                         placeholder="Valor..."
                       />
                       <button 
                         onClick={() => setDiscountType(discountType === 'fixed' ? 'percent' : 'fixed')}
                         className="px-6 glass rounded-2xl font-black text-primary"
                       >
                         {discountType === 'fixed' ? 'R$' : '%'}
                       </button>
                    </div>
                 </div>
              </div>

              <div className="flex-1 flex flex-col">
                 <h4 className="text-xs font-black uppercase tracking-widest text-gray-500 mb-8">Fluxo de Caixa</h4>
                 
                 <div className="grid grid-cols-4 gap-6 mb-12">
                    {[
                      { id: 'credit', name: 'Crédito', icon: CreditCard },
                      { id: 'debit', name: 'Débito', icon: CreditCard },
                      { id: 'pix', name: 'PIX', icon: Wallet },
                      { id: 'cash', name: 'Dinheiro', icon: Banknote },
                    ].map(m => (
                      <button 
                        key={m.id}
                        onClick={() => setCurrentMethod(m.id as any)}
                        className={`p-8 rounded-3xl border transition-all flex flex-col items-center gap-4 ${currentMethod === m.id ? 'bg-primary border-primary shadow-2xl shadow-primary/20 scale-105' : 'glass border-white/5 opacity-50 hover:opacity-100'}`}
                      >
                        <m.icon size={32} />
                        <span className="font-black uppercase text-[10px] tracking-widest">{m.name}</span>
                      </button>
                    ))}
                 </div>

                 <div className="flex gap-6 items-center mb-12">
                    <div className="flex-1 relative">
                       <span className="absolute left-6 top-1/2 -translate-y-1/2 font-black text-2xl text-gray-500">R$</span>
                       <input 
                         type="number" 
                         value={currentAmount}
                         onChange={(e) => setCurrentAmount(e.target.value)}
                         className="w-full glass py-8 pl-16 pr-8 rounded-3xl text-5xl font-black text-accent outline-none border-white/10"
                       />
                    </div>
                    <button 
                       onClick={handleAddPayment}
                       className="h-full px-12 btn-beco btn-beco-purple text-xl font-black rounded-3xl"
                    >
                       Lançar Valor
                    </button>
                 </div>

                 <div className="space-y-4">
                    {payments.map((p, idx) => (
                      <div key={idx} className="flex justify-between items-center p-6 glass rounded-2xl border-white/5 animate-in slide-in-from-right duration-300">
                         <div className="flex items-center gap-4">
                            <CheckCircle2 className="text-emerald-500" size={24}/>
                            <div>
                               <p className="font-black text-lg uppercase tracking-wider">{p.method}</p>
                               <p className="text-[10px] text-gray-500 font-bold uppercase">Confirmado</p>
                            </div>
                         </div>
                         <div className="flex items-center gap-8">
                            <p className="text-2xl font-black text-white">R$ {p.amount.toFixed(2)}</p>
                            <button onClick={() => setPayments(payments.filter((_, i) => i !== idx))} className="text-rose-500 p-2 hover:bg-rose-500/10 rounded-lg"><Trash2 size={20}/></button>
                         </div>
                      </div>
                    ))}
                 </div>
              </div>

              <div className="mt-12 pt-12 border-t border-white/10 flex items-center justify-between">
                 <div className="flex flex-col">
                    <span className="text-[10px] font-black uppercase text-gray-500 mb-2">Troco a Devolver</span>
                    <span className="text-5xl font-black text-emerald-400">R$ {change.toFixed(2)}</span>
                 </div>
                 <div className="flex flex-col items-end">
                    <span className="text-[10px] font-black uppercase text-gray-500 mb-2">Restante</span>
                    <span className={`text-5xl font-black ${remaining > 0 ? 'text-rose-500 animate-pulse' : 'text-emerald-400'}`}>R$ {remaining.toFixed(2)}</span>
                 </div>
              </div>

              <button 
                 disabled={remaining > 0 || !selectedSellerId}
                 onClick={handleFinish}
                 className="w-full btn-beco btn-beco-purple py-10 text-3xl font-black mt-12 shadow-2xl shadow-primary/40 disabled:opacity-20 disabled:grayscale transition-all flex items-center justify-center gap-6 group"
              >
                 FINALIZAR CONTA <ChevronRight className="group-hover:translate-x-2 transition-transform" size={32}/>
              </button>
              {(remaining > 0 || !selectedSellerId) && (
                <p className="text-center text-[10px] font-black uppercase tracking-[0.2em] text-rose-500 mt-4 animate-pulse">
                  {!selectedSellerId ? 'Selecione o Operador para liberar' : `Falta receber R$ ${remaining.toFixed(2)}`}
                </p>
              )}
           </div>
        </div>
      </motion.div>
    </>
  );
}
