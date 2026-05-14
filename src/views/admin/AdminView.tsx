import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Settings, Package, User, TrendingUp, Plus, Trash2, 
  CheckCircle, X, ChefHat, Image, LayoutDashboard, Sparkles, Clock, ArrowLeft,
  Eye, EyeOff, Search, GripVertical
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

import { ScheduleModal } from '../../components/modals/ScheduleModal';
import type { ScheduleConfig } from '../../types';

function SortableCategoryItem({ cat, menu, upsertCategory, deleteCategory, setSchedulingItem, toggleCategoryVisibility }: any) {
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

  return (
    <div 
      ref={setNodeRef} 
      style={style} 
      className="flex items-center justify-between p-8 border-b border-white/5 hover:bg-white/[0.02] transition-all group relative"
    >
      <div className="flex items-center gap-6">
        <div {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing p-2 hover:bg-white/5 rounded-lg transition-all text-gray-600 hover:text-primary">
          <GripVertical size={20} />
        </div>
        <div className="w-12 h-12 bg-white/5 rounded-xl flex items-center justify-center font-black text-primary">{cat.sortOrder}</div>
        <div>
          <p className="font-black text-lg">{cat.name}</p>
          <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">
            {menu.filter((p: any) => p.categoryId === cat.id).length} Produtos
          </p>
        </div>
      </div>
      <div className="flex items-center gap-4 opacity-0 group-hover:opacity-100 transition-all">
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
        <button onClick={() => {
          const newName = prompt('Novo nome da categoria:', cat.name);
          if (newName) upsertCategory({ ...cat, name: newName });
        }} className="p-4 glass rounded-xl text-primary"><Settings size={18}/></button>
        <button 
          onClick={() => {
            if (confirm(`Tem certeza que deseja excluir a categoria "${cat.name}"? Os produtos vinculados ficarão sem categoria.`)) {
              deleteCategory(cat.id);
            }
          }} 
          className="p-4 glass rounded-xl text-rose-500 hover:bg-rose-500/10"
        >
          <Trash2 size={18}/>
        </button>
      </div>
    </div>
  );
}

export function AdminView() {
  const { 
    menu, updateProduct, addProduct, deleteProduct,
    settings, updateSettings,
    sellers, addSeller, toggleSellerStatus, deleteSeller,
    categories, upsertCategory, modifierGroups, updateModifierGroup, deleteModifierGroup, addModifierGroup,
    adminTab, setAdminTab, adminMode, toggleProductVisibility, deleteCategory, reorderCategories, toggleCategoryVisibility
  } = useStore();

  const activeTab = adminTab;
  const setActiveTab = setAdminTab;
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);

  console.log("🛠️ AdminView Render - Tab:", activeTab);
  console.log("📦 Menu:", menu.length, "🏷️ Categories:", categories.length);
  console.log("⚙️ Settings:", settings);
  
  const [schedulingItem, setSchedulingItem] = useState<{ type: 'product' | 'category', id: string, name: string, config?: ScheduleConfig } | null>(null);

  const [newSellerName, setNewSellerName] = useState('');
  const [newSellerRole, setNewSellerRole] = useState<'garçom' | 'atendente' | 'gerente' | 'outro'>('garçom');
  const [newSellerPermission, setNewSellerPermission] = useState<'admin' | 'standard' | 'restricted'>('standard');
  const [newSellerPin, setNewSellerPin] = useState('1234');
  const [newModifierName, setNewModifierName] = useState('');
  const [newModifierPrice, setNewModifierPrice] = useState('');
  const [addingToGroup, setAddingToGroup] = useState<string | null>(null);

  const [movements, setMovements] = useState<any[]>([]);
  const [searchTerm, setSearchTerm] = useState('');

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

  const ConfigInput = ({ label, value, onChange, type = 'text', placeholder }: { label: string, value: any, onChange: (val: any) => void, type?: string, placeholder?: string }) => (
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
        <input 
          type={type === 'number' ? 'text' : type} 
          value={value} 
          placeholder={placeholder}
          onChange={(e) => {
            let val = e.target.value;
            if (type === 'number') {
              val = val.replace(/[^0-9,.]/g, '');
              onChange(val);
            } else {
              onChange(val);
            }
          }}
          className="w-full bg-white/[0.03] p-4 rounded-2xl border border-white/5 focus:border-primary/40 focus:bg-white/[0.05] outline-none font-bold text-sm transition-all placeholder:text-zinc-700"
        />
      )}
    </div>
  );

  const compressImage = (file: File): Promise<string> => {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new window.Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          let width = img.width;
          let height = img.height;
          const max = 800; // Resolução máxima para PDV/Tablet
          
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
          resolve(canvas.toDataURL('image/jpeg', 0.7)); // 70% qualidade JPEG
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
            <p className="text-gray-500 font-bold uppercase tracking-[0.4em] text-[10px] mt-3 ml-2 italic">Administração e Governança do PDV</p>
          </div>
        </div>
        <div className="flex glass p-2 rounded-[2rem] border-white/5">
          {[
            { id: 'config', name: 'Geral', icon: Settings },
            { id: 'categories', name: 'Categorias', icon: LayoutDashboard },
            { id: 'products', name: 'Produtos', icon: Package },
            { id: 'optionals', name: 'Opcionais', icon: Sparkles },
            { id: 'sellers', name: 'Equipe', icon: User },
            { id: 'movements', name: 'Auditoria', icon: TrendingUp },
          ]
          .filter(tab => {
            if (adminMode === 'menu') {
              return ['categories', 'products', 'optionals'].includes(tab.id);
            } else {
              return ['config', 'sellers', 'movements'].includes(tab.id);
            }
          })
          .map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id as any)} className={`px-8 py-4 rounded-[1.5rem] flex items-center gap-3 font-black text-xs uppercase tracking-widest transition-all ${activeTab === tab.id ? 'bg-primary text-white shadow-xl shadow-primary/20' : 'text-gray-500 hover:text-white'}`}>
              <tab.icon size={18}/> {tab.name}
            </button>
          ))}
        </div>
      </div>

      {activeTab === 'config' && (
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

      {activeTab === 'categories' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-16">
          <div className="space-y-6">
            <div className="flex justify-between items-center mb-8 px-4">
              <h3 className="text-3xl font-black flex items-center gap-4"><LayoutDashboard size={28}/> Categorias</h3>
              <button 
                onClick={() => upsertCategory({ id: Math.random().toString(36).substr(2, 9), name: 'Nova Categoria', sortOrder: categories.length })} 
                className="p-3 bg-primary text-white rounded-xl"
              >
                <Plus size={20}/>
              </button>
            </div>
            <div className="glass rounded-[3rem] border-white/5 overflow-hidden">
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
                      upsertCategory={upsertCategory} 
                      deleteCategory={deleteCategory}
                      setSchedulingItem={setSchedulingItem}
                      toggleCategoryVisibility={toggleCategoryVisibility}
                    />
                  ))}
                </SortableContext>
              </DndContext>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'products' && (
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
              <button onClick={() => setEditingProduct({ id: Math.random().toString(36).substr(2, 9), name: '', price: 0, categoryId: categories[0]?.id || '', image: '', visible: true, modifierGroups: [] })} className="p-3 bg-primary text-white rounded-xl hover:scale-105 transition-all"><Plus size={20}/></button>
            </div>
            <div className="glass rounded-[3rem] border-white/5 overflow-hidden max-h-[60vh] overflow-y-auto custom-scrollbar">
              {Object.entries(
                (menu || []).reduce((acc: Record<string, any[]>, p: any) => {
                  const catName = p.categoryName || p.category || 'Sem Categoria';
                  if (!acc[catName]) acc[catName] = [];
                  acc[catName].push(p);
                  return acc;
                }, {} as Record<string, any[]>)
              ).map(([category, items]) => (
                <div key={category}>
                  <div className="bg-white/5 px-8 py-4 border-y border-white/5">
                    <h4 className="text-xs font-black uppercase tracking-widest text-primary">{category}</h4>
                  </div>
                  {items
                    .filter((p: any) => p.name.toLowerCase().includes(searchTerm.toLowerCase()))
                    .map((p: any) => (
                    <div key={p.id} className={`flex items-center justify-between p-8 border-b border-white/5 hover:bg-white/[0.02] transition-all group ${!p.visible ? 'opacity-40 grayscale' : ''}`}>
                      <div className="flex items-center gap-6">
                        <div className="relative">
                          <img src={p.image} className="w-20 h-20 rounded-2xl object-cover shadow-2xl border border-white/5" />
                          {!p.visible && <div className="absolute inset-0 bg-black/60 rounded-2xl flex items-center justify-center"><EyeOff size={20} className="text-white/40" /></div>}
                        </div>
                        <div>
                          <p className="font-black text-xl tracking-tight">{p.name}</p>
                          <div className="flex items-center gap-3 mt-1">
                            <span className="text-xs font-black text-gray-400">R$ {p.price.toFixed(2)}</span>
                            {p.cost > 0 && <span className="px-2 py-0.5 bg-emerald-500/10 text-emerald-500 rounded text-[9px] font-black uppercase">Lucro R$ {(p.price - p.cost).toFixed(2)}</span>}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 opacity-0 group-hover:opacity-100 transition-all">
                        <button 
                          onClick={() => toggleProductVisibility(p.id)}
                          className={`p-4 glass rounded-2xl transition-all ${p.visible ? 'text-emerald-400' : 'text-gray-500'}`}
                          title={p.visible ? 'Ocultar do Cardápio' : 'Mostrar no Cardápio'}
                        >
                          {p.visible ? <Eye size={20}/> : <EyeOff size={20}/>}
                        </button>
                        <button onClick={() => setSchedulingItem({ type: 'product', id: p.id, name: p.name, config: p.schedule })} className={`p-4 glass rounded-2xl ${p.schedule?.enabled ? 'text-accent' : 'text-gray-500'}`}><Clock size={20}/></button>
                        <button onClick={() => setEditingProduct(p)} className="p-4 glass rounded-2xl text-primary"><Settings size={20}/></button>
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>

          <AnimatePresence>
            {editingProduct && (
              <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="glass-card p-12 border-primary/20 sticky top-12 h-fit shadow-2xl shadow-primary/10 overflow-hidden">
                <div className="flex justify-between items-start mb-10">
                  <h3 className="text-3xl font-black">Editar Produto</h3>
                  <button 
                    onClick={() => setEditingProduct({...editingProduct, visible: !editingProduct.visible})}
                    className={`flex items-center gap-2 px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${editingProduct.visible ? 'bg-emerald-500/10 text-emerald-500' : 'bg-rose-500/10 text-rose-500'}`}
                  >
                    {editingProduct.visible ? <><Eye size={14}/> Visível</> : <><EyeOff size={14}/> Oculto</>}
                  </button>
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
                          <img src={editingProduct.image} className="absolute inset-0 w-full h-full object-cover opacity-40" />
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
                  <button 
                    onClick={async () => { 
                      try {
                        const cleanProduct = {
                          ...editingProduct,
                          // Normalização de Números (Lida com vírgula e ponto)
                          price: typeof editingProduct.price === 'string' 
                            ? parseFloat(String(editingProduct.price).replace(',', '.')) || 0 
                            : Number(editingProduct.price) || 0,
                          cost: typeof editingProduct.cost === 'string'
                            ? parseFloat(String(editingProduct.cost).replace(',', '.')) || 0
                            : Number(editingProduct.cost) || 0,
                          // Normalização de Strings (Evita null)
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
                      }
                    }} 
                    className="w-full btn-beco btn-beco-purple py-6 font-black shadow-xl shadow-primary/20 hover:scale-[1.02] active:scale-95 transition-all"
                  >
                    SALVAR ALTERAÇÕES
                  </button>

                  <div className="pt-6 border-t border-white/5 flex flex-col items-center gap-4">
                    <button 
                      onClick={() => {
                        const pin = prompt('Esta é uma ação crítica. Digite o PIN de Administrador para excluir este produto:');
                        if (pin === '0806') {
                          if (confirm(`Tem certeza que deseja excluir permanentemente o produto "${editingProduct.name}"?`)) {
                            deleteProduct(editingProduct.id);
                            setEditingProduct(null);
                          }
                        } else if (pin !== null) {
                          alert('PIN incorreto. Apenas Administradores podem excluir produtos.');
                        }
                      }}
                      className="text-[10px] font-black text-rose-500/40 hover:text-rose-500 uppercase tracking-[0.2em] transition-all flex items-center gap-2"
                    >
                      <Trash2 size={12} /> Excluir Produto do Cardápio
                    </button>
                    <p className="text-[9px] text-zinc-700 font-bold uppercase italic">Ação irreversível • Requer autorização nível Admin</p>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {activeTab === 'optionals' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-16">
          <div className="space-y-6">
            <div className="flex justify-between items-center mb-8 px-4">
              <h3 className="text-3xl font-black flex items-center gap-4"><Sparkles size={28}/> Grupos de Opcionais</h3>
              <button 
                onClick={() => addModifierGroup({ id: Math.random().toString(36).substr(2, 9), name: 'Novo Grupo', minChoices: 0, maxChoices: 1, isRequired: false, status: 'active', modifiers: [] })}
                className="p-3 bg-primary text-white rounded-xl"
              >
                <Plus size={20}/>
              </button>
            </div>
            <div className="glass rounded-[3rem] border-white/5 overflow-hidden">
              {(modifierGroups || []).map((group) => (
                <div key={group.id} className="p-8 border-b border-white/5 hover:bg-white/[0.02] transition-all group">
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <h4 className="font-black text-xl">{group.name}</h4>
                      <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">
                        {group.isRequired ? 'Obrigatório' : 'Opcional'} • {group.minChoices} a {group.maxChoices} escolhas
                      </p>
                    </div>
                    <div className="flex gap-2">
                       <button onClick={() => deleteModifierGroup(group.id)} className="p-3 glass rounded-xl text-rose-500"><Trash2 size={16}/></button>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {group.modifiers.map((m, idx) => (
                      <span key={idx} className="px-3 py-1 bg-white/5 rounded-lg text-[10px] font-bold border border-white/5 flex items-center gap-2">
                        {m.name} (+R$ {m.price.toFixed(2)})
                        <button onClick={() => {
                          const newModifiers = group.modifiers.filter((_, i) => i !== idx);
                          updateModifierGroup(group.id, { modifiers: newModifiers });
                        }} className="text-rose-500 hover:text-rose-400">×</button>
                      </span>
                    ))}
                  </div>
                  <div className="mt-4 flex gap-2">
                    {addingToGroup === group.id ? (
                      <div className="flex gap-2 w-full animate-in slide-in-from-top-2 duration-300">
                        <input 
                          autoFocus
                          placeholder="Nome..." 
                          value={newModifierName} 
                          onChange={(e) => setNewModifierName(e.target.value)}
                          className="flex-1 glass px-4 py-2 rounded-xl text-xs font-bold border-white/10 outline-none"
                        />
                        <input 
                          placeholder="R$..." 
                          value={newModifierPrice} 
                          onChange={(e) => setNewModifierPrice(e.target.value)}
                          className="w-20 glass px-4 py-2 rounded-xl text-xs font-bold border-white/10 outline-none"
                        />
                        <button 
                          onClick={() => {
                            if (newModifierName) {
                              const newModifiers = [...group.modifiers, { id: Math.random().toString(36).substr(2, 9), name: newModifierName, price: Number(newModifierPrice) || 0, status: 'active' as const }];
                              updateModifierGroup(group.id, { modifiers: newModifiers });
                              setNewModifierName('');
                              setNewModifierPrice('');
                              setAddingToGroup(null);
                            }
                          }}
                          className="px-4 py-2 bg-primary text-white rounded-xl text-[10px] font-black uppercase"
                        >
                          OK
                        </button>
                        <button onClick={() => setAddingToGroup(null)} className="px-4 py-2 glass rounded-xl text-[10px] font-black uppercase">Cancelar</button>
                      </div>
                    ) : (
                      <button 
                        onClick={() => setAddingToGroup(group.id)}
                        className="px-3 py-1 bg-primary/10 text-primary rounded-lg text-[10px] font-black border border-primary/20 hover:bg-primary/20 transition-all"
                      >
                        + Add Opção
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'sellers' && (
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
                     <option value="standard" className="bg-[#0a0a0c]">Padrão</option>
                     <option value="admin" className="bg-[#0a0a0c]">Administrador</option>
                     <option value="restricted" className="bg-[#0a0a0c]">Restrito</option>
                  </select>
               </div>
            </div>
            <button onClick={async () => { await addSeller({ id: Math.random().toString(36).substr(2, 9), name: newSellerName, role: newSellerRole, permission: newSellerPermission, pin: newSellerPin, status: 'active' }); setNewSellerName(''); setNewSellerPin('1234'); }} className="w-full btn-beco btn-beco-purple py-6 font-black mt-4">Registrar Vendedor</button>
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

      {activeTab === 'movements' && (
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
