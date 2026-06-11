import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { X, Wallet, CreditCard, Banknote, Trash2, CheckCircle2, ChevronRight, Plus } from 'lucide-react';
import { useStore, type Seller, type Table as TableType } from '../../store';
import { calculateBillTotal, calculateServiceFee, clampServiceFeePercent, formatPercent, MAX_SERVICE_FEE_PERCENT, roundMoney } from '../../lib/billing';
import { can } from '../../lib/permissions';
import { AdminApi, OperationalApi, type SellerCandidate } from '../../lib/api';
import { ActionDialog } from '../common/ActionDialog';

interface Payment {
  id?: string;
  method: 'credit' | 'debit' | 'cash' | 'pix';
  amount: number;
  sellerName?: string;
  createdAt?: Date;
}

type PaymentMethod = Payment['method'];

const SELF_SERVICE_SELLER = {
  id: 'self-service',
  name: 'Cliente pediu sozinho',
  nickname: 'Self',
  status: 'active',
  role: 'outro',
  permission: 'operator',
} as const;

const PAYMENT_CANCEL_REASONS = [
  { code: 'forma_errada', label: 'Forma errada' },
  { code: 'valor_errado', label: 'Valor errado' },
  { code: 'mesa_errada', label: 'Mesa errada' },
  { code: 'cliente_desistiu', label: 'Cliente desistiu' },
  { code: 'correcao_administrativa', label: 'Correção administrativa' },
  { code: 'outro', label: 'Outro motivo' },
];

const paymentMethodLabels: Record<PaymentMethod, string> = {
  credit: 'Crédito',
  debit: 'Débito',
  pix: 'PIX / QR Code',
  cash: 'Dinheiro',
};

const TECHNICAL_SELLER_IDS = new Set(['admin-bootstrap', 'manager-default', 'operator-default', 'master']);
const TECHNICAL_SELLER_NAMES = new Set(['administrador', 'admin full', 'admin mestre', 'operador']);

const isCheckoutSeller = (seller: Seller) => {
  if (seller.status !== 'active') return false;
  if (TECHNICAL_SELLER_IDS.has(seller.id)) return false;
  const normalizedName = String(seller.name || '').trim().toLowerCase();
  return !TECHNICAL_SELLER_NAMES.has(normalizedName);
};

const normalizeSellerName = (value: string) => (
  String(value || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim()
    .toLowerCase()
);

type ValidatedCoupon = {
  code: string;
  amount: number;
  appliedAmount: number;
  customerName?: string;
  campaignName?: string;
  validUntil?: string;
  minOrderValue?: number;
  selectedBenefit?: string;
  benefitLabel?: string;
  requiresBenefitChoice?: boolean;
  benefitOptions?: Array<{ id: string; label: string }>;
};

export function CheckoutModal({ table, onClose }: { table: TableType, onClose: () => void }) {
  const { closeBill, settings, sellers, currentSeller, addNotification } = useStore();
  const [selectedSellerId, setSelectedSellerId] = useState<string>(SELF_SERVICE_SELLER.id);
  const defaultServiceFeePercent = clampServiceFeePercent(Number(settings.serviceTax ?? MAX_SERVICE_FEE_PERCENT));
  const [serviceFeePercent, setServiceFeePercent] = useState(defaultServiceFeePercent);
  const [discountValue, setDiscountValue] = useState(0);
  const [discountType, setDiscountType] = useState<'fixed' | 'percent'>('fixed');
  const [discountReason] = useState('');
  const [payments, setPayments] = useState<Payment[]>(() => table.payments || []);
  const [currentMethod, setCurrentMethod] = useState<PaymentMethod | null>(null);
  const [pendingPayment, setPendingPayment] = useState<{ method: PaymentMethod; amount: number } | null>(null);
  const [paymentCancelDialog, setPaymentCancelDialog] = useState<{ payment: Payment; index: number } | null>(null);
  const [paymentCancelReasonCode, setPaymentCancelReasonCode] = useState('');
  const [paymentCancelReasonNotes, setPaymentCancelReasonNotes] = useState('');
  const [isSavingPayment, setIsSavingPayment] = useState(false);
  const [couponInput, setCouponInput] = useState('');
  const [coupon, setCoupon] = useState<ValidatedCoupon | null>(null);
  const [couponMessage, setCouponMessage] = useState('');
  const [isApplyingCoupon, setIsApplyingCoupon] = useState(false);
  const [showAddSellerModal, setShowAddSellerModal] = useState(false);
  const [newSellerName, setNewSellerName] = useState('');
  const [newSellerPin, setNewSellerPin] = useState('1234');
  const [newSellerEmploymentType, setNewSellerEmploymentType] = useState<'fixo' | 'freelancer'>('fixo');
  const [sellerCandidates, setSellerCandidates] = useState<SellerCandidate[]>([]);
  const [isLoadingSellerCandidates, setIsLoadingSellerCandidates] = useState(false);
  const [activatingSellerCandidateId, setActivatingSellerCandidateId] = useState<string | null>(null);
  const [isCreatingOsSeller, setIsCreatingOsSeller] = useState(false);
  const rawSellerOptions = sellers.some(s => s.id === currentSeller?.id)
    ? sellers
    : currentSeller ? [currentSeller, ...sellers] : sellers;
  const sellerOptions = rawSellerOptions.filter(isCheckoutSeller);
  const sellerCandidateSearch = normalizeSellerName(newSellerName);
  const visibleSellerCandidates = useMemo(() => (
    sellerCandidates
      .filter((candidate) => !candidate.canSellInPdv)
      .filter((candidate) => {
        if (!sellerCandidateSearch) return true;
        return normalizeSellerName(candidate.name).includes(sellerCandidateSearch);
      })
      .slice(0, 8)
  ), [sellerCandidates, sellerCandidateSearch]);
  const selectedSeller = selectedSellerId === SELF_SERVICE_SELLER.id
    ? SELF_SERVICE_SELLER
    : sellerOptions.find(s => s.id === selectedSellerId);
  const canApplyDiscount = can(currentSeller, 'applyDiscount', settings.pdvPermissions, settings.pdvUserPermissions);
  const canEditServiceFee = can(currentSeller, 'editServiceFee', settings.pdvPermissions, settings.pdvUserPermissions);
  const canLaunchPayment = can(currentSeller, 'launchPayment', settings.pdvPermissions, settings.pdvUserPermissions);
  const canSplitPayment = can(currentSeller, 'splitPayment', settings.pdvPermissions, settings.pdvUserPermissions);
  const canChangePaymentMethod = can(currentSeller, 'changePaymentMethod', settings.pdvPermissions, settings.pdvUserPermissions);
  const canCancelPayment = can(currentSeller, 'cancelPayment', settings.pdvPermissions, settings.pdvUserPermissions);
  const canCloseBill = can(currentSeller, 'closeBill', settings.pdvPermissions, settings.pdvUserPermissions);
  const canManageSellers = can(currentSeller, 'managePDVUsers', settings.pdvPermissions, settings.pdvUserPermissions);
  
  const subtotal = roundMoney(table.orders.reduce((acc: number, o: any) => {
    const itemPrice = o.price + (o.selectedModifiers || []).reduce((mAcc: number, m: any) => mAcc + m.price, 0);
    return acc + (itemPrice * o.quantity);
  }, 0));

  const feeValue = calculateServiceFee(subtotal, serviceFeePercent);
  const rawDiscountAmount = discountType === 'fixed'
    ? discountValue
    : subtotal * (Math.min(100, Math.max(0, discountValue)) / 100);
  const discountAmountValue = canApplyDiscount ? roundMoney(Math.min(subtotal + feeValue, Math.max(0, rawDiscountAmount))) : 0;
  const totalBeforeCoupon = calculateBillTotal({ subtotal, serviceFee: feeValue, discount: discountAmountValue });
  const couponAmountValue = roundMoney(Math.min(coupon?.appliedAmount || 0, totalBeforeCoupon));
  const totalFinal = roundMoney(Math.max(0, totalBeforeCoupon - couponAmountValue));
  const paidTotal = roundMoney(payments.reduce((acc: number, p: any) => acc + p.amount, 0));
  const diff = Number((totalFinal - paidTotal).toFixed(2));
  const remaining = Math.max(0, diff);
  const change = Math.max(0, -diff);
  const hasCashPayment = payments.some((payment) => payment.method === 'cash');
  const hasInvalidOverpayment = paidTotal > totalFinal && !hasCashPayment;
  const hasPendingCouponChoice = Boolean(coupon?.requiresBenefitChoice);

  const handleCreateCheckoutSeller = async () => {
    const name = newSellerName.trim();
    const pin = newSellerPin.trim();
    if (!name) {
      addNotification('Nome do vendedor é obrigatório.', 'error');
      return;
    }
    if (!/^\d{4}$/.test(pin)) {
      addNotification('PIN deve ter 4 dígitos.', 'error');
      return;
    }

    setIsCreatingOsSeller(true);
    try {
      const result = await AdminApi.createOsSeller({ name, pin, employmentType: newSellerEmploymentType });
      const createdSeller = result.seller;
      if (!createdSeller?.id) {
        addNotification('Cadastro criado, mas não voltou como vendedor. Atualize e tente selecionar.', 'error');
        return;
      }
      useStore.setState((state) => ({
        sellers: [
          ...state.sellers.filter((seller) => seller.id !== createdSeller.id),
          createdSeller,
        ],
      }));
      setSelectedSellerId(createdSeller.id);
      addNotification(`${name} foi criado no OS e ativado como vendedor no PDV.`, 'info');
      setNewSellerName('');
      setNewSellerPin('1234');
      setNewSellerEmploymentType('fixo');
      setShowAddSellerModal(false);
    } catch (error) {
      console.error('Erro ao criar vendedor no OS:', error);
      addNotification(error instanceof Error ? error.message : 'Não foi possível criar este vendedor no OS.', 'error');
    } finally {
      setIsCreatingOsSeller(false);
    }
  };

  const handleActivateSellerCandidate = async (candidate: SellerCandidate) => {
    const pin = newSellerPin.trim();
    if (!candidate.hasPin && !/^\d{4}$/.test(pin)) {
      addNotification('Esse cadastro do OS ainda não tem PIN. Informe um PIN de 4 dígitos para ativar.', 'error');
      return;
    }

    setActivatingSellerCandidateId(candidate.id);
    try {
      const result = await AdminApi.activateSellerCandidate(candidate.id, candidate.hasPin ? undefined : pin);
      const activatedSeller = result.seller;
      if (!activatedSeller?.id) {
        addNotification('Cadastro ativado, mas não voltou como vendedor. Atualize e tente selecionar.', 'error');
        return;
      }
      useStore.setState((state) => ({
        sellers: [
          ...state.sellers.filter((seller) => seller.id !== activatedSeller.id),
          activatedSeller,
        ],
      }));
      setSelectedSellerId(activatedSeller.id);
      addNotification(`${candidate.name} agora aparece como vendedor no PDV.`, 'info');
      setNewSellerName('');
      setNewSellerPin('1234');
      setNewSellerEmploymentType('fixo');
      setShowAddSellerModal(false);
    } catch (error) {
      console.error('Erro ao ativar vendedor do OS:', error);
      addNotification(error instanceof Error ? error.message : 'Não foi possível ativar este vendedor.', 'error');
    } finally {
      setActivatingSellerCandidateId(null);
    }
  };

  const [amountDigits, setAmountDigits] = useState<string>(() => {
    return Math.round(remaining * 100).toString();
  });

  useEffect(() => {
    setAmountDigits(Math.round(remaining * 100).toString());
  }, [remaining]);

  useEffect(() => {
    setServiceFeePercent(defaultServiceFeePercent);
  }, [defaultServiceFeePercent]);

  useEffect(() => {
    setPayments(table.payments || []);
  }, [table.id, table.payments]);

  useEffect(() => {
    if (!showAddSellerModal) return;
    let cancelled = false;
    setIsLoadingSellerCandidates(true);
    AdminApi.listSellerCandidates()
      .then((result) => {
        if (!cancelled) setSellerCandidates(result.candidates || []);
      })
      .catch((error) => {
        console.error('Erro ao carregar candidatos de vendedor:', error);
        if (!cancelled) {
          setSellerCandidates([]);
          addNotification('Não foi possível carregar funcionários/freelas do OS agora.', 'error');
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoadingSellerCandidates(false);
      });
    return () => {
      cancelled = true;
    };
  }, [showAddSellerModal, addNotification]);

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

  const handleAddPayment = async () => {
    if (!canLaunchPayment) return;
    if (payments.length >= 1 && !canSplitPayment) return;
    if (!currentMethod) return;
    if (!selectedSeller) return;
    const val = currentPaymentAmount;
    if (val <= 0) return;
    const nextPaidTotal = roundMoney(paidTotal + val);
    if (nextPaidTotal > totalFinal && currentMethod !== 'cash' && !hasCashPayment) return;
    setPendingPayment({ method: currentMethod, amount: val });
  };

  const handleConfirmPayment = async () => {
    if (!pendingPayment || !canLaunchPayment || !selectedSeller) return;
    setIsSavingPayment(true);
    try {
      const result = await OperationalApi.createTablePayment({
        tableId: table.id,
        tableNumber: table.number,
        method: pendingPayment.method,
        amount: pendingPayment.amount,
        sellerId: selectedSeller.id,
        sellerName: selectedSeller.name,
      });
      setPayments([...payments, result.payment]);
      setPendingPayment(null);
      setCurrentMethod(null);
    } finally {
      setIsSavingPayment(false);
    }
  };

  const handleRemovePayment = async (payment: Payment, idx: number) => {
    if (!canCancelPayment) return;
    const reason = PAYMENT_CANCEL_REASONS.find(item => item.code === paymentCancelReasonCode);
    if (payment.id) {
      await OperationalApi.cancelTablePayment(payment.id, {
        reasonCode: reason?.code,
        reasonLabel: reason?.label,
        reasonNotes: paymentCancelReasonNotes.trim(),
      });
    }
    setPayments(payments.filter((_, i) => i !== idx));
  };

  const handleApplyCoupon = async (selectedBenefit?: string) => {
    const cleanCode = couponInput.trim();
    if (!cleanCode) return;
    setIsApplyingCoupon(true);
    setCouponMessage('');
    try {
      const result = await OperationalApi.validateCoupon({
        code: cleanCode,
        tableId: table.id,
        subtotal,
        serviceFee: feeValue,
        discount: discountAmountValue,
        selectedBenefit,
      });
      setCoupon(result.coupon);
      setCouponInput(result.coupon.code);
      if (result.coupon.requiresBenefitChoice) {
        setCouponMessage(`Cupom ${result.coupon.code} encontrado. Escolha o benefício do cliente.`);
      } else if (result.coupon.appliedAmount <= 0 && result.coupon.benefitLabel) {
        setCouponMessage(`Cupom ${result.coupon.code} aplicado: ${result.coupon.benefitLabel}.`);
      } else {
        setCouponMessage(`Cupom ${result.coupon.code} aplicado: R$ ${result.coupon.appliedAmount.toFixed(2)}`);
      }
    } catch (error) {
      setCoupon(null);
      setCouponMessage(error instanceof Error ? error.message : 'Cupom inválido.');
    } finally {
      setIsApplyingCoupon(false);
    }
  };

  const handleFinish = async () => {
    if (hasInvalidOverpayment || hasPendingCouponChoice || remaining > 0 || !selectedSeller || !canLaunchPayment || !canCloseBill) return;
    const success = await closeBill({
      tableId: table.id,
      tableNumber: table.number,
      sellerId: selectedSeller.id,
      sellerName: selectedSeller.name,
      subtotal,
      serviceFee: feeValue,
      discount: discountAmountValue,
      discountReason,
      couponCode: coupon?.code || '',
      couponAmount: couponAmountValue,
      couponBenefit: coupon?.selectedBenefit || '',
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
      <motion.div initial={{ y: 100, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 100, opacity: 0 }} className="fixed inset-0 z-[450] flex items-center justify-center p-2 sm:p-6 pointer-events-none font-['Outfit']">
        <div className="glass-card w-full max-w-7xl h-[calc(100dvh-1rem)] sm:h-[90dvh] lg:h-[85vh] flex flex-col lg:flex-row overflow-hidden pointer-events-auto border-white/10 shadow-2xl">
           {/* Esquerda: Resumo */}
           <div className="w-full lg:w-1/3 max-h-[38dvh] lg:max-h-none p-4 sm:p-6 lg:p-8 bg-white/5 flex flex-col border-b lg:border-b-0 lg:border-r border-white/5">
              <div className="flex justify-between items-center mb-4 lg:mb-6">
                 <h2 className="text-2xl sm:text-3xl font-black italic tracking-tighter">Resumo <span className="text-primary">Mesa {table.number}</span></h2>
                 <button onClick={onClose} className="p-2.5 glass rounded-xl hover:text-rose-500"><X size={20}/></button>
              </div>

              <div className="flex-1 overflow-y-auto space-y-3 lg:space-y-4 pr-2 custom-scrollbar">
                 {table.orders.map((o: any, idx: number) => {
                   const modifiersTotal = o.selectedModifiers?.reduce((mAcc: number, m: any) => mAcc + m.price, 0) || 0;
                   return (
                    <div key={idx} className="space-y-1 pb-3 border-b border-white/5">
                       <div className="flex justify-between items-start">
                          <div>
                             <p className="font-bold text-sm sm:text-base">{o.quantity}x {o.name}</p>
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

              <div className="mt-4 lg:mt-6 space-y-3 pt-4 lg:pt-6 border-t border-white/10 text-sm">
                 <div className="flex justify-between text-gray-400 font-bold"><span>Subtotal</span><span>R$ {subtotal.toFixed(2)}</span></div>
                 <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 space-y-3">
                    <div className="flex justify-between text-gray-200 font-black items-center gap-4">
                       <span className="text-base sm:text-lg">Taxa de serviço ({formatPercent(serviceFeePercent)}%)</span>
                       <span className="text-xl sm:text-2xl text-white">R$ {feeValue.toFixed(2)}</span>
                    </div>
                    {canEditServiceFee ? (
                      <>
                        <div className="flex flex-wrap items-center gap-2">
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
                            className="w-20 glass px-3 py-2 rounded-xl border-white/10 outline-none text-right font-black text-primary"
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
                 <div className="flex justify-between text-amber-300 font-bold">
                   <span>Cupom{coupon?.appliedAmount === 0 && coupon?.benefitLabel ? ` (${coupon.benefitLabel})` : ''}</span>
                   <span>- R$ {couponAmountValue.toFixed(2)}</span>
                 </div>
                 <div className="flex justify-between text-3xl font-black text-accent pt-3 border-t border-white/5 italic tracking-tighter"><span>Total</span><span>R$ {totalFinal.toFixed(2)}</span></div>
              </div>
           </div>

           {/* Direita: Pagamento */}
           <div className="flex-1 min-h-0 p-4 sm:p-6 lg:p-10 flex flex-col bg-[#0d0d0f] overflow-y-auto custom-scrollbar">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 lg:gap-8 mb-6 lg:mb-8">
                 <div>
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <h4 className="text-[10px] font-black uppercase tracking-widest text-gray-500">Vendedor responsável</h4>
                      {canManageSellers && (
                        <button
                          type="button"
                          onClick={() => setShowAddSellerModal(true)}
                          className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-3 py-1 text-[9px] font-black uppercase tracking-widest text-primary transition-all hover:bg-primary hover:text-white"
                        >
                          <Plus size={12} /> Add vendedor
                        </button>
                      )}
                    </div>
                    <select 
                       value={selectedSellerId} 
                       onChange={(e) => setSelectedSellerId(e.target.value)}
                       className="w-full glass p-4 rounded-xl border-white/10 outline-none font-bold text-base bg-transparent"
                    >
                       <option value={SELF_SERVICE_SELLER.id} className="bg-[#0d0d0f]">Cliente pediu sozinho</option>
                       {sellerOptions.map((s: any) => (
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

              <div className="rounded-xl border border-amber-400/15 bg-amber-400/[0.03] p-3 mb-4">
                <div className="flex flex-col sm:flex-row sm:items-end gap-2">
                  <div className="flex-1">
                    <h4 className="text-[9px] font-black uppercase tracking-widest text-amber-200/80 mb-2">Cupom</h4>
                  <input
                    value={couponInput}
                    onChange={(event) => {
                      setCouponInput(event.target.value.toUpperCase());
                      if (coupon) setCoupon(null);
                    }}
                    className="w-full glass px-3 py-3 rounded-lg border-white/10 outline-none font-black uppercase tracking-widest text-sm"
                    placeholder="Código"
                  />
                  </div>
                  <button
                    onClick={() => handleApplyCoupon()}
                    disabled={isApplyingCoupon || !couponInput.trim()}
                    className="px-5 py-3 rounded-lg bg-amber-300 text-black font-black uppercase tracking-widest text-[10px] disabled:opacity-40"
                  >
                    {isApplyingCoupon ? 'Validando...' : 'Aplicar'}
                  </button>
                  {coupon && (
                    <button
                      onClick={() => {
                        setCoupon(null);
                        setCouponMessage('Cupom removido desta conta.');
                      }}
                      className="px-3 py-3 rounded-lg border border-white/10 text-rose-300 font-black uppercase tracking-widest text-[10px]"
                    >
                      Remover
                    </button>
                  )}
                </div>
                {couponMessage && (
                  <p className={`mt-2 text-[9px] font-black uppercase tracking-widest ${coupon ? 'text-emerald-300' : 'text-rose-300'}`}>
                    {couponMessage}
                  </p>
                )}
                {coupon?.requiresBenefitChoice && (
                  <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {(coupon.benefitOptions || []).map((option, index) => (
                      <button
                        key={option.id}
                        onClick={() => handleApplyCoupon(option.id)}
                        disabled={isApplyingCoupon}
                        className={`rounded-lg py-2.5 px-3 font-black uppercase tracking-widest text-[10px] disabled:opacity-40 ${index === 0 ? 'bg-emerald-400 text-black' : 'bg-white/10 text-amber-200 border border-amber-300/20'}`}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                )}
                {coupon && !coupon.requiresBenefitChoice && (
                  <div className="mt-2 rounded-lg bg-white/[0.04] border border-white/10 p-2 text-[9px] font-bold uppercase tracking-widest text-gray-300">
                    {coupon.customerName && <p>Cliente: {coupon.customerName}</p>}
                    {coupon.minOrderValue ? <p>Mínimo: R$ {coupon.minOrderValue.toFixed(2)}</p> : null}
                    {coupon.benefitLabel && <p>Benefício: {coupon.benefitLabel}</p>}
                  </div>
                )}
              </div>

              <div className="flex-1 flex flex-col">
                 <h4 className="text-[10px] font-black uppercase tracking-widest text-gray-500 mb-4">Fluxo de Caixa</h4>
                 
                 <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4 mb-5 sm:mb-6">
                    {[
                      { id: 'credit', name: 'Crédito', icon: CreditCard },
                      { id: 'debit', name: 'Débito', icon: CreditCard },
                      { id: 'pix', name: 'PIX', icon: Wallet },
                      { id: 'cash', name: 'Dinheiro', icon: Banknote },
                    ].map(m => (
                      <button 
                        key={m.id}
                        onClick={() => canChangePaymentMethod && setCurrentMethod(m.id as PaymentMethod)}
                        disabled={!canChangePaymentMethod}
                        className={`p-4 sm:p-6 rounded-2xl border transition-all flex flex-col items-center gap-3 ${currentMethod === m.id ? 'bg-primary border-primary shadow-2xl shadow-primary/20 scale-105' : 'glass border-white/5 opacity-50 hover:opacity-100'} ${!canChangePaymentMethod ? 'cursor-not-allowed grayscale' : ''}`}
                      >
                        <m.icon size={26} />
                        <span className="font-black uppercase text-[9px] tracking-widest">{m.name}</span>
                      </button>
                    ))}
                 </div>
                 {!canChangePaymentMethod && (
                   <p className="mb-5 text-[10px] font-black uppercase tracking-widest text-amber-300">
                     Seu perfil não pode alterar a forma de pagamento.
                   </p>
                 )}
                 {canChangePaymentMethod && !currentMethod && (
                   <p className="mb-5 text-[10px] font-black uppercase tracking-widest text-amber-300">
                     Selecione a forma exata conferida na maquininha antes de lançar.
                   </p>
                 )}

                 <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 sm:items-center mb-5 sm:mb-6">
                    <div className="flex-1 relative">
                       <span className="absolute left-5 top-1/2 -translate-y-1/2 font-black text-xl text-gray-500">R$</span>
                       <input 
                         type="text"
                         inputMode="numeric"
                         value={currentAmountFormatted}
                         onChange={handleAmountChange}
                         className="w-full glass py-4 pl-12 pr-6 rounded-2xl text-3xl sm:text-4xl font-black text-accent outline-none border-white/10"
                       />
                    </div>
                    <button 
                       onClick={handleAddPayment}
                       disabled={isSavingPayment || !canLaunchPayment || !selectedSeller || !currentMethod || (payments.length >= 1 && !canSplitPayment) || currentPaymentCreatesInvalidChange}
                       className="w-full sm:w-auto py-4 px-8 btn-beco btn-beco-purple text-base font-black rounded-2xl disabled:opacity-30 disabled:grayscale"
                    >
                       {isSavingPayment ? 'Salvando...' : 'Lançar Valor'}
                    </button>
                 </div>
                 {pendingPayment && (
                   <div className="mb-5 rounded-2xl border border-amber-300/30 bg-amber-300/10 p-4 sm:p-5 shadow-2xl shadow-amber-900/10">
                     <p className="text-[10px] font-black uppercase tracking-[0.2em] text-amber-200 mb-2">
                       Conferência obrigatória
                     </p>
                     <h4 className="text-xl sm:text-2xl font-black italic text-white mb-2">
                       Tem certeza que foi em {paymentMethodLabels[pendingPayment.method]}?
                     </h4>
                     <p className="text-xs sm:text-sm font-bold text-gray-300 leading-relaxed">
                       Valor: <span className="text-accent font-black">R$ {pendingPayment.amount.toFixed(2)}</span>. Confirme na maquininha antes de salvar. Todos os pagamentos precisam bater com o relatório da maquininha.
                     </p>
                     <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                       <button
                         onClick={() => setPendingPayment(null)}
                         disabled={isSavingPayment}
                         className="py-3 rounded-xl bg-white/10 border border-white/10 font-black uppercase tracking-widest text-[10px] text-white disabled:opacity-40"
                       >
                         Voltar e corrigir
                       </button>
                       <button
                         onClick={handleConfirmPayment}
                         disabled={isSavingPayment}
                         className="py-3 rounded-xl bg-emerald-400 text-black font-black uppercase tracking-widest text-[10px] disabled:opacity-40"
                       >
                         Sim, conciliei na maquininha
                       </button>
                     </div>
                   </div>
                 )}
                 {payments.length > 0 && (
                   <p className="mb-5 text-[10px] font-black uppercase tracking-widest text-emerald-300">
                     Pagamentos lançados ficam salvos na mesa mesmo se ela continuar aberta.
                   </p>
                 )}
                 {!canLaunchPayment && (
                   <p className="mb-5 text-[10px] font-black uppercase tracking-widest text-rose-400">
                     Seu perfil não pode lançar pagamentos.
                   </p>
                 )}
                 {canLaunchPayment && !selectedSeller && (
                   <p className="mb-5 text-[10px] font-black uppercase tracking-widest text-amber-300">
                     Selecione o vendedor responsável antes de lançar qualquer pagamento.
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
                               <p className="font-black text-base uppercase tracking-wider">{paymentMethodLabels[p.method]}</p>
                               <p className="text-[9px] text-gray-500 font-bold uppercase">Confirmado</p>
                            </div>
                         </div>
                         <div className="flex items-center gap-6">
                            <p className="text-xl font-black text-white">R$ {p.amount.toFixed(2)}</p>
                            <button
                              onClick={() => {
                                setPaymentCancelReasonCode('');
                                setPaymentCancelReasonNotes('');
                                setPaymentCancelDialog({ payment: p, index: idx });
                              }}
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

              <div className="mt-5 sm:mt-6 pt-5 sm:pt-6 border-t border-white/10 flex items-center justify-between gap-4">
                 <div className="flex flex-col">
                    <span className="text-[9px] font-black uppercase text-gray-500 mb-1">Troco a Devolver</span>
                    <span className="text-2xl sm:text-4xl font-black text-emerald-400">R$ {change.toFixed(2)}</span>
                 </div>
                 <div className="flex flex-col items-end">
                    <span className="text-[9px] font-black uppercase text-gray-500 mb-1">Restante</span>
                    <span className={`text-2xl sm:text-4xl font-black ${remaining > 0 ? 'text-rose-500 animate-pulse' : 'text-emerald-400'}`}>R$ {remaining.toFixed(2)}</span>
                 </div>
              </div>

              <button 
                 disabled={remaining > 0 || hasInvalidOverpayment || hasPendingCouponChoice || !selectedSeller || !canLaunchPayment || !canCloseBill}
                 onClick={handleFinish}
                 className="w-full btn-beco btn-beco-purple py-4 sm:py-5 text-base sm:text-2xl font-black mt-5 sm:mt-6 shadow-2xl shadow-primary/40 disabled:opacity-20 disabled:grayscale transition-all flex items-center justify-center gap-4 group rounded-2xl"
              >
                 FINALIZAR CONTA <ChevronRight className="group-hover:translate-x-2 transition-transform" size={26}/>
              </button>
              {(remaining > 0 || hasInvalidOverpayment || hasPendingCouponChoice || !selectedSeller || !canLaunchPayment || !canCloseBill) && (
                <p className="text-center text-[9px] font-black uppercase tracking-[0.2em] text-rose-500 mt-3 animate-pulse">
                  {!canCloseBill ? 'Sem permissão para fechar conta' : !canLaunchPayment ? 'Sem permissão para lançar pagamento' : !selectedSeller ? 'Selecione o vendedor responsável' : hasPendingCouponChoice ? 'Escolha o benefício do cupom' : hasInvalidOverpayment ? 'Troco só pode existir em pagamento em dinheiro' : `Falta receber R$ ${remaining.toFixed(2)}`}
                </p>
              )}
           </div>
        </div>
      </motion.div>
      <AnimatePresence>
        {showAddSellerModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[900] bg-black/85 backdrop-blur-xl flex items-center justify-center p-4"
          >
            <motion.div
              initial={{ scale: 0.96, y: 18 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.96, y: 18 }}
              className="w-full max-w-2xl max-h-[calc(100dvh-2rem)] overflow-hidden rounded-[2rem] border border-primary/30 bg-[#111114] shadow-2xl shadow-primary/20 flex flex-col"
            >
              <div className="p-6 border-b border-white/10 flex items-start justify-between gap-4">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.24em] text-primary">OS + PDV</p>
                  <h3 className="mt-1 text-3xl font-black italic tracking-tight text-white">Add vendedor</h3>
                  <p className="mt-2 text-xs font-bold text-zinc-500">
                    Vincule alguém do Becoartes OS ou crie um cadastro novo já conciliado.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowAddSellerModal(false)}
                  className="rounded-2xl bg-white/5 p-3 text-zinc-400 transition-all hover:bg-white/10 hover:text-white"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="p-6 space-y-5 overflow-y-auto custom-scrollbar">
                <label className="block">
                  <span className="mb-2 block text-[10px] font-black uppercase tracking-widest text-zinc-500">Buscar ou criar vendedor</span>
                  <input
                    value={newSellerName}
                    onChange={(event) => setNewSellerName(event.target.value)}
                    placeholder="Digite o nome..."
                    className="w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-4 text-base font-black text-white outline-none transition-all focus:border-primary/60"
                  />
                </label>

                <div className="rounded-[1.75rem] border border-emerald-500/15 bg-emerald-500/5 p-4">
                  <div className="flex items-center justify-between gap-4 mb-3">
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-[0.22em] text-emerald-300">Recomendado</p>
                      <h4 className="text-lg font-black text-white">Vincular cadastro existente do OS</h4>
                    </div>
                    {isLoadingSellerCandidates && (
                      <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Carregando...</span>
                    )}
                  </div>
                  <div className="space-y-2 max-h-56 overflow-y-auto custom-scrollbar pr-1">
                    {visibleSellerCandidates.length === 0 ? (
                      <div className="rounded-2xl border border-white/5 bg-black/20 p-4 text-xs font-bold text-zinc-500">
                        {isLoadingSellerCandidates ? 'Buscando cadastros do OS...' : 'Nenhum cadastro do OS encontrado para este filtro.'}
                      </div>
                    ) : visibleSellerCandidates.map((candidate) => (
                      <button
                        key={candidate.id}
                        type="button"
                        onClick={() => handleActivateSellerCandidate(candidate)}
                        disabled={activatingSellerCandidateId === candidate.id}
                        className="w-full rounded-2xl border border-white/5 bg-black/25 p-4 text-left transition-all hover:border-emerald-400/40 hover:bg-emerald-500/10 disabled:opacity-50"
                      >
                        <div className="flex items-center justify-between gap-4">
                          <div className="min-w-0">
                            <p className="font-black text-white truncate">{candidate.name}</p>
                            <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 truncate">
                              {candidate.role || 'sem nível'} • {candidate.funcao || 'sem função'} • {candidate.employmentType || 'sem vínculo'}
                            </p>
                          </div>
                          <span className="shrink-0 rounded-xl bg-emerald-500/10 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-emerald-300">
                            {activatingSellerCandidateId === candidate.id ? 'Ativando...' : 'Ativar'}
                          </span>
                        </div>
                        {!candidate.hasPin && (
                          <p className="mt-2 text-[10px] font-bold uppercase tracking-widest text-amber-300">
                            Sem PIN no OS. Vai usar o PIN informado abaixo.
                          </p>
                        )}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="rounded-[1.75rem] border border-white/10 bg-white/[0.03] p-4 space-y-4">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-[0.22em] text-zinc-500">Novo cadastro</p>
                    <h4 className="text-lg font-black text-white">Criar no OS e ativar no PDV</h4>
                    <p className="text-xs font-bold text-zinc-500 mt-1">
                      Use quando a pessoa ainda não existe no OS. Ela já nasce marcada como vendedora do PDV.
                    </p>
                  </div>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <label className="block">
                    <span className="mb-2 block text-[10px] font-black uppercase tracking-widest text-zinc-500">PIN</span>
                    <input
                      value={newSellerPin}
                      onChange={(event) => setNewSellerPin(event.target.value.replace(/\D/g, '').slice(0, 4))}
                      inputMode="numeric"
                      maxLength={4}
                      className="w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-4 text-base font-black text-white outline-none transition-all focus:border-primary/60"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-2 block text-[10px] font-black uppercase tracking-widest text-zinc-500">Vínculo</span>
                    <select
                      value={newSellerEmploymentType}
                      onChange={(event) => setNewSellerEmploymentType(event.target.value as 'fixo' | 'freelancer')}
                      className="w-full rounded-2xl border border-white/10 bg-[#17171b] px-4 py-4 text-base font-black text-white outline-none transition-all focus:border-primary/60"
                    >
                      <option value="fixo">Fixo</option>
                      <option value="freelancer">Freelancer</option>
                    </select>
                  </label>
                  </div>
                </div>

              <button
                type="button"
                onClick={handleCreateCheckoutSeller}
                disabled={isCreatingOsSeller}
                className="flex w-full items-center justify-center gap-2 rounded-2xl bg-primary px-5 py-4 text-sm font-black uppercase tracking-widest text-white shadow-xl shadow-primary/25 transition-all hover:scale-[1.01] disabled:opacity-50 disabled:hover:scale-100"
              >
                <Plus size={16} /> {isCreatingOsSeller ? 'Criando...' : 'Criar no OS e selecionar'}
              </button>
              </div>
            </motion.div>
          </motion.div>
        )}
        {paymentCancelDialog && (
          <ActionDialog
            isOpen
            tone="danger"
            title="Cancelar pagamento?"
            description={`Remover ${paymentMethodLabels[paymentCancelDialog.payment.method]} de R$ ${paymentCancelDialog.payment.amount.toFixed(2)} desta mesa.`}
            confirmLabel="Cancelar pagamento"
            confirmDisabled={!paymentCancelReasonCode || (paymentCancelReasonCode === 'outro' && !paymentCancelReasonNotes.trim())}
            onClose={() => {
              setPaymentCancelDialog(null);
              setPaymentCancelReasonCode('');
              setPaymentCancelReasonNotes('');
            }}
            onConfirm={async () => {
              await handleRemovePayment(paymentCancelDialog.payment, paymentCancelDialog.index);
            }}
          >
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {PAYMENT_CANCEL_REASONS.map((reason) => (
                  <button
                    key={reason.code}
                    type="button"
                    onClick={() => setPaymentCancelReasonCode(reason.code)}
                    className={`rounded-2xl border px-4 py-3 text-left text-[10px] font-black uppercase tracking-widest transition-all ${
                      paymentCancelReasonCode === reason.code
                        ? 'border-rose-400 bg-rose-500/20 text-white shadow-lg shadow-rose-950/20'
                        : 'border-white/10 bg-white/[0.03] text-zinc-400 hover:border-white/25 hover:text-white'
                    }`}
                  >
                    {reason.label}
                  </button>
                ))}
              </div>
              {paymentCancelReasonCode === 'outro' && (
                <textarea
                  value={paymentCancelReasonNotes}
                  onChange={(event) => setPaymentCancelReasonNotes(event.target.value)}
                  placeholder="Explique o motivo do cancelamento..."
                  className="w-full min-h-24 glass rounded-2xl border-white/10 p-4 text-sm font-bold outline-none focus:border-rose-400/50"
                />
              )}
            </div>
          </ActionDialog>
        )}
      </AnimatePresence>
    </>
  );
}
