import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import QRCode from 'qrcode';
import JSZip from 'jszip';
import {
  Plus, Settings, LayoutDashboard, Package, Sparkles, User, TrendingUp,
  ArrowLeft, Eye, EyeOff, Clock, Trash2, Image, ChefHat, Search, CheckCircle, X,
  GripVertical, ChevronRight, Check, Wallet, CreditCard, Banknote, Copy,
  QrCode, Download, Archive, RefreshCcw, ExternalLink, AlertTriangle
} from 'lucide-react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import type { DragEndEvent } from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useStore, type Product } from '../../store';
import { PinLoginModal } from '../../components/auth/PinLoginModal';
import { ActionDialog } from '../../components/common/ActionDialog';
import {
  can,
  defaultPermissionsByProfile,
  getEffectivePermissions,
  getEffectiveUserPermissions,
  getPermissionLabel,
  getPermissionProfile,
  permissionGroups,
  permissionLabels,
  type PermissionKey,
  type PermissionProfile,
  type UserPermissionMatrix
} from '../../lib/permissions';
import { createId } from '../../lib/id';
import { getImageSrc } from '../../lib/image';
import { APP_BUILD_LABEL, getAppLabel } from '../../lib/version';
import { AdminApi, AppApi } from '../../lib/api';

import { ScheduleModal } from '../../components/modals/ScheduleModal';
import type { ScheduleConfig } from '../../types';

type AdminDialog = {
  title: string;
  description?: string;
  confirmLabel?: string;
  tone?: 'primary' | 'danger';
  input?: {
    label: string;
    defaultValue?: string;
    placeholder?: string;
    type?: string;
    inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'];
  };
  onConfirm: (value?: string) => void | Promise<void>;
};

type AuditMovement = {
  id: string;
  action: string;
  details: string;
  table: string;
  origin: string;
  author: string;
  timestamp: string;
};

const QR_PUBLIC_BASE_URL = 'https://qr.becoartes.com';
const QR_MENU_TEMPLATE_URL = '/qr/menu-qr-template.jpg';
const QR_TEMPLATE_WIDTH = 3875;
const QR_TEMPLATE_HEIGHT = 5463;
const QR_REPLACE_BOX = {
  left: 893,
  top: 2185,
  width: 1997,
  height: 2115,
};
const QR_SIZE = 1860;
const QR_TOP_OFFSET = 26;

const normalizeQrRangeValue = (value: string, fallback: number) => {
  const parsed = Math.trunc(Number(value));
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, 999);
};

const downloadBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};

const dataUrlToBlob = async (dataUrl: string) => {
  const response = await fetch(dataUrl);
  return response.blob();
};

const loadImage = (src: string) => new Promise<HTMLImageElement>((resolve, reject) => {
  const image = new window.Image();
  image.onload = () => resolve(image);
  image.onerror = reject;
  image.src = src;
});

const buildPrintableQrBlob = async (tableNumber: number, qrUrl: string) => {
  const qrDataUrl = await QRCode.toDataURL(qrUrl, {
    errorCorrectionLevel: 'H',
    margin: 1,
    width: QR_SIZE,
    color: {
      dark: '#000000',
      light: '#ffffff',
    },
  });
  const [templateImage, qrImage] = await Promise.all([
    loadImage(QR_MENU_TEMPLATE_URL),
    loadImage(qrDataUrl),
  ]);
  const canvas = document.createElement('canvas');
  canvas.width = QR_TEMPLATE_WIDTH;
  canvas.height = QR_TEMPLATE_HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) return dataUrlToBlob(qrDataUrl);

  ctx.drawImage(templateImage, 0, 0, canvas.width, canvas.height);

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(QR_REPLACE_BOX.left, QR_REPLACE_BOX.top, QR_REPLACE_BOX.width, QR_REPLACE_BOX.height);

  const qrLeft = QR_REPLACE_BOX.left + Math.round((QR_REPLACE_BOX.width - QR_SIZE) / 2);
  const qrTop = QR_REPLACE_BOX.top + QR_TOP_OFFSET;
  ctx.drawImage(qrImage, qrLeft, qrTop, QR_SIZE, QR_SIZE);

  ctx.fillStyle = '#000000';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '900 126px Arial, Helvetica, sans-serif';
  const labelCenterX = QR_REPLACE_BOX.left + Math.round(QR_REPLACE_BOX.width / 2);
  const labelTop = qrTop + QR_SIZE - 4;
  const labelHeight = QR_REPLACE_BOX.top + QR_REPLACE_BOX.height - labelTop;
  ctx.fillText(`Mesa ${tableNumber}`, labelCenterX, labelTop + Math.round(labelHeight * 0.42));

  return new Promise<Blob>((resolve) => {
    canvas.toBlob((blob) => resolve(blob || new Blob()), 'image/jpeg', 0.94);
  });
};

const auditActionLabels: Record<string, string> = {
  bill_closed: 'Conta fechada',
  item_removed: 'Item cancelado',
  item_added: 'Item adicionado',
  order_sent: 'Pedido enviado',
  order_ready: 'Pedido pronto',
  cash_opened: 'Caixa aberto',
  cash_closed: 'Caixa fechado',
  discount_applied: 'Desconto aplicado',
  service_tax_changed: 'Taxa de serviço alterada',
  qr_table_regenerated: 'QR Code de mesa renovado',
  payment_registered: 'Pagamento registrado',
  cash_close_blocked: 'Fechamento de caixa bloqueado',
  Lançamento_Manual: 'Lançamento manual',
};

const getAuditActionLabel = (action: string) => {
  if (auditActionLabels[action]) return auditActionLabels[action];
  return action
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toLocaleUpperCase('pt-BR'));
};

const parseAuditDetails = (details: string) => {
  if (!details) return null;
  try {
    return JSON.parse(details);
  } catch {
    return details;
  }
};

const formatAuditValue = (key: string, value: any) => {
  if (value === null || value === undefined || value === '') return '';
  if (key === 'payments' && Array.isArray(value)) {
    const paymentLabels: Record<string, string> = { credit: 'Crédito', debit: 'Débito', cash: 'Dinheiro', pix: 'PIX' };
    return value.map((payment) => {
      const amount = Number(payment?.amount || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
      return `${paymentLabels[payment?.method] || payment?.method || 'Pagamento'} ${amount}`;
    }).join(', ');
  }
  if (typeof value === 'number' && key.toLowerCase().includes('percent')) {
    return `${value.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;
  }
  if (typeof value === 'number' && ['total', 'subtotal', 'discount', 'servicetax', 'service_tax', 'servicefee', 'amount', 'value', 'paid', 'change', 'delta'].some((term) => key.toLowerCase().includes(term))) {
    return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }
  if (Array.isArray(value)) return value.map((item) => (typeof item === 'object' ? formatAuditDetails(JSON.stringify(item)) : String(item))).join(', ');
  if (typeof value === 'object') return formatAuditDetails(JSON.stringify(value));
  return String(value);
};

const auditDetailLabels: Record<string, string> = {
  product_name: 'Produto',
  itemName: 'Item',
  quantity: 'Quantidade',
  subtotal: 'Subtotal',
  serviceTax: 'Taxa de serviço',
  service_tax: 'Taxa de serviço',
  serviceFee: 'Taxa de serviço',
  serviceFeePercent: 'Taxa aplicada',
  discount: 'Desconto',
  discountReason: 'Motivo',
  total: 'Total',
  paid: 'Pago',
  change: 'Troco',
  payments: 'Pagamentos',
  reason: 'Motivo',
  sellerName: 'Operador',
  inventoryMovements: 'Movimentos de estoque',
  eventId: 'Evento',
  defaultPercent: 'Taxa padrão',
  appliedPercent: 'Taxa usada',
  defaultAmount: 'Valor padrão',
  appliedAmount: 'Valor usado',
  delta: 'Diferença',
  totalBeforeDiscount: 'Total antes do desconto',
  totalAfterDiscount: 'Total após desconto',
  oldValue: 'Antes',
  newValue: 'Depois',
};

const formatAuditDetails = (details: string) => {
  const parsed = parseAuditDetails(details);
  if (!parsed) return 'Sem detalhes';
  if (typeof parsed === 'string') return parsed;
  if (typeof parsed !== 'object') return String(parsed);

  const parts = Object.entries(parsed)
    .map(([key, value]) => {
      const formatted = formatAuditValue(key, value);
      if (!formatted) return '';
      return `${auditDetailLabels[key] || getAuditActionLabel(key)}: ${formatted}`;
    })
    .filter(Boolean);

  return parts.length ? parts.join(' • ') : 'Sem detalhes';
};

// Componente de Input fora para evitar perda de foco
const ConfigInput = ({ label, value, onChange, type = 'text', placeholder, disabled = false }: { label: string, value: any, onChange: (val: any) => void, type?: string, placeholder?: string, disabled?: boolean }) => {
  const isMoney = label.toLowerCase().includes('preço') || label.toLowerCase().includes('custo') || label.toLowerCase().includes('taxa');

  // Formata o valor para exibição (ex: 12.50 -> "12,50")
  const formatMoney = (val: any) => {
    const num = typeof val === 'number' ? val : parseFloat(String(val).replace(',', '.')) || 0;
    return num.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let val = e.target.value;
    if (isMoney) {
      // Máscara de dinheiro: remove tudo que não é número e divide por 100
      const digits = val.replace(/\D/g, '');
      const num = parseInt(digits || '0') / 100;
      onChange(num);
    } else if (type === 'number') {
      val = val.replace(/[^0-9,.]/g, '');
      onChange(val);
    } else {
      onChange(val);
    }
  };

  return (
    <div className="space-y-2">
      <label className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500 ml-1">{label}</label>
      {type === 'checkbox' ? (
        <button
          onClick={() => onChange(!value)}
          disabled={disabled}
          className={`w-full p-4 rounded-2xl border transition-all flex items-center justify-between font-bold text-sm ${value ? 'bg-primary/10 text-primary border-primary/20' : 'bg-white/5 text-gray-500 border-white/5'}`}
        >
          {value ? 'Ativado' : 'Desativado'}
          {value ? <CheckCircle size={18}/> : <X size={18}/>}
        </button>
      ) : (
        <div className="relative">
          <input
            type="text"
            value={isMoney ? formatMoney(value) : value}
            placeholder={placeholder}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            onChange={handleInputChange}
            disabled={disabled}
            className={`w-full bg-white/[0.03] p-4 rounded-2xl border border-white/5 focus:border-primary/40 focus:bg-white/[0.05] outline-none font-bold text-sm transition-all placeholder:text-zinc-700 ${isMoney ? 'text-right pr-12' : ''} ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
          />
          {isMoney && <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[10px] font-black text-zinc-600">R$</span>}
        </div>
      )}
    </div>
  );
};

function SortableCategoryItem({ cat, menu, setSchedulingItem, toggleCategoryVisibility, isExpanded, onToggleExpand, updateProduct, categories, onRenameCategory, onDeleteCategory, canManageCategories }: any) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({ id: cat.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 100 : 1,
    opacity: isDragging ? 0.5 : 1
  };

  const categoryProducts = menu.filter((p: any) => p.categoryId === cat.id);

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="border-b border-white/5 hover:bg-white/[0.01] transition-all group relative"
    >
      <div className="flex items-center justify-between p-8">
        <div className="flex items-center gap-6 flex-1 cursor-pointer" onClick={() => onToggleExpand(cat.id)}>
          <div {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing p-2 hover:bg-white/5 rounded-lg transition-all text-gray-600 hover:text-primary" onClick={(e) => e.stopPropagation()}>
            <GripVertical size={20} />
          </div>
          <div className="w-12 h-12 bg-white/5 rounded-xl flex items-center justify-center font-black text-primary">{cat.sortOrder}</div>
          <div>
            <p className="font-black text-lg">{cat.name}</p>
            <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">
              {categoryProducts.length} Produtos • {isExpanded ? 'Clique para recolher' : 'Clique para ver itens'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          {canManageCategories && (
            <>
              <button
                onClick={() => toggleCategoryVisibility(cat.id)}
                className={`p-4 glass rounded-xl transition-all ${cat.visible ? 'text-primary' : 'text-gray-500 opacity-50'}`}
              >
                {cat.visible ? <Eye size={18}/> : <EyeOff size={18}/>}
              </button>
              <button
                onClick={() => setSchedulingItem({ type: 'category', id: cat.id, name: cat.name, config: cat.schedule })}
                className={`p-4 glass rounded-xl ${cat.schedule?.enabled ? 'text-accent' : 'text-gray-500'}`}
              >
                <Clock size={18}/>
              </button>
              <button onClick={() => onRenameCategory(cat)} className="p-4 glass rounded-xl text-primary"><Settings size={18}/></button>
              <button
                onClick={() => onDeleteCategory(cat)}
                className="p-4 glass rounded-xl text-rose-500 hover:bg-rose-500/10"
              >
                <Trash2 size={18}/>
              </button>
            </>
          )}
        </div>
      </div>

      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden bg-black/20"
          >
            <div className="p-8 pt-0 space-y-2">
              {categoryProducts.length === 0 ? (
                <p className="text-[10px] font-bold text-zinc-600 uppercase tracking-widest p-4 text-center">Nenhum produto nesta categoria</p>
              ) : (
                categoryProducts.map((p: any) => (
                  <div key={p.id} className="flex items-center justify-between p-4 glass rounded-2xl border-white/5 hover:border-white/10 transition-all">
                    <div className="flex items-center gap-4">
                      <img src={getImageSrc(p.image)} className="w-10 h-10 rounded-lg object-cover" />
                      <p className="font-bold text-sm">{p.name}</p>
                    </div>
                    <div className="flex items-center gap-4">
                      <label className="text-[9px] font-black uppercase text-zinc-500">Mover para:</label>
                      <select
                        value={cat.id}
                        onChange={(e) => updateProduct(p.id, { categoryId: e.target.value })}
                        disabled={!canManageCategories}
                        className="bg-white/5 p-2 rounded-lg text-[10px] font-bold outline-none border border-white/5 focus:border-primary/40"
                      >
                        {categories.map((c: any) => (
                          <option key={c.id} value={c.id} className="bg-[#0a0a0c]">{c.name}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                ))
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function AdminView() {
  const {
    menu, updateProduct, addProduct, deleteProduct,
    settings, updateSettings,
    tables, sellers, addSeller, toggleSellerStatus, deleteSeller,
    categories, upsertCategory, modifierGroups, updateModifierGroup, deleteModifierGroup, addModifierGroup,
    adminTab, setAdminTab, adminMode, toggleProductVisibility, deleteCategory, reorderCategories, toggleCategoryVisibility,
    linkGroupToCategory, linkGroupToProduct, currentSeller, closedBills, addNotification,
    productModifierMapping, categoryModifierMapping
  } = useStore();

  const activeTab = adminTab;
  const setActiveTab = setAdminTab;
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [editingGroup, setEditingGroup] = useState<string | null>(null);


  const [schedulingItem, setSchedulingItem] = useState<{ type: 'product' | 'category', id: string, name: string, config?: ScheduleConfig } | null>(null);

  const [newSellerName, setNewSellerName] = useState('');
  const [newSellerRole, setNewSellerRole] = useState<'garçom' | 'atendente' | 'gerente' | 'outro'>('garçom');
  const [newSellerPermission, setNewSellerPermission] = useState<'admin' | 'manager' | 'operator'>('operator');
  const [newSellerPin, setNewSellerPin] = useState('1234');
  const [showPermissionConfig, setShowPermissionConfig] = useState(false);
  const [activePermissionProfile, setActivePermissionProfile] = useState<PermissionProfile>('operator');
  const [permissionSearch, setPermissionSearch] = useState('');
  const [showAddSellerModal, setShowAddSellerModal] = useState(false);
  const [selectedSeller, setSelectedSeller] = useState<any | null>(null);

  const [movements, setMovements] = useState<AuditMovement[]>([]);
  const [auditStartDate, setAuditStartDate] = useState('');
  const [auditEndDate, setAuditEndDate] = useState('');
  const [auditAuthor, setAuditAuthor] = useState('');
  const [auditAction, setAuditAction] = useState('');
  const [qrRangeStart, setQrRangeStart] = useState('1');
  const [qrRangeEnd, setQrRangeEnd] = useState('50');
  const [isQrDownloading, setIsQrDownloading] = useState(false);
  const [isAuditLoading, setIsAuditLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [adminDialog, setAdminDialog] = useState<AdminDialog | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = categories.findIndex(c => c.id === active.id);
      const newIndex = categories.findIndex(c => c.id === over.id);
      reorderCategories(arrayMove(categories, oldIndex, newIndex));
    }
  };

  useEffect(() => {
    if (activeTab === 'movements') {
      const fetchMovements = async () => {
        setIsAuditLoading(true);
        try {
          const res = await AppApi.fetchAuditLogs(100, {
            startDate: auditStartDate,
            endDate: auditEndDate,
            author: auditAuthor,
            action: auditAction,
          });

          const formatted = res.auditLogs.map((r: any) => ({
            id: r.id,
            action: r.action,
            details: r.details,
            table: r.table_number,
            origin: r.origin || 'pdv',
            author: r.author_name || 'Sistema',
            timestamp: r.timestamp
          }));

          setMovements(formatted);
        } catch (error) {
          console.error('Erro ao carregar auditoria:', error);
          addNotification('Não foi possível carregar a auditoria agora.', 'info');
        } finally {
          setIsAuditLoading(false);
        }
      };
      fetchMovements();
    }
  }, [activeTab, auditStartDate, auditEndDate, auditAuthor, auditAction, addNotification]);

  const SectionCard = ({ title, icon: Icon, children }: { title: string, icon: any, children: React.ReactNode }) => (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="glass-card p-6 sm:p-10 border-white/5 h-full">
      <div className="flex items-center gap-4 mb-8 sm:mb-10 border-b border-white/5 pb-5 sm:pb-6">
        <div className="w-11 h-11 sm:w-12 sm:h-12 bg-primary/10 rounded-2xl flex items-center justify-center text-primary shadow-inner shrink-0">
          <Icon size={22} />
        </div>
        <h3 className="text-2xl font-black tracking-tighter leading-tight">{title}</h3>
      </div>
      <div className="space-y-6 sm:space-y-8">
        {children}
      </div>
    </motion.div>
  );

  const [expandedCategoryId, setExpandedCategoryId] = useState<string | null>(null);
  const auditAuthorOptions = Array.from(new Set([
    ...sellers.map((seller: any) => seller.name).filter(Boolean),
    ...movements.map((movement) => movement.author).filter(Boolean),
  ])).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  const auditActionOptions = Array.from(new Set([
    ...Object.keys(auditActionLabels),
    ...movements.map((movement) => movement.action).filter(Boolean),
  ])).sort((a, b) => getAuditActionLabel(a).localeCompare(getAuditActionLabel(b), 'pt-BR'));

  if (!currentSeller) {
    return <PinLoginModal />;
  }

  const permissionOverrides = settings.pdvPermissions;
  const userPermissionOverrides = settings.pdvUserPermissions as UserPermissionMatrix | undefined;
  const isAdminProfile = currentSeller.permission === 'admin';
  const isSuperAdmin = currentSeller.permission === 'admin' && ['admin-bootstrap', 'admin-bypass', 'master'].includes(currentSeller.id);
  const canManageSettings = can(currentSeller, 'manageSettings', permissionOverrides, userPermissionOverrides);
  const canManageTeam = can(currentSeller, 'manageTeam', permissionOverrides, userPermissionOverrides);
  const canManageOptionals = can(currentSeller, 'manageOptionals', permissionOverrides, userPermissionOverrides);
  const canAddProduct = can(currentSeller, 'addProduct', permissionOverrides, userPermissionOverrides);
  const canEditProduct = can(currentSeller, 'editProduct', permissionOverrides, userPermissionOverrides);
  const canEditProductPrice = can(currentSeller, 'editProductPrice', permissionOverrides, userPermissionOverrides);
  const canDeleteProduct = can(currentSeller, 'deleteProduct', permissionOverrides, userPermissionOverrides);
  const canToggleVisibility = can(currentSeller, 'toggleProductVisibility', permissionOverrides, userPermissionOverrides);
  const canManageCategories = can(currentSeller, 'manageCategories', permissionOverrides, userPermissionOverrides);
  const canViewSalesTotals = can(currentSeller, 'viewSalesTotals', permissionOverrides, userPermissionOverrides);
  const canAccessProducts =
    (adminMode === 'menu' && canToggleVisibility)
    || canAddProduct
    || canEditProduct
    || canEditProductPrice
    || canDeleteProduct;
  const editingProductExists = Boolean(editingProduct && menu.some(p => p.id === editingProduct.id));
  const canEditProductFields = !editingProductExists || canEditProduct;
  const canEditProductMoney = !editingProductExists || canEditProductPrice;
  const canSaveEditingProduct = Boolean(editingProduct && (editingProductExists ? (canEditProduct || canEditProductPrice) : canAddProduct));
  const sortedQrTables = [...tables].sort((a, b) => a.number - b.number);
  const availableQrNumbers = sortedQrTables.map((table) => table.number);
  const qrMinTable = availableQrNumbers[0] || 1;
  const qrMaxTable = availableQrNumbers[availableQrNumbers.length - 1] || 50;
  const getQrRevision = (tableNumber: number) => settings.qrCodes?.tableRevisions?.[String(tableNumber)] || '';
  const getQrUrl = (tableNumber: number) => {
    const revision = getQrRevision(tableNumber);
    return `${QR_PUBLIC_BASE_URL}/mesa/${tableNumber}${revision ? `?v=${encodeURIComponent(revision)}` : ''}`;
  };
  const downloadTableQr = async (tableNumber: number) => {
    try {
      const blob = await buildPrintableQrBlob(tableNumber, getQrUrl(tableNumber));
      downloadBlob(blob, `becoartes-mesa-${String(tableNumber).padStart(2, '0')}.jpg`);
      addNotification(`QR Code da mesa ${tableNumber} baixado.`, 'info');
    } catch (error) {
      console.error('Erro ao gerar QR Code:', error);
      addNotification('Não foi possível gerar este QR Code.', 'error');
    }
  };
  const downloadQrRangeZip = async () => {
    const from = normalizeQrRangeValue(qrRangeStart, qrMinTable);
    const to = normalizeQrRangeValue(qrRangeEnd, qrMaxTable);
    const start = Math.min(from, to);
    const end = Math.max(from, to);
    const selectedNumbers = availableQrNumbers.filter((number) => number >= start && number <= end);

    if (selectedNumbers.length === 0) {
      addNotification('Nenhuma mesa encontrada nesse intervalo.', 'error');
      return;
    }

    setIsQrDownloading(true);
    try {
      const zip = new JSZip();
      for (const tableNumber of selectedNumbers) {
        const blob = await buildPrintableQrBlob(tableNumber, getQrUrl(tableNumber));
        zip.file(`mesa-${String(tableNumber).padStart(2, '0')}.jpg`, blob);
      }
      const zipBlob = await zip.generateAsync({ type: 'blob' });
      downloadBlob(zipBlob, `becoartes-qrcodes-mesas-${start}-${end}.zip`);
      addNotification(`${selectedNumbers.length} QR Codes baixados em ZIP.`, 'info');
    } catch (error) {
      console.error('Erro ao gerar ZIP de QR Codes:', error);
      addNotification('Não foi possível gerar o pacote de QR Codes.', 'error');
    } finally {
      setIsQrDownloading(false);
    }
  };
  const requestQrRegeneration = (tableNumber: number) => {
    setAdminDialog({
      title: `Gerar novo QR da Mesa ${tableNumber}?`,
      description: 'Use apenas se o impresso atual precisar ser substituído. A rota da mesa continua permanente, mas a imagem baixada terá uma nova versão.',
      confirmLabel: 'Gerar novo QR',
      input: { label: 'PIN admin', placeholder: 'Digite o PIN admin', type: 'password', inputMode: 'numeric' },
      onConfirm: async (pin) => {
        const result = await AdminApi.regenerateTableQr(tableNumber, pin || '');
        updateSettings({ qrCodes: result.qrCodes });
        addNotification(`QR Code da mesa ${tableNumber} renovado. Baixe a nova imagem.`, 'info');
      }
    });
  };

  const allowedTabIds = new Set([
    ...(canAccessProducts ? ['products'] : []),
    ...(canManageCategories ? ['categories'] : []),
    ...(canManageOptionals ? ['optionals'] : []),
    ...(isAdminProfile && canManageSettings ? ['config'] : []),
    ...(isAdminProfile && canManageSettings ? ['qrcodes'] : []),
    ...(isAdminProfile && canManageTeam ? ['sellers'] : []),
    ...(isAdminProfile && canViewSalesTotals ? ['finance', 'movements'] : []),
  ]);
  const isActiveTabAllowed = allowedTabIds.has(activeTab);

  if (!isActiveTabAllowed) {
    return (
      <div className="min-h-screen bg-[#0a0a0c] text-white font-['Outfit'] flex items-center justify-center p-12">
        <div className="glass-card max-w-lg p-10 text-center border-white/10">
          <h2 className="text-3xl font-black tracking-tighter mb-4">Acesso restrito</h2>
          <p className="text-zinc-500 font-bold text-sm leading-relaxed mb-8">
            Seu perfil {getPermissionLabel(currentSeller)} não tem permissão para acessar esta área administrativa.
          </p>
          <button onClick={() => useStore.getState().setActiveView('pdv')} className="btn-beco btn-beco-purple px-8 py-4 rounded-2xl font-black">
            Voltar ao PDV
          </button>
        </div>
      </div>
    );
  }

  const paymentLabels: Record<string, string> = {
    credit: 'Crédito',
    debit: 'Débito',
    cash: 'Dinheiro',
    pix: 'PIX',
  };

  const paymentSummary = closedBills.reduce((acc, bill) => {
    for (const payment of bill.payments || []) {
      const current = acc[payment.method] || { total: 0, count: 0 };
      acc[payment.method] = {
        total: current.total + payment.amount,
        count: current.count + 1,
      };
    }
    return acc;
  }, {} as Record<string, { total: number; count: number }>);

  const closedBillsSubtotal = closedBills.reduce((acc, bill) => acc + bill.subtotal, 0);
  const closedBillsServiceFee = closedBills.reduce((acc, bill) => acc + bill.serviceFee, 0);
  const closedBillsDiscount = closedBills.reduce((acc, bill) => acc + bill.discount, 0);
  const closedBillsTotal = closedBills.reduce((acc, bill) => acc + bill.total, 0);

  const requestCategoryRename = (cat: any) => {
    setAdminDialog({
      title: 'Renomear categoria',
      description: 'Esse nome aparece no tablet, QR Code e PDV.',
      confirmLabel: 'Salvar nome',
      input: { label: 'Novo nome', defaultValue: cat.name },
      onConfirm: async (newName) => {
        if (newName) await upsertCategory({ ...cat, name: newName });
      }
    });
  };

  const requestCategoryDelete = (cat: any) => {
    setAdminDialog({
      title: 'Excluir categoria?',
      description: `Os produtos vinculados a "${cat.name}" ficarão sem categoria.`,
      confirmLabel: 'Excluir categoria',
      tone: 'danger',
      onConfirm: async () => deleteCategory(cat.id)
    });
  };

  const requestProductDelete = (product: Product) => {
    setAdminDialog({
      title: 'Excluir produto?',
      description: `Excluir permanentemente "${product.name}". Se houver histórico, o sistema pode ocultar em vez de apagar.`,
      confirmLabel: 'Excluir produto',
      tone: 'danger',
      onConfirm: async () => {
        await deleteProduct(product.id);
        setEditingProduct(null);
      }
    });
  };

  const requestModifierGroupDelete = (groupId: string) => {
    setAdminDialog({
      title: 'Excluir grupo?',
      description: 'Produtos e categorias deixam de herdar essas opções.',
      confirmLabel: 'Excluir grupo',
      tone: 'danger',
      onConfirm: async () => {
        await deleteModifierGroup(groupId);
        setEditingGroup(null);
      }
    });
  };

  const profileLabels: Record<PermissionProfile, string> = {
    admin: 'Admin',
    manager: 'Gerente',
    operator: 'Operador',
  };
  const profileDescriptions: Record<PermissionProfile, string> = {
    admin: 'Acesso total, financeiro, auditoria e configuração sensível.',
    manager: 'Gestão operacional do salão, cardápio e caixa com limites.',
    operator: 'Operação diária: mesas, pedidos e pagamentos autorizados.',
  };
  const permissionProfiles: PermissionProfile[] = ['admin', 'manager', 'operator'];
  const criticalPermissionKeys: PermissionKey[] = [
    'manageSettings',
    'managePDVPermissions',
    'accessSensitiveData',
    'applyDiscount',
    'editServiceFee',
    'closeCash',
    'refundPayment',
    'adjustStock',
    'editProductPrice',
  ];

  const getPermissionValue = (profile: PermissionProfile, key: PermissionKey) => {
    return getEffectivePermissions(profile, settings.pdvPermissions as any)[key];
  };

  const isCoreAdminPermission = (profile: PermissionProfile, key: PermissionKey) => (
    profile === 'admin' && ['accessPDV', 'manageSettings', 'managePDVPermissions'].includes(key)
  );

  const getPermissionStats = (profile: PermissionProfile) => {
    const effective = getEffectivePermissions(profile, settings.pdvPermissions as any);
    const keys = Object.keys(defaultPermissionsByProfile[profile]) as PermissionKey[];
    const active = keys.filter((key) => effective[key]).length;
    const changed = keys.filter((key) => effective[key] !== defaultPermissionsByProfile[profile][key]).length;
    return { active, total: keys.length, changed };
  };

  const getSellerPermissionStats = (seller: any) => {
    const profile = getPermissionProfile(seller);
    const effective = getEffectiveUserPermissions(seller, settings.pdvPermissions as any, userPermissionOverrides);
    const keys = Object.keys(defaultPermissionsByProfile[profile]) as PermissionKey[];
    const active = keys.filter((key) => effective[key]).length;
    const overridden = seller?.id ? Object.keys(userPermissionOverrides?.[seller.id] || {}).length : 0;
    return { active, total: keys.length, changed: getPermissionStats(profile).changed, overridden };
  };

  const normalizeSellerName = (name: string) => name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

  const getSellerDuplicates = (seller: any) => {
    const normalizedName = normalizeSellerName(seller?.name || '');
    if (!normalizedName) return [];
    return sellers.filter((candidate: any) => (
      candidate.id !== seller.id
      && normalizeSellerName(candidate.name || '') === normalizedName
    ));
  };

  const getSellerPermissionValue = (seller: any, key: PermissionKey) => {
    return getEffectiveUserPermissions(seller, settings.pdvPermissions as any, userPermissionOverrides)[key];
  };

  const isSellerPermissionOverridden = (seller: any, key: PermissionKey) => {
    return Boolean(seller?.id && userPermissionOverrides?.[seller.id]?.[key] !== undefined);
  };

  const setSellerPermissionValue = (seller: any, key: PermissionKey, value: boolean) => {
    if (!seller?.id) return;
    if (isCoreAdminPermission(getPermissionProfile(seller), key)) return;

    updateSettings({
      pdvUserPermissions: {
        ...(settings.pdvUserPermissions || {}),
        [seller.id]: {
          ...(settings.pdvUserPermissions?.[seller.id] || {}),
          [key]: value,
        },
      },
    });
  };

  const resetSellerPermissionValue = (seller: any, key: PermissionKey) => {
    if (!seller?.id) return;
    const nextUserPermissions = { ...(settings.pdvUserPermissions || {}) };
    const nextSellerPermissions = { ...(nextUserPermissions[seller.id] || {}) };
    delete nextSellerPermissions[key];

    if (Object.keys(nextSellerPermissions).length === 0) {
      delete nextUserPermissions[seller.id];
    } else {
      nextUserPermissions[seller.id] = nextSellerPermissions;
    }

    updateSettings({ pdvUserPermissions: nextUserPermissions });
  };

  const resetSellerPermissions = (seller: any) => {
    if (!seller?.id) return;
    const nextUserPermissions = { ...(settings.pdvUserPermissions || {}) };
    delete nextUserPermissions[seller.id];
    updateSettings({ pdvUserPermissions: nextUserPermissions });
  };

  const handleCreateSeller = async () => {
    await addSeller({
      id: createId(),
      name: newSellerName,
      role: newSellerRole,
      permission: newSellerPermission,
      pin: newSellerPin,
      status: 'active'
    });
    setNewSellerName('');
    setNewSellerPin('1234');
    setNewSellerRole('garçom');
    setNewSellerPermission('operator');
    setShowAddSellerModal(false);
  };

  const setPermissionValue = (profile: PermissionProfile, key: PermissionKey, value: boolean) => {
    if (isCoreAdminPermission(profile, key)) return;

    updateSettings({
      pdvPermissions: {
        ...(settings.pdvPermissions || {}),
        [profile]: {
          ...(settings.pdvPermissions?.[profile] || {}),
          [key]: value,
        },
      },
    });
  };

  const setPermissionGroupValue = (profile: PermissionProfile, keys: PermissionKey[], value: boolean) => {
    const nextProfilePermissions = { ...(settings.pdvPermissions?.[profile] || {}) };
    for (const key of keys) {
      if (isCoreAdminPermission(profile, key)) continue;
      nextProfilePermissions[key] = value;
    }

    updateSettings({
      pdvPermissions: {
        ...(settings.pdvPermissions || {}),
        [profile]: nextProfilePermissions,
      },
    });
  };

  const resetPermissionProfile = (profile: PermissionProfile) => {
    const nextPermissions = { ...(settings.pdvPermissions || {}) };
    delete nextPermissions[profile];
    updateSettings({ pdvPermissions: nextPermissions });
  };

  const normalizedPermissionSearch = permissionSearch.trim().toLowerCase();
  const visiblePermissionGroups = permissionGroups
    .map((group) => ({
      ...group,
      keys: normalizedPermissionSearch
        ? group.keys.filter((key) => (
          permissionLabels[key].toLowerCase().includes(normalizedPermissionSearch)
          || group.title.toLowerCase().includes(normalizedPermissionSearch)
          || key.toLowerCase().includes(normalizedPermissionSearch)
        ))
        : group.keys,
    }))
    .filter((group) => group.keys.length > 0);

  const isGroupLinkedToCategory = (categoryId: string, groupId: string) => {
    return Boolean(categoryModifierMapping[categoryId]?.includes(groupId));
  };

  const isGroupLinkedDirectlyToProduct = (productId: string, groupId: string) => {
    return Boolean(productModifierMapping[productId]?.includes(groupId));
  };

  const isGroupInheritedByProduct = (product: Product, groupId: string) => {
    return Boolean(categoryModifierMapping[product.categoryId]?.includes(groupId));
  };

  const compressImage = (file: File): Promise<string> => {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new window.Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          let width = img.width;
          let height = img.height;
          const max = 800;

          if (width > height) {
            if (width > max) {
              height *= max / width;
              width = max;
            }
          } else {
            if (height > max) {
              width *= max / height;
              height = max;
            }
          }

          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx?.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', 0.7));
        };
        img.src = e.target?.result as string;
      };
      reader.readAsDataURL(file);
    });
  };

  return (
    <div className="p-4 sm:p-8 xl:p-16 bg-[#0a0a0c] min-h-screen text-white font-['Outfit'] pb-32 sm:pb-48 overflow-x-hidden overflow-y-auto custom-scrollbar h-screen">
      <div className="flex flex-col gap-6 sm:gap-8 mb-10 sm:mb-16">
        <div className="flex items-center gap-4 sm:gap-8 min-w-0">
          <button
            onClick={() => useStore.getState().setActiveView('pdv')}
            className="w-14 h-14 sm:w-16 sm:h-16 glass rounded-2xl flex items-center justify-center text-zinc-500 hover:text-white transition-all border-white/5 shrink-0"
          >
            <ArrowLeft size={28} />
          </button>
          <div className="min-w-0">
            <h1 className="text-5xl sm:text-7xl font-black tracking-tighter leading-none">Beco <span className="text-primary">Control</span></h1>
            <p className="text-gray-500 font-bold uppercase tracking-[0.28em] sm:tracking-[0.4em] text-[9px] sm:text-[10px] mt-3 sm:ml-2 italic break-words">
              {currentSeller.name} • {getPermissionLabel(currentSeller)}
            </p>
            <p className="text-zinc-700 font-black uppercase tracking-[0.2em] sm:tracking-[0.25em] text-[9px] mt-2 sm:ml-2 break-words">
              {getAppLabel()} {APP_BUILD_LABEL}
            </p>
          </div>
        </div>
        <div className="w-full max-w-full overflow-x-auto overflow-y-hidden custom-scrollbar pb-2">
        <div className="flex w-max min-w-full glass p-2 rounded-[2rem] border-white/5">
          {[
            { id: 'config', name: 'Geral', icon: Settings },
            { id: 'categories', name: 'Categorias', icon: LayoutDashboard },
            { id: 'products', name: 'Produtos', icon: Package },
            { id: 'optionals', name: 'Opcionais', icon: Sparkles },
            { id: 'sellers', name: 'Equipe', icon: User },
            { id: 'qrcodes', name: 'QR Mesas', icon: QrCode },
            { id: 'finance', name: 'Fechamentos', icon: Wallet },
            { id: 'movements', name: 'Auditoria', icon: TrendingUp },
          ]
          .filter(tab => {
            return allowedTabIds.has(tab.id);
          })
          .map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id as any)} className={`px-4 sm:px-8 py-4 rounded-[1.5rem] flex items-center gap-3 font-black text-[11px] sm:text-xs uppercase tracking-widest transition-all whitespace-nowrap shrink-0 ${activeTab === tab.id ? 'bg-primary text-white shadow-xl shadow-primary/20' : 'text-gray-500 hover:text-white'}`}>
              <tab.icon size={18}/> {tab.name}
            </button>
          ))}
        </div>
        </div>
      </div>

      {activeTab === 'config' && canManageSettings && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-8">
          <SectionCard title="Configurações Gerais" icon={Settings}>
            <ConfigInput label="Nome da Unidade" value={settings.unitName} onChange={(val) => updateSettings({ unitName: val })} />
            <div className="grid grid-cols-2 gap-4">
              <ConfigInput label="Moeda" value={settings.currency} onChange={(val) => updateSettings({ currency: val })} />
              <ConfigInput label="Taxa de Serviço (%)" type="number" value={settings.serviceTax} onChange={(val) => updateSettings({ serviceTax: val })} />
            </div>
          </SectionCard>
          <SectionCard title="Tablet & Slideshow" icon={Image}>
            <ConfigInput label="Banner Automático" type="checkbox" value={settings.tablet.autoBanner} onChange={(val) => updateSettings({ tablet: { ...settings.tablet, autoBanner: val } })} />
            <ConfigInput label="Texto de Boas-vindas" value={settings.tablet.bannerText} onChange={(val) => updateSettings({ tablet: { ...settings.tablet, bannerText: val } })} />
            <div className="space-y-4">
              <label className="text-[10px] font-black uppercase tracking-widest text-gray-500 ml-1">Imagens do Carrossel (URLs)</label>
              <div className="space-y-3">
                {settings.tablet?.bannerUrls?.map((url: string, idx: number) => (
                  <div key={idx} className="flex gap-2 group">
                    <input
                      value={url}
                      onChange={(e) => {
                        const newUrls = [...settings.tablet.bannerUrls];
                        newUrls[idx] = e.target.value;
                        updateSettings({ tablet: { ...settings.tablet, bannerUrls: newUrls } });
                      }}
                      className="flex-1 glass p-4 rounded-xl border-white/10 text-xs font-medium focus:border-primary outline-none"
                      placeholder="https://..."
                    />
                    <button onClick={() => {
                      const newUrls = settings.tablet.bannerUrls.filter((_, i) => i !== idx);
                      updateSettings({ tablet: { ...settings.tablet, bannerUrls: newUrls } });
                    }} className="p-4 glass rounded-xl text-rose-500 hover:bg-rose-500/10 transition-all opacity-0 group-hover:opacity-100">
                      <Trash2 size={16}/>
                    </button>
                  </div>
                ))}
                  <button
                  onClick={() => updateSettings({ tablet: { ...settings.tablet, bannerUrls: [...(settings.tablet?.bannerUrls || []), ''] } })}
                  className="w-full p-4 glass border-dashed border-white/20 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-white/5 text-primary transition-all"
                >
                  + Adicionar Imagem
                </button>
              </div>
            </div>
          </SectionCard>
          <SectionCard title="Cozinha & KDS" icon={ChefHat}>
            <div className="grid grid-cols-2 gap-4">
              <ConfigInput label="Mostrar Mesa" type="checkbox" value={settings.kitchen.showTable} onChange={(val) => updateSettings({ kitchen: { ...settings.kitchen, showTable: val } })} />
              <ConfigInput label="Alerta Visual" type="checkbox" value={settings.kitchen.visualAlert} onChange={(val) => updateSettings({ kitchen: { ...settings.kitchen, visualAlert: val } })} />
            </div>
          </SectionCard>
        </div>
      )}

      {activeTab === 'qrcodes' && isAdminProfile && canManageSettings && (
        <div className="max-w-7xl mx-auto space-y-8">
          <div className="glass-card border-primary/20 p-6 sm:p-10 rounded-[2rem] sm:rounded-[3rem]">
            <div className="flex flex-col xl:flex-row xl:items-center xl:justify-between gap-8">
              <div className="max-w-3xl">
                <div className="w-16 h-16 rounded-3xl bg-primary/10 text-primary flex items-center justify-center mb-6">
                  <QrCode size={30} />
                </div>
                <p className="text-[10px] font-black uppercase tracking-[0.32em] text-primary mb-3">QR Code permanente</p>
                <h3 className="text-4xl sm:text-5xl font-black tracking-tighter mb-4">QR Codes das mesas</h3>
                <p className="text-sm sm:text-base font-bold text-zinc-400 leading-relaxed">
                  Cada QR abre direto a experiência do cliente em <strong className="text-white">{QR_PUBLIC_BASE_URL}</strong>.
                  Eles foram pensados para impressão: não expiram e continuam funcionando após reiniciar, atualizar ou trocar sessão.
                </p>
              </div>

              <div className="glass rounded-[2rem] border-white/10 p-5 sm:p-6 w-full xl:w-[430px]">
                <p className="text-[10px] font-black uppercase tracking-[0.26em] text-zinc-500 mb-4">Baixar pacote</p>
                <div className="grid grid-cols-2 gap-4 mb-5">
                  <div>
                    <label className="block text-[9px] font-black uppercase tracking-widest text-zinc-500 mb-2">De</label>
                    <input
                      type="number"
                      min={1}
                      value={qrRangeStart}
                      onChange={(event) => setQrRangeStart(event.target.value)}
                      className="w-full glass p-4 rounded-2xl border-white/10 outline-none font-black text-lg focus:border-primary/40"
                    />
                  </div>
                  <div>
                    <label className="block text-[9px] font-black uppercase tracking-widest text-zinc-500 mb-2">Até</label>
                    <input
                      type="number"
                      min={1}
                      value={qrRangeEnd}
                      onChange={(event) => setQrRangeEnd(event.target.value)}
                      className="w-full glass p-4 rounded-2xl border-white/10 outline-none font-black text-lg focus:border-primary/40"
                    />
                  </div>
                </div>
                <button
                  onClick={downloadQrRangeZip}
                  disabled={isQrDownloading}
                  className="w-full btn-beco btn-beco-purple py-5 rounded-2xl font-black text-xs uppercase tracking-widest flex items-center justify-center gap-3 disabled:opacity-50"
                >
                  <Archive size={18} /> {isQrDownloading ? 'Gerando ZIP...' : 'Baixar ZIP'}
                </button>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
            {sortedQrTables.length === 0 ? (
              <div className="col-span-full glass-card p-10 text-center border-white/10">
                <p className="text-sm font-bold text-zinc-400">Nenhuma mesa cadastrada para gerar QR Code.</p>
              </div>
            ) : sortedQrTables.map((table) => {
              const revision = getQrRevision(table.number);
              const rotatedAt = settings.qrCodes?.lastRotatedAt?.[String(table.number)] || '';
              const url = getQrUrl(table.number);

              return (
                <div key={table.id} className="glass-card border-white/10 rounded-[2rem] p-6 flex flex-col gap-5">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-[0.24em] text-zinc-500">Mesa</p>
                      <h4 className="text-4xl font-black tracking-tighter">{table.number}</h4>
                    </div>
                    <div className="px-3 py-2 rounded-full bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 text-[9px] font-black uppercase tracking-widest">
                      Permanente
                    </div>
                  </div>

                  <div className="rounded-2xl bg-black/30 border border-white/10 p-4">
                    <p className="text-[9px] font-black uppercase tracking-widest text-zinc-500 mb-2">Link público</p>
                    <p className="text-xs font-bold text-zinc-300 break-all leading-relaxed">{url}</p>
                    {revision && (
                      <p className="text-[9px] font-black uppercase tracking-widest text-primary mt-3">
                        Versão {revision}{rotatedAt ? ` • ${new Date(rotatedAt).toLocaleString('pt-BR')}` : ''}
                      </p>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <button
                      onClick={() => window.open(url, '_blank', 'noopener,noreferrer')}
                      className="glass py-4 rounded-2xl text-[10px] font-black uppercase tracking-widest text-zinc-300 hover:text-white transition-all flex items-center justify-center gap-2"
                    >
                      <ExternalLink size={15} /> Abrir
                    </button>
                    <button
                      onClick={async () => {
                        await navigator.clipboard?.writeText(url);
                        addNotification(`Link da mesa ${table.number} copiado.`, 'info');
                      }}
                      className="glass py-4 rounded-2xl text-[10px] font-black uppercase tracking-widest text-zinc-300 hover:text-white transition-all flex items-center justify-center gap-2"
                    >
                      <Copy size={15} /> Copiar
                    </button>
                    <button
                      onClick={() => downloadTableQr(table.number)}
                      className="glass py-4 rounded-2xl text-[10px] font-black uppercase tracking-widest text-zinc-300 hover:text-white transition-all flex items-center justify-center gap-2"
                    >
                      <Download size={15} /> JPG
                    </button>
                    <button
                      onClick={() => requestQrRegeneration(table.number)}
                      className="glass py-4 rounded-2xl text-[10px] font-black uppercase tracking-widest text-amber-300 hover:text-amber-200 transition-all flex items-center justify-center gap-2 border-amber-500/20"
                    >
                      <RefreshCcw size={15} /> Novo
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {activeTab === 'categories' && canManageCategories && (
        <div className="max-w-6xl mx-auto space-y-6">
          <div className="flex justify-between items-center mb-12 px-8">
            <div>
              <h3 className="text-4xl font-black flex items-center gap-4"><LayoutDashboard size={36}/> Gestão de Categorias</h3>
              <p className="text-gray-500 font-bold uppercase tracking-widest text-[10px] mt-2 italic">Arraste para reordenar a exibição no Tablet</p>
            </div>
            {canManageCategories && (
              <button
                onClick={() => setAdminDialog({
                  title: 'Nova Categoria',
                  description: 'Digite o nome da categoria para o cardápio.',
                  confirmLabel: 'Criar Categoria',
                  input: { label: 'Nome da Categoria', placeholder: 'Ex: Entradas, Bebidas...' },
                  onConfirm: (name) => {
                    if (name) upsertCategory({ id: createId(), name, sortOrder: categories.length, visible: true });
                  }
                })}
                className="px-8 py-4 bg-primary text-white rounded-2xl font-black text-xs uppercase tracking-widest shadow-xl shadow-primary/20 hover:scale-105 transition-all flex items-center gap-3"
              >
                <Plus size={20}/> Adicionar Categoria
              </button>
            )}
          </div>
          <div className="glass rounded-[3rem] border-white/5 overflow-hidden shadow-2xl">
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={categories.map(c => c.id)}
                strategy={verticalListSortingStrategy}
              >
                {categories.map((cat) => (
                  <SortableCategoryItem
                    key={cat.id}
                    cat={cat}
                    menu={menu}
                    setSchedulingItem={setSchedulingItem}
                    toggleCategoryVisibility={toggleCategoryVisibility}
                    isExpanded={expandedCategoryId === cat.id}
                    onToggleExpand={(id: string) => setExpandedCategoryId(expandedCategoryId === id ? null : id)}
                    updateProduct={updateProduct}
                    categories={categories}
                    onRenameCategory={requestCategoryRename}
                    onDeleteCategory={requestCategoryDelete}
                    canManageCategories={canManageCategories}
                  />
                ))}
              </SortableContext>
            </DndContext>
          </div>
        </div>
      )}

      {activeTab === 'products' && canAccessProducts && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-16">
          <div className="space-y-6">
            <div className="flex flex-col md:flex-row justify-between items-stretch md:items-center mb-8 gap-4 px-0 sm:px-4">
              <div className="flex flex-col sm:flex-row sm:items-center gap-4 min-w-0">
                <h3 className="text-3xl font-black flex items-center gap-4"><Package size={28}/> Catálogo</h3>
                <div className="relative w-full sm:w-auto">
                  <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500" />
                  <input
                    type="text"
                    placeholder="Buscar produto..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="glass pl-12 pr-6 py-3 rounded-2xl text-xs font-bold border-white/10 outline-none w-full sm:w-64 focus:border-primary transition-all"
                  />
                </div>
              </div>
              {canAddProduct && (
                <button onClick={() => setEditingProduct({ id: createId(), name: '', price: 0, categoryId: categories[0]?.id || '', image: '', visible: true, modifierGroups: [] })} className="p-3 bg-primary text-white rounded-xl hover:scale-105 transition-all"><Plus size={20}/></button>
              )}
            </div>
            <div className="glass rounded-[2rem] sm:rounded-[3rem] border-white/5 overflow-hidden max-h-[60vh] overflow-y-auto custom-scrollbar">
              {categories.map((cat) => {
                const items = menu.filter(p => p.categoryId === cat.id);
                const filteredItems = items.filter((p: any) => p.name.toLowerCase().includes(searchTerm.toLowerCase()));
                if (filteredItems.length === 0 && (items.length > 0 || !searchTerm)) return null;
                if (items.length === 0) return null;
                return (
                  <div key={cat.id}>
                    <div className="bg-white/5 px-5 sm:px-8 py-4 border-y border-white/5 flex justify-between items-center">
                      <h4 className="text-xs font-black uppercase tracking-widest text-primary">{cat.name}</h4>
                      {!cat.visible && <span className="text-[9px] font-black uppercase text-gray-500 bg-white/5 px-2 py-0.5 rounded">Invisível</span>}
                    </div>
                    {filteredItems.map((p: any) => (
                      <div key={p.id} className={`flex items-center justify-between gap-3 p-4 sm:p-8 border-b border-white/5 hover:bg-white/[0.02] transition-all group ${!p.visible ? 'opacity-40 grayscale' : ''}`}>
                        <div className="flex items-center gap-4 sm:gap-6 min-w-0">
                          <div className="relative">
                            <img src={getImageSrc(p.image)} className="w-14 h-14 sm:w-20 sm:h-20 rounded-2xl object-cover shadow-2xl border border-white/5" />
                            {!p.visible && <div className="absolute inset-0 bg-black/60 rounded-2xl flex items-center justify-center"><EyeOff size={20} className="text-white/40" /></div>}
                          </div>
                          <div className="min-w-0">
                            <p className="font-black text-base sm:text-xl tracking-tight leading-tight break-words">{p.name}</p>
                            <div className="flex flex-wrap items-center gap-2 sm:gap-3 mt-1">
                              <span className="text-xs font-black text-gray-400">R$ {typeof p.price === 'number' ? p.price.toFixed(2) : p.price}</span>
                              {p.cost > 0 && <span className="px-2 py-0.5 bg-emerald-500/10 text-emerald-500 rounded text-[9px] font-black uppercase">Lucro R$ {(p.price - p.cost).toFixed(2)}</span>}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 sm:gap-3 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-all shrink-0">
                          {canToggleVisibility && (
                            <button
                              onClick={() => toggleProductVisibility(p.id)}
                              className={`p-3 sm:p-4 glass rounded-2xl transition-all ${p.visible ? 'text-emerald-400' : 'text-gray-500'}`}
                              title={p.visible ? 'Ocultar do Cardápio' : 'Mostrar no Cardápio'}
                            >
                              {p.visible ? <Eye size={20}/> : <EyeOff size={20}/>}
                            </button>
                          )}
                          {(canEditProduct || canEditProductPrice) && (
                            <>
                              {canEditProduct && (
                                <button onClick={() => setSchedulingItem({ type: 'product', id: p.id, name: p.name, config: p.schedule })} className={`p-3 sm:p-4 glass rounded-2xl ${p.schedule?.enabled ? 'text-accent' : 'text-gray-500'}`}><Clock size={20}/></button>
                              )}
                              <button onClick={() => setEditingProduct(p)} className="p-3 sm:p-4 glass rounded-2xl text-primary"><Settings size={20}/></button>
                            </>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>

          <AnimatePresence>
            {editingProduct && (
              <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="glass-card p-12 border-primary/20 sticky top-12 h-fit shadow-2xl shadow-primary/10 overflow-hidden">
                <div className="flex justify-between items-start mb-10">
                  <div className="flex flex-col gap-1">
                    <h3 className="text-3xl font-black">
                      {menu.some(p => p.id === editingProduct.id) ? 'Editar Produto' : 'Novo Produto'}
                    </h3>
                  </div>
                  <div className="flex items-center gap-4">
                    {canAddProduct && menu.some(p => p.id === editingProduct.id) && (
                      <button
                        onClick={async () => {
                          try {
                            const duplicatedProduct = {
                              ...editingProduct,
                              id: createId(),
                              name: `${editingProduct.name} (Cópia)`,
                              price: typeof editingProduct.price === 'string'
                                ? parseFloat(String(editingProduct.price).replace(',', '.')) || 0
                                : Number(editingProduct.price) || 0,
                              cost: typeof editingProduct.cost === 'string'
                                ? parseFloat(String(editingProduct.cost).replace(',', '.')) || 0
                                : Number(editingProduct.cost) || 0,
                              description: editingProduct.description || '',
                              image: editingProduct.image || '',
                              visible: false,
                              erpCode: '',
                              remoteStockId: '',
                            };

                            await addProduct(duplicatedProduct);
                            setEditingProduct(duplicatedProduct);
                            addNotification('Produto duplicado como oculto. Revise nome, estoque e publique quando estiver pronto.', 'info');
                          } catch (err: any) {
                            console.error('Erro ao duplicar produto:', err);
                            addNotification(`Erro ao duplicar: ${err.message}`, 'error');
                          }
                        }}
                        className="flex items-center gap-2 px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all bg-white/5 text-zinc-300 hover:bg-primary/10 hover:text-primary"
                      >
                        <Copy size={14}/> Duplicar
                      </button>
                    )}
                    {canToggleVisibility && (
                      <button
                        onClick={async () => {
                          if (editingProduct.id.startsWith('new_')) {
                            setEditingProduct({...editingProduct, visible: !editingProduct.visible});
                          } else {
                            await toggleProductVisibility(editingProduct.id);
                            setEditingProduct({...editingProduct, visible: !editingProduct.visible});
                          }
                        }}
                        className={`flex items-center gap-2 px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${editingProduct.visible ? 'bg-emerald-500/10 text-emerald-500' : 'bg-rose-500/10 text-rose-500'}`}
                      >
                        {editingProduct.visible ? <><Eye size={14}/> Visível</> : <><EyeOff size={14}/> Oculto</>}
                      </button>
                    )}
                    <button
                      onClick={() => setEditingProduct(null)}
                      className="w-10 h-10 glass rounded-full flex items-center justify-center hover:bg-rose-500/10 hover:text-rose-500 transition-all"
                    >
                      <X size={20} />
                    </button>
                  </div>
                </div>
                <div className="space-y-8">
                  <ConfigInput label="Nome do Produto" value={editingProduct.name} onChange={(v) => setEditingProduct({...editingProduct, name: v})} placeholder="Ex: Suco de Laranja 400ml" disabled={!canEditProductFields} />
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div className="space-y-2">
                      <label className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500 ml-1">Categoria</label>
                      <div className="relative group">
                        <select
                          value={editingProduct.categoryId}
                          onChange={(e) => setEditingProduct({...editingProduct, categoryId: e.target.value})}
                          disabled={!canEditProductFields}
                          className="w-full bg-white/[0.03] p-4 rounded-2xl border border-white/5 outline-none font-bold text-sm transition-all appearance-none cursor-pointer hover:bg-white/[0.05] focus:border-primary/40"
                        >
                          {categories.map(c => <option key={c.id} value={c.id} className="bg-[#0a0a0c]">{c.name}</option>)}
                        </select>
                        <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-zinc-600 group-hover:text-primary transition-colors">
                           <LayoutDashboard size={16} />
                        </div>
                      </div>
                    </div>
                    <ConfigInput label="Preço" type="number" value={editingProduct.price} onChange={(v) => setEditingProduct({...editingProduct, price: v})} placeholder="0,00" disabled={!canEditProductMoney} />
                    <ConfigInput label="Custo" type="number" value={editingProduct.cost || 0} onChange={(v) => setEditingProduct({...editingProduct, cost: v})} placeholder="0,00" disabled={!canEditProductMoney} />
                  </div>
                  <div className="space-y-3">
                    <label className="text-[10px] font-black uppercase tracking-widest text-gray-500 ml-1">Vincular Opcionais</label>
                    <div className="flex flex-wrap gap-2">
                      {modifierGroups.map(mg => {
                        const isLinked = editingProduct.modifierGroups?.some(g => g.id === mg.id);
                        return (
                          <button
                            key={mg.id}
                            type="button"
                            onClick={() => {
                              if (!canEditProductFields) return;
                              const currentGroups = editingProduct.modifierGroups || [];
                              const newGroups = isLinked
                                ? currentGroups.filter(g => g.id !== mg.id)
                                : [...currentGroups, mg];
                              setEditingProduct({ ...editingProduct, modifierGroups: newGroups });
                            }}
                            className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${isLinked ? 'bg-primary text-white' : 'glass text-gray-500'} ${!canEditProductFields ? 'opacity-50 cursor-not-allowed' : ''}`}
                          >
                            {mg.name}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div className="space-y-3">
                    <label className="text-[10px] font-black uppercase tracking-widest text-gray-500 ml-1">Imagem do Produto</label>
                    <div
                      onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                      onDrop={async (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        const file = e.dataTransfer.files?.[0];
                        if (file) {
                          if (canEditProductFields) {
                            const compressed = await compressImage(file);
                            setEditingProduct({ ...editingProduct, image: compressed });
                          }
                        }
                      }}
                      className="relative h-48 bg-white/[0.02] border-2 border-dashed border-white/5 rounded-[2.5rem] flex flex-col items-center justify-center gap-4 group hover:border-primary/40 hover:bg-white/[0.04] transition-all overflow-hidden cursor-pointer"
                    >
                      {editingProduct.image ? (
                        <>
                          <img src={getImageSrc(editingProduct.image)} className="absolute inset-0 w-full h-full object-cover opacity-40" />
                          <div className="relative z-10 flex flex-col items-center gap-2">
                             <div className="w-12 h-12 bg-white/10 rounded-full flex items-center justify-center backdrop-blur-md group-hover:scale-110 transition-all">
                               <Plus size={24} />
                             </div>
                             <span className="text-[10px] font-black uppercase tracking-widest">Trocar Imagem</span>
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="w-16 h-16 bg-white/5 rounded-3xl flex items-center justify-center text-gray-500 group-hover:text-primary transition-all">
                            <Image size={32} />
                          </div>
                          <div className="text-center">
                            <p className="text-xs font-black uppercase tracking-widest">Arraste a foto aqui</p>
                            <p className="text-[10px] font-bold text-gray-500 mt-1">ou clique para selecionar</p>
                          </div>
                        </>
                      )}
                      <input
                        type="file"
                        accept="image/*"
                        className="absolute inset-0 opacity-0 cursor-pointer"
                        disabled={!canEditProductFields}
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          if (file) {
                            const compressed = await compressImage(file);
                            setEditingProduct({ ...editingProduct, image: compressed });
                          }
                        }}
                      />
                    </div>
                  </div>
                  <ConfigInput label="Descrição" value={editingProduct.description || ''} onChange={(v) => setEditingProduct({...editingProduct, description: v})} disabled={!canEditProductFields} />
                  <div className="grid grid-cols-2 gap-4">
                    <ConfigInput label="Código ERP" value={editingProduct.erpCode || ''} onChange={(v) => setEditingProduct({...editingProduct, erpCode: v})} placeholder="Ex: PRD-001" disabled={!canEditProductFields} />
                    <ConfigInput label="ID Estoque Remoto" value={editingProduct.remoteStockId || ''} onChange={(v) => setEditingProduct({...editingProduct, remoteStockId: v})} placeholder="Ex: stock_abc" disabled={!canEditProductFields} />
                  </div>
                  <div className="relative group">
                    <ConfigInput label="Ou cole a URL da Imagem" value={editingProduct.image || ''} onChange={(v) => setEditingProduct({...editingProduct, image: v})} disabled={!canEditProductFields} />
                  </div>
                  {canSaveEditingProduct && (
                  <button
                    onClick={async () => {
                      try {
                        const cleanProduct: any = {
                          ...editingProduct,
                          price: typeof editingProduct.price === 'string'
                            ? parseFloat(String(editingProduct.price).replace(',', '.')) || 0
                            : Number(editingProduct.price) || 0,
                          cost: typeof editingProduct.cost === 'string'
                            ? parseFloat(String(editingProduct.cost).replace(',', '.')) || 0
                            : Number(editingProduct.cost) || 0,
                          description: editingProduct.description || "",
                          image: editingProduct.image || "",
                          erpCode: editingProduct.erpCode || "",
                          remoteStockId: editingProduct.remoteStockId || "",
                        };
                        if (!canEditProductFields) {
                          delete cleanProduct.modifierGroups;
                        }

                        const exists = menu.find(p => p.id === editingProduct.id);
                        if (exists) {
                          await updateProduct(editingProduct.id, cleanProduct);
                        } else {
                          await addProduct(cleanProduct);
                        }
                        setEditingProduct(null);
                      } catch (err: any) {
                        console.error("Erro no form:", err);
                        addNotification(`Erro ao salvar: ${err.message}`, 'error');
                      }
                    }}
                    className="w-full btn-beco btn-beco-purple py-6 font-black shadow-xl shadow-primary/20 hover:scale-[1.02] active:scale-95 transition-all"
                  >
                    SALVAR ALTERAÇÕES
                  </button>
                  )}

                  {canDeleteProduct && (
                  <div className="pt-6 border-t border-white/5 flex flex-col items-center gap-4">
	                    <button
	                      onClick={() => {
	                        requestProductDelete(editingProduct);
	                      }}
                      className="text-[10px] font-black text-rose-500/40 hover:text-rose-500 uppercase tracking-[0.2em] transition-all flex items-center gap-2"
                    >
                      <Trash2 size={12} /> Excluir Produto do Cardápio
                    </button>
                    <p className="text-[9px] text-zinc-700 font-bold uppercase italic">Ação irreversível • Requer autorização nível Admin</p>
                  </div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {activeTab === 'optionals' && canManageOptionals && (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-16">
          <div className="xl:col-span-1 space-y-6">
            <div className="flex justify-between items-center mb-8 px-4">
              <h3 className="text-3xl font-black flex items-center gap-4"><Sparkles size={28}/> Grupos</h3>
              <button
                onClick={() => addModifierGroup({ id: createId(), name: 'Novo Grupo', minChoices: 0, maxChoices: 1, isRequired: false, status: 'active', modifiers: [] })}
                className="p-3 bg-primary text-white rounded-xl shadow-lg shadow-primary/20 hover:scale-105 transition-all"
              >
                <Plus size={20}/>
              </button>
            </div>
            <div className="glass rounded-[3rem] border-white/5 overflow-hidden max-h-[70vh] overflow-y-auto custom-scrollbar">
              {(modifierGroups || []).map((group) => (
                <button
                  key={group.id}
                  onClick={() => setEditingGroup(group.id)}
                  className={`w-full p-8 border-b border-white/5 text-left transition-all group ${editingGroup === group.id ? 'bg-primary/10 border-primary/20' : 'hover:bg-white/[0.02]'}`}
                >
                  <div className="flex justify-between items-start">
                    <div>
                      <h4 className={`font-black text-xl ${editingGroup === group.id ? 'text-primary' : ''}`}>{group.name}</h4>
                      <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mt-1">
                        {group.isRequired ? 'Obrigatório' : 'Opcional'} • {group.modifiers.length} Opções
                      </p>
                    </div>
                    {editingGroup === group.id && <ChevronRight size={20} className="text-primary animate-pulse" />}
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="xl:col-span-2">
            {editingGroup ? (
              <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-8">
                {modifierGroups.filter(g => g.id === editingGroup).map(group => (
                  <div key={group.id} className="space-y-12">
                    {/* Configuração Básica */}
                    <div className="glass-card p-10 border-white/5 shadow-2xl">
                      <div className="flex justify-between items-center mb-8">
                        <h4 className="text-2xl font-black tracking-tighter">Configurar "{group.name}"</h4>
                        <button onClick={() => requestModifierGroupDelete(group.id)} className="p-4 glass rounded-xl text-rose-500 hover:bg-rose-500/10 transition-all"><Trash2 size={18}/></button>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                        <ConfigInput label="Nome do Grupo" value={group.name} onChange={(v) => updateModifierGroup(group.id, { name: v })} />
                        <div className="grid grid-cols-2 gap-4">
                          <ConfigInput label="Min" type="number" value={group.minChoices} onChange={(v) => updateModifierGroup(group.id, { minChoices: Number(v) })} />
                          <ConfigInput label="Max" type="number" value={group.maxChoices} onChange={(v) => updateModifierGroup(group.id, { maxChoices: Number(v) })} />
                        </div>
                        <button
                          onClick={() => updateModifierGroup(group.id, { isRequired: !group.isRequired })}
                          className={`md:col-span-2 p-5 rounded-2xl border text-left transition-all ${group.isRequired ? 'bg-primary/10 border-primary/30 text-primary' : 'glass border-white/5 text-gray-500 hover:text-white'}`}
                        >
                          <span className="block text-[10px] font-black uppercase tracking-[0.2em] mb-1">Obrigatoriedade</span>
                          <span className="font-black text-sm">{group.isRequired ? 'Cliente precisa escolher dentro deste grupo' : 'Opcional livre, cliente escolhe se quiser'}</span>
                        </button>
                      </div>
                    </div>

                    {/* Opções */}
                    <div className="glass-card p-10 border-white/5">
                      <h4 className="text-xl font-black mb-8 flex items-center gap-3"><Plus size={20} className="text-primary"/> Opções de Escolha</h4>
                      <div className="space-y-3">
                        {group.modifiers.map((m, idx) => (
                          <div key={m.id || idx} className={`flex items-center gap-4 p-4 glass rounded-2xl border-white/5 hover:border-white/10 transition-all ${m.status === 'inactive' ? 'opacity-45 grayscale' : ''}`}>
                            <input
                              value={m.name}
                              autoComplete="off"
                              autoCorrect="off"
                              spellCheck={false}
                              onChange={(e) => {
                                const newMods = [...group.modifiers];
                                newMods[idx] = { ...m, name: e.target.value };
                                updateModifierGroup(group.id, { modifiers: newMods });
                              }}
                              className="flex-1 bg-transparent outline-none font-bold text-sm"
                            />
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] font-black text-gray-500 uppercase">R$</span>
                              <input
                                type="number"
                                autoComplete="off"
                                value={m.price}
                                onChange={(e) => {
                                  const newMods = [...group.modifiers];
                                  newMods[idx] = { ...m, price: Number(e.target.value) || 0 };
                                  updateModifierGroup(group.id, { modifiers: newMods });
                                }}
                                className="w-20 bg-transparent outline-none font-bold text-sm text-right"
                              />
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                const newMods = [...group.modifiers];
                                newMods[idx] = { ...m, status: m.status === 'inactive' ? 'active' : 'inactive' };
                                updateModifierGroup(group.id, { modifiers: newMods });
                              }}
                              title={m.status === 'inactive' ? 'Mostrar no tablet' : 'Ocultar do tablet'}
                              className={`p-2 rounded-lg transition-all ${
                                m.status === 'inactive'
                                  ? 'text-gray-500 hover:bg-white/10 hover:text-white'
                                  : 'text-emerald-400 hover:bg-emerald-500/10'
                              }`}
                            >
                              {m.status === 'inactive' ? <EyeOff size={16}/> : <Eye size={16}/>}
                            </button>
                            <button onClick={() => {
                              const newMods = group.modifiers.filter((_, i) => i !== idx);
                              updateModifierGroup(group.id, { modifiers: newMods });
                            }} className="p-2 text-rose-500 hover:bg-rose-500/10 rounded-lg transition-all"><X size={16}/></button>
                          </div>
                        ))}
                        <button
                          onClick={() => {
                            const newMods = [...group.modifiers, { id: createId(), name: 'Nova Opção', price: 0, status: 'active' as const }];
                            updateModifierGroup(group.id, { modifiers: newMods });
                          }}
                          className="w-full p-4 glass border-dashed border-white/10 rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-white/5 text-primary transition-all"
                        >
                          + Adicionar Nova Opção
                        </button>
                      </div>
                    </div>

                    {/* Vínculos */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                      <div className="glass-card p-10 border-white/5">
                        <h4 className="text-xl font-black mb-6 flex items-center gap-3 text-primary"><LayoutDashboard size={20}/> Aplicar em Categorias</h4>
                        <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-6 leading-relaxed">Atrelar a uma categoria inteira (todos os produtos herdam)</p>
                        <div className="space-y-2">
	                          {categories.map(cat => {
                              const linked = isGroupLinkedToCategory(cat.id, group.id);
                              const productCount = menu.filter(p => p.categoryId === cat.id).length;
                              return (
	                            <button
	                              key={cat.id}
	                              onClick={() => linkGroupToCategory(cat.id, group.id, !linked)}
	                              className={`w-full p-4 rounded-xl text-left flex justify-between items-center group transition-all border ${linked ? 'bg-primary/10 border-primary/30 text-primary' : 'glass border-white/5 hover:border-primary/40'}`}
	                            >
                                <div>
	                                <span className="font-bold text-sm block">{cat.name}</span>
                                  <span className="text-[9px] font-black uppercase tracking-widest text-gray-500">{productCount} produto(s)</span>
                                </div>
                                <span className={`flex items-center gap-2 text-[10px] font-black uppercase tracking-widest ${linked ? 'text-primary' : 'text-gray-500 group-hover:text-primary'}`}>
                                  {linked ? 'Aplicado' : 'Aplicar'}
                                  {linked ? <Check size={16} /> : <Plus size={16} />}
                                </span>
	                            </button>
                              );
                            })}
	                        </div>
	                      </div>

                      <div className="glass-card p-10 border-white/5">
                        <h4 className="text-xl font-black mb-6 flex items-center gap-3 text-accent"><Package size={20}/> Aplicar em Produtos</h4>
                        <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-6 leading-relaxed">Escolher apenas itens específicos</p>
                        <div className="max-h-64 overflow-y-auto custom-scrollbar space-y-2 pr-2">
	                          {menu.map(p => {
                              const direct = isGroupLinkedDirectlyToProduct(p.id, group.id);
                              const inherited = isGroupInheritedByProduct(p, group.id);
                              const lockedByCategory = inherited && !direct;
                              return (
	                            <button
	                              key={p.id}
	                              onClick={() => {
                                  if (lockedByCategory) return;
                                  linkGroupToProduct(p.id, group.id, !direct);
                                }}
                                disabled={lockedByCategory}
	                              className={`w-full p-4 rounded-xl text-left flex justify-between items-center transition-all border ${
                                  direct
                                    ? 'bg-accent/10 border-accent/30 text-accent'
                                    : lockedByCategory
                                      ? 'bg-primary/5 border-primary/20 text-gray-400 cursor-not-allowed'
                                      : 'glass border-white/5 hover:border-white/20'
                                }`}
	                            >
                                <div>
	                                <span className="font-bold text-sm block">{p.name}</span>
                                  <span className="text-[9px] font-black uppercase tracking-widest text-gray-500">{p.categoryName || p.categoryId}</span>
                                </div>
                                <span className={`flex items-center gap-2 text-[10px] font-black uppercase tracking-widest ${direct ? 'text-accent' : inherited ? 'text-primary' : 'text-gray-500'}`}>
                                  {direct ? 'Direto' : inherited ? 'Herdado' : 'Aplicar'}
                                  {(direct || inherited) ? <Check size={16} /> : <Plus size={16} />}
                                </span>
	                            </button>
                              );
                            })}
	                        </div>
	                      </div>
                    </div>
                  </div>
                ))}
              </motion.div>
            ) : (
              <div className="h-full flex flex-col items-center justify-center glass rounded-[3rem] border-white/5 border-dashed p-20 text-center">
                <div className="w-24 h-24 bg-white/5 rounded-[2rem] flex items-center justify-center text-gray-700 mb-8">
                  <Sparkles size={48} />
                </div>
                <h3 className="text-3xl font-black mb-4 tracking-tighter">Selecione um Grupo</h3>
                <p className="text-gray-500 font-bold uppercase tracking-widest text-[10px] max-w-xs leading-relaxed">
                  Escolha um grupo à esquerda para configurar opções, preços e onde ele deve aparecer no cardápio.
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'sellers' && canManageTeam && (
        <div className="space-y-8">
          {isSuperAdmin && (
            <div className="glass-card p-6 border-primary/20 flex flex-col md:flex-row md:items-center justify-between gap-6">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.24em] text-primary mb-2">Super admin</p>
                <h3 className="text-2xl font-black tracking-tighter">Permissões do PDV</h3>
                <p className="text-sm font-bold text-zinc-500 mt-1">Configure o que admin, gerente e operador podem fazer no caixa, mesas, pedidos e estoque.</p>
              </div>
              <button
                onClick={() => setShowPermissionConfig(true)}
                className="btn-beco btn-beco-purple px-8 py-5 rounded-2xl font-black uppercase tracking-widest text-xs flex items-center justify-center gap-3"
              >
                <Settings size={18} /> Configurar
              </button>
            </div>
          )}

          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="glass-card p-6 sm:p-10 border-white/5">
            <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-6 mb-8 border-b border-white/5 pb-6">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-primary/10 rounded-2xl flex items-center justify-center text-primary shadow-inner shrink-0">
                  <User size={22} />
                </div>
                <div>
                  <h3 className="text-3xl font-black tracking-tighter leading-tight">Equipe Ativa</h3>
                  <p className="text-sm font-bold text-zinc-500 mt-1">
                    Clique em uma pessoa para revisar o perfil e as permissões do PDV.
                  </p>
                </div>
              </div>

              <button
                onClick={() => setShowAddSellerModal(true)}
                className="btn-beco btn-beco-purple px-6 py-4 rounded-2xl font-black uppercase tracking-widest text-xs flex items-center justify-center gap-3"
              >
                <Plus size={18} /> Novo operador
              </button>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              {sellers.map((s: any) => {
                const profile = getPermissionProfile(s);
                const stats = getSellerPermissionStats(s);
                const duplicates = getSellerDuplicates(s);
                return (
                  <button
                    key={s.id}
                    onClick={() => setSelectedSeller(s)}
                    className="w-full flex items-center justify-between gap-5 p-5 sm:p-6 glass rounded-2xl border-white/5 hover:border-primary/40 hover:bg-primary/5 text-left transition-all"
                  >
                    <div className="flex items-center gap-5 min-w-0">
                      <div className="w-12 h-12 bg-white/10 rounded-xl flex items-center justify-center font-black shrink-0">{s.name.charAt(0)}</div>
                      <div className="min-w-0">
                        <p className="font-black text-lg truncate">{s.name}</p>
                        <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">{s.role} • {profileLabels[profile]}</p>
                        <div className="flex flex-wrap items-center gap-2 mt-2">
                          <span className={`inline-flex px-2 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest ${s.source === 'os' ? 'bg-emerald-500/10 text-emerald-300' : 'bg-primary/10 text-primary'}`}>
                            {s.source === 'os' ? 'Espelhado do OS' : 'Usuário próprio PDV'}
                          </span>
                          <span className="inline-flex px-2 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest bg-white/5 text-zinc-400">
                            {stats.active}/{stats.total} permissões
                          </span>
                          {stats.overridden > 0 && (
                            <span className="inline-flex px-2 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest bg-amber-500/10 text-amber-300">
                              {stats.overridden} exceções
                            </span>
                          )}
                          {duplicates.length > 0 && (
                            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest bg-rose-500/10 text-rose-300">
                              <AlertTriangle size={11} /> Possível duplicidade
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 shrink-0">
                      <span className={`hidden sm:inline-flex px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest ${s.status === 'active' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'}`}>
                        {s.status === 'active' ? 'Ativo' : 'Inativo'}
                      </span>
                      <ChevronRight className="text-zinc-600" size={20} />
                    </div>
                  </button>
                );
              })}
            </div>
          </motion.div>
        </div>
      )}

      {activeTab === 'finance' && canViewSalesTotals && (
        <div className="space-y-10">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            <div className="glass-card p-8 border-white/5">
              <span className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">Produtos vendidos</span>
              <p className="text-4xl font-black text-white mt-3">R$ {closedBillsSubtotal.toFixed(2)}</p>
              <p className="text-[10px] font-black uppercase tracking-widest text-zinc-600 mt-2">{closedBills.length} mesas fechadas</p>
            </div>
            <div className="glass-card p-8 border-white/5">
              <span className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">Taxa de serviço</span>
              <p className="text-4xl font-black text-amber-300 mt-3">R$ {closedBillsServiceFee.toFixed(2)}</p>
              <p className="text-[10px] font-black uppercase tracking-widest text-zinc-600 mt-2">Separado do desconto</p>
            </div>
            <div className="glass-card p-8 border-white/5">
              <span className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">Descontos</span>
              <p className="text-4xl font-black text-rose-400 mt-3">R$ {closedBillsDiscount.toFixed(2)}</p>
              <p className="text-[10px] font-black uppercase tracking-widest text-zinc-600 mt-2">Não inclui taxa removida</p>
            </div>
            <div className="glass-card p-8 border-white/5">
              <span className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">Total recebido</span>
              <p className="text-4xl font-black text-emerald-400 mt-3">R$ {closedBillsTotal.toFixed(2)}</p>
              <p className="text-[10px] font-black uppercase tracking-widest text-zinc-600 mt-2">Produtos + taxa - desconto</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            {(['credit', 'debit', 'pix', 'cash'] as const).map((method) => {
              const Icon = method === 'cash' ? Banknote : method === 'pix' ? Wallet : CreditCard;
              const summary = paymentSummary[method] || { total: 0, count: 0 };
              return (
                <div key={method} className="glass-card p-8 border-white/5">
                  <div className="flex items-center justify-between mb-4">
                    <span className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">{paymentLabels[method]}</span>
                    <Icon size={22} className="text-primary" />
                  </div>
                  <p className="text-3xl font-black text-white">R$ {summary.total.toFixed(2)}</p>
                  <p className="text-[10px] font-black uppercase tracking-widest text-zinc-600 mt-2">{summary.count} lançamentos</p>
                </div>
              );
            })}
          </div>

          <div className="glass rounded-[3rem] border-white/5 overflow-hidden">
            <table className="w-full text-left">
              <thead className="bg-white/5">
                <tr className="text-[10px] font-black uppercase tracking-widest text-gray-500">
                  <th className="p-8">Mesa</th>
                  <th className="p-8">Horário</th>
                  <th className="p-8">Operador</th>
                  <th className="p-8 text-right">Produtos</th>
                  <th className="p-8 text-right">Taxa</th>
                  <th className="p-8 text-right">Desconto</th>
                  <th className="p-8">Pagamentos</th>
                  <th className="p-8 text-right">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {closedBills.map((bill) => (
                  <tr key={bill.id} className="hover:bg-white/[0.01] transition-all">
                    <td className="p-8 font-black text-xl">{bill.tableNumber}</td>
                    <td className="p-8 font-medium text-gray-400">{new Date(bill.closedAt).toLocaleString('pt-BR')}</td>
                    <td className="p-8 font-black text-primary">{bill.sellerName}</td>
                    <td className="p-8 text-right font-black text-zinc-300">R$ {bill.subtotal.toFixed(2)}</td>
                    <td className="p-8 text-right font-black text-amber-300">R$ {bill.serviceFee.toFixed(2)}</td>
                    <td className="p-8 text-right font-black text-rose-400">R$ {bill.discount.toFixed(2)}</td>
                    <td className="p-8">
                      <div className="flex flex-wrap gap-2">
                        {(bill.payments || []).map((payment, idx) => (
                          <span key={`${bill.id}-${idx}`} className="px-3 py-1 rounded-full text-[10px] font-black uppercase bg-white/5 text-zinc-300">
                            {paymentLabels[payment.method] || payment.method}: R$ {payment.amount.toFixed(2)}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="p-8 text-right font-black text-emerald-400">R$ {bill.total.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'movements' && canViewSalesTotals && (
        <div className="space-y-5">
          <div className="glass rounded-[2rem] border-white/5 p-5">
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4">
              <label className="space-y-2">
                <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Início</span>
                <input
                  type="date"
                  value={auditStartDate}
                  onChange={(event) => setAuditStartDate(event.target.value)}
                  className="w-full bg-white/5 border border-white/5 rounded-2xl px-4 py-3 text-sm font-bold outline-none focus:border-primary/50"
                />
              </label>
              <label className="space-y-2">
                <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Fim</span>
                <input
                  type="date"
                  value={auditEndDate}
                  onChange={(event) => setAuditEndDate(event.target.value)}
                  className="w-full bg-white/5 border border-white/5 rounded-2xl px-4 py-3 text-sm font-bold outline-none focus:border-primary/50"
                />
              </label>
              <label className="space-y-2">
                <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Usuário</span>
                <select
                  value={auditAuthor}
                  onChange={(event) => setAuditAuthor(event.target.value)}
                  className="w-full bg-white/5 border border-white/5 rounded-2xl px-4 py-3 text-sm font-bold outline-none focus:border-primary/50"
                >
                  <option value="" className="bg-[#0a0a0c]">Todos</option>
                  {auditAuthorOptions.map((author) => (
                    <option key={author} value={author} className="bg-[#0a0a0c]">{author}</option>
                  ))}
                </select>
              </label>
              <label className="space-y-2">
                <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Ação</span>
                <select
                  value={auditAction}
                  onChange={(event) => setAuditAction(event.target.value)}
                  className="w-full bg-white/5 border border-white/5 rounded-2xl px-4 py-3 text-sm font-bold outline-none focus:border-primary/50"
                >
                  <option value="" className="bg-[#0a0a0c]">Todas</option>
                  {auditActionOptions.map((action) => (
                    <option key={action} value={action} className="bg-[#0a0a0c]">{getAuditActionLabel(action)}</option>
                  ))}
                </select>
              </label>
              <div className="flex items-end">
                <button
                  onClick={() => {
                    setAuditStartDate('');
                    setAuditEndDate('');
                    setAuditAuthor('');
                    setAuditAction('');
                  }}
                  className="w-full rounded-2xl bg-white/5 border border-white/5 px-4 py-3 text-[10px] font-black uppercase tracking-widest text-zinc-400 hover:text-white hover:bg-white/10"
                >
                  Limpar filtros
                </button>
              </div>
            </div>
          </div>

          <div className="glass rounded-[3rem] border-white/5 overflow-hidden">
            <div className="overflow-x-auto custom-scrollbar">
              <table className="w-full min-w-[980px] text-left">
                <thead className="bg-white/5">
                  <tr className="text-[10px] font-black uppercase tracking-widest text-gray-500">
                    <th className="p-6">Data e horário</th>
                    <th className="p-6">Ação</th>
                    <th className="p-6">Mesa</th>
                    <th className="p-6">Detalhes</th>
                    <th className="p-6">Usuário</th>
                    <th className="p-6">Origem</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {isAuditLoading ? (
                    <tr>
                      <td colSpan={6} className="p-10 text-center text-xs font-black uppercase tracking-widest text-zinc-500">Carregando auditoria...</td>
                    </tr>
                  ) : movements.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="p-10 text-center text-xs font-black uppercase tracking-widest text-zinc-500">Nenhum registro encontrado com esses filtros.</td>
                    </tr>
                  ) : movements.map((m) => (
                    <tr key={m.id} className="hover:bg-white/[0.02] transition-all align-top">
                      <td className="p-6 font-bold text-gray-400 whitespace-nowrap">
                        {new Date(m.timestamp).toLocaleDateString('pt-BR')} às {new Date(m.timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                      </td>
                      <td className="p-6">
                        <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase whitespace-nowrap ${m.action === 'bill_closed' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-primary/10 text-primary'}`}>
                          {getAuditActionLabel(m.action)}
                        </span>
                      </td>
                      <td className="p-6 font-black text-lg whitespace-nowrap">{m.table ? `Mesa ${m.table}` : '-'}</td>
                      <td className="p-6 text-gray-300 font-medium max-w-xl leading-relaxed">{formatAuditDetails(m.details)}</td>
                      <td className="p-6 font-black text-primary whitespace-nowrap">{m.author || 'Sistema'}</td>
                      <td className="p-6">
                        <span className="text-[10px] font-black uppercase tracking-widest bg-white/10 px-2 py-1 rounded">{m.origin}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      <AnimatePresence>
        {showAddSellerModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[900] bg-black/80 backdrop-blur-xl p-6 flex items-center justify-center"
          >
            <motion.div
              initial={{ scale: 0.96, y: 24 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.96, y: 24 }}
              className="w-full max-w-2xl glass-card border-primary/20 overflow-hidden"
            >
              <div className="p-7 border-b border-white/10 flex items-center justify-between gap-5">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.24em] text-primary mb-2">Equipe PDV</p>
                  <h2 className="text-3xl font-black tracking-tighter">Novo Operador</h2>
                  <p className="text-sm font-bold text-zinc-500 mt-1">Cadastro próprio do PDV para uso independente do OS.</p>
                </div>
                <button onClick={() => setShowAddSellerModal(false)} className="p-4 glass rounded-2xl hover:text-rose-500 transition-all">
                  <X size={24} />
                </button>
              </div>

              <div className="p-7 space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  <ConfigInput label="Nome Completo" value={newSellerName} onChange={setNewSellerName} />
                  <ConfigInput label="PIN (4 dígitos)" value={newSellerPin} onChange={setNewSellerPin} />
                  <div className="space-y-3">
                    <label className="text-[10px] font-black uppercase tracking-widest text-gray-500 ml-1">Cargo</label>
                    <select value={newSellerRole} onChange={(e) => setNewSellerRole(e.target.value as any)} className="w-full glass p-5 rounded-2xl border-white/10 outline-none font-bold text-sm bg-transparent">
                      <option value="garçom" className="bg-[#0a0a0c]">Garçom</option>
                      <option value="atendente" className="bg-[#0a0a0c]">Atendente</option>
                      <option value="gerente" className="bg-[#0a0a0c]">Gerente</option>
                      <option value="outro" className="bg-[#0a0a0c]">Outro</option>
                    </select>
                  </div>
                  <div className="space-y-3">
                    <label className="text-[10px] font-black uppercase tracking-widest text-gray-500 ml-1">Perfil de Permissão</label>
                    <select value={newSellerPermission} onChange={(e) => setNewSellerPermission(e.target.value as any)} className="w-full glass p-5 rounded-2xl border-white/10 outline-none font-bold text-sm bg-transparent">
                      <option value="admin" className="bg-[#0a0a0c]">Admin full access</option>
                      <option value="manager" className="bg-[#0a0a0c]">Gerente</option>
                      <option value="operator" className="bg-[#0a0a0c]">Operador</option>
                    </select>
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row justify-end gap-3 pt-2">
                  <button onClick={() => setShowAddSellerModal(false)} className="px-6 py-4 rounded-2xl glass font-black uppercase tracking-widest text-xs">
                    Cancelar
                  </button>
                  <button onClick={handleCreateSeller} className="btn-beco btn-beco-purple px-8 py-4 rounded-2xl font-black uppercase tracking-widest text-xs">
                    Registrar operador
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}

        {selectedSeller && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[900] bg-black/80 backdrop-blur-xl p-6 flex items-center justify-center"
          >
            <motion.div
              initial={{ scale: 0.96, y: 24 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.96, y: 24 }}
              className="w-full max-w-6xl max-h-[90vh] glass-card border-primary/20 overflow-hidden flex flex-col"
            >
              {(() => {
                const profile = getPermissionProfile(selectedSeller);
                const stats = getSellerPermissionStats(selectedSeller);
                const duplicates = getSellerDuplicates(selectedSeller);
                return (
                  <>
                    <div className="p-7 border-b border-white/10 flex items-start justify-between gap-5">
                      <div className="flex items-center gap-5 min-w-0">
                        <div className="w-14 h-14 bg-white/10 rounded-2xl flex items-center justify-center font-black text-xl shrink-0">
                          {selectedSeller.name.charAt(0)}
                        </div>
                        <div className="min-w-0">
                          <p className="text-[10px] font-black uppercase tracking-[0.24em] text-primary mb-2">Permissões do usuário</p>
                          <h2 className="text-3xl font-black tracking-tighter truncate">{selectedSeller.name}</h2>
                          <p className="text-sm font-bold text-zinc-500 mt-1 uppercase tracking-widest">
                            {selectedSeller.role} • {profileLabels[profile]} • {stats.active}/{stats.total} permissões
                          </p>
                          <span className={`inline-flex mt-3 px-2 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest ${selectedSeller.source === 'os' ? 'bg-emerald-500/10 text-emerald-300' : 'bg-primary/10 text-primary'}`}>
                            {selectedSeller.source === 'os' ? 'Espelhado do OS' : 'Usuário próprio PDV'}
                          </span>
                          {stats.overridden > 0 && (
                            <span className="inline-flex mt-3 ml-2 px-2 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest bg-amber-500/10 text-amber-300">
                              {stats.overridden} exceções individuais
                            </span>
                          )}
                        </div>
                      </div>
                      <button onClick={() => setSelectedSeller(null)} className="p-4 glass rounded-2xl hover:text-rose-500 transition-all">
                        <X size={24} />
                      </button>
                    </div>

                    <div className="flex-1 overflow-y-auto custom-scrollbar p-7 space-y-6">
                      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                        <div className="bg-black/20 rounded-2xl p-5 border border-white/5">
                          <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-2">Status</p>
                          <p className={`text-xl font-black ${selectedSeller.status === 'active' ? 'text-emerald-300' : 'text-rose-300'}`}>
                            {selectedSeller.status === 'active' ? 'Ativo' : 'Inativo'}
                          </p>
                        </div>
                        <div className="bg-black/20 rounded-2xl p-5 border border-white/5">
                          <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-2">Origem</p>
                          <p className="text-xl font-black">{selectedSeller.source === 'os' ? 'Becoartes OS' : 'PDV'}</p>
                        </div>
                        <div className="bg-black/20 rounded-2xl p-5 border border-white/5">
                          <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-2">Perfil base</p>
                          <p className="text-xl font-black">{profileLabels[profile]}</p>
                        </div>
                      </div>

                      {duplicates.length > 0 && (
                        <div className="rounded-2xl border border-rose-500/20 bg-rose-500/5 p-5 flex items-start gap-4">
                          <AlertTriangle className="text-rose-300 shrink-0 mt-0.5" size={20} />
                          <div>
                            <p className="text-xs font-black uppercase tracking-widest text-rose-300 mb-2">Possível duplicidade</p>
                            <p className="text-sm font-bold text-zinc-400 leading-relaxed">
                              Encontramos outro cadastro com o mesmo nome: {duplicates.map((seller: any) => `${seller.name} (${seller.source === 'os' ? 'OS' : 'PDV'})`).join(', ')}.
                              Não removi nada automaticamente para não apagar acesso válido.
                            </p>
                          </div>
                        </div>
                      )}

                      <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-5">
                        <p className="text-xs font-black uppercase tracking-widest text-amber-300 mb-2">Permissão por pessoa</p>
                        <p className="text-sm font-bold text-zinc-400 leading-relaxed">
                          Os checkboxes abaixo valem só para <span className="text-white">{selectedSeller.name}</span>.
                          O perfil <span className="text-white">{profileLabels[profile]}</span> continua sendo o padrão quando não houver exceção marcada.
                        </p>
                      </div>

                      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
                        {permissionGroups.map((group) => {
                          const groupActiveCount = group.keys.filter((key) => getSellerPermissionValue(selectedSeller, key)).length;
                          return (
                            <div key={`${selectedSeller.id}-${group.title}`} className="bg-black/20 rounded-2xl p-5 border border-white/5">
                              <div className="mb-4">
                                <h4 className="text-sm font-black uppercase tracking-widest text-primary">{group.title}</h4>
                                <p className="text-[10px] font-black uppercase tracking-widest text-zinc-600 mt-1">
                                  {groupActiveCount} de {group.keys.length} ativas
                                </p>
                              </div>
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                {group.keys.map((key) => {
                                  const active = getSellerPermissionValue(selectedSeller, key);
                                  const locked = isCoreAdminPermission(profile, key);
                                  const overridden = isSellerPermissionOverridden(selectedSeller, key);
                                  return (
                                    <button
                                      key={`${selectedSeller.id}-${key}`}
                                      onClick={() => setSellerPermissionValue(selectedSeller, key, !active)}
                                      disabled={locked}
                                      className={`min-h-[60px] rounded-xl border px-4 py-3 text-left transition-all flex items-start gap-3 ${
                                        active
                                          ? 'bg-primary/15 border-primary/30 text-white'
                                          : 'bg-white/[0.03] border-white/5 text-zinc-500'
                                      } ${locked ? 'opacity-70 cursor-not-allowed' : 'hover:border-white/20'}`}
                                    >
                                      <span className={`mt-0.5 w-5 h-5 rounded-md border flex items-center justify-center shrink-0 ${active ? 'bg-primary border-primary' : 'border-white/20'}`}>
                                        {active && <Check size={13} strokeWidth={4} />}
                                      </span>
                                      <span className="min-w-0 flex-1">
                                        <span className="text-xs font-black uppercase tracking-wide leading-snug block">{permissionLabels[key]}</span>
                                        {overridden && (
                                          <span
                                            onClick={(event) => {
                                              event.stopPropagation();
                                              resetSellerPermissionValue(selectedSeller, key);
                                            }}
                                            className="inline-flex mt-2 text-[9px] font-black uppercase tracking-widest text-amber-300 hover:text-amber-100"
                                          >
                                            Exceção • usar padrão
                                          </span>
                                        )}
                                      </span>
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      <div className="flex flex-col sm:flex-row justify-between gap-3 pt-2">
                        <button
                          onClick={() => resetSellerPermissions(selectedSeller)}
                          disabled={stats.overridden === 0}
                          className="px-6 py-4 rounded-2xl glass font-black uppercase tracking-widest text-xs disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          Restaurar padrão do perfil
                        </button>
                        <button
                          onClick={async () => {
                            if (selectedSeller.source === 'os') return;
                            await toggleSellerStatus(selectedSeller.id);
                            setSelectedSeller((prev: any) => prev ? { ...prev, status: prev.status === 'active' ? 'inactive' : 'active' } : prev);
                          }}
                          disabled={selectedSeller.source === 'os'}
                          className="px-6 py-4 rounded-2xl glass font-black uppercase tracking-widest text-xs disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          {selectedSeller.status === 'active' ? 'Desativar acesso' : 'Ativar acesso'}
                        </button>
                        <button
                          onClick={async () => {
                            if (selectedSeller.source === 'os') return;
                            await deleteSeller(selectedSeller.id);
                            setSelectedSeller(null);
                          }}
                          disabled={selectedSeller.source === 'os'}
                          className="px-6 py-4 rounded-2xl bg-rose-500/10 text-rose-300 font-black uppercase tracking-widest text-xs disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          Excluir usuário próprio
                        </button>
                      </div>
                    </div>
                  </>
                );
              })()}
            </motion.div>
          </motion.div>
        )}

        {showPermissionConfig && isSuperAdmin && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[900] bg-black/80 backdrop-blur-xl p-8 flex items-center justify-center"
          >
            <motion.div
              initial={{ scale: 0.96, y: 24 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.96, y: 24 }}
              className="w-full max-w-7xl max-h-[90vh] glass-card border-primary/20 overflow-hidden flex flex-col"
            >
              <div className="p-8 border-b border-white/10 flex items-center justify-between gap-6">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.24em] text-primary mb-2">Configuração do PDV</p>
                  <h2 className="text-4xl font-black tracking-tighter">Permissões por Perfil</h2>
                  <p className="text-sm font-bold text-zinc-500 mt-2">As mudanças salvam na configuração do sistema e também são validadas no BFF.</p>
                </div>
                <button onClick={() => setShowPermissionConfig(false)} className="p-5 glass rounded-2xl hover:text-rose-500 transition-all">
                  <X size={26} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto custom-scrollbar p-8 space-y-8">
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                  {permissionProfiles.map((profile) => {
                    const stats = getPermissionStats(profile);
                    const isActive = activePermissionProfile === profile;
                    return (
                      <button
                        key={profile}
                        onClick={() => setActivePermissionProfile(profile)}
                        className={`p-5 rounded-2xl border text-left transition-all ${
                          isActive
                            ? 'bg-primary/15 border-primary/40 shadow-2xl shadow-primary/10'
                            : 'bg-white/[0.03] border-white/5 hover:border-white/20'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-4 mb-4">
                          <div>
                            <p className="text-2xl font-black tracking-tighter">{profileLabels[profile]}</p>
                            <p className="text-xs font-bold text-zinc-500 leading-relaxed mt-1">{profileDescriptions[profile]}</p>
                          </div>
                          {stats.changed > 0 && (
                            <span className="px-2 py-1 rounded-lg bg-amber-500/10 text-amber-300 text-[9px] font-black uppercase tracking-widest">
                              {stats.changed} ajuste(s)
                            </span>
                          )}
                        </div>
                        <div className="h-2 rounded-full bg-white/5 overflow-hidden mb-3">
                          <div
                            className="h-full bg-primary rounded-full transition-all"
                            style={{ width: `${Math.round((stats.active / stats.total) * 100)}%` }}
                          />
                        </div>
                        <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500">
                          {stats.active} de {stats.total} permissões ativas
                        </p>
                      </button>
                    );
                  })}
                </div>

                <div className="glass border-white/10 rounded-[2rem] overflow-hidden">
                  <div className="p-6 border-b border-white/10 flex flex-col xl:flex-row xl:items-center justify-between gap-5">
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-[0.24em] text-primary mb-2">Editando perfil</p>
                      <h3 className="text-3xl font-black tracking-tighter">{profileLabels[activePermissionProfile]}</h3>
                      <p className="text-sm font-bold text-zinc-500 mt-1">{profileDescriptions[activePermissionProfile]}</p>
                    </div>
                    <div className="flex flex-col sm:flex-row gap-3">
                      <div className="relative">
                        <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500" />
                        <input
                          value={permissionSearch}
                          onChange={(event) => setPermissionSearch(event.target.value)}
                          placeholder="Buscar permissão..."
                          className="glass pl-11 pr-5 py-4 rounded-2xl text-xs font-bold border-white/10 outline-none min-w-[240px] focus:border-primary/40"
                        />
                      </div>
                      <button
                        onClick={() => resetPermissionProfile(activePermissionProfile)}
                        className="px-5 py-4 rounded-2xl bg-white/5 hover:bg-white/10 text-[10px] font-black uppercase tracking-widest text-zinc-400"
                      >
                        Restaurar padrão
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 xl:grid-cols-2 gap-5 p-6">
                    {visiblePermissionGroups.map((group) => {
                      const groupActiveCount = group.keys.filter((key) => getPermissionValue(activePermissionProfile, key)).length;
                      const allGroupActive = groupActiveCount === group.keys.length;
                      return (
                        <div key={`${activePermissionProfile}-${group.title}`} className="bg-black/20 rounded-2xl p-5 border border-white/5">
                          <div className="flex items-start justify-between gap-4 mb-4">
                            <div>
                              <h4 className="text-sm font-black uppercase tracking-widest text-primary">{group.title}</h4>
                              <p className="text-[10px] font-black uppercase tracking-widest text-zinc-600 mt-1">
                                {groupActiveCount} de {group.keys.length} ativas
                              </p>
                            </div>
                            <button
                              onClick={() => setPermissionGroupValue(activePermissionProfile, group.keys, !allGroupActive)}
                              className={`px-4 py-2 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all ${
                                allGroupActive
                                  ? 'bg-rose-500/10 text-rose-300 hover:bg-rose-500/15'
                                  : 'bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/15'
                              }`}
                            >
                              {allGroupActive ? 'Desativar grupo' : 'Ativar grupo'}
                            </button>
                          </div>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            {group.keys.map((key) => {
                              const active = getPermissionValue(activePermissionProfile, key);
                              const locked = isCoreAdminPermission(activePermissionProfile, key);
                              const critical = criticalPermissionKeys.includes(key);
                              return (
                                <button
                                  key={`${activePermissionProfile}-${key}`}
                                  onClick={() => setPermissionValue(activePermissionProfile, key, !active)}
                                  disabled={locked}
                                  className={`min-h-[68px] rounded-xl border px-4 py-3 text-left transition-all flex items-start gap-3 ${
                                    active
                                      ? 'bg-primary/15 border-primary/30 text-white'
                                      : 'bg-white/[0.03] border-white/5 text-zinc-500'
                                  } ${locked ? 'opacity-70 cursor-not-allowed' : 'hover:border-white/20'}`}
                                  title={locked ? 'Permissão essencial do super admin' : undefined}
                                >
                                  <span className={`mt-0.5 w-5 h-5 rounded-md border flex items-center justify-center shrink-0 ${active ? 'bg-primary border-primary' : 'border-white/20'}`}>
                                    {active && <Check size={13} strokeWidth={4} />}
                                  </span>
                                  <span className="min-w-0">
                                    <span className="text-xs font-black uppercase tracking-wide leading-snug block">{permissionLabels[key]}</span>
                                    {critical && (
                                      <span className="inline-flex mt-2 px-2 py-0.5 rounded-md bg-amber-500/10 text-amber-300 text-[8px] font-black uppercase tracking-widest">
                                        Sensível
                                      </span>
                                    )}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {visiblePermissionGroups.length === 0 && (
                    <div className="p-12 text-center text-zinc-500 font-bold">
                      Nenhuma permissão encontrada para “{permissionSearch}”.
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Modal de Agenda */}
      <AnimatePresence>
        {adminDialog && (
          <ActionDialog
            isOpen
            title={adminDialog.title}
            description={adminDialog.description}
            confirmLabel={adminDialog.confirmLabel}
            tone={adminDialog.tone}
            input={adminDialog.input}
            onClose={() => setAdminDialog(null)}
            onConfirm={adminDialog.onConfirm}
          />
        )}
      </AnimatePresence>

      {/* Modal de Agenda */}
      <AnimatePresence>
        {schedulingItem && (
          <ScheduleModal
            title={schedulingItem.name}
            initialConfig={schedulingItem.config}
            onClose={() => setSchedulingItem(null)}
            onSave={async (config) => {
              if (schedulingItem.type === 'product') {
                await updateProduct(schedulingItem.id, { schedule: config });
              } else {
                const cat = categories.find(c => c.id === schedulingItem.id);
                if (cat) await upsertCategory({ ...cat, schedule: config });
              }
              setSchedulingItem(null);
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
