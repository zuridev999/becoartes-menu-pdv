import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { X, Wallet, CreditCard, Banknote, Trash2, CheckCircle2, ChevronRight, Plus, Menu, Printer, Pencil, ChevronDown } from 'lucide-react';
import { useStore, type Seller, type Table as TableType } from '../../store';
import { calculateBillTotal, calculateServiceFee, clampServiceFeePercent, formatPercent, MAX_SERVICE_FEE_PERCENT, parseFlexibleDecimal, roundMoney } from '../../lib/billing';
import { can } from '../../lib/permissions';
import { AdminApi, OperationalApi, hasApiSessionToken, setApiSessionToken, type SellerCandidate } from '../../lib/api';
import { ActionDialog } from '../common/ActionDialog';
import { ReceiptPrintModal } from '../common/ReceiptPrintModal';
import type { ReceiptData } from '../../lib/receiptPrint';

interface Payment {
  id?: string;
  method: 'credit' | 'debit' | 'cash' | 'pix';
  amount: number;
  sellerName?: string;
  createdAt?: Date;
}

type PaymentMethod = Payment['method'];
type ServiceFeeInputMode = 'percent' | 'amount';

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

const money = (value: number) => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const TECHNICAL_SELLER_IDS = new Set(['admin-bootstrap', 'manager-default', 'operator-default', 'master']);
const TECHNICAL_SELLER_NAMES = new Set(['administrador', 'admin full', 'admin mestre', 'operador']);
const SELLER_SESSION_STORAGE_KEY = 'beco_seller_session';

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

const isSessionExpiredError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error || '');
  return /sess[aã]o obrigat[oó]ria|session/i.test(message);
};

const isEligibleSellerCandidate = (candidate: SellerCandidate) => {
  const name = normalizeSellerName(candidate.name);
  const role = normalizeSellerName(candidate.role);
  if (TECHNICAL_SELLER_NAMES.has(name)) return false;
  if (['gui mameluco', 'operacional'].includes(name)) return false;
  if (['super_admin', 'operacional'].includes(role)) return false;
  return true;
};

const formatCpfCnpj = (value: string) => {
  const digits = value.replace(/\D/g, '').slice(0, 14);
  if (digits.length <= 11) {
    return digits
      .replace(/^(\d{3})(\d)/, '$1.$2')
      .replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
      .replace(/\.(\d{3})(\d)/, '.$1-$2');
  }
  return digits
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2')
    .replace(/(\d{4})(\d)/, '$1-$2');
};

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
  const [serviceFeeInputMode, setServiceFeeInputMode] = useState<ServiceFeeInputMode>('percent');
  const [serviceFeePercentInput, setServiceFeePercentInput] = useState(formatPercent(defaultServiceFeePercent).replace('.', ','));
  const [serviceFeeAmountInput, setServiceFeeAmountInput] = useState('');
  const [discountInput, setDiscountInput] = useState('0');
  const discountValue = Math.max(0, parseFlexibleDecimal(discountInput) ?? 0);
  const [showServiceFeeEditor, setShowServiceFeeEditor] = useState(false);
  const [showDiscountEditor, setShowDiscountEditor] = useState(false);
  const [showOrderItems, setShowOrderItems] = useState(false);
  const [discountType, setDiscountType] = useState<'fixed' | 'percent'>('fixed');
  const [discountReason] = useState('');
  const [payments, setPayments] = useState<Payment[]>(() => table.payments || []);
  const [currentMethod, setCurrentMethod] = useState<PaymentMethod | null>(null);
  const [paymentCancelDialog, setPaymentCancelDialog] = useState<{ payment: Payment; index: number } | null>(null);
  const [paymentCancelReasonCode, setPaymentCancelReasonCode] = useState('');
  const [paymentCancelReasonNotes, setPaymentCancelReasonNotes] = useState('');
  const [isSavingPayment, setIsSavingPayment] = useState(false);
  const paymentSavingRef = useRef(false);
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
  const [showSellerDirectory, setShowSellerDirectory] = useState(false);
  const [showCustomerDocument, setShowCustomerDocument] = useState(false);
  const [showCouponInput, setShowCouponInput] = useState(false);
  const [customerDocument, setCustomerDocument] = useState('');
  const [receiptPreview, setReceiptPreview] = useState<ReceiptData | null>(null);
  const rawSellerOptions = sellers.some(s => s.id === currentSeller?.id)
    ? sellers
    : currentSeller ? [currentSeller, ...sellers] : sellers;
  const sellerOptions = rawSellerOptions.filter(isCheckoutSeller);
  const sellerCandidateSearch = normalizeSellerName(newSellerName);
  const shouldShowSellerCandidates = showSellerDirectory || Boolean(sellerCandidateSearch);
  const visibleSellerCandidates = useMemo(() => (
    shouldShowSellerCandidates ? sellerCandidates
      .filter(isEligibleSellerCandidate)
      .filter((candidate) => !candidate.canSellInPdv)
      .filter((candidate) => {
        if (!sellerCandidateSearch) return true;
        return normalizeSellerName(candidate.name).includes(sellerCandidateSearch);
      })
      .slice(0, 8)
      : []
  ), [sellerCandidates, sellerCandidateSearch, shouldShowSellerCandidates]);
  const selectedSeller = selectedSellerId === SELF_SERVICE_SELLER.id
    ? SELF_SERVICE_SELLER
    : sellerOptions.find(s => s.id === selectedSellerId);
  const canApplyDiscount = can(currentSeller, 'applyDiscount', settings.pdvPermissions, settings.pdvUserPermissions);
  const canEditServiceFee = can(currentSeller, 'editServiceFee', settings.pdvPermissions, settings.pdvUserPermissions);
  const isAdminSeller = currentSeller?.permission === 'admin';
  const canLowerServiceFee = Boolean(currentSeller?.id && currentSeller.status === 'active');
  const canEditServiceFeeControls = canEditServiceFee || canLowerServiceFee;
  const canLaunchPayment = can(currentSeller, 'launchPayment', settings.pdvPermissions, settings.pdvUserPermissions);
  const canSplitPayment = can(currentSeller, 'splitPayment', settings.pdvPermissions, settings.pdvUserPermissions);
  const canChangePaymentMethod = can(currentSeller, 'changePaymentMethod', settings.pdvPermissions, settings.pdvUserPermissions);
  const canCancelPayment = can(currentSeller, 'cancelPayment', settings.pdvPermissions, settings.pdvUserPermissions);
  const canCloseBill = can(currentSeller, 'closeBill', settings.pdvPermissions, settings.pdvUserPermissions);
  const canManageSellers = ['admin', 'manager'].includes(String(currentSeller?.permission || ''))
    || can(currentSeller, 'managePDVUsers', settings.pdvPermissions, settings.pdvUserPermissions);

  const expireSellerSession = useCallback(() => {
    localStorage.removeItem(SELLER_SESSION_STORAGE_KEY);
    setApiSessionToken(null);
    useStore.setState({ currentSeller: null });
    setShowAddSellerModal(false);
    addNotification('Sessão expirada. Entre com o PIN novamente para cadastrar vendedor.', 'error');
  }, [addNotification]);

  const openAddSellerModal = () => {
    if (!hasApiSessionToken()) {
      expireSellerSession();
      return;
    }
    setShowAddSellerModal(true);
  };

  const subtotal = roundMoney(table.orders.reduce((acc: number, o: any) => {
    const itemPrice = o.price + (o.selectedModifiers || []).reduce((mAcc: number, m: any) => mAcc + m.price, 0);
    return acc + (itemPrice * o.quantity);
  }, 0));

  const maxEditableServiceFeePercent = isAdminSeller
    ? Number.POSITIVE_INFINITY
    : canEditServiceFee
      ? MAX_SERVICE_FEE_PERCENT
      : defaultServiceFeePercent;
  const maxEditableServiceFeeAmount = calculateServiceFee(subtotal, maxEditableServiceFeePercent);
  const requestedPercent = parseFlexibleDecimal(serviceFeePercentInput) ?? 0;
  const requestedAmount = parseFlexibleDecimal(serviceFeeAmountInput) ?? 0;
  const feeValue = serviceFeeInputMode === 'amount'
    ? roundMoney(Math.min(isAdminSeller ? Number.MAX_SAFE_INTEGER : maxEditableServiceFeeAmount, Math.max(0, requestedAmount)))
    : calculateServiceFee(
      subtotal,
      requestedPercent,
      maxEditableServiceFeePercent,
    );
  const serviceFeePercent = serviceFeeInputMode === 'percent'
    ? clampServiceFeePercent(requestedPercent, maxEditableServiceFeePercent)
    : subtotal > 0 ? roundMoney((feeValue / subtotal) * 100) : 0;
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
    if (!hasApiSessionToken()) {
      expireSellerSession();
      return;
    }
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
      setShowSellerDirectory(false);
      setShowAddSellerModal(false);
    } catch (error) {
      console.error('Erro ao criar vendedor no OS:', error);
      if (isSessionExpiredError(error)) {
        expireSellerSession();
        return;
      }
      addNotification(error instanceof Error ? error.message : 'Não foi possível criar este vendedor no OS.', 'error');
    } finally {
      setIsCreatingOsSeller(false);
    }
  };

  const handleActivateSellerCandidate = async (candidate: SellerCandidate) => {
    if (!hasApiSessionToken()) {
      expireSellerSession();
      return;
    }
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
      setShowSellerDirectory(false);
      setShowAddSellerModal(false);
    } catch (error) {
      console.error('Erro ao ativar vendedor do OS:', error);
      if (isSessionExpiredError(error)) {
        expireSellerSession();
        return;
      }
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
    setServiceFeePercentInput(formatPercent(defaultServiceFeePercent).replace('.', ','));
    setServiceFeeAmountInput(calculateServiceFee(subtotal, defaultServiceFeePercent).toFixed(2).replace('.', ','));
  }, [defaultServiceFeePercent, subtotal]);

  useEffect(() => {
    setPayments(table.payments || []);
  }, [table.id, table.payments]);

  useEffect(() => {
    if (!showAddSellerModal) return;
    if (!hasApiSessionToken()) {
      expireSellerSession();
      return;
    }
    let cancelled = false;
    setIsLoadingSellerCandidates(true);
    AdminApi.listSellerCandidates()
      .then((result) => {
        if (!cancelled) setSellerCandidates(result.candidates || []);
      })
      .catch((error) => {
        console.error('Erro ao carregar candidatos de vendedor:', error);
        if (!cancelled) {
          if (isSessionExpiredError(error)) {
            expireSellerSession();
            return;
          }
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
  }, [showAddSellerModal, addNotification, expireSellerSession]);

  const currentPaymentAmount = Number(amountDigits) / 100;
  const currentPaymentCreatesInvalidChange = roundMoney(paidTotal + currentPaymentAmount) > totalFinal
    && currentMethod !== 'cash'
    && !hasCashPayment;
  const currentAmountFormatted = (Number(amountDigits) / 100).toFixed(2).replace('.', ',');

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const rawVal = e.target.value;
    const cleanDigits = rawVal.replace(/\D/g, '');
    const finalDigits = cleanDigits.replace(/^0+/, '') || '0';
    if (finalDigits.length > 9) return;
    setAmountDigits(finalDigits);
  };

  const handleAddPayment = async () => {
    if (paymentSavingRef.current || !canLaunchPayment) return;
    if (payments.length >= 1 && !canSplitPayment) return;
    if (!currentMethod) return;
    if (!selectedSeller) return;
    const val = currentPaymentAmount;
    if (val <= 0) return;
    const nextPaidTotal = roundMoney(paidTotal + val);
    if (nextPaidTotal > totalFinal && currentMethod !== 'cash' && !hasCashPayment) return;
    paymentSavingRef.current = true;
    setIsSavingPayment(true);
    try {
      const result = await OperationalApi.createTablePayment({
        tableId: table.id,
        tableNumber: table.number,
        method: currentMethod,
        amount: val,
        sellerId: selectedSeller.id,
        sellerName: selectedSeller.name,
      });
      setPayments([...payments, result.payment]);
      setCurrentMethod(null);
    } catch (error) {
      addNotification(error instanceof Error ? error.message : 'Não foi possível salvar o pagamento. Tente novamente.', 'error');
    } finally {
      paymentSavingRef.current = false;
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

  const handlePrintReceipt = () => {
    setReceiptPreview({
      title: `Mesa ${table.number}`,
      subtitle: payments.length > 0 ? 'CONTA COM PAGAMENTOS' : 'CONTA ABERTA',
      tableNumber: table.number,
      sellerName: selectedSeller?.name,
      customerDocument: customerDocument.trim(),
      items: table.orders,
      subtotal,
      serviceFee: feeValue,
      serviceFeePercent,
      discount: discountAmountValue,
      couponCode: coupon?.code,
      couponAmount: couponAmountValue,
      total: totalFinal,
      payments,
      paidTotal,
      remaining,
      change,
    });
  };

  const handleServiceFeeModeChange = (mode: ServiceFeeInputMode) => {
    if (mode === serviceFeeInputMode) return;
    if (mode === 'percent') {
      setServiceFeePercentInput(formatPercent(serviceFeePercent).replace('.', ','));
    } else {
      setServiceFeeAmountInput(feeValue.toFixed(2).replace('.', ','));
    }
    setServiceFeeInputMode(mode);
  };

  const normalizeServiceFeePercentInput = () => {
    const parsed = parseFlexibleDecimal(serviceFeePercentInput) ?? 0;
    const safePercent = clampServiceFeePercent(parsed, maxEditableServiceFeePercent);
    setServiceFeePercentInput(formatPercent(safePercent).replace('.', ','));
  };

  const normalizeServiceFeeAmountInput = () => {
    const parsed = parseFlexibleDecimal(serviceFeeAmountInput) ?? 0;
    const safeAmount = roundMoney(Math.min(isAdminSeller ? Number.MAX_SAFE_INTEGER : maxEditableServiceFeeAmount, Math.max(0, parsed)));
    setServiceFeeAmountInput(safeAmount.toFixed(2).replace('.', ','));
  };

  const handleFinish = () => {
    if (hasInvalidOverpayment || hasPendingCouponChoice || remaining > 0 || !selectedSeller || !canLaunchPayment || !canCloseBill) return;
    void closeBill({
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
    onClose();
  };

  return (
    <>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} className="fixed inset-0 bg-black/90 backdrop-blur-3xl z-[400]" />
      <motion.div initial={{ y: 100, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 100, opacity: 0 }} className="fixed inset-0 z-[450] flex items-center justify-center p-2 sm:p-6 pointer-events-none font-['Outfit']">
        <div role="dialog" aria-modal="true" aria-labelledby="checkout-title" className="glass-card pointer-events-auto flex max-h-[calc(100dvh-1rem)] w-full max-w-[68rem] min-w-0 flex-col overflow-hidden rounded-3xl border-white/10 bg-[#101013] shadow-2xl sm:max-h-[90dvh]">
          <header className="flex shrink-0 items-center justify-between gap-3 border-b border-white/10 px-4 py-3 sm:px-6 sm:py-4">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-400">Fechamento da conta</p>
              <h2 id="checkout-title" className="text-2xl font-black tracking-tight sm:text-3xl">Mesa <span className="text-primary">{table.number}</span></h2>
            </div>
            <button type="button" onClick={onClose} aria-label="Fechar pagamento" className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-white/10 bg-white/5 text-zinc-300 hover:bg-white/10"><X size={20} /></button>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain custom-scrollbar">
            <div className="grid min-w-0 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
              <section aria-label="Resumo e ajustes da conta" className="min-w-0 space-y-2 border-b border-white/10 bg-white/[0.02] p-3 sm:space-y-3 sm:p-6 lg:border-b-0 lg:border-r">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-base font-bold">Resumo da conta</h3>
                  <button type="button" aria-expanded={showOrderItems} aria-controls="checkout-items" onClick={() => setShowOrderItems(value => !value)} className="flex min-h-9 items-center gap-1.5 rounded-xl px-2 text-xs font-bold text-zinc-400 hover:bg-white/5 hover:text-white sm:min-h-11">
                    {table.orders.reduce((count, item) => count + item.quantity, 0)} {table.orders.reduce((count, item) => count + item.quantity, 0) === 1 ? 'item' : 'itens'}
                    <ChevronDown size={16} className={showOrderItems ? 'rotate-180' : ''} />
                  </button>
                </div>
                {showOrderItems && (
                  <div id="checkout-items" className="space-y-3 rounded-xl border border-white/10 bg-black/15 p-3">
                    {table.orders.map((item, index) => {
                      const modifiersTotal = (item.selectedModifiers || []).reduce((sum, modifier) => sum + modifier.price, 0);
                      return (
                        <div key={item.id || index} className="space-y-1 text-sm">
                          <div className="flex items-start justify-between gap-3">
                            <span className="min-w-0 break-words font-semibold">{item.quantity}× {item.name}</span>
                            <span className="shrink-0 font-bold text-zinc-300">{money((item.price + modifiersTotal) * item.quantity)}</span>
                          </div>
                          {!!item.selectedModifiers?.length && <p className="text-xs text-zinc-400">{item.selectedModifiers.map(modifier => modifier.name).join(' · ')}</p>}
                          {item.notes && <p className="text-xs text-zinc-400">{item.notes}</p>}
                        </div>
                      );
                    })}
                  </div>
                )}
                <div className="flex justify-between gap-3 text-sm text-zinc-400"><span>Subtotal dos itens</span><span className="font-bold text-zinc-200">{money(subtotal)}</span></div>
                <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-2 sm:p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold">Desconto</span>
                    <div className="flex items-center gap-2">
                      <span className={discountAmountValue > 0 ? 'text-sm font-bold text-rose-300' : 'text-sm font-bold text-zinc-400'}>{discountAmountValue > 0 ? '− ' : ''}{money(discountAmountValue)}</span>
                      {canApplyDiscount && <button type="button" aria-label="Editar desconto" aria-expanded={showDiscountEditor} onClick={() => setShowDiscountEditor(value => !value)} className="grid h-11 w-11 place-items-center rounded-xl bg-white/5 text-primary hover:bg-primary/15"><Pencil size={16} /></button>}
                    </div>
                  </div>
                  {canApplyDiscount && showDiscountEditor && (
                    <div className="mt-3 space-y-2 border-t border-white/10 pt-3">
                      <div className="flex gap-2">
                        <input aria-label="Valor do desconto" type="text" inputMode="decimal" value={discountInput} onChange={event => setDiscountInput(event.target.value.replace(/[^0-9.,]/g, ''))} className="h-11 w-full min-w-0 rounded-xl border border-white/10 bg-black/20 px-3 text-base outline-none focus:border-primary" />
                        <button type="button" aria-label="Alternar desconto entre reais e percentual" onClick={() => setDiscountType(discountType === 'fixed' ? 'percent' : 'fixed')} className="h-11 w-12 shrink-0 rounded-xl border border-white/10 text-sm font-bold text-primary">{discountType === 'fixed' ? 'R$' : '%'}</button>
                        <button type="button" onClick={() => setShowDiscountEditor(false)} className="h-11 rounded-xl bg-primary/15 px-3 text-sm font-bold text-primary">OK</button>
                      </div>
                      {discountValue > 0 && <button type="button" onClick={() => { setDiscountInput('0'); setShowDiscountEditor(false); }} className="min-h-11 text-xs font-semibold text-rose-300">Remover desconto</button>}
                    </div>
                  )}
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-2 sm:p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold">Taxa de serviço <span className="whitespace-nowrap text-primary">{formatPercent(serviceFeePercent).replace('.', ',')}%</span></p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="text-sm font-bold">{money(feeValue)}</span>
                      {canEditServiceFeeControls && <button type="button" aria-label="Editar taxa de serviço" aria-expanded={showServiceFeeEditor} onClick={() => setShowServiceFeeEditor(value => !value)} className="grid h-11 w-11 place-items-center rounded-xl bg-white/5 text-primary hover:bg-primary/15"><Pencil size={16} /></button>}
                    </div>
                  </div>
                  {canEditServiceFeeControls && showServiceFeeEditor && (
                    <div className="mt-3 space-y-3 border-t border-white/10 pt-3">
                      <div className="grid grid-cols-2 gap-2" role="group" aria-label="Modo de edição da taxa de serviço">
                        <button type="button" aria-pressed={serviceFeeInputMode === 'percent'} onClick={() => handleServiceFeeModeChange('percent')} className={`min-h-11 rounded-xl border text-sm font-bold ${serviceFeeInputMode === 'percent' ? 'border-primary bg-primary text-white' : 'border-white/10 text-zinc-400'}`}>Percentual (%)</button>
                        <button type="button" aria-pressed={serviceFeeInputMode === 'amount'} onClick={() => handleServiceFeeModeChange('amount')} className={`min-h-11 rounded-xl border text-sm font-bold ${serviceFeeInputMode === 'amount' ? 'border-primary bg-primary text-white' : 'border-white/10 text-zinc-400'}`}>Valor (R$)</button>
                      </div>
                      <div className="flex gap-2">
                        <input type="text" inputMode="decimal" value={serviceFeeInputMode === 'percent' ? serviceFeePercentInput : serviceFeeAmountInput}
                          onChange={event => {
                            const value = event.target.value.replace(/[^0-9.,]/g, '');
                            if (serviceFeeInputMode === 'percent') setServiceFeePercentInput(value);
                            else setServiceFeeAmountInput(value);
                          }}
                          onBlur={serviceFeeInputMode === 'percent' ? normalizeServiceFeePercentInput : normalizeServiceFeeAmountInput}
                          aria-label={serviceFeeInputMode === 'percent' ? 'Percentual da taxa de serviço' : 'Valor em reais da taxa de serviço'}
                          className="h-11 w-full min-w-0 rounded-xl border border-white/10 bg-black/20 px-3 text-base outline-none focus:border-primary" />
                        <button type="button" onClick={() => setShowServiceFeeEditor(false)} className="h-11 rounded-xl bg-primary/15 px-4 text-sm font-bold text-primary">OK</button>
                      </div>
                      {!isAdminSeller && <p className="text-xs text-zinc-400">Até {formatPercent(maxEditableServiceFeePercent).replace('.', ',')}% de serviço.</p>}
                    </div>
                  )}
                  {canEditServiceFeeControls && (
                    <button type="button" onClick={() => {
                      setServiceFeePercentInput(feeValue > 0 ? '0' : formatPercent(defaultServiceFeePercent).replace('.', ','));
                      setServiceFeeInputMode('percent');
                      setShowServiceFeeEditor(false);
                    }} className="mt-1 inline-flex min-h-9 items-center rounded-lg px-2 text-xs font-semibold text-amber-300 hover:bg-amber-400/10 sm:min-h-11">
                      {feeValue > 0 ? 'Remover taxa de serviço' : 'Restaurar taxa de serviço'}
                    </button>
                  )}
                </div>
                {coupon && <div className="flex justify-between gap-3 text-sm text-amber-300"><span>Cupom{coupon.benefitLabel ? ` · ${coupon.benefitLabel}` : ''}</span><span className="shrink-0 font-bold">− {money(couponAmountValue)}</span></div>}
                <div className="flex items-center justify-between gap-3 border-t border-white/10 pt-3">
                  <span className="text-sm font-bold text-zinc-300">Total da conta</span>
                  <span className="text-2xl font-black text-accent">{money(totalFinal)}</span>
                </div>
              </section>

            <section aria-label="Pagamento" className="min-w-0 bg-[#101013] p-4 sm:p-6">
              <div className="min-w-0 space-y-3">
                 <h3 className="text-base font-bold">Receber pagamento</h3>

                 <div className="grid grid-cols-4 gap-2 mb-3">
                    {[
                      { id: 'credit', name: 'Crédito', icon: CreditCard },
                      { id: 'debit', name: 'Débito', icon: CreditCard },
                      { id: 'pix', name: 'PIX', icon: Wallet },
                      { id: 'cash', name: 'Dinheiro', icon: Banknote },
                    ].map(m => (
                      <button
                        key={m.id}
                        onClick={() => canChangePaymentMethod && setCurrentMethod(m.id as PaymentMethod)}
                        disabled={!canChangePaymentMethod || isSavingPayment}
                        className={`min-h-[64px] rounded-2xl border px-1 py-3 transition-all flex flex-col items-center justify-center gap-2 ${currentMethod === m.id ? 'bg-primary border-primary shadow-2xl shadow-primary/20 scale-[1.02]' : 'bg-black/20 border-white/10 opacity-75 hover:opacity-100'} ${!canChangePaymentMethod ? 'cursor-not-allowed grayscale' : ''}`}
                      >
                        <m.icon size={20} />
                        <span className="font-black uppercase text-[11px] tracking-wide">{m.name}</span>
                      </button>
                    ))}
                 </div>
                 {!canChangePaymentMethod && (
                   <p className="mb-5 text-[10px] font-black uppercase tracking-widest text-amber-300">
                     Seu perfil não pode alterar a forma de pagamento.
                   </p>
                 )}
                 {canChangePaymentMethod && !currentMethod && (
                   <p className="mb-2 text-[9px] font-black uppercase tracking-widest text-amber-300">
                     Selecione a forma de pagamento.
                   </p>
                 )}

                 <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(190px,280px)_auto] sm:items-center">
                    <div className="relative">
                       <span className="absolute left-4 top-1/2 -translate-y-1/2 font-black text-base text-gray-500">R$</span>
                       <input
                         type="text"
                         inputMode="numeric"
                         aria-label="Valor do pagamento"
                         disabled={isSavingPayment}
                         value={currentAmountFormatted}
                         onChange={handleAmountChange}
                         className="w-full rounded-xl border border-white/10 bg-black/20 py-2.5 pl-10 pr-5 text-2xl font-black text-accent outline-none"
                       />
                    </div>
                    <button
                       onClick={handleAddPayment}
                       disabled={isSavingPayment || currentPaymentAmount <= 0 || !canLaunchPayment || !selectedSeller || !currentMethod || (payments.length >= 1 && !canSplitPayment) || currentPaymentCreatesInvalidChange}
                       className="h-12 w-full px-7 sm:w-[190px] btn-beco btn-beco-purple text-xs font-black rounded-xl disabled:opacity-30 disabled:grayscale"
                    >
                       {isSavingPayment ? 'Salvando...' : 'Lançar Valor'}
                    </button>
                 </div>
                 {payments.length > 0 && (
                   <p className="mb-3 text-[10px] font-black uppercase tracking-widest text-emerald-300">
                     Pagamentos lançados ficam salvos na mesa mesmo se ela continuar aberta.
                   </p>
                 )}
                 {!canLaunchPayment && (
                   <p className="mb-3 text-[10px] font-black uppercase tracking-widest text-rose-400">
                     Seu perfil não pode lançar pagamentos.
                   </p>
                 )}
                 {canLaunchPayment && !selectedSeller && (
                   <p className="mb-3 text-[10px] font-black uppercase tracking-widest text-amber-300">
                     Selecione o vendedor responsável antes de lançar qualquer pagamento.
                   </p>
                 )}
                 {canLaunchPayment && payments.length >= 1 && !canSplitPayment && (
                   <p className="mb-3 text-[10px] font-black uppercase tracking-widest text-amber-300">
                     Seu perfil não pode dividir pagamento em mais de uma forma.
                   </p>
                 )}
                 {(hasInvalidOverpayment || currentPaymentCreatesInvalidChange) && (
                   <p className="mb-3 text-[10px] font-black uppercase tracking-widest text-rose-400">
                     Valor acima do total só é permitido em dinheiro, porque gera troco.
                   </p>
                 )}

                 <div className="space-y-2">
                    {payments.map((p, idx) => (
                      <div key={idx} className="flex min-w-0 flex-wrap justify-between items-center gap-2 p-3 glass rounded-xl border-white/5 animate-in slide-in-from-right duration-300">
                         <div className="flex min-w-0 items-center gap-3">
                            <CheckCircle2 className="text-emerald-500" size={20}/>
                            <div>
                               <p className="font-black text-sm uppercase tracking-wider">{paymentMethodLabels[p.method]}</p>
                               <p className="text-[9px] text-gray-500 font-bold uppercase">Registrado</p>
                            </div>
                         </div>
                         <div className="ml-auto flex shrink-0 items-center gap-3 sm:gap-6">
                            <p className="text-lg font-black text-white">{money(p.amount)}</p>
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

              <details className="mt-5 border-t border-white/10 pt-3">
                <summary className="cursor-pointer py-2 text-sm font-semibold text-zinc-300">Vendedor, cliente e cupom <span className="mt-1 block text-xs font-normal text-zinc-500">{selectedSeller?.name || 'Selecione o vendedor'}</span></summary>
                <div className="mt-3">
              <div className="grid min-w-0 grid-cols-1 gap-2.5 ">
                 <div className="min-w-0 rounded-2xl border border-white/10 bg-white/[0.025] p-3">
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <h4 className="text-[9px] font-black uppercase tracking-widest text-gray-500">Vendedor</h4>
                      {canManageSellers && (
                        <button
                          type="button"
                          onClick={openAddSellerModal}
                          className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2.5 py-1 text-[8px] font-black uppercase tracking-widest text-primary transition-all hover:bg-primary hover:text-white"
                        >
                          <Plus size={12} /> Add vendedor
                        </button>
                      )}
                    </div>
                    <select
                       value={selectedSellerId}
                       onChange={(e) => setSelectedSellerId(e.target.value)}
                       className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm font-black outline-none"
                    >
                       <option value={SELF_SERVICE_SELLER.id} className="bg-[#0d0d0f]">Cliente pediu sozinho</option>
                       {sellerOptions.map((s: any) => (
                         <option key={s.id} value={s.id} className="bg-[#0d0d0f]">{s.name}</option>
                       ))}
                    </select>
                 </div>
                <div className="grid min-w-0 grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setShowCustomerDocument((value) => !value)}
                    className={`rounded-2xl border px-3 py-2.5 text-left transition-all ${showCustomerDocument || customerDocument ? 'border-emerald-300/35 bg-emerald-300/10 text-emerald-200' : 'border-white/10 bg-white/[0.025] text-zinc-300 hover:border-emerald-300/30 hover:bg-emerald-300/5'}`}
                  >
                    <span className="block text-[8px] font-black uppercase tracking-widest text-zinc-500">Cliente</span>
                    <span className="mt-1 block whitespace-nowrap text-[9px] font-black uppercase tracking-widest">
                      {customerDocument ? 'CPF OK' : 'CPF/CNPJ'}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowCouponInput((value) => !value)}
                    className={`rounded-2xl border px-3 py-2.5 text-left transition-all ${showCouponInput || coupon ? 'border-amber-300/35 bg-amber-300/10 text-amber-200' : 'border-white/10 bg-white/[0.025] text-zinc-300 hover:border-amber-300/30 hover:bg-amber-300/5'}`}
                  >
                    <span className="block text-[8px] font-black uppercase tracking-widest text-zinc-500">Benefício</span>
                    <span className="mt-1 block whitespace-nowrap text-[9px] font-black uppercase tracking-widest">
                      {coupon ? 'Cupom OK' : 'Cupom'}
                    </span>
                  </button>
                </div>
              </div>

              {(showCustomerDocument || showCouponInput || couponMessage || coupon?.requiresBenefitChoice || (coupon && !coupon.requiresBenefitChoice)) && (
                <div className="mt-3 grid min-w-0 grid-cols-1 gap-3 lg:grid-cols-2">
                  {showCustomerDocument && (
                    <div className="rounded-2xl border border-emerald-300/20 bg-emerald-300/[0.04] p-3">
                      <h4 className="mb-2 text-[9px] font-black uppercase tracking-widest text-emerald-200">CPF/CNPJ na conta</h4>
                      <input
                        value={customerDocument}
                        onChange={(event) => setCustomerDocument(formatCpfCnpj(event.target.value))}
                        inputMode="numeric"
                        className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm font-black tracking-widest outline-none"
                        placeholder="000.000.000-00 ou 00.000.000/0000-00"
                      />
                    </div>
                  )}
                  {showCouponInput && (
                    <div className="rounded-2xl border border-amber-400/20 bg-amber-400/[0.04] p-3">
                      <h4 className="mb-2 text-[9px] font-black uppercase tracking-widest text-amber-200">Cupom</h4>
                      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                        <input
                          value={couponInput}
                          onChange={(event) => {
                            setCouponInput(event.target.value.toUpperCase());
                            if (coupon) setCoupon(null);
                          }}
                          className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm font-black uppercase tracking-widest outline-none"
                          placeholder="Código"
                        />
                        <button
                          onClick={() => handleApplyCoupon()}
                          disabled={isApplyingCoupon || !couponInput.trim()}
                          className="rounded-xl bg-amber-300 px-5 text-[9px] font-black uppercase tracking-widest text-black disabled:opacity-40"
                        >
                          {isApplyingCoupon ? 'Validando...' : 'Aplicar'}
                        </button>
                      </div>
                    </div>
                  )}
                  {coupon && (
                    <button
                      onClick={() => {
                        setCoupon(null);
                        setCouponMessage('Cupom removido desta conta.');
                      }}
                      className="rounded-xl border border-rose-300/20 bg-rose-300/[0.04] px-3 py-3 text-[9px] font-black uppercase tracking-widest text-rose-300"
                    >
                      Remover cupom
                    </button>
                  )}
                  {couponMessage && (
                    <p className={`lg:col-span-2 text-[9px] font-black uppercase tracking-widest ${coupon ? 'text-emerald-300' : 'text-rose-300'}`}>
                      {couponMessage}
                    </p>
                  )}
                  {coupon?.requiresBenefitChoice && (
                    <div className="lg:col-span-2 mt-1 grid grid-cols-1 sm:grid-cols-2 gap-2">
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
                    <div className="lg:col-span-2 rounded-lg bg-white/[0.04] border border-white/10 p-2 text-[9px] font-bold uppercase tracking-widest text-gray-300">
                      {coupon.customerName && <p>Cliente: {coupon.customerName}</p>}
                      {coupon.minOrderValue ? <p>Mínimo: R$ {coupon.minOrderValue.toFixed(2)}</p> : null}
                      {coupon.benefitLabel && <p>Benefício: {coupon.benefitLabel}</p>}
                    </div>
                  )}
                </div>
              )}

                </div>
              </details>
            </section>
          </div>
        </div>
        <footer className="shrink-0 space-y-3 border-t border-white/10 bg-[#151518] px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:px-6 sm:py-4">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <div className="text-xs text-zinc-400">Recebido <span className="ml-1 font-bold text-emerald-400">{money(paidTotal)}</span>{change > 0 && <span className="ml-3">Troco <strong className="text-emerald-400">{money(change)}</strong></span>}</div>
            <div className="flex items-baseline gap-2">
              <span className="text-xs font-bold text-zinc-400">{remaining > 0 ? 'Falta receber' : 'Conta paga'}</span>
              <span className={`text-xl font-black sm:text-2xl ${remaining > 0 ? 'text-accent' : 'text-emerald-400'}`}>{money(remaining)}</span>
            </div>
          </div>
          <div className="flex items-stretch gap-2">
            <button type="button" onClick={handlePrintReceipt} aria-label="Imprimir conta" className="flex h-12 shrink-0 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 text-sm font-bold text-zinc-300 hover:bg-white/10"><Printer size={18} /><span className="hidden sm:inline">Imprimir conta</span></button>
            <button disabled={isSavingPayment || remaining > 0 || hasInvalidOverpayment || hasPendingCouponChoice || !selectedSeller || !canLaunchPayment || !canCloseBill} onClick={handleFinish} className="btn-beco btn-beco-purple flex h-12 min-w-0 flex-1 items-center justify-center gap-2 rounded-xl px-4 text-sm font-bold disabled:opacity-30 disabled:grayscale">
              Finalizar conta <ChevronRight size={18} />
            </button>
          </div>
          {(hasInvalidOverpayment || hasPendingCouponChoice || !selectedSeller || !canLaunchPayment || !canCloseBill) && <p className="text-xs text-rose-300">{!canCloseBill ? 'Sem permissão para fechar conta.' : !canLaunchPayment ? 'Sem permissão para lançar pagamento.' : !selectedSeller ? 'Selecione o vendedor responsável.' : hasPendingCouponChoice ? 'Escolha o benefício do cupom.' : 'Troco só é permitido em dinheiro.'}</p>}
        </footer>
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
                  <p className="text-[10px] font-black uppercase tracking-[0.24em] text-primary">VENDA + GORJETA</p>
                  <h3 className="mt-1 text-3xl font-black italic tracking-tight text-white">Add vendedor</h3>
                  <p className="mt-2 text-xs font-bold text-zinc-500">
                    Use quando uma pessoa vendeu a mesa e precisamos rastrear venda, taxa de serviço e comissão.
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
                  <span className="mb-2 block text-[10px] font-black uppercase tracking-widest text-zinc-500">Nome do vendedor</span>
                  <input
                    value={newSellerName}
                    onChange={(event) => setNewSellerName(event.target.value)}
                    placeholder="Digite o nome..."
                    className="w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-4 text-base font-black text-white outline-none transition-all focus:border-primary/60"
                  />
                </label>

                <div className="rounded-[1.75rem] border border-emerald-500/15 bg-emerald-500/5 p-4">
                  <div className="flex items-start justify-between gap-4 mb-3">
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-[0.22em] text-emerald-300">Já existe?</p>
                      <h4 className="text-lg font-black text-white">Usar pessoa cadastrada no OS</h4>
                      <p className="mt-1 text-xs font-bold text-emerald-100/55">
                        Se aparecer aqui, clique para ativar como vendedor e selecionar nesta conta.
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {isLoadingSellerCandidates && (
                        <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Carregando...</span>
                      )}
                      <button
                        type="button"
                        onClick={() => setShowSellerDirectory((value) => !value)}
                        className="inline-flex items-center gap-1 rounded-full bg-emerald-400/10 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-emerald-200 transition-all hover:bg-emerald-400 hover:text-black"
                      >
                        <Menu size={13} /> Lista
                      </button>
                    </div>
                  </div>
                  <div className="space-y-2 max-h-56 overflow-y-auto custom-scrollbar pr-1">
                    {visibleSellerCandidates.length === 0 ? (
                      <div className="rounded-2xl border border-white/5 bg-black/20 p-4 text-xs font-bold text-zinc-500">
                        {isLoadingSellerCandidates
                          ? 'Buscando pessoas no OS...'
                          : sellerCandidateSearch || showSellerDirectory
                            ? 'Nenhuma pessoa compatível encontrada. Se for vendedor novo, crie abaixo.'
                            : 'Digite o nome ou toque em Lista para ver todos os cadastros do OS que ainda não são vendedores.'}
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
                            {activatingSellerCandidateId === candidate.id ? 'Ativando...' : 'Usar'}
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
                    <p className="text-[10px] font-black uppercase tracking-[0.22em] text-zinc-500">Vendedor novo</p>
                    <h4 className="text-lg font-black text-white">Criar para rastrear venda e gorjeta</h4>
                    <p className="text-xs font-bold text-zinc-500 mt-1">
                      Use só quando a pessoa realmente vendeu ou vai vender mesas. O cadastro já nasce no OS e aparece no PDV.
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
                <Plus size={16} /> {isCreatingOsSeller ? 'Criando...' : 'Salvar vendedor e selecionar'}
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
      <ReceiptPrintModal
        data={receiptPreview}
        onClose={() => setReceiptPreview(null)}
      />
    </>
  );
}
