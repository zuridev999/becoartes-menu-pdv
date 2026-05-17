import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { X, Wallet, CreditCard, Banknote, Trash2, CheckCircle2, ChevronRight } from 'lucide-react';
import { useStore, type Table as TableType } from '../../store';

interface Payment {
  method: 'credit' | 'debit' | 'cash' | 'pix';
  amount: number;
}

export function CheckoutModal({ table, onClose }: { table: TableType, onClose: () => void }) {
  const { closeBill, settings, sellers, currentSeller } = useStore();
  const [selectedSellerId, setSelectedSellerId] = useState<string>(currentSeller?.id || '');
  const [serviceFeeEnabled, setServiceFeeEnabled] = useState(true);
  const [serviceFeePercent] = useState(settings.serviceTax || 13);
  const [discountValue, setDiscountValue] = useState(0);
  const [discountType, setDiscountType] = useState<'fixed' | 'percent'>('fixed');
  const [discountReason] = useState('');
  const [payments, setPayments] = useState<Payment[]>([]);
  const [currentMethod, setCurrentMethod] = useState<Payment['method']>('credit');
  const sellerOptions = sellers.some(s => s.id === currentSeller?.id)
    ? sellers
    : currentSeller ? [currentSeller, ...sellers] : sellers;
  
  const subtotal = table.orders.reduce((acc: number, o: any) => {
    const itemPrice = o.price + (o.selectedModifiers || []).reduce((mAcc: number, m: any) => mAcc + m.price, 0);
    return acc + (itemPrice * o.quantity);
  }, 0);

  const feeValue = serviceFeeEnabled ? subtotal * (serviceFeePercent / 100) : 0;
  const discountAmountValue = discountType === 'fixed' ? discountValue : subtotal * (discountValue / 100);
  const totalFinal = subtotal + feeValue - discountAmountValue;
  const paidTotal = payments.reduce((acc: number, p: any) => acc + p.amount, 0);
  const diff = Number((totalFinal - paidTotal).toFixed(2));
  const remaining = Math.max(0, diff);
  const change = Math.max(0, -diff);

  const [amountDigits, setAmountDigits] = useState<string>(() => {
    return Math.round(remaining * 100).toString();
  });

  useEffect(() => {
    setAmountDigits(Math.round(remaining * 100).toString());
  }, [remaining]);

  const currentAmountFormatted = (Number(amountDigits) / 100).toFixed(2);

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const rawVal = e.target.value;
    const cleanDigits = rawVal.replace(/\D/g, '');
    const finalDigits = cleanDigits.replace(/^0+/, '') || '0';
    if (finalDigits.length > 9) return;
    setAmountDigits(finalDigits);
  };

  const handleAddPayment = () => {
    const val = Number(currentAmountFormatted);
    if (val <= 0) return;
    setPayments([...payments, { method: currentMethod, amount: val }]);
  };

  const handleFinish = async () => {
    const seller = sellerOptions.find(s => s.id === selectedSellerId);
    const success = await closeBill({
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

    if (success) {
      onClose();
    }
  };

  return (
    <>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} className="fixed inset-0 bg-black/90 backdrop-blur-3xl z-[400]" />
      <motion.div initial={{ y: 100, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 100, opacity: 0 }} className="fixed inset-0 z-[450] flex items-center justify-center p-6 pointer-events-none font-['Outfit']">
        <div className="glass-card w-full max-w-7xl h-[85vh] flex overflow-hidden pointer-events-auto border-white/10 shadow-2xl">
           {/* Esquerda: Resumo */}
           <div className="w-1/3 p-8 bg-white/5 flex flex-col border-r border-white/5">
              <div className="flex justify-between items-center mb-6">
                 <h2 className="text-3xl font-black italic tracking-tighter">Resumo <span className="text-primary">Mesa {table.number}</span></h2>
                 <button onClick={onClose} className="p-2.5 glass rounded-xl hover:text-rose-500"><X size={20}/></button>
              </div>

              <div className="flex-1 overflow-y-auto space-y-4 pr-2 custom-scrollbar">
                 {table.orders.map((o: any, idx: number) => {
                   const modifiersTotal = o.selectedModifiers?.reduce((mAcc: number, m: any) => mAcc + m.price, 0) || 0;
                   return (
                    <div key={idx} className="space-y-1 pb-3 border-b border-white/5">
                       <div className="flex justify-between items-start">
                          <div>
                             <p className="font-bold text-base">{o.quantity}x {o.name}</p>
                             <p className="text-[9px] text-gray-500 uppercase font-black">{o.categoryName || o.category}</p>
                          </div>
                          <p className="font-black text-white/70 text-sm">R$ {((o.price + modifiersTotal) * o.quantity).toFixed(2)}</p>
                       </div>
                       {o.selectedModifiers?.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {o.selectedModifiers.map((m: any) => (
                              <span key={m.id} className="text-[8px] font-black bg-white/5 px-1.5 py-0.5 rounded text-gray-400">+{m.name}</span>
                            ))}
                          </div>
                       )}
                       {o.notes && (
                          <p className="text-[9px] text-rose-400 font-bold italic">"{o.notes}"</p>
                       )}
                    </div>
                   );
                 })}
              </div>

              <div className="mt-6 space-y-3 pt-6 border-t border-white/10 text-sm">
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
                 <div className="flex justify-between text-3xl font-black text-accent pt-3 border-t border-white/5 italic tracking-tighter"><span>Total</span><span>R$ {totalFinal.toFixed(2)}</span></div>
              </div>
           </div>

           {/* Direita: Pagamento */}
           <div className="flex-1 p-10 flex flex-col bg-[#0d0d0f] overflow-y-auto custom-scrollbar">
              <div className="grid grid-cols-2 gap-8 mb-8">
                 <div>
                    <h4 className="text-[10px] font-black uppercase tracking-widest text-gray-500 mb-3">Operador Responsável</h4>
                    <select 
                       value={selectedSellerId} 
                       onChange={(e) => setSelectedSellerId(e.target.value)}
                       className="w-full glass p-4 rounded-xl border-white/10 outline-none font-bold text-base bg-transparent"
                    >
                       <option value="">Selecione o Vendedor</option>
                       {sellerOptions.filter((s: any) => s.status === 'active').map((s: any) => (
                         <option key={s.id} value={s.id} className="bg-[#0d0d0f]">{s.name}</option>
                       ))}
                    </select>
                 </div>
                 <div>
                    <h4 className="text-[10px] font-black uppercase tracking-widest text-gray-500 mb-3">Desconto Especial</h4>
                    <div className="flex gap-3">
                       <input 
                         type="number" 
                         value={discountValue} 
                         onChange={(e) => setDiscountValue(Number(e.target.value))}
                         className="flex-1 glass p-4 rounded-xl border-white/10 outline-none font-bold text-base"
                         placeholder="Valor..."
                       />
                       <button 
                         onClick={() => setDiscountType(discountType === 'fixed' ? 'percent' : 'fixed')}
                         className="px-4 glass rounded-xl font-black text-primary text-sm"
                       >
                         {discountType === 'fixed' ? 'R$' : '%'}
                       </button>
                    </div>
                 </div>
              </div>

              <div className="flex-1 flex flex-col">
                 <h4 className="text-[10px] font-black uppercase tracking-widest text-gray-500 mb-4">Fluxo de Caixa</h4>
                 
                 <div className="grid grid-cols-4 gap-4 mb-6">
                    {[
                      { id: 'credit', name: 'Crédito', icon: CreditCard },
                      { id: 'debit', name: 'Débito', icon: CreditCard },
                      { id: 'pix', name: 'PIX', icon: Wallet },
                      { id: 'cash', name: 'Dinheiro', icon: Banknote },
                    ].map(m => (
                      <button 
                        key={m.id}
                        onClick={() => setCurrentMethod(m.id as any)}
                        className={`p-6 rounded-2xl border transition-all flex flex-col items-center gap-3 ${currentMethod === m.id ? 'bg-primary border-primary shadow-2xl shadow-primary/20 scale-105' : 'glass border-white/5 opacity-50 hover:opacity-100'}`}
                      >
                        <m.icon size={26} />
                        <span className="font-black uppercase text-[9px] tracking-widest">{m.name}</span>
                      </button>
                    ))}
                 </div>

                 <div className="flex gap-4 items-center mb-6">
                    <div className="flex-1 relative">
                       <span className="absolute left-5 top-1/2 -translate-y-1/2 font-black text-xl text-gray-500">R$</span>
                       <input 
                         type="text"
                         inputMode="numeric"
                         value={currentAmountFormatted}
                         onChange={handleAmountChange}
                         className="w-full glass py-4 pl-12 pr-6 rounded-2xl text-4xl font-black text-accent outline-none border-white/10"
                       />
                    </div>
                    <button 
                       onClick={handleAddPayment}
                       className="py-4 px-8 btn-beco btn-beco-purple text-base font-black rounded-2xl"
                    >
                       Lançar Valor
                    </button>
                 </div>

                 <div className="space-y-3">
                    {payments.map((p, idx) => (
                      <div key={idx} className="flex justify-between items-center p-4 glass rounded-xl border-white/5 animate-in slide-in-from-right duration-300">
                         <div className="flex items-center gap-3">
                            <CheckCircle2 className="text-emerald-500" size={20}/>
                            <div>
                               <p className="font-black text-base uppercase tracking-wider">{p.method}</p>
                               <p className="text-[9px] text-gray-500 font-bold uppercase">Confirmado</p>
                            </div>
                         </div>
                         <div className="flex items-center gap-6">
                            <p className="text-xl font-black text-white">R$ {p.amount.toFixed(2)}</p>
                            <button onClick={() => setPayments(payments.filter((_, i) => i !== idx))} className="text-rose-500 p-1.5 hover:bg-rose-500/10 rounded-lg"><Trash2 size={18}/></button>
                         </div>
                      </div>
                    ))}
                 </div>
              </div>

              <div className="mt-6 pt-6 border-t border-white/10 flex items-center justify-between">
                 <div className="flex flex-col">
                    <span className="text-[9px] font-black uppercase text-gray-500 mb-1">Troco a Devolver</span>
                    <span className="text-4xl font-black text-emerald-400">R$ {change.toFixed(2)}</span>
                 </div>
                 <div className="flex flex-col items-end">
                    <span className="text-[9px] font-black uppercase text-gray-500 mb-1">Restante</span>
                    <span className={`text-4xl font-black ${remaining > 0 ? 'text-rose-500 animate-pulse' : 'text-emerald-400'}`}>R$ {remaining.toFixed(2)}</span>
                 </div>
              </div>

              <button 
                 disabled={remaining > 0 || !selectedSellerId}
                 onClick={handleFinish}
                 className="w-full btn-beco btn-beco-purple py-5 text-2xl font-black mt-6 shadow-2xl shadow-primary/40 disabled:opacity-20 disabled:grayscale transition-all flex items-center justify-center gap-4 group rounded-2xl"
              >
                 FINALIZAR CONTA <ChevronRight className="group-hover:translate-x-2 transition-transform" size={26}/>
              </button>
              {(remaining > 0 || !selectedSellerId) && (
                <p className="text-center text-[9px] font-black uppercase tracking-[0.2em] text-rose-500 mt-3 animate-pulse">
                  {!selectedSellerId ? 'Selecione o Operador para liberar' : `Falta receber R$ ${remaining.toFixed(2)}`}
                </p>
              )}
           </div>
        </div>
      </motion.div>
    </>
  );
}
