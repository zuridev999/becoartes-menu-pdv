import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Plus, Settings, LayoutDashboard, Package, Sparkles, User, TrendingUp, 
  ArrowLeft, Eye, EyeOff, Clock, Trash2, Image, ChefHat, Search, CheckCircle, X,
  GripVertical, ChevronRight, Check, Wallet, CreditCard, Banknote
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
import { db } from '../../lib/db';
import { PinLoginModal } from '../../components/auth/PinLoginModal';
import { ActionDialog } from '../../components/common/ActionDialog';
import { can, getPermissionLabel } from '../../lib/permissions';
import { createId } from '../../lib/id';
import { getImageSrc } from '../../lib/image';

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
  };
  onConfirm: (value?: string) => void | Promise<void>;
};

// Componente de Input fora para evitar perda de foco
const ConfigInput = ({ label, value, onChange, type = 'text', placeholder }: { label: string, value: any, onChange: (val: any) => void, type?: string, placeholder?: string }) => {
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
            onChange={handleInputChange}
            className={`w-full bg-white/[0.03] p-4 rounded-2xl border border-white/5 focus:border-primary/40 focus:bg-white/[0.05] outline-none font-bold text-sm transition-all placeholder:text-zinc-700 ${isMoney ? 'text-right pr-12' : ''}`}
          />
          {isMoney && <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[10px] font-black text-zinc-600">R$</span>}
        </div>
      )}
    </div>
  );
};

function SortableCategoryItem({ cat, menu, setSchedulingItem, toggleCategoryVisibility, isExpanded, onToggleExpand, updateProduct, categories, onRenameCategory, onDeleteCategory }: any) {
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
    sellers, addSeller, toggleSellerStatus, deleteSeller,
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

  const [movements, setMovements] = useState<any[]>([]);
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
        const res = await db.execute(`
          SELECT * FROM audit_logs 
          ORDER BY timestamp DESC LIMIT 100
        `);

        const formatted = res.rows.map((r: any) => ({
          id: r.id,
          action: r.action,
          details: r.details,
          table: r.table_number,
          origin: r.origin || 'pdv',
          author: r.author_name,
          timestamp: r.timestamp
        }));

        setMovements(formatted);
      };
      fetchMovements();
    }
  }, [activeTab]);

  const SectionCard = ({ title, icon: Icon, children }: { title: string, icon: any, children: React.ReactNode }) => (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="glass-card p-10 border-white/5 h-full">
      <div className="flex items-center gap-4 mb-10 border-b border-white/5 pb-6">
        <div className="w-12 h-12 bg-primary/10 rounded-2xl flex items-center justify-center text-primary shadow-inner">
          <Icon size={24} />
        </div>
        <h3 className="text-2xl font-black tracking-tighter">{title}</h3>
      </div>
      <div className="space-y-8">
        {children}
      </div>
    </motion.div>
  );

  const [expandedCategoryId, setExpandedCategoryId] = useState<string | null>(null);

  if (!currentSeller) {
    return <PinLoginModal />;
  }

  const canManageSettings = can(currentSeller, 'manageSettings');
  const canManageTeam = can(currentSeller, 'manageTeam');
  const canManageOptionals = can(currentSeller, 'manageOptionals');
  const canAddProduct = can(currentSeller, 'addProduct');
  const canEditProductPrice = can(currentSeller, 'editProductPrice');
  const canDeleteProduct = can(currentSeller, 'deleteProduct');
  const canToggleVisibility = can(currentSeller, 'toggleProductVisibility');
  const canViewSalesTotals = can(currentSeller, 'viewSalesTotals');
  const canAccessProducts =
    (adminMode === 'menu' && canToggleVisibility)
    || canAddProduct
    || canEditProductPrice
    || canDeleteProduct;

  const allowedTabIds = new Set([
    ...(canAccessProducts ? ['products'] : []),
    ...(canAddProduct ? ['categories'] : []),
    ...(canManageOptionals ? ['optionals'] : []),
    ...(canManageSettings ? ['config'] : []),
    ...(canManageTeam ? ['sellers'] : []),
    ...(canViewSalesTotals ? ['finance', 'movements'] : []),
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
    <div className="p-16 bg-[#0a0a0c] min-h-screen text-white font-['Outfit'] pb-48 overflow-y-auto custom-scrollbar h-screen">
      <div className="flex justify-between items-end mb-16">
        <div className="flex items-center gap-8">
          <button 
            onClick={() => useStore.getState().setActiveView('pdv')}
            className="w-16 h-16 glass rounded-2xl flex items-center justify-center text-zinc-500 hover:text-white transition-all border-white/5"
          >
            <ArrowLeft size={32} />
          </button>
          <div>
            <h1 className="text-7xl font-black tracking-tighter">Beco <span className="text-primary">Control</span></h1>
            <p className="text-gray-500 font-bold uppercase tracking-[0.4em] text-[10px] mt-3 ml-2 italic">
              {currentSeller.name} • {getPermissionLabel(currentSeller)}
            </p>
          </div>
        </div>
        <div className="flex glass p-2 rounded-[2rem] border-white/5">
          {[
            { id: 'config', name: 'Geral', icon: Settings },
            { id: 'categories', name: 'Categorias', icon: LayoutDashboard },
            { id: 'products', name: 'Produtos', icon: Package },
            { id: 'optionals', name: 'Opcionais', icon: Sparkles },
            { id: 'sellers', name: 'Equipe', icon: User },
            { id: 'finance', name: 'Fechamentos', icon: Wallet },
            { id: 'movements', name: 'Auditoria', icon: TrendingUp },
          ]
          .filter(tab => {
            return allowedTabIds.has(tab.id);
          })
          .map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id as any)} className={`px-8 py-4 rounded-[1.5rem] flex items-center gap-3 font-black text-xs uppercase tracking-widest transition-all ${activeTab === tab.id ? 'bg-primary text-white shadow-xl shadow-primary/20' : 'text-gray-500 hover:text-white'}`}>
              <tab.icon size={18}/> {tab.name}
            </button>
          ))}
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

      {activeTab === 'categories' && canAddProduct && (
        <div className="max-w-6xl mx-auto space-y-6">
          <div className="flex justify-between items-center mb-12 px-8">
            <div>
              <h3 className="text-4xl font-black flex items-center gap-4"><LayoutDashboard size={36}/> Gestão de Categorias</h3>
              <p className="text-gray-500 font-bold uppercase tracking-widest text-[10px] mt-2 italic">Arraste para reordenar a exibição no Tablet</p>
            </div>
            {canAddProduct && (
              <button 
                onClick={() => upsertCategory({ id: createId(), name: 'Nova Categoria', sortOrder: categories.length, visible: true })} 
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
                  />
                ))}
              </SortableContext>
            </DndContext>
          </div>
        </div>
      )}

      {activeTab === 'products' && canAccessProducts && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-16">
          <div className="space-y-6">
            <div className="flex flex-col md:flex-row justify-between items-center mb-8 gap-4 px-4">
              <div className="flex items-center gap-4">
                <h3 className="text-3xl font-black flex items-center gap-4"><Package size={28}/> Catálogo</h3>
                <div className="relative">
                  <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500" />
                  <input 
                    type="text" 
                    placeholder="Buscar produto..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="glass pl-12 pr-6 py-3 rounded-2xl text-xs font-bold border-white/10 outline-none w-64 focus:border-primary transition-all"
                  />
                </div>
              </div>
              {canAddProduct && (
                <button onClick={() => setEditingProduct({ id: createId(), name: '', price: 0, categoryId: categories[0]?.id || '', image: '', visible: true, modifierGroups: [] })} className="p-3 bg-primary text-white rounded-xl hover:scale-105 transition-all"><Plus size={20}/></button>
              )}
            </div>
            <div className="glass rounded-[3rem] border-white/5 overflow-hidden max-h-[60vh] overflow-y-auto custom-scrollbar">
              {categories.map((cat) => {
                const items = menu.filter(p => p.categoryId === cat.id);
                const filteredItems = items.filter((p: any) => p.name.toLowerCase().includes(searchTerm.toLowerCase()));
                if (filteredItems.length === 0 && (items.length > 0 || !searchTerm)) return null;
                if (items.length === 0) return null;
                return (
                  <div key={cat.id}>
                    <div className="bg-white/5 px-8 py-4 border-y border-white/5 flex justify-between items-center">
                      <h4 className="text-xs font-black uppercase tracking-widest text-primary">{cat.name}</h4>
                      {!cat.visible && <span className="text-[9px] font-black uppercase text-gray-500 bg-white/5 px-2 py-0.5 rounded">Invisível</span>}
                    </div>
                    {filteredItems.map((p: any) => (
                      <div key={p.id} className={`flex items-center justify-between p-8 border-b border-white/5 hover:bg-white/[0.02] transition-all group ${!p.visible ? 'opacity-40 grayscale' : ''}`}>
                        <div className="flex items-center gap-6">
                          <div className="relative">
                            <img src={getImageSrc(p.image)} className="w-20 h-20 rounded-2xl object-cover shadow-2xl border border-white/5" />
                            {!p.visible && <div className="absolute inset-0 bg-black/60 rounded-2xl flex items-center justify-center"><EyeOff size={20} className="text-white/40" /></div>}
                          </div>
                          <div>
                            <p className="font-black text-xl tracking-tight">{p.name}</p>
                            <div className="flex items-center gap-3 mt-1">
                              <span className="text-xs font-black text-gray-400">R$ {typeof p.price === 'number' ? p.price.toFixed(2) : p.price}</span>
                              {p.cost > 0 && <span className="px-2 py-0.5 bg-emerald-500/10 text-emerald-500 rounded text-[9px] font-black uppercase">Lucro R$ {(p.price - p.cost).toFixed(2)}</span>}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-3 opacity-0 group-hover:opacity-100 transition-all">
                          {canToggleVisibility && (
                            <button 
                              onClick={() => toggleProductVisibility(p.id)}
                              className={`p-4 glass rounded-2xl transition-all ${p.visible ? 'text-emerald-400' : 'text-gray-500'}`}
                              title={p.visible ? 'Ocultar do Cardápio' : 'Mostrar no Cardápio'}
                            >
                              {p.visible ? <Eye size={20}/> : <EyeOff size={20}/>}
                            </button>
                          )}
                          {canEditProductPrice && (
                            <>
                              <button onClick={() => setSchedulingItem({ type: 'product', id: p.id, name: p.name, config: p.schedule })} className={`p-4 glass rounded-2xl ${p.schedule?.enabled ? 'text-accent' : 'text-gray-500'}`}><Clock size={20}/></button>
                              <button onClick={() => setEditingProduct(p)} className="p-4 glass rounded-2xl text-primary"><Settings size={20}/></button>
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
                  <h3 className="text-3xl font-black">Editar Produto</h3>
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
                </div>
                <div className="space-y-8">
                  <ConfigInput label="Nome do Produto" value={editingProduct.name} onChange={(v) => setEditingProduct({...editingProduct, name: v})} placeholder="Ex: Suco de Laranja 400ml" />
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div className="space-y-2">
                      <label className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500 ml-1">Categoria</label>
                      <div className="relative group">
                        <select 
                          value={editingProduct.categoryId} 
                          onChange={(e) => setEditingProduct({...editingProduct, categoryId: e.target.value})}
                          className="w-full bg-white/[0.03] p-4 rounded-2xl border border-white/5 outline-none font-bold text-sm transition-all appearance-none cursor-pointer hover:bg-white/[0.05] focus:border-primary/40"
                        >
                          {categories.map(c => <option key={c.id} value={c.id} className="bg-[#0a0a0c]">{c.name}</option>)}
                        </select>
                        <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-zinc-600 group-hover:text-primary transition-colors">
                           <LayoutDashboard size={16} />
                        </div>
                      </div>
                    </div>
                    <ConfigInput label="Preço" type="number" value={editingProduct.price} onChange={(v) => setEditingProduct({...editingProduct, price: v})} placeholder="0,00" />
                    <ConfigInput label="Custo" type="number" value={editingProduct.cost || 0} onChange={(v) => setEditingProduct({...editingProduct, cost: v})} placeholder="0,00" />
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
                              const currentGroups = editingProduct.modifierGroups || [];
                              const newGroups = isLinked 
                                ? currentGroups.filter(g => g.id !== mg.id)
                                : [...currentGroups, mg];
                              setEditingProduct({ ...editingProduct, modifierGroups: newGroups });
                            }}
                            className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${isLinked ? 'bg-primary text-white' : 'glass text-gray-500'}`}
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
                          const compressed = await compressImage(file);
                          setEditingProduct({ ...editingProduct, image: compressed });
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
                  <ConfigInput label="Descrição" value={editingProduct.description || ''} onChange={(v) => setEditingProduct({...editingProduct, description: v})} />
                  <div className="grid grid-cols-2 gap-4">
                    <ConfigInput label="Código ERP" value={editingProduct.erpCode || ''} onChange={(v) => setEditingProduct({...editingProduct, erpCode: v})} placeholder="Ex: PRD-001" />
                    <ConfigInput label="ID Estoque Remoto" value={editingProduct.remoteStockId || ''} onChange={(v) => setEditingProduct({...editingProduct, remoteStockId: v})} placeholder="Ex: stock_abc" />
                  </div>
                  <div className="relative group">
                    <ConfigInput label="Ou cole a URL da Imagem" value={editingProduct.image || ''} onChange={(v) => setEditingProduct({...editingProduct, image: v})} />
                  </div>
                  {(canAddProduct || canEditProductPrice) && (
                  <button 
                    onClick={async () => { 
                      try {
                        const cleanProduct = {
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
                          <div key={m.id || idx} className="flex items-center gap-4 p-4 glass rounded-2xl border-white/5 hover:border-white/10 transition-all">
                            <input 
                              value={m.name} 
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
                                value={m.price} 
                                onChange={(e) => {
                                  const newMods = [...group.modifiers];
                                  newMods[idx] = { ...m, price: Number(e.target.value) || 0 };
                                  updateModifierGroup(group.id, { modifiers: newMods });
                                }}
                                className="w-20 bg-transparent outline-none font-bold text-sm text-right"
                              />
                            </div>
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
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-16">
          <SectionCard title="Adicionar Novo Operador" icon={Plus}>
            <div className="grid grid-cols-2 gap-6">
               <ConfigInput label="Nome Completo" value={newSellerName} onChange={setNewSellerName} />
               <ConfigInput label="PIN (4 dígitos)" value={newSellerPin} onChange={setNewSellerPin} />
               <div className="space-y-3">
                  <label className="text-[10px] font-black uppercase tracking-widest text-gray-500 ml-1">Cargo</label>
                  <select value={newSellerRole} onChange={(e) => setNewSellerRole(e.target.value as any)} className="w-full glass p-5 rounded-2xl border-white/10 outline-none font-bold text-sm bg-transparent">
                     <option value="garçom" className="bg-[#0a0a0c]">Garçom</option>
                     <option value="atendente" className="bg-[#0a0a0c]">Atendente</option>
                     <option value="gerente" className="bg-[#0a0a0c]">Gerente</option>
                  </select>
               </div>
               <div className="space-y-3">
                  <label className="text-[10px] font-black uppercase tracking-widest text-gray-500 ml-1">Permissão</label>
                  <select value={newSellerPermission} onChange={(e) => setNewSellerPermission(e.target.value as any)} className="w-full glass p-5 rounded-2xl border-white/10 outline-none font-bold text-sm bg-transparent">
                     <option value="admin" className="bg-[#0a0a0c]">Admin full access</option>
                     <option value="manager" className="bg-[#0a0a0c]">Gerente</option>
                     <option value="operator" className="bg-[#0a0a0c]">Operador</option>
                  </select>
               </div>
            </div>
            <button onClick={async () => { await addSeller({ id: createId(), name: newSellerName, role: newSellerRole, permission: newSellerPermission, pin: newSellerPin, status: 'active' }); setNewSellerName(''); setNewSellerPin('1234'); }} className="w-full btn-beco btn-beco-purple py-6 font-black mt-4">Registrar Vendedor</button>
          </SectionCard>

          <SectionCard title="Equipe Ativa" icon={User}>
            <div className="space-y-4">
               {sellers.map((s: any) => (
                 <div key={s.id} className="flex items-center justify-between p-6 glass rounded-2xl border-white/5">
                    <div className="flex items-center gap-6">
                       <div className="w-12 h-12 bg-white/10 rounded-xl flex items-center justify-center font-black">{s.name.charAt(0)}</div>
                       <div><p className="font-black text-lg">{s.name}</p><p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">{s.role} • {s.permission}</p></div>
                    </div>
                    <div className="flex items-center gap-3">
                       <button onClick={() => toggleSellerStatus(s.id)} className={`px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest ${s.status === 'active' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'}`}>{s.status === 'active' ? 'Ativo' : 'Inativo'}</button>
                       <button onClick={() => deleteSeller(s.id)} className="p-3 glass rounded-xl text-rose-500"><Trash2 size={18}/></button>
                    </div>
                 </div>
               ))}
            </div>
          </SectionCard>
        </div>
      )}

      {activeTab === 'finance' && canViewSalesTotals && (
        <div className="space-y-10">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            <div className="glass-card p-8 border-white/5">
              <span className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">Total Fechado</span>
              <p className="text-4xl font-black text-emerald-400 mt-3">R$ {closedBillsTotal.toFixed(2)}</p>
              <p className="text-[10px] font-black uppercase tracking-widest text-zinc-600 mt-2">{closedBills.length} mesas fechadas</p>
            </div>
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
        <div className="glass rounded-[3rem] border-white/5 overflow-hidden">
           <table className="w-full text-left">
              <thead className="bg-white/5">
                 <tr className="text-[10px] font-black uppercase tracking-widest text-gray-500">
                    <th className="p-8">Horário</th>
                    <th className="p-8">Ação</th>
                    <th className="p-8">Mesa</th>
                    <th className="p-8">Detalhes</th>
                    <th className="p-8">Origem</th>
                    <th className="p-8">Autor</th>
                 </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                 {movements.map((m: any) => (
                   <tr key={m.id} className="hover:bg-white/[0.01] transition-all">
                      <td className="p-8 font-medium text-gray-400">{new Date(m.timestamp).toLocaleTimeString()}</td>
                      <td className="p-8"><span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase ${m.action === 'bill_closed' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-primary/10 text-primary'}`}>{m.action.replace('_', ' ')}</span></td>
                      <td className="p-8 font-black text-xl">{m.table}</td>
                      <td className="p-8 text-gray-300 font-medium">{m.details}</td>
                      <td className="p-8"><span className="text-[10px] font-black uppercase tracking-widest bg-white/10 px-2 py-1 rounded">{m.origin}</span></td>
                      <td className="p-8 font-black text-primary">{m.author}</td>
                   </tr>
                 ))}
              </tbody>
           </table>
        </div>
      )}
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
