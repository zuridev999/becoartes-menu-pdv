import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { Search, ChevronRight, Plus, Utensils } from 'lucide-react';
import { useStore, type Product } from '../../store';
import { isItemAvailable } from '../../lib/utils';
import { applyImageFallback, getImageSrc } from '../../lib/image';

interface MenuCatalogProps {
  onProductSelect: (product: Product) => void;
  viewMode?: 'grid' | 'list';
  navigationMode?: 'sidebar' | 'menu' | 'continuous';
  surface?: 'default' | 'delivery';
  footerContent?: ReactNode;
}

export function MenuCatalog({ onProductSelect, viewMode = 'grid', navigationMode = 'sidebar', surface = 'default', footerContent }: MenuCatalogProps) {
  const { menu, categories: dbCategories } = useStore();
  const availableCategories = useMemo(() => dbCategories
    .filter(c => {
      if (c.visible === false) return false;
      const { available } = isItemAvailable(c.schedule);
      if (!available && c.schedule?.hideTotally) return false;
      return true;
    })
    .sort((a, b) => Number(a.sortOrder ?? 0) - Number(b.sortOrder ?? 0)),
  [dbCategories]);
  const availableCategoryNames = useMemo(() => availableCategories.map(c => c.name), [availableCategories]);
  const categoryOrder = useMemo(
    () => new Map(availableCategories.map((category, index) => [category.id, Number(category.sortOrder ?? index)])),
    [availableCategories]
  );

  const [selectedCategory, setSelectedCategory] = useState(availableCategoryNames[0] || '');
  const [searchQuery, setSearchQuery] = useState('');
  const categorySectionRefs = useRef<Record<string, HTMLElement | null>>({});

  useEffect(() => {
    if (availableCategoryNames.length === 0) {
      setSelectedCategory('');
      return;
    }
    if (!selectedCategory || !availableCategoryNames.includes(selectedCategory)) {
      setSelectedCategory(availableCategoryNames[0]);
    }
  }, [availableCategoryNames, selectedCategory]);

  const productCountByCategory = useMemo(() => {
    const counts = new Map<string, number>();
    for (const product of menu) {
      if (!product.visible) continue;
      if (surface === 'delivery' && product.deliveryVisible === false) continue;
      const cat = dbCategories.find(c => c.id === product.categoryId);
      if (cat) {
        const { available: catAvailable } = isItemAvailable(cat.schedule);
        if (!catAvailable && cat.schedule?.hideTotally) continue;
      }
      const { available } = isItemAvailable(product.schedule);
      if (!available && product.schedule?.hideTotally) continue;
      const categoryName = product.categoryName || cat?.name || '';
      if (!categoryName) continue;
      counts.set(categoryName, (counts.get(categoryName) || 0) + 1);
    }
    return counts;
  }, [dbCategories, menu, surface]);

  const visibleMenu = useMemo(() => menu
    .filter(p => {
      if (!p.visible) return false;
      if (surface === 'delivery' && p.deliveryVisible === false) return false;
      
      // Check Category Schedule
      const cat = dbCategories.find(c => c.id === p.categoryId);
      if (cat) {
        const { available: catAvailable } = isItemAvailable(cat.schedule);
        if (!catAvailable && cat.schedule?.hideTotally) return false;
      }

      // Check Product Schedule
      const { available } = isItemAvailable(p.schedule);
      if (!available && p.schedule?.hideTotally) return false;

      return p.name.toLowerCase().includes(searchQuery.toLowerCase()) || (p.description || '').toLowerCase().includes(searchQuery.toLowerCase());
    })
    .map((product, index) => ({ product, index }))
    .sort((a, b) => {
      const categoryDiff = (categoryOrder.get(a.product.categoryId) ?? 9999) - (categoryOrder.get(b.product.categoryId) ?? 9999);
      if (categoryDiff !== 0) return categoryDiff;
      const orderDiff = Number(a.product.sortOrder ?? 0) - Number(b.product.sortOrder ?? 0);
      if (orderDiff !== 0) return orderDiff;
      return a.index - b.index;
    })
    .map(({ product }) => product),
  [categoryOrder, dbCategories, menu, searchQuery, surface]);

  const filteredMenu = visibleMenu.filter(p => p.categoryName === selectedCategory);
  const menuByCategory = useMemo(() => {
    return availableCategoryNames.map(category => ({
      category,
      products: visibleMenu.filter(product => product.categoryName === category),
    })).filter(group => group.products.length > 0);
  }, [availableCategoryNames, visibleMenu]);

  const handleCategorySelect = (category: string) => {
    setSelectedCategory(category);
    if (navigationMode === 'continuous') {
      categorySectionRefs.current[category]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else {
      setSearchQuery('');
    }
  };

  const isContinuousMenu = navigationMode === 'continuous';
  const gridClassName = "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-8 pb-4";
  const productCardClassName = isContinuousMenu
    ? "glass-card flex flex-col p-3.5 sm:p-4 md:p-6 border-white/5 hover:border-primary/30 group transition-all text-left active:scale-[0.98]"
    : "glass-card flex flex-col p-4 md:p-6 border-white/5 hover:border-primary/30 group transition-all text-left active:scale-[0.98]";
  const productImageClassName = isContinuousMenu
    ? "relative aspect-[4/3] sm:aspect-auto sm:h-48 md:h-64 mb-4 md:mb-6 rounded-2xl md:rounded-3xl overflow-hidden bg-zinc-950"
    : "relative h-40 sm:h-48 md:h-64 mb-4 md:mb-6 rounded-2xl md:rounded-3xl overflow-hidden";
  const renderGridProduct = (p: Product) => (
    <motion.button layout key={p.id} onClick={() => onProductSelect(p)} className={productCardClassName}>
      <div className={productImageClassName}>
        <img src={getImageSrc(p.image)} onError={applyImageFallback} className="w-full h-full object-cover object-center group-hover:scale-110 transition-all duration-500" />
        <div className="absolute top-3 right-3 md:top-4 md:right-4 bg-black/60 backdrop-blur-xl px-3 md:px-4 py-2 rounded-xl font-black text-accent border border-white/10 text-sm md:text-base">R$ {p.price.toFixed(2)}</div>
      </div>
      <h4 className="font-black text-xl md:text-2xl mb-2 italic tracking-tighter leading-none">{p.name}</h4>
      <p className="text-gray-500 font-bold text-xs md:text-sm line-clamp-2 leading-relaxed">{p.description}</p>
    </motion.button>
  );

  return (
    <div className={`flex h-full min-h-0 overflow-hidden ${navigationMode === 'menu' || navigationMode === 'continuous' ? 'flex-col' : 'max-md:flex-col'}`}>
      {/* Sidebar de Categorias */}
      <div className={`${navigationMode === 'menu' || navigationMode === 'continuous' ? 'w-full shrink-0 glass border-b border-white/5 pt-3 sm:pt-5 pb-3 px-3 sm:px-5 z-30' : 'w-full md:w-72 shrink-0 glass border-b md:border-b-0 md:border-r border-white/5 flex flex-col pt-3 md:pt-10 pb-3 md:pb-8 px-3 md:px-4 z-30'}`}>
        {(navigationMode === 'menu' || navigationMode === 'continuous') && (
          <div className="flex items-center gap-3 mb-3 px-1">
            <div className="w-9 h-9 rounded-2xl bg-primary/15 text-primary flex items-center justify-center">
              <Utensils size={17} />
            </div>
            <div>
              <p className="text-[8px] font-black uppercase tracking-[0.28em] text-primary">Menu do cardápio</p>
              <p className="text-xs font-bold text-gray-500">
                {navigationMode === 'continuous' ? 'Role o cardápio inteiro ou toque para pular até uma categoria.' : 'Toque em uma categoria para ver só aqueles itens.'}
              </p>
            </div>
          </div>
        )}
        <div className={`${navigationMode === 'menu' || navigationMode === 'continuous' ? 'flex flex-nowrap gap-2 overflow-x-auto custom-scrollbar pb-1' : 'flex md:flex-col flex-nowrap md:flex-1 gap-2 md:gap-3 overflow-x-auto md:overflow-y-auto md:pr-2 custom-scrollbar'}`}>
          {availableCategoryNames.map(cat => (
            <button 
              key={cat} 
              onClick={() => handleCategorySelect(cat)} 
              className={`shrink-0 ${navigationMode === 'menu' || navigationMode === 'continuous' ? 'min-w-[9.5rem] max-w-[12rem] px-4 py-3 rounded-2xl' : 'md:w-full px-4 py-3 md:p-6 rounded-2xl md:rounded-[2rem]'} text-left transition-all flex items-center justify-between gap-3 group ${selectedCategory === cat ? 'bg-gradient-to-br from-primary to-purple-600 text-white shadow-2xl md:scale-[1.05]' : 'text-gray-500 hover:bg-white/5'}`}
            >
              <div>
                <p className={`font-black text-[8px] md:text-[10px] uppercase tracking-widest ${selectedCategory === cat ? 'text-white/70' : 'text-primary'}`}>
                  {productCountByCategory.get(cat) || 0} itens
                </p>
                <h4 className="font-black text-sm md:text-lg tracking-tighter italic whitespace-nowrap">{cat}</h4>
              </div>
              <ChevronRight size={18} className={`${navigationMode === 'menu' || navigationMode === 'continuous' ? 'hidden' : 'hidden md:block'} ${selectedCategory === cat ? 'opacity-100' : 'opacity-0'}`} />
            </button>
          ))}
        </div>
      </div>

      {/* Grid de Produtos */}
      <div className={`flex-1 min-h-0 ${navigationMode === 'menu' || navigationMode === 'continuous' ? 'p-4 sm:p-6 lg:p-10' : 'p-4 sm:p-8 lg:p-12'} overflow-y-auto custom-scrollbar bg-white/[0.01]`}>
         <div className={`flex flex-col md:flex-row md:justify-between md:items-center gap-4 ${navigationMode === 'menu' || navigationMode === 'continuous' ? 'mb-5 sm:mb-8' : 'mb-6 md:mb-16'}`}>
            <div className="min-w-0">
              <h3 className="text-4xl sm:text-5xl lg:text-6xl font-black tracking-tighter italic leading-none truncate">{navigationMode === 'continuous' ? 'Cardápio' : selectedCategory}</h3>
              <p className="text-primary font-black uppercase tracking-[0.28em] md:tracking-[0.5em] text-[9px] md:text-[10px] mt-2">
                {navigationMode === 'continuous'
                  ? `${visibleMenu.length} ${visibleMenu.length === 1 ? 'item' : 'itens'} em todas as categorias`
                  : `${filteredMenu.length} ${filteredMenu.length === 1 ? 'item' : 'itens'} nesta categoria`}
              </p>
            </div>
            <div className="relative w-full md:w-96">
               <input 
                type="text" 
                placeholder="Pesquisar..." 
                value={searchQuery} 
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === '0044') {
                    window.dispatchEvent(new CustomEvent('beco-fullscreen', { detail: 'request' }));
                    setSearchQuery('');
                    return;
                  }
                  if (val === '0040') {
                    window.dispatchEvent(new CustomEvent('beco-fullscreen', { detail: 'exit' }));
                    setSearchQuery('');
                    return;
                  }
                  setSearchQuery(val);
                }} 
                className="w-full glass p-4 md:p-6 pl-12 md:pl-14 rounded-2xl md:rounded-3xl border-white/10 text-base md:text-xl font-bold focus:border-primary outline-none transition-all" 
               />
               <Search className="absolute left-4 md:left-6 top-1/2 -translate-y-1/2 text-gray-500" size={20} />
            </div>
         </div>

         {navigationMode === 'continuous' && viewMode === 'grid' ? (
           <div className="space-y-10 pb-4">
             {menuByCategory.map(({ category, products }) => (
               <section
                 key={category}
                 ref={(node) => { categorySectionRefs.current[category] = node; }}
                 className="scroll-mt-6"
               >
                 <div className="mb-4">
                   <p className="text-[9px] font-black uppercase tracking-[0.35em] text-primary">{products.length} itens</p>
                   <h4 className="text-3xl sm:text-4xl font-black italic tracking-tighter">{category}</h4>
                 </div>
                 <div className={gridClassName}>
                   {products.map(renderGridProduct)}
                 </div>
               </section>
             ))}
           </div>
         ) : viewMode === 'grid' ? (
           <div className={gridClassName}>
             {filteredMenu.map(renderGridProduct)}
           </div>
         ) : (
           <div className="space-y-6">
             {filteredMenu.map(p => (
               <motion.button layout key={p.id} onClick={() => onProductSelect(p)} className="glass-card flex items-center p-6 border-white/5 hover:border-primary/30 group transition-all w-full text-left">
                 <div className="w-48 h-48 rounded-3xl overflow-hidden mr-8"><img src={getImageSrc(p.image)} onError={applyImageFallback} className="w-full h-full object-cover group-hover:scale-110 transition-all duration-500" /></div>
                 <div className="flex-1">
                   <h4 className="font-black text-3xl mb-3 italic tracking-tighter">{p.name}</h4>
                   <p className="text-gray-500 font-bold text-lg leading-relaxed max-w-2xl">{p.description}</p>
                 </div>
                 <div className="text-right">
                   <p className="text-accent font-black text-4xl tracking-tighter mb-4">R$ {p.price.toFixed(2)}</p>
                   <div className="btn-beco btn-beco-purple px-8 py-3 rounded-2xl flex items-center gap-3">
                     <Plus size={20} /> <span className="font-black">ADICIONAR</span>
                   </div>
                 </div>
               </motion.button>
             ))}
           </div>
         )}
         {footerContent && (
           <div className="pt-8 pb-10">
             {footerContent}
           </div>
         )}
      </div>
    </div>
  );
}
