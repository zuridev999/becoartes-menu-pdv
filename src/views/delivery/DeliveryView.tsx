import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Bike, CheckCircle2, Copy, CreditCard, Landmark, MapPin, QrCode, RefreshCw, Send, ShoppingBag, Trash2, UserRound, X } from 'lucide-react';
import { useStore, type Modifier, type OrderItem, type Product } from '../../store';
import { MenuCatalog } from '../../components/shared/MenuCatalog';
import { ProductModal } from '../../components/modals/ProductModal';
import { createId } from '../../lib/id';
import { getOrderItemTotal, getOrderItemsTotal } from '../../lib/totals';
import { DeliveryApi, type DeliveryCouponConfig, type DeliveryCustomerAccount, type DeliveryOrderSummary } from '../../lib/api';

type DeliveryCustomer = {
  name: string;
  phone: string;
  email: string;
  taxId: string;
  street: string;
  number: string;
  neighborhood: string;
  city: string;
  state: string;
  postalCode: string;
  complement: string;
  reference: string;
  latitude?: number | null;
  longitude?: number | null;
  quoteId?: string;
  quoteExpiresAt?: string;
  notes: string;
  fulfillment: 'delivery' | 'pickup';
  paymentMethod: 'pix' | 'credit' | 'debit';
  coupon: string;
  joinClub: boolean;
};

type DeliveryEvent = {
  id: string;
  orderId: string;
  createdAt: string;
  total: number;
  customer: DeliveryCustomer;
  items: OrderItem[];
  paymentStatus: string;
  paymentProvider?: string;
  paymentExternalId?: string | null;
  checkoutUrl?: string | null;
  paymentInstructions?: {
    type: string;
    status: string;
    qrCodeText?: string;
    qrCodeImage?: string | null;
    expiresAt?: string | null;
    chargeStatus?: string | null;
    message?: string;
  } | null;
  kitchenStatus: string;
  deliveryStatus: string;
  kitchenSentAt: string | null;
  deliveryRequestedAt: string | null;
  deliveryProvider: string;
  deliveryExternalId: string | null;
  club?: {
    enrolled: boolean;
    paidOrders: number;
    cycleSize: number;
    remainingToReward: number;
    rewardsEarned: number;
    rewardLabel?: string;
  } | null;
};

type DeliveryQuote = {
  status: string;
  provider: string;
  deliveryFee: number;
  quoteId: string | null;
  expiresAt: string | null;
  preparationTimeSeconds: number;
};

const STORAGE_KEY = 'beco_delivery_mock_orders';
const SESSION_KEY = 'beco_delivery_customer_session';
const LAST_ORDER_KEY = 'beco_delivery_last_order_id';

const STATUS_LABELS: Record<string, string> = {
  disabled: 'Motoboy não acionado',
  missing_credentials: 'Aguardando configuracao',
  not_required_pickup: 'Retirada no Beco',
  paid: 'Pagamento aprovado',
  paid_mock: 'Pagamento aprovado',
  payment_failed: 'Pagamento recusado',
  payment_pending: 'Aguardando pagamento',
  pending: 'Pendente',
  available_mock: 'Entrega disponível',
  ready_for_homologation: 'Pronto para homologação',
  requested_mock: 'Motoboy solicitado',
  sent_mock: 'Delivery enviado',
  sent_production: 'Delivery na cozinha',
  waiting_payment: 'Aguardando pagamento',
};

type DeliveryCardDraft = {
  holderName: string;
  holderTaxId: string;
  number: string;
  expiry: string;
  securityCode: string;
  installments: string;
};

declare global {
  interface Window {
    PagSeguro?: {
      encryptCard: (input: {
        publicKey: string;
        holder: string;
        number: string;
        expMonth: string;
        expYear: string;
        securityCode: string;
      }) => { encryptedCard?: string; hasErrors?: boolean; errors?: unknown[] };
    };
  }
}

const PAYMENT_METHODS: Array<{ id: DeliveryCustomer['paymentMethod']; label: string; description: string; icon: typeof QrCode }> = [
  { id: 'pix', label: 'Pix', description: 'QR Code e copia e cola no nosso checkout', icon: QrCode },
  { id: 'credit', label: 'Crédito', description: 'Cartão criptografado pela chave pública PagBank', icon: CreditCard },
  { id: 'debit', label: 'Débito', description: 'Cartão de débito via Orders API', icon: Landmark },
];

const emptyCustomer: DeliveryCustomer = {
  name: '',
  phone: '',
  email: '',
  taxId: '',
  street: '',
  number: '',
  neighborhood: '',
  city: '',
  state: '',
  postalCode: '',
  complement: '',
  reference: '',
  notes: '',
  fulfillment: 'delivery',
  paymentMethod: 'pix',
  coupon: '',
  joinClub: true,
};

const DEFAULT_DELIVERY_COUPONS: DeliveryCouponConfig[] = [
  { code: 'BECO10', type: 'percent', value: 10, maxDiscount: 30, minSubtotal: 0, label: '10% de desconto' },
];

const saveMockOrder = (order: DeliveryEvent) => {
  const current = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]') as DeliveryEvent[];
  localStorage.setItem(STORAGE_KEY, JSON.stringify([order, ...current].slice(0, 25)));
};

const formatCurrency = (value: number) => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const getStatusLabel = (status: string) => STATUS_LABELS[status] || status.replaceAll('_', ' ');

const digitsOnly = (value: string) => value.replace(/\D/g, '');

const loadPagBankSdk = async () => {
  if (window.PagSeguro?.encryptCard) return window.PagSeguro;
  await new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-pagbank-sdk="true"]');
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error('SDK PagBank indisponível.')), { once: true });
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://assets.pagseguro.com.br/checkout-sdk-js/rc/dist/browser/pagseguro.min.js';
    script.async = true;
    script.dataset.pagbankSdk = 'true';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('SDK PagBank indisponível.'));
    document.head.appendChild(script);
  });
  if (!window.PagSeguro?.encryptCard) throw new Error('SDK PagBank não carregou.');
  return window.PagSeguro;
};

const parseCardExpiry = (value: string) => {
  const digits = digitsOnly(value);
  const month = digits.slice(0, 2);
  const year = digits.slice(2, 6);
  const fullYear = year.length === 2 ? `20${year}` : year;
  return { month, year: fullYear };
};

const calculateCouponDiscount = (subtotal: number, couponCode: string, coupons: DeliveryCouponConfig[]) => {
  const normalizedCode = couponCode.trim().toUpperCase();
  if (!normalizedCode) return 0;
  const coupon = coupons.find((item) => item.code === normalizedCode);
  if (!coupon || subtotal < coupon.minSubtotal) return 0;
  const rawDiscount = coupon.type === 'fixed' ? coupon.value : subtotal * (coupon.value / 100);
  const cappedDiscount = coupon.maxDiscount === null ? rawDiscount : Math.min(rawDiscount, coupon.maxDiscount);
  return Math.min(subtotal, Math.max(0, cappedDiscount));
};

const isPaymentApproved = (status: string) => status.startsWith('paid');

const shouldTrackOrder = (order: DeliveryEvent) => (
  !isPaymentApproved(order.paymentStatus)
  || ['pending', 'waiting_payment'].includes(order.kitchenStatus)
  || ['pending', 'waiting_payment', 'missing_credentials', 'ready_for_homologation'].includes(order.deliveryStatus)
);

export function DeliveryView() {
  const { addNotification } = useStore();
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [cart, setCart] = useState<OrderItem[]>([]);
  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);
  const [customer, setCustomer] = useState<DeliveryCustomer>(emptyCustomer);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [cardDraft, setCardDraft] = useState<DeliveryCardDraft>({
    holderName: '',
    holderTaxId: '',
    number: '',
    expiry: '',
    securityCode: '',
    installments: '1',
  });
  const [isPaying, setIsPaying] = useState(false);
  const [deliveryQuote, setDeliveryQuote] = useState<DeliveryQuote | null>(null);
  const [deliveryCoupons, setDeliveryCoupons] = useState<DeliveryCouponConfig[]>(DEFAULT_DELIVERY_COUPONS);
  const [publicStatus, setPublicStatus] = useState('building');
  const [account, setAccount] = useState<DeliveryCustomerAccount | null>(null);
  const [customerOrders, setCustomerOrders] = useState<DeliveryOrderSummary[]>([]);
  const [isAccountOpen, setIsAccountOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [authDraft, setAuthDraft] = useState({ identity: '', password: '', code: '', newPassword: '' });
  const [authMode, setAuthMode] = useState<'login' | 'forgot' | 'reset' | 'verify' | 'orders'>('login');
  const [authMessage, setAuthMessage] = useState('');
  const [isAuthBusy, setIsAuthBusy] = useState(false);
  const [isQuotingDelivery, setIsQuotingDelivery] = useState(false);
  const [isLookingUpPostalCode, setIsLookingUpPostalCode] = useState(false);
  const [completedOrder, setCompletedOrder] = useState<DeliveryEvent | null>(null);

  const subtotal = getOrderItemsTotal(cart);
  const couponDiscount = calculateCouponDiscount(subtotal, customer.coupon, deliveryCoupons);
  const deliveryFee = customer.fulfillment === 'delivery' && subtotal > 0 ? 8 : 0;
  const total = Math.max(0, subtotal + deliveryFee - couponDiscount);

  const cartCount = useMemo(() => cart.reduce((acc, item) => acc + item.quantity, 0), [cart]);

  const addDeliveryItem = (product: Product, quantity: number, selectedModifiers: Modifier[], notes = '') => {
    const item: OrderItem = {
      id: createId(),
      productId: product.id,
      categoryId: product.categoryId,
      categoryName: product.categoryName,
      name: product.name,
      price: product.price,
      remoteStockId: product.remoteStockId,
      quantity,
      selectedModifiers,
      notes,
      status: 'pending',
      orderedAt: new Date(),
    };
    setCart((current) => [...current, item]);
    addNotification(`${quantity}x ${product.name} adicionado ao delivery!`, 'info');
  };

  useEffect(() => {
    let cancelled = false;
    DeliveryApi.config()
      .then((config) => {
        if (!cancelled) setPublicStatus(String(config.mode?.publicStatus || 'open'));
        if (!cancelled && Array.isArray(config.coupons) && config.coupons.length > 0) {
          setDeliveryCoupons(config.coupons);
        }
      })
      .catch((error) => {
        console.warn('Config delivery indisponível:', error);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const token = localStorage.getItem(SESSION_KEY) || '';
    const lastOrderId = localStorage.getItem(LAST_ORDER_KEY) || '';
    if (lastOrderId) {
      DeliveryApi.getOrder(lastOrderId)
        .then((result) => setCompletedOrder(result.order as DeliveryEvent))
        .catch(() => localStorage.removeItem(LAST_ORDER_KEY));
    }
    if (!token) return;
    DeliveryApi.getCustomerSession(token)
      .then((result) => {
        if (result.customer) {
          setAccount(result.customer);
          setCustomer((current) => ({
            ...current,
            name: result.customer?.name || current.name,
            phone: result.customer?.phone || current.phone,
            email: result.customer?.email || current.email,
            street: result.customer?.street || current.street,
            number: result.customer?.number || current.number,
            neighborhood: result.customer?.neighborhood || current.neighborhood,
            city: result.customer?.city || current.city,
            state: result.customer?.state || current.state,
            postalCode: result.customer?.postalCode || current.postalCode,
            complement: result.customer?.complement || current.complement,
            reference: result.customer?.reference || current.reference,
            joinClub: result.customer?.joinClub ?? current.joinClub,
          }));
        }
      })
      .catch(() => localStorage.removeItem(SESSION_KEY));
  }, []);

  const validateCheckout = () => {
    const nextErrors: Record<string, string> = {};
    if (!customer.name.trim()) nextErrors.name = 'Informe seu nome.';
    if (!customer.phone.trim()) nextErrors.phone = 'Informe seu telefone.';
    if (!customer.email.trim()) nextErrors.email = 'Informe seu e-mail.';
    if (digitsOnly(customer.taxId).length < 11) nextErrors.taxId = 'Informe o CPF.';
    if (!account && !password.trim()) nextErrors.password = 'Crie uma senha.';
    if (!account && password.trim().length < 6) nextErrors.password = 'Senha com pelo menos 6 caracteres.';
    if (customer.fulfillment === 'delivery') {
      if (!customer.street.trim()) nextErrors.street = 'Informe o endereço.';
      if (!customer.number.trim()) nextErrors.number = 'Informe o número.';
      if (!customer.neighborhood.trim()) nextErrors.neighborhood = 'Informe o bairro.';
      if (!customer.city.trim()) nextErrors.city = 'Informe a cidade.';
      if (!customer.state.trim()) nextErrors.state = 'Informe o UF.';
      if (!customer.postalCode.trim()) nextErrors.postalCode = 'Informe o CEP.';
    }
    if (['credit', 'debit'].includes(customer.paymentMethod)) {
      if (!cardDraft.holderName.trim()) nextErrors.cardHolderName = 'Informe o nome do cartão.';
      if (digitsOnly(cardDraft.holderTaxId || customer.taxId).length < 11) nextErrors.cardHolderTaxId = 'Informe o CPF do titular.';
      if (digitsOnly(cardDraft.number).length < 13) nextErrors.cardNumber = 'Informe o número do cartão.';
      const expiry = parseCardExpiry(cardDraft.expiry);
      if (expiry.month.length !== 2 || expiry.year.length !== 4) nextErrors.cardExpiry = 'Informe MM/AA.';
      if (digitsOnly(cardDraft.securityCode).length < 3) nextErrors.cardSecurityCode = 'Informe o CVV.';
    }
    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const encryptDeliveryCard = async () => {
    const publicKeyResult = await DeliveryApi.pagbankPublicKey();
    if (!publicKeyResult.publicKey) throw new Error('Chave pública PagBank indisponível.');
    const sdk = await loadPagBankSdk();
    const expiry = parseCardExpiry(cardDraft.expiry);
    const encrypted = sdk.encryptCard({
      publicKey: publicKeyResult.publicKey,
      holder: cardDraft.holderName.trim(),
      number: digitsOnly(cardDraft.number),
      expMonth: expiry.month,
      expYear: expiry.year,
      securityCode: digitsOnly(cardDraft.securityCode),
    });
    if (encrypted.hasErrors || !encrypted.encryptedCard) {
      throw new Error('Não foi possível validar o cartão. Confira os dados.');
    }
    return {
      encrypted: encrypted.encryptedCard,
      holderName: cardDraft.holderName.trim(),
      holderTaxId: digitsOnly(cardDraft.holderTaxId || customer.taxId),
      installments: Math.max(1, Number(cardDraft.installments || 1)),
    };
  };

  const quoteDelivery = async () => {
    if (customer.fulfillment !== 'delivery' || cart.length === 0 || isQuotingDelivery) return;
    if (!customer.street.trim() || !customer.number.trim() || !customer.neighborhood.trim() || !customer.city.trim() || !customer.state.trim() || !customer.postalCode.trim()) {
      setErrors((current) => ({
        ...current,
        street: customer.street.trim() ? current.street || '' : 'Informe o endereço.',
        number: customer.number.trim() ? current.number || '' : 'Informe o número.',
        neighborhood: customer.neighborhood.trim() ? current.neighborhood || '' : 'Informe o bairro.',
        city: customer.city.trim() ? current.city || '' : 'Informe a cidade.',
        state: customer.state.trim() ? current.state || '' : 'Informe o UF.',
        postalCode: customer.postalCode.trim() ? current.postalCode || '' : 'Informe o CEP.',
      }));
      return;
    }

    setIsQuotingDelivery(true);
    try {
      const result = await DeliveryApi.quote({ customer, items: cart });
      setDeliveryQuote(result.quote);
      addNotification(`Entrega: ${getStatusLabel(result.quote.status)}`, 'info');
    } catch (error) {
      console.warn('Cotação delivery indisponível:', error);
      setDeliveryQuote(null);
      addNotification('Cotação de entrega indisponível no momento.', 'error');
    } finally {
      setIsQuotingDelivery(false);
    }
  };

  const lookupPostalCode = async () => {
    if (isLookingUpPostalCode) return;
    const digits = customer.postalCode.replace(/\D/g, '');
    if (digits.length !== 8) {
      setErrors((current) => ({ ...current, postalCode: 'Informe um CEP com 8 dígitos.' }));
      return;
    }

    setIsLookingUpPostalCode(true);
    try {
      const result = await DeliveryApi.lookupPostalCode(digits);
      if (!result.postalCode.address) {
        addNotification('CEP não localizado. Preencha o endereço manualmente.', 'info');
        return;
      }
      const { address } = result.postalCode;
      setCustomer((current) => ({
        ...current,
        postalCode: digits,
        street: current.street || address.street,
        neighborhood: current.neighborhood || address.neighborhood,
        city: current.city || address.city,
        state: current.state || address.state,
      }));
      setDeliveryQuote(null);
      setErrors((current) => ({ ...current, postalCode: '', street: '', neighborhood: '', city: '', state: '' }));
      addNotification('Endereço preenchido pelo CEP.', 'info');
    } catch (error) {
      console.warn('Busca de CEP indisponível:', error);
      addNotification('Busca de CEP indisponível. Preencha manualmente.', 'error');
    } finally {
      setIsLookingUpPostalCode(false);
    }
  };

  const simulatePaymentAndDispatch = async () => {
    if (!validateCheckout() || cart.length === 0 || isPaying) return;

    setIsPaying(true);

    const now = new Date().toISOString();
    const orderId = `delivery_${createId()}`;
    const fallbackOrder: DeliveryEvent = {
      id: orderId,
      orderId,
      createdAt: now,
      total,
      customer,
      items: cart.map((item) => ({ ...item, id: createId(), orderId })),
      paymentStatus: 'paid',
      kitchenStatus: 'sent_mock',
      deliveryStatus: 'requested_mock',
      kitchenSentAt: now,
      deliveryRequestedAt: now,
      deliveryProvider: 'ifood_mock',
      deliveryExternalId: `ifood_mock_${createId()}`,
    };

    try {
      if (!account) {
        const created = await DeliveryApi.registerCustomer({ customer, password });
        localStorage.setItem(SESSION_KEY, created.session.token);
        setAccount(created.customer);
        setAuthMessage(created.verification?.code ? `Codigo de confirmacao: ${created.verification.code}` : 'Cadastro criado.');
        setAuthMode('verify');
      }
      const encryptedCard = ['credit', 'debit'].includes(customer.paymentMethod)
        ? await encryptDeliveryCard()
        : null;
      const result = await DeliveryApi.checkout({
        orderId,
        customer: {
          ...customer,
          taxId: digitsOnly(customer.taxId),
          quoteId: deliveryQuote?.quoteId || '',
          quoteExpiresAt: deliveryQuote?.expiresAt || '',
        },
        items: cart,
        payment: encryptedCard ? { card: encryptedCard } : undefined,
      });
      const persistedOrder = {
        ...fallbackOrder,
        ...result.order,
        createdAt: result.order.createdAt,
        customer: {
          ...result.order.customer,
          taxId: result.order.customer.taxId || customer.taxId || '',
          paymentMethod: result.order.customer.paymentMethod === 'pagbank' ? 'pix' : result.order.customer.paymentMethod,
        },
        items: result.order.items,
        paymentStatus: result.order.paymentStatus,
        paymentProvider: result.order.paymentProvider,
        paymentExternalId: result.order.paymentExternalId,
        checkoutUrl: result.order.checkoutUrl,
        paymentInstructions: result.order.paymentInstructions,
        kitchenStatus: result.order.kitchenStatus,
        deliveryStatus: result.order.deliveryStatus,
        kitchenSentAt: result.order.kitchenSentAt,
        deliveryRequestedAt: result.order.deliveryRequestedAt,
        deliveryProvider: result.order.deliveryProvider,
        deliveryExternalId: result.order.deliveryExternalId,
        club: result.order.club,
      } satisfies DeliveryEvent;
      saveMockOrder(persistedOrder);
      localStorage.setItem(LAST_ORDER_KEY, persistedOrder.orderId);
      setCompletedOrder(persistedOrder);
      setCart([]);
      setIsCheckoutOpen(false);
      setPassword('');
      setCardDraft({ holderName: '', holderTaxId: '', number: '', expiry: '', securityCode: '', installments: '1' });
      setCustomer((current) => account ? current : emptyCustomer);
      const message = result.order.checkoutUrl
        ? 'Checkout PagBank criado. Finalize o pagamento para acionar operação.'
        : isPaymentApproved(result.order.paymentStatus)
          ? 'Delivery pago: cozinha e motoboy registrados no BFF.'
          : customer.paymentMethod === 'pix'
            ? 'Pix gerado. A operação será acionada após o pagamento.'
            : 'Pagamento enviado. A operação será acionada após confirmação.';
      addNotification(message, isPaymentApproved(result.order.paymentStatus) ? 'order' : 'info');
    } catch (error) {
      console.warn('Checkout delivery indisponível:', error);
      addNotification(error instanceof Error ? error.message : 'Checkout indisponível. Revise os dados e tente novamente.', 'error');
    } finally {
      setIsPaying(false);
    }
  };

  const loadCustomerOrders = async () => {
    const token = localStorage.getItem(SESSION_KEY) || '';
    if (!token) return;
    try {
      const result = await DeliveryApi.listCustomerOrders(token);
      setCustomerOrders(result.orders);
    } catch (error) {
      setAuthMessage(error instanceof Error ? error.message : 'Não foi possível carregar seus pedidos.');
    }
  };

  const handleCustomerLogin = async () => {
    if (isAuthBusy) return;
    setIsAuthBusy(true);
    try {
      const result = await DeliveryApi.loginCustomer({ identity: authDraft.identity, password: authDraft.password });
      localStorage.setItem(SESSION_KEY, result.session.token);
      setAccount(result.customer);
      setAuthMessage('Login feito.');
      setAuthMode('orders');
      await loadCustomerOrders();
    } catch (error) {
      setAuthMessage(error instanceof Error ? error.message : 'Não foi possível entrar agora.');
    } finally {
      setIsAuthBusy(false);
    }
  };

  const handleForgotPassword = async () => {
    if (isAuthBusy) return;
    setIsAuthBusy(true);
    try {
      const result = await DeliveryApi.forgotPassword(authDraft.identity);
      setAuthMessage(result.code ? `Codigo de recuperacao: ${result.code}` : 'Se encontramos seu cadastro, enviamos um codigo.');
      setAuthMode('reset');
    } catch (error) {
      setAuthMessage(error instanceof Error ? error.message : 'Não foi possível enviar o código agora.');
    } finally {
      setIsAuthBusy(false);
    }
  };

  const handleResetPassword = async () => {
    if (isAuthBusy) return;
    setIsAuthBusy(true);
    try {
      const result = await DeliveryApi.resetPassword({ identity: authDraft.identity, code: authDraft.code, password: authDraft.newPassword });
      localStorage.setItem(SESSION_KEY, result.session.token);
      setAccount(result.customer);
      setAuthMessage('Senha atualizada.');
      setAuthMode('orders');
      await loadCustomerOrders();
    } catch (error) {
      setAuthMessage(error instanceof Error ? error.message : 'Não foi possível trocar a senha agora.');
    } finally {
      setIsAuthBusy(false);
    }
  };

  const handleVerifyCode = async () => {
    if (isAuthBusy) return;
    setIsAuthBusy(true);
    try {
      const token = localStorage.getItem(SESSION_KEY) || '';
      const result = await DeliveryApi.verifyCustomerCode({ token, code: authDraft.code });
      setAccount(result.customer);
      setAuthMessage('Cadastro confirmado.');
    } catch (error) {
      setAuthMessage(error instanceof Error ? error.message : 'Não foi possível confirmar o cadastro agora.');
    } finally {
      setIsAuthBusy(false);
    }
  };

  const handleTrackCustomerOrder = async (orderId: string) => {
    try {
      const result = await DeliveryApi.getOrder(orderId);
      const order = result.order as DeliveryEvent;
      localStorage.setItem(LAST_ORDER_KEY, order.orderId);
      setCompletedOrder(order);
      setIsAccountOpen(false);
    } catch (error) {
      setAuthMessage(error instanceof Error ? error.message : 'Não foi possível abrir o acompanhamento agora.');
    }
  };

  if (publicStatus !== 'open') {
    return <DeliveryBuildingScreen />;
  }

  const updateCustomer = <K extends keyof DeliveryCustomer>(key: K, value: DeliveryCustomer[K]) => {
    setCustomer((current) => ({ ...current, [key]: value }));
    if (['street', 'number', 'neighborhood', 'city', 'state', 'postalCode', 'fulfillment'].includes(String(key))) {
      setDeliveryQuote(null);
    }
    if (errors[key]) setErrors((current) => ({ ...current, [key]: '' }));
  };

  return (
    <div className="h-[100dvh] overflow-hidden bg-[#0a0a0c] text-white font-['Outfit']">
      <div className="fixed top-0 left-0 right-0 h-16 sm:h-20 glass border-b border-white/5 z-50 flex items-center justify-between px-3 sm:px-6 backdrop-blur-3xl bg-black/50">
        <div className="flex items-center gap-3 sm:gap-4 min-w-0">
          <div className="w-10 h-10 bg-red-500/20 rounded-2xl flex shrink-0 items-center justify-center text-red-300">
            <Bike size={20} />
          </div>
          <div className="min-w-0">
            <p className="text-[8px] font-black uppercase text-red-300 tracking-[0.28em]">Delivery</p>
            <h1 className="text-xl sm:text-2xl font-black tracking-tighter truncate">Becoartes em casa</h1>
          </div>
        </div>
        <button
          onClick={() => setIsCheckoutOpen(true)}
          disabled={cart.length === 0}
          className="btn-beco btn-beco-purple px-4 py-3 relative active:scale-95 disabled:opacity-30"
          aria-label="Abrir carrinho"
        >
          <ShoppingBag size={18} />
          {cart.length > 0 && (
            <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white text-[10px] font-black rounded-full flex items-center justify-center border-2 border-[#0a0a0c]">
              {cartCount}
            </span>
          )}
        </button>
        <button
          onClick={async () => {
            setIsAccountOpen(true);
            setAuthMode(account ? 'orders' : 'login');
            if (account) await loadCustomerOrders();
          }}
          className="glass rounded-2xl border border-white/10 px-4 py-3 text-xs font-black uppercase tracking-widest text-zinc-300 hover:text-white"
        >
          {account ? 'Meus pedidos' : 'Login'}
        </button>
      </div>

      <div className="h-full pt-16 sm:pt-20 pb-[6.5rem] sm:pb-28">
        <MenuCatalog onProductSelect={setSelectedProduct} viewMode="grid" surface="delivery" />
      </div>

      <div className="fixed bottom-[calc(env(safe-area-inset-bottom)+1rem)] left-3 right-3 sm:left-1/2 sm:right-auto sm:-translate-x-1/2 z-50">
        <button
          onClick={() => setIsCheckoutOpen(true)}
          disabled={cart.length === 0}
          className="w-full sm:w-auto glass-card px-5 sm:px-8 py-4 flex items-center justify-center gap-4 border-red-500/30 shadow-2xl shadow-red-500/10 active:scale-95 transition-all disabled:opacity-40"
        >
          <Send size={20} className="text-red-300" />
          <div className="text-left">
            <p className="text-[8px] font-black uppercase text-gray-500">{cartCount || 0} {cartCount === 1 ? 'item' : 'itens'} no delivery</p>
            <p className="text-lg font-black text-white leading-none">Checkout - {formatCurrency(total)}</p>
          </div>
        </button>
      </div>

      <AnimatePresence>
        {selectedProduct && (
          <ProductModal
            product={selectedProduct}
            onClose={() => setSelectedProduct(null)}
            onAddToCart={addDeliveryItem}
            tabletLandscape
            qrMobileFlow
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isCheckoutOpen && (
          <DeliveryCheckout
            cart={cart}
            customer={customer}
            errors={errors}
            deliveryQuote={deliveryQuote}
            subtotal={subtotal}
            deliveryFee={deliveryFee}
            couponDiscount={couponDiscount}
            total={total}
            isPaying={isPaying}
            isQuotingDelivery={isQuotingDelivery}
            onClose={() => setIsCheckoutOpen(false)}
            onRemove={(itemId) => setCart((current) => current.filter((item) => item.id !== itemId))}
            onCustomerChange={updateCustomer}
            onQuoteDelivery={quoteDelivery}
            onPay={simulatePaymentAndDispatch}
            account={account}
            password={password}
            onPasswordChange={setPassword}
            cardDraft={cardDraft}
            onCardDraftChange={(key, value) => {
              setCardDraft((current) => ({ ...current, [key]: value }));
              if (errors[key]) setErrors((current) => ({ ...current, [key]: '' }));
            }}
            couponHint={deliveryCoupons[0]?.code || ''}
            isLookingUpPostalCode={isLookingUpPostalCode}
            onLookupPostalCode={lookupPostalCode}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isAccountOpen && (
          <DeliveryAccountModal
            account={account}
            mode={authMode}
            draft={authDraft}
            message={authMessage}
            orders={customerOrders}
            onClose={() => setIsAccountOpen(false)}
            onModeChange={setAuthMode}
            onDraftChange={(key, value) => setAuthDraft((current) => ({ ...current, [key]: value }))}
            onLogin={handleCustomerLogin}
            onForgot={handleForgotPassword}
            onReset={handleResetPassword}
            onVerify={handleVerifyCode}
            onReloadOrders={loadCustomerOrders}
            onTrackOrder={handleTrackCustomerOrder}
            onLogout={() => {
              localStorage.removeItem(SESSION_KEY);
              setAccount(null);
              setCustomerOrders([]);
              setAuthMode('login');
              setAuthMessage('Você saiu da conta.');
            }}
            isBusy={isAuthBusy}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {completedOrder && (
          <DeliverySuccess
            order={completedOrder}
            onOrderUpdate={setCompletedOrder}
            onClose={() => setCompletedOrder(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function Field({
  label,
  value,
  error,
  onChange,
  type = 'text',
  placeholder,
}: {
  label: string;
  value: string;
  error?: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <label className="block min-w-0">
      <span className="mb-2 block text-[10px] font-black uppercase tracking-[0.22em] text-gray-500">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className={`w-full glass rounded-2xl border p-4 text-sm font-bold outline-none transition-all ${error ? 'border-rose-500 text-rose-100' : 'border-white/10 focus:border-primary'}`}
      />
      {error && <span className="mt-2 block text-xs font-bold text-rose-300">{error}</span>}
    </label>
  );
}

function DeliveryCheckout({
  cart,
  customer,
  errors,
  deliveryQuote,
  subtotal,
  deliveryFee,
  couponDiscount,
  total,
  isPaying,
  isQuotingDelivery,
  onClose,
  onRemove,
  onCustomerChange,
  onQuoteDelivery,
  onPay,
  account,
  password,
  onPasswordChange,
  cardDraft,
  onCardDraftChange,
  couponHint,
  isLookingUpPostalCode,
  onLookupPostalCode,
}: {
  cart: OrderItem[];
  customer: DeliveryCustomer;
  errors: Record<string, string>;
  deliveryQuote: DeliveryQuote | null;
  subtotal: number;
  deliveryFee: number;
  couponDiscount: number;
  total: number;
  isPaying: boolean;
  isQuotingDelivery: boolean;
  onClose: () => void;
  onRemove: (itemId: string) => void;
  onCustomerChange: <K extends keyof DeliveryCustomer>(key: K, value: DeliveryCustomer[K]) => void;
  onQuoteDelivery: () => void;
  onPay: () => void;
  account: DeliveryCustomerAccount | null;
  password: string;
  onPasswordChange: (value: string) => void;
  cardDraft: DeliveryCardDraft;
  onCardDraftChange: (key: keyof DeliveryCardDraft, value: string) => void;
  couponHint: string;
  isLookingUpPostalCode: boolean;
  onLookupPostalCode: () => void;
}) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[200] flex items-center justify-center p-3 sm:p-8 bg-black/80 backdrop-blur-md">
      <motion.div initial={{ scale: 0.95, y: 20 }} animate={{ scale: 1, y: 0 }} className="w-full max-w-6xl bg-[#0a0a0c] rounded-[2rem] border border-white/10 shadow-2xl overflow-hidden flex flex-col max-h-[calc(100dvh-1.5rem)]">
        <div className="p-4 sm:p-8 border-b border-white/5 flex justify-between items-center gap-3 bg-white/[0.02]">
          <div className="flex items-center gap-4 min-w-0">
            <div className="w-12 h-12 bg-red-500/20 rounded-2xl flex shrink-0 items-center justify-center text-red-300">
              <CreditCard size={24} />
            </div>
            <div className="min-w-0">
              <h2 className="text-3xl sm:text-5xl font-black italic tracking-tighter leading-none">Checkout</h2>
              <p className="text-gray-500 font-black uppercase tracking-widest text-[9px] sm:text-xs">Pix, crédito ou débito</p>
            </div>
          </div>
          <button onClick={onClose} className="p-3 glass rounded-full hover:bg-rose-500/20 text-rose-500 transition-all shrink-0">
            <X size={24} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar p-4 sm:p-8 grid grid-cols-1 lg:grid-cols-[1fr_420px] gap-6">
          <div className="space-y-6">
            <section className="space-y-4">
              <div className="flex items-center gap-3 text-white">
                <UserRound size={18} className="text-primary" />
                <h3 className="text-xl font-black uppercase tracking-tight">Cliente</h3>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Nome" value={customer.name} error={errors.name} onChange={(value) => onCustomerChange('name', value)} />
                <Field label="Telefone" value={customer.phone} error={errors.phone} onChange={(value) => onCustomerChange('phone', value)} />
                <Field label="E-mail" type="email" value={customer.email} error={errors.email} onChange={(value) => onCustomerChange('email', value)} />
                <Field label="CPF" value={customer.taxId} error={errors.taxId} onChange={(value) => onCustomerChange('taxId', value)} />
                <Field label="Cupom" value={customer.coupon} onChange={(value) => onCustomerChange('coupon', value)} placeholder={couponHint} />
              </div>
              <label className="flex items-center gap-3 glass rounded-2xl border border-white/10 p-4">
                <input type="checkbox" checked={customer.joinClub} onChange={(event) => onCustomerChange('joinClub', event.target.checked)} className="h-5 w-5 accent-purple-500" />
                <span className="text-sm font-bold text-gray-300">Cadastrar no clube gratuito de descontos Becoartes.</span>
              </label>
              {!account ? (
                <Field label="Senha" type="password" value={password} error={errors.password} onChange={onPasswordChange} />
              ) : (
                <div className="glass rounded-2xl border border-emerald-500/20 p-4 text-sm font-black text-emerald-300">
                  Comprando como {account.name}
                </div>
              )}
            </section>

            <section className="space-y-4">
              <div className="flex items-center gap-3 text-white">
                <MapPin size={18} className="text-primary" />
                <h3 className="text-xl font-black uppercase tracking-tight">Entrega</h3>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {(['delivery', 'pickup'] as const).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => onCustomerChange('fulfillment', mode)}
                    className={`rounded-2xl border p-4 text-sm font-black uppercase tracking-widest transition-all ${customer.fulfillment === mode ? 'border-red-400 bg-red-500/20 text-white' : 'border-white/10 glass text-gray-400'}`}
                  >
                    {mode === 'delivery' ? 'Entrega' : 'Retirada'}
                  </button>
                ))}
              </div>
              {customer.fulfillment === 'delivery' && (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="grid grid-cols-[1fr_auto] gap-2 items-end">
                      <Field label="CEP" value={customer.postalCode} error={errors.postalCode} onChange={(value) => onCustomerChange('postalCode', value)} />
                      <button onClick={onLookupPostalCode} disabled={isLookingUpPostalCode} className="h-[54px] px-4 rounded-2xl bg-white/5 border border-white/10 text-[10px] font-black uppercase tracking-widest text-zinc-300 hover:text-white disabled:opacity-50">
                        {isLookingUpPostalCode ? '...' : 'Buscar'}
                      </button>
                    </div>
                    <Field label="Endereço" value={customer.street} error={errors.street} onChange={(value) => onCustomerChange('street', value)} />
                    <Field label="Número" value={customer.number} error={errors.number} onChange={(value) => onCustomerChange('number', value)} />
                    <Field label="Bairro" value={customer.neighborhood} error={errors.neighborhood} onChange={(value) => onCustomerChange('neighborhood', value)} />
                    <Field label="Cidade" value={customer.city} error={errors.city} onChange={(value) => onCustomerChange('city', value)} />
                    <Field label="UF" value={customer.state} error={errors.state} onChange={(value) => onCustomerChange('state', value.toUpperCase().slice(0, 2))} />
                    <Field label="Complemento" value={customer.complement} onChange={(value) => onCustomerChange('complement', value)} />
                    <Field label="Referência" value={customer.reference} onChange={(value) => onCustomerChange('reference', value)} />
                  </div>
                  <div className="glass rounded-2xl border border-white/10 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[10px] font-black uppercase tracking-[0.22em] text-gray-500">Cotação</p>
                      <p className="text-sm font-black text-gray-300">
                        {deliveryQuote ? `${getStatusLabel(deliveryQuote.status)} • ${formatCurrency(deliveryQuote.deliveryFee)}` : 'Entrega ainda não calculada'}
                      </p>
                    </div>
                    <button onClick={onQuoteDelivery} disabled={isQuotingDelivery || cart.length === 0} className="btn-beco btn-beco-purple px-4 py-3 rounded-2xl font-black uppercase tracking-widest text-xs flex items-center justify-center gap-2 disabled:opacity-40">
                      <RefreshCw size={16} className={isQuotingDelivery ? 'animate-spin' : ''} />
                      {isQuotingDelivery ? 'Calculando' : 'Calcular'}
                    </button>
                  </div>
                </>
              )}
              <label className="block">
                <span className="mb-2 block text-[10px] font-black uppercase tracking-[0.22em] text-gray-500">Observações</span>
                <textarea value={customer.notes} onChange={(event) => onCustomerChange('notes', event.target.value)} className="w-full glass rounded-2xl border border-white/10 p-4 text-sm font-bold outline-none focus:border-primary min-h-[96px] resize-none" />
              </label>
            </section>

            <section className="space-y-4">
              <div className="flex items-center gap-3 text-white">
                <CreditCard size={18} className="text-primary" />
                <h3 className="text-xl font-black uppercase tracking-tight">Pagamento</h3>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {PAYMENT_METHODS.map((method) => {
                  const Icon = method.icon;
                  return (
                    <button
                      key={method.id}
                      onClick={() => onCustomerChange('paymentMethod', method.id)}
                      className={`rounded-2xl border p-4 text-left transition-all ${customer.paymentMethod === method.id ? 'border-primary bg-primary/20 text-white' : 'border-white/10 glass text-gray-400'}`}
                    >
                      <span className="flex items-center gap-2 text-xs font-black uppercase tracking-widest">
                        <Icon size={16} />
                        {method.label}
                      </span>
                      <span className="mt-2 block text-[11px] font-bold text-gray-500">{method.description}</span>
                    </button>
                  );
                })}
              </div>
              {['credit', 'debit'].includes(customer.paymentMethod) && (
                <div className="glass rounded-2xl border border-white/10 p-4 space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Field label="Nome no cartão" value={cardDraft.holderName} error={errors.cardHolderName} onChange={(value) => onCardDraftChange('holderName', value)} />
                    <Field label="CPF do titular" value={cardDraft.holderTaxId || customer.taxId} error={errors.cardHolderTaxId} onChange={(value) => onCardDraftChange('holderTaxId', value)} />
                    <Field label="Número do cartão" value={cardDraft.number} error={errors.cardNumber} onChange={(value) => onCardDraftChange('number', value)} />
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="Validade" value={cardDraft.expiry} error={errors.cardExpiry} onChange={(value) => onCardDraftChange('expiry', value)} placeholder="MM/AA" />
                      <Field label="CVV" value={cardDraft.securityCode} error={errors.cardSecurityCode} onChange={(value) => onCardDraftChange('securityCode', value)} />
                    </div>
                    {customer.paymentMethod === 'credit' && (
                      <Field label="Parcelas" value={cardDraft.installments} onChange={(value) => onCardDraftChange('installments', value.replace(/\D/g, '').slice(0, 2) || '1')} />
                    )}
                  </div>
                  <p className="text-[11px] font-bold text-zinc-500">
                    O cartão é criptografado no navegador pela chave pública PagBank antes de sair desta tela.
                  </p>
                </div>
              )}
            </section>
          </div>

          <aside className="space-y-4">
            <div className="space-y-3">
              {cart.map((item) => (
                <div key={item.id} className="glass rounded-2xl border border-white/10 p-4 flex gap-3">
                  <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center font-black shrink-0">{item.quantity}</div>
                  <div className="min-w-0 flex-1">
                    <p className="font-black text-base leading-tight">{item.name}</p>
                    <p className="text-sm font-black text-accent mt-1">{formatCurrency(getOrderItemTotal(item))}</p>
                  </div>
                  <button onClick={() => onRemove(item.id)} className="p-2 text-rose-400 hover:bg-rose-500/10 rounded-xl">
                    <Trash2 size={18} />
                  </button>
                </div>
              ))}
            </div>
            <div className="glass rounded-2xl border border-white/10 p-5 space-y-3">
              <div className="flex justify-between text-sm font-bold text-gray-400"><span>Subtotal</span><span>{formatCurrency(subtotal)}</span></div>
              <div className="flex justify-between text-sm font-bold text-gray-400"><span>Entrega</span><span>{formatCurrency(deliveryFee)}</span></div>
              <div className="flex justify-between text-sm font-bold text-emerald-300"><span>Desconto</span><span>- {formatCurrency(couponDiscount)}</span></div>
              <div className="border-t border-white/10 pt-4 flex justify-between items-end">
                <span className="text-[10px] font-black uppercase tracking-[0.22em] text-gray-500">Total</span>
                <span className="text-4xl font-black text-accent tracking-tighter">{formatCurrency(total)}</span>
              </div>
            </div>
            <button onClick={onPay} disabled={isPaying || cart.length === 0} className="w-full btn-beco btn-beco-purple py-5 rounded-3xl font-black tracking-[0.18em] uppercase flex items-center justify-center gap-3 disabled:opacity-30">
              <CreditCard size={20} />
              {isPaying ? 'Processando...' : customer.paymentMethod === 'pix' ? 'Gerar Pix' : 'Pagar e enviar'}
            </button>
          </aside>
        </div>
      </motion.div>
    </motion.div>
  );
}

function DeliverySuccess({
  order,
  onOrderUpdate,
  onClose,
}: {
  order: DeliveryEvent;
  onOrderUpdate: (order: DeliveryEvent) => void;
  onClose: () => void;
}) {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [copiedPix, setCopiedPix] = useState(false);

  const refreshOrder = useCallback(async () => {
    if (!order.orderId || isRefreshing) return;
    setIsRefreshing(true);
    try {
      const result = await DeliveryApi.getOrder(order.orderId);
      onOrderUpdate({ ...order, ...result.order } as DeliveryEvent);
    } catch (error) {
      console.warn('Status delivery indisponível:', error);
    } finally {
      setIsRefreshing(false);
    }
  }, [isRefreshing, onOrderUpdate, order]);

  useEffect(() => {
    if (!order.orderId || !shouldTrackOrder(order)) return;
    const timer = window.setInterval(refreshOrder, 8000);
    return () => window.clearInterval(timer);
  }, [order, refreshOrder]);

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[400] bg-emerald-500 flex flex-col items-center justify-center text-white p-5 sm:p-8 text-center">
      <div className="w-24 h-24 sm:w-28 sm:h-28 bg-white/20 rounded-full flex items-center justify-center mb-6 sm:mb-8">
        <CheckCircle2 size={72} />
      </div>
      <h2 className="text-4xl sm:text-7xl font-black italic tracking-tighter mb-4">Pedido recebido</h2>
      <p className="text-sm sm:text-xl font-black uppercase tracking-widest max-w-2xl">
        {isPaymentApproved(order.paymentStatus)
          ? 'Pagamento aprovado. Cozinha e delivery foram acionados em paralelo.'
          : 'Pedido registrado. A operacao sera acionada apos confirmacao do pagamento.'}
      </p>

      <div className="mt-7 grid grid-cols-1 sm:grid-cols-3 gap-3 text-left max-w-4xl w-full">
        <StatusTile
          label="Pagamento"
          value={getStatusLabel(order.paymentStatus)}
          done={isPaymentApproved(order.paymentStatus)}
        />
        <StatusTile
          label="Cozinha"
          value={getStatusLabel(order.kitchenStatus)}
          done={['sent_mock', 'sent_production'].includes(order.kitchenStatus)}
        />
        <StatusTile
          label="Motoboy"
          value={order.deliveryExternalId || getStatusLabel(order.deliveryStatus)}
          done={['requested_mock', 'requested', 'not_required_pickup', 'disabled'].includes(order.deliveryStatus)}
        />
      </div>

      <div className="mt-4 bg-black/15 rounded-2xl px-5 py-4 max-w-4xl w-full text-left">
        <p className="text-[10px] font-black uppercase tracking-widest opacity-70">Pedido</p>
        <p className="text-sm sm:text-base font-black break-all">{order.orderId}</p>
      </div>

      {order.paymentInstructions?.type === 'pix' && order.paymentInstructions.qrCodeText && !isPaymentApproved(order.paymentStatus) && (
        <div className="mt-4 bg-black/15 rounded-2xl px-5 py-4 max-w-4xl w-full text-left">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest opacity-70">Pix copia e cola</p>
              <p className="mt-1 text-sm font-bold opacity-90">{order.paymentInstructions.message || 'Pague para enviar o pedido para operação.'}</p>
            </div>
            {order.paymentInstructions.qrCodeImage && (
              <img src={order.paymentInstructions.qrCodeImage} alt="QR Code Pix" className="w-20 h-20 rounded-xl bg-white p-1 object-contain" />
            )}
          </div>
          <div className="mt-4 rounded-xl bg-black/20 p-3 text-xs font-mono break-all max-h-28 overflow-y-auto">
            {order.paymentInstructions.qrCodeText}
          </div>
          <button
            onClick={async () => {
              await navigator.clipboard.writeText(order.paymentInstructions?.qrCodeText || '');
              setCopiedPix(true);
              window.setTimeout(() => setCopiedPix(false), 1800);
            }}
            className="mt-3 px-5 py-3 bg-white text-emerald-700 rounded-2xl font-black uppercase tracking-widest text-xs flex items-center gap-2"
          >
            <Copy size={16} />
            {copiedPix ? 'Copiado' : 'Copiar Pix'}
          </button>
        </div>
      )}

      {order.paymentInstructions?.type !== 'pix' && order.paymentInstructions?.message && (
        <div className="mt-4 bg-black/15 rounded-2xl px-5 py-4 max-w-4xl w-full text-left">
          <p className="text-[10px] font-black uppercase tracking-widest opacity-70">Pagamento</p>
          <p className="text-sm sm:text-base font-black">{order.paymentInstructions.message}</p>
        </div>
      )}

      {order.club?.enrolled && (
        <div className="mt-3 bg-black/15 rounded-2xl px-5 py-4 max-w-4xl w-full text-left">
          <p className="text-[10px] font-black uppercase tracking-widest opacity-70">Clube Becoartes</p>
          <p className="text-sm sm:text-base font-black">
            {order.club.remainingToReward === 0
              ? `Você completou um ciclo e ganhou ${order.club.rewardLabel || 'uma recompensa'}.`
              : `${order.club.paidOrders}/${order.club.cycleSize} pedidos no ciclo. Faltam ${order.club.remainingToReward}.`}
          </p>
        </div>
      )}

      {order.checkoutUrl && (
        <a href={order.checkoutUrl} className="mt-6 px-8 py-4 bg-black/20 text-white rounded-2xl font-black uppercase tracking-widest">
          Abrir pagamento
        </a>
      )}
      <button onClick={refreshOrder} disabled={isRefreshing} className="mt-4 px-8 py-4 bg-black/15 text-white rounded-2xl font-black uppercase tracking-widest disabled:opacity-50">
        {isRefreshing ? 'Atualizando...' : 'Atualizar status'}
      </button>
      <button onClick={onClose} className="mt-8 px-8 py-4 bg-white text-emerald-600 rounded-2xl font-black uppercase tracking-widest">
        Voltar ao cardápio
      </button>
    </motion.div>
  );
}

function DeliveryBuildingScreen() {
  return (
    <div className="min-h-[100dvh] bg-[#0a0a0c] text-white font-['Outfit'] flex items-center justify-center p-6">
      <div className="max-w-2xl text-center">
        <div className="mx-auto mb-8 w-20 h-20 rounded-[2rem] bg-red-500/20 text-red-300 flex items-center justify-center">
          <Bike size={38} />
        </div>
        <p className="text-[10px] font-black uppercase tracking-[0.32em] text-red-300 mb-4">delivery.becoartes.com</p>
        <h1 className="text-5xl sm:text-7xl font-black italic tracking-tighter leading-none">Estamos criando o seu delivery</h1>
        <p className="mt-6 text-lg sm:text-xl font-bold text-zinc-400">
          Em breve você vai pedir Becoartes por aqui.
        </p>
      </div>
    </div>
  );
}

function DeliveryAccountModal({
  account,
  mode,
  draft,
  message,
  orders,
  onClose,
  onModeChange,
  onDraftChange,
  onLogin,
  onForgot,
  onReset,
  onVerify,
  onReloadOrders,
  onTrackOrder,
  onLogout,
  isBusy,
}: {
  account: DeliveryCustomerAccount | null;
  mode: 'login' | 'forgot' | 'reset' | 'verify' | 'orders';
  draft: { identity: string; password: string; code: string; newPassword: string };
  message: string;
  orders: DeliveryOrderSummary[];
  onClose: () => void;
  onModeChange: (mode: 'login' | 'forgot' | 'reset' | 'verify' | 'orders') => void;
  onDraftChange: (key: keyof typeof draft, value: string) => void;
  onLogin: () => void;
  onForgot: () => void;
  onReset: () => void;
  onVerify: () => void;
  onReloadOrders: () => void;
  onTrackOrder: (orderId: string) => void;
  onLogout: () => void;
  isBusy: boolean;
}) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[300] flex items-center justify-center p-3 sm:p-8 bg-black/80 backdrop-blur-md">
      <motion.div initial={{ scale: 0.95, y: 20 }} animate={{ scale: 1, y: 0 }} className="w-full max-w-3xl bg-[#0a0a0c] rounded-[2rem] border border-white/10 shadow-2xl overflow-hidden max-h-[calc(100dvh-1.5rem)] flex flex-col">
        <div className="p-5 sm:p-7 border-b border-white/5 flex items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.26em] text-primary">Cliente</p>
            <h2 className="text-3xl sm:text-4xl font-black italic tracking-tighter">{account ? account.name : 'Entrar'}</h2>
          </div>
          <button onClick={onClose} className="p-3 glass rounded-full text-rose-400"><X size={22} /></button>
        </div>

        <div className="p-5 sm:p-7 overflow-y-auto custom-scrollbar space-y-5">
          {message && <div className="glass rounded-2xl border border-primary/20 p-4 text-sm font-black text-primary">{message}</div>}

          {mode === 'login' && (
            <div className="space-y-4">
              <Field label="E-mail ou telefone" value={draft.identity} onChange={(value) => onDraftChange('identity', value)} />
              <Field label="Senha" type="password" value={draft.password} onChange={(value) => onDraftChange('password', value)} />
              <button type="button" onClick={onLogin} disabled={isBusy} className="w-full btn-beco btn-beco-purple py-4 rounded-2xl font-black uppercase tracking-widest disabled:opacity-50">{isBusy ? 'Entrando...' : 'Entrar'}</button>
              <button type="button" onClick={() => onModeChange('forgot')} className="text-sm font-black text-zinc-400 uppercase tracking-widest">Esqueci senha</button>
            </div>
          )}

          {mode === 'forgot' && (
            <div className="space-y-4">
              <Field label="E-mail ou telefone" value={draft.identity} onChange={(value) => onDraftChange('identity', value)} />
              <button type="button" onClick={onForgot} disabled={isBusy} className="w-full btn-beco btn-beco-purple py-4 rounded-2xl font-black uppercase tracking-widest disabled:opacity-50">{isBusy ? 'Enviando...' : 'Enviar código'}</button>
            </div>
          )}

          {mode === 'reset' && (
            <div className="space-y-4">
              <Field label="Código" value={draft.code} onChange={(value) => onDraftChange('code', value)} />
              <Field label="Nova senha" type="password" value={draft.newPassword} onChange={(value) => onDraftChange('newPassword', value)} />
              <button type="button" onClick={onReset} disabled={isBusy} className="w-full btn-beco btn-beco-purple py-4 rounded-2xl font-black uppercase tracking-widest disabled:opacity-50">{isBusy ? 'Salvando...' : 'Trocar senha'}</button>
            </div>
          )}

          {mode === 'verify' && account && (
            <div className="space-y-4">
              <Field label="Código recebido" value={draft.code} onChange={(value) => onDraftChange('code', value)} />
              <button type="button" onClick={onVerify} disabled={isBusy} className="w-full btn-beco btn-beco-purple py-4 rounded-2xl font-black uppercase tracking-widest disabled:opacity-50">{isBusy ? 'Confirmando...' : 'Confirmar cadastro'}</button>
              <button type="button" onClick={() => onModeChange('orders')} className="text-sm font-black text-zinc-400 uppercase tracking-widest">Ver meus pedidos</button>
            </div>
          )}

          {mode === 'orders' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <button type="button" onClick={onReloadOrders} disabled={isBusy} className="glass rounded-2xl border border-white/10 px-4 py-3 text-xs font-black uppercase tracking-widest text-zinc-300 disabled:opacity-50">Atualizar</button>
                <button type="button" onClick={onLogout} className="glass rounded-2xl border border-white/10 px-4 py-3 text-xs font-black uppercase tracking-widest text-rose-300">Sair</button>
              </div>
              {orders.length === 0 ? (
                <div className="glass rounded-2xl border border-white/10 p-6 text-sm font-black text-zinc-400">Nenhum pedido encontrado.</div>
              ) : orders.map((order) => (
                <div key={order.orderId} className="glass rounded-2xl border border-white/10 p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500">{new Date(order.createdAt).toLocaleString('pt-BR')}</p>
                      <p className="font-black text-white break-all">{order.orderId}</p>
                    </div>
                    <p className="font-black text-emerald-300">{formatCurrency(order.total)}</p>
                  </div>
                  <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs font-black text-zinc-400">
                    <span>{getStatusLabel(order.paymentStatus)}</span>
                    <span>{getStatusLabel(order.kitchenStatus)}</span>
                    <span>{getStatusLabel(order.deliveryStatus)}</span>
                  </div>
                  <button type="button" onClick={() => onTrackOrder(order.orderId)} className="mt-4 w-full glass rounded-2xl border border-white/10 px-4 py-3 text-xs font-black uppercase tracking-widest text-primary">
                    Acompanhar
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

function StatusTile({
  label,
  value,
  done,
}: {
  label: string;
  value: string;
  done: boolean;
}) {
  return (
    <div className="bg-black/15 rounded-2xl p-4 min-w-0">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[10px] font-black uppercase tracking-widest opacity-70">{label}</p>
        <span className={`h-3 w-3 rounded-full shrink-0 ${done ? 'bg-white' : 'bg-amber-300 animate-pulse'}`} />
      </div>
      <p className="mt-2 text-lg sm:text-xl font-black break-words">{value}</p>
    </div>
  );
}
