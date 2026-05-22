import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { X, Wallet, CreditCard, Banknote, Trash2, CheckCircle2, ChevronRight } from 'lucide-react';
import { useStore, type Table as TableType } from '../../store';
import { calculateBillTotal, calculateServiceFee, clampServiceFeePercent, formatPercent, MAX_SERVICE_FEE_PERCENT, roundMoney } from '../../lib/billing';
import { can } from '../../lib/permissions';

interface Payment {
  method: 'credit' | 'debit' | 'cash' | 'pix';
  amount: number;
}

export function CheckoutModal({ table, onClose }: { table: TableType, onClose: () => void }) {
  const { closeBill, settings, sellers, currentSeller } = useStore();
  const [selectedSellerId, setSelectedSellerId] = useState<string>(currentSeller?.id || '');
  const defaultServiceFeePercent = clampServiceFeePercent(Number(settings.serviceTax ?? MAX_SERVICE_FEE_PERCENT));
  const [serviceFeePercent, setServiceFeePercent] = useState(defaultServiceFeePercent);
  const [discountValue, setDiscountValue] = useState(0);
  const [discountType, setDiscountType] = useState<'fixed' | 'percent'>('fixed');
  const [discountReason] = useState('');
  const [payments, setPayments] = useState<Payment[]>([]);
  const [currentMethod, setCurrentMethod] = useState<Payment['method']>('credit');
  const sellerOptions = sellers.some(s => s.id === currentSeller?.id)
    ? sellers
    : currentSeller ? [currentSeller, ...sellers] : sellers;
  const canApplyDiscount = can(currentSeller, 'applyDiscount', settings.pdvPermissions);
  const canEditServiceFee = can(currentSeller, 'editServiceFee', settings.pdvPermissions);
  const canLaunchPayment = can(currentSeller, 'launchPayment', settings.pdvPermissions);
  const canSplitPayment = can(currentSeller, 'splitPayment', settings.pdvPermissions);
  const canChangePaymentMethod = can(currentSeller, 'changePaymentMethod', settings.pdvPermissions);
  const canCancelPayment = can(currentSeller, 'cancelPayment', settings.pdvPermissions);
  const canCloseBill = can(currentSeller, 'closeBill', settings.pdvPermissions);
  
  const subtotal = roundMoney(table.orders.reduce((acc: number, o: any) => {
    const itemPrice = o.price + (o.selectedModifiers || []).reduce((mAcc: number, m: any) => mAcc + m.price, 0);
    return acc + (itemPrice * o.quantity);
  }, 0));

  const feeValue = calculateServiceFee(subtotal, serviceFeePercent);
  const rawDiscountAmount = discountType === 'fixed'
    ? discountValue
    : subtotal * (Math.min(100, Math.max(0, discountValue)) / 100);
  const discountAmountValue = canApplyDiscount ? roundMoney(Math.min(subtotal + feeValue, Math.max(0, rawDiscountAmount))) : 0;
  const totalFinal = calculateBillTotal({ subtotal, serviceFee: feeValue, discount: discountAmountValue });
  const paidTotal = roundMoney(payments.reduce((acc: number, p: any) => acc + p.amount, 0));
  const diff = Number((totalFinal - paidTotal).toFixed(2));
  const remaining = Math.max(0, diff);
  const change = Math.max(0, -diff);
  const hasCashPayment = payments.some((payment) => payment.method === 'cash');
  const hasInvalidOverpayment = paidTotal > totalFinal && !hasCashPayment;

  const [amountDigits, setAmountDigits] = useState<string>(() => {
    return Math.round(remaining * 100).toString();
  });

  useEffect(() => {
    setAmountDigits(Math.round(remaining * 100).toString());
  }, [remaining]);

  useEffect(() => {
    setServiceFeePercent(defaultServiceFeePercent);
  }, [defaultServiceFeePercent]);

  const currentPaymentAmount = Number(amountDigits) / 100;
  const currentPaymentCreatesInvalidChange = roundMoney(paidTotal + currentPaymentAmount) > totalFinal
    && currentMethod !== 'cash'
    && !hasCashPayment;
  const currentAmountFormatted = (Number(amountDigits) / 100).toFixed(2);

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const rawVal = e.target.value;
    const cleanDigits = rawVal.replace(/\D/g, '');
    const finalDigits = cleanDigits.replace(/^0+/, '') || '0';
    if (finalDigits.length > 9) return;
    setAmountDigits(finalDigits);
  };

  const handleAddPayment = () => {
    if (!canLaunchPayment) return;
    if (payments.length >= 1 && !canSplitPayment) return;
    const val = currentPaymentAmount;
    if (val <= 0) return;
    const nextPaidTotal = roundMoney(paidTotal + val);
    if (nextPaidTotal > totalFinal && currentMethod !== 'cash' && !hasCashPayment) return;
    setPayments([...payments, { method: currentMethod, amount: val }]);
  };

  const handleFinish = async () => {
    if (hasInvalidOverpayment || remaining > 0 || !selectedSellerId || !canLaunchPayment || !canCloseBill) return;
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
                 <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 space-y-3">
                    <div className="flex justify-between text-gray-300 font-black items-center">
                       <span>Taxa de serviço ({formatPercent(serviceFeePercent)}%)</span>
                       <span>R$ {feeValue.toFixed(2)}</span>
                    </div>
                    {canEditServiceFee ? (
                      <>
                        <p className="text-[9px] font-black uppercase tracking-widest text-amber-200/80">
                          Controle separado do desconto. A taxa pode ir de 0% a 13%.
                        </p>
                        <div className="flex items-center gap-2">
                          {[0, 1, 5, 10, 13].map((percent) => (
                            <button
                              key={percent}
                              onClick={() => setServiceFeePercent(percent)}
                              className={`px-3 py-2 rounded-xl text-[10px] font-black border transition-all ${serviceFeePercent === percent ? 'bg-primary text-white border-primary' : 'border-white/10 text-gray-400 hover:text-white'}`}
                            >
                              {percent}%
                            </button>
                          ))}
                          <input
                            type="number"
                            min={0}
                            max={MAX_SERVICE_FEE_PERCENT}
                            step={0.01}
                            value={serviceFeePercent}
                            onChange={(e) => setServiceFeePercent(clampServiceFeePercent(Number(e.target.value)))}
                            className="ml-auto w-20 glass px-3 py-2 rounded-xl border-white/10 outline-none text-right font-black text-primary"
                          />
                        </div>
                        {serviceFeePercent > 0 && (
                          <button
                            onClick={() => setServiceFeePercent(0)}
                            className="w-full py-2 rounded-xl border border-amber-500/20 text-amber-300 text-[10px] font-black uppercase tracking-widest hover:bg-amber-500/10"
                          >
                            Remover taxa de serviço
                          </button>
                        )}
                      </>
                    ) : (
                      <p className="text-[9px] font-black uppercase tracking-widest text-gray-600">Sem permissão para alterar a taxa de serviço.</p>
                    )}
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
                 <div className={canApplyDiscount ? '' : 'opacity-40'}>
                    <h4 className="text-[10px] font-black uppercase tracking-widest text-gray-500 mb-3">Desconto Especial</h4>
                    {!canApplyDiscount && (
                      <p className="mb-2 text-[9px] font-black uppercase tracking-widest text-rose-300">
                        Desconto bloqueado. Taxa de serviço é controlada separadamente.
                      </p>
                    )}
                    <div className="flex gap-3">
                       <input 
                         type="number" 
                         value={discountValue} 
                         onChange={(e) => canApplyDiscount && setDiscountValue(Number(e.target.value))}
                         disabled={!canApplyDiscount}
                         className="flex-1 glass p-4 rounded-xl border-white/10 outline-none font-bold text-base"
                         placeholder={canApplyDiscount ? 'Valor...' : 'Sem permissão'}
                       />
                       <button 
                         onClick={() => canApplyDiscount && setDiscountType(discountType === 'fixed' ? 'percent' : 'fixed')}
                         disabled={!canApplyDiscount}
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
                        onClick={() => canChangePaymentMethod && setCurrentMethod(m.id as any)}
                        disabled={!canChangePaymentMethod}
                        className={`p-6 rounded-2xl border transition-all flex flex-col items-center gap-3 ${currentMethod === m.id ? 'bg-primary border-primary shadow-2xl shadow-primary/20 scale-105' : 'glass border-white/5 opacity-50 hover:opacity-100'} ${!canChangePaymentMethod ? 'cursor-not-allowed grayscale' : ''}`}
                      >
                        <m.icon size={26} />
                        <span className="font-black uppercase text-[9px] tracking-widest">{m.name}</span>
                      </button>
                    ))}
                 </div>
                 {!canChangePaymentMethod && (
                   <p className="mb-5 text-[10px] font-black uppercase tracking-widest text-amber-300">
                     Forma de pagamento fixa em crédito para este perfil.
                   </p>
                 )}

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
                       disabled={!canLaunchPayment || (payments.length >= 1 && !canSplitPayment) || currentPaymentCreatesInvalidChange}
                       className="py-4 px-8 btn-beco btn-beco-purple text-base font-black rounded-2xl disabled:opacity-30 disabled:grayscale"
                    >
                       Lançar Valor
                    </button>
                 </div>
                 {!canLaunchPayment && (
                   <p className="mb-5 text-[10px] font-black uppercase tracking-widest text-rose-400">
                     Seu perfil não pode lançar pagamentos.
                   </p>
                 )}
                 {canLaunchPayment && payments.length >= 1 && !canSplitPayment && (
                   <p className="mb-5 text-[10px] font-black uppercase tracking-widest text-amber-300">
                     Seu perfil não pode dividir pagamento em mais de uma forma.
                   </p>
                 )}
                 {(hasInvalidOverpayment || currentPaymentCreatesInvalidChange) && (
                   <p className="mb-5 text-[10px] font-black uppercase tracking-widest text-rose-400">
                     Valor acima do total só é permitido em dinheiro, porque gera troco.
                   </p>
                 )}

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
                            <button
                              onClick={() => canCancelPayment && setPayments(payments.filter((_, i) => i !== idx))}
                              disabled={!canCancelPayment}
                              className="text-rose-500 p-1.5 hover:bg-rose-500/10 rounded-lg disabled:opacity-20 disabled:cursor-not-allowed"
                              title={canCancelPayment ? 'Remover pagamento' : 'Sem permissão para cancelar pagamento'}
                            >
                              <Trash2 size={18}/>
                            </button>
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
                 disabled={remaining > 0 || hasInvalidOverpayment || !selectedSellerId || !canLaunchPayment || !canCloseBill}
                 onClick={handleFinish}
                 className="w-full btn-beco btn-beco-purple py-5 text-2xl font-black mt-6 shadow-2xl shadow-primary/40 disabled:opacity-20 disabled:grayscale transition-all flex items-center justify-center gap-4 group rounded-2xl"
              >
                 FINALIZAR CONTA <ChevronRight className="group-hover:translate-x-2 transition-transform" size={26}/>
              </button>
              {(remaining > 0 || hasInvalidOverpayment || !selectedSellerId || !canLaunchPayment || !canCloseBill) && (
                <p className="text-center text-[9px] font-black uppercase tracking-[0.2em] text-rose-500 mt-3 animate-pulse">
                  {!canCloseBill ? 'Sem permissão para fechar conta' : !canLaunchPayment ? 'Sem permissão para lançar pagamento' : !selectedSellerId ? 'Selecione o Operador para liberar' : hasInvalidOverpayment ? 'Troco só pode existir em pagamento em dinheiro' : `Falta receber R$ ${remaining.toFixed(2)}`}
                </p>
              )}
           </div>
        </div>
      </motion.div>
    </>
  );
}
