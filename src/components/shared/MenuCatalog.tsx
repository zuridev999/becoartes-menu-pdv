import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Search, ChevronRight, Plus } from 'lucide-react';
import { useStore, type Product } from '../../store';
import { isItemAvailable } from '../../lib/utils';
import { applyImageFallback, getImageSrc } from '../../lib/image';

interface MenuCatalogProps {
  onProductSelect: (product: Product) => void;
  viewMode?: 'grid' | 'list';
  scrollSpyCategories?: boolean;
}

export function MenuCatalog({ onProductSelect, viewMode = 'grid', scrollSpyCategories = false }: MenuCatalogProps) {
  const { menu, categories: dbCategories } = useStore();
  const availableCategories = dbCategories.filter(c => {
    if (c.visible === false) return false;
    const { available } = isItemAvailable(c.schedule);
    if (!available && c.schedule?.hideTotally) return false;
    return true;
  }).map(c => c.name);

  const [selectedCategory, setSelectedCategory] = useState(availableCategories[0] || '');
  const [searchQuery, setSearchQuery] = useState('');
  const scrollRootRef = useRef<HTMLDivElement | null>(null);
  const categorySectionRefs = useRef<Record<string, HTMLElement | null>>({});

  useEffect(() => {
    if (!availableCategories.length) return;
    if (!selectedCategory || !availableCategories.includes(selectedCategory)) {
      setSelectedCategory(availableCategories[0]);
    }
  }, [availableCategories, selectedCategory]);

  const visibleMenu = useMemo(() => menu.filter(p => {
    if (!p.visible) return false;
    if (p.remoteStockId && typeof p.stockQuantity === 'number' && p.stockQuantity <= 0) return false;
    
    // Check Category Schedule
    const cat = dbCategories.find(c => c.id === p.categoryId);
    if (cat) {
      const { available: catAvailable } = isItemAvailable(cat.schedule);
      if (!catAvailable && cat.schedule?.hideTotally) return false;
    }

    // Check Product Schedule
    const { available } = isItemAvailable(p.schedule);
    if (!available && p.schedule?.hideTotally) return false;

    return (p.categoryName === selectedCategory) &&
           (p.name.toLowerCase().includes(searchQuery.toLowerCase()) || (p.description || '').toLowerCase().includes(searchQuery.toLowerCase()));
  }), [dbCategories, menu, searchQuery, selectedCategory]);

  const scrollSpyMenu = useMemo(() => menu.filter(p => {
    if (!p.visible) return false;
    if (p.remoteStockId && typeof p.stockQuantity === 'number' && p.stockQuantity <= 0) return false;

    const cat = dbCategories.find(c => c.id === p.categoryId);
    if (cat) {
      const { available: catAvailable } = isItemAvailable(cat.schedule);
      if (!catAvailable && cat.schedule?.hideTotally) return false;
    }

    const { available } = isItemAvailable(p.schedule);
    if (!available && p.schedule?.hideTotally) return false;

    return p.name.toLowerCase().includes(searchQuery.toLowerCase())
      || (p.description || '').toLowerCase().includes(searchQuery.toLowerCase());
  }), [dbCategories, menu, searchQuery]);

  const productsByCategory = useMemo(() => availableCategories.map(category => ({
    category,
    products: scrollSpyMenu.filter(product => product.categoryName === category),
  })).filter(group => group.products.length > 0), [availableCategories, scrollSpyMenu]);

  useEffect(() => {
    if (!scrollSpyCategories || searchQuery.trim()) return;

    const root = scrollRootRef.current;
    if (!root) return;

    const observer = new IntersectionObserver((entries) => {
      const visibleEntry = entries
        .filter(entry => entry.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];

      const category = visibleEntry?.target.getAttribute('data-category');
      if (category) setSelectedCategory(category);
    }, {
      root,
      threshold: [0.18, 0.32, 0.5],
      rootMargin: '-18% 0px -55% 0px',
    });

    Object.values(categorySectionRefs.current).forEach(section => {
      if (section) observer.observe(section);
    });

    return () => observer.disconnect();
  }, [productsByCategory, scrollSpyCategories, searchQuery]);

  const handleCategoryClick = (category: string) => {
    setSelectedCategory(category);
    if (scrollSpyCategories) {
      categorySectionRefs.current[category]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  return (
    <div className="flex h-full min-h-0 overflow-hidden max-md:flex-col">
      {/* Sidebar de Categorias */}
      <div className="w-full md:w-72 shrink-0 glass border-b md:border-b-0 md:border-r border-white/5 flex flex-col pt-3 md:pt-10 pb-3 md:pb-8 px-3 md:px-4 z-30">
        <div className="flex md:flex-col flex-nowrap md:flex-1 gap-2 md:gap-3 overflow-x-auto md:overflow-y-auto md:pr-2 custom-scrollbar">
          {availableCategories.map(cat => (
            <button 
              key={cat} 
              onClick={() => handleCategoryClick(cat)} 
              className={`shrink-0 md:w-full px-4 py-3 md:p-6 rounded-2xl md:rounded-[2rem] text-left transition-all flex items-center justify-between gap-3 group ${selectedCategory === cat ? 'bg-gradient-to-br from-primary to-purple-600 text-white shadow-2xl md:scale-[1.05]' : 'text-gray-500 hover:bg-white/5'}`}
            >
              <div>
                <p className={`font-black text-[8px] md:text-[10px] uppercase tracking-widest ${selectedCategory === cat ? 'text-white/70' : 'text-primary'}`}>
                  Categoria
                </p>
                <h4 className="font-black text-sm md:text-lg tracking-tighter italic whitespace-nowrap">{cat}</h4>
              </div>
              <ChevronRight size={18} className={`hidden md:block ${selectedCategory === cat ? 'opacity-100' : 'opacity-0'}`} />
            </button>
          ))}
        </div>
      </div>

      {/* Grid de Produtos */}
      <div ref={scrollRootRef} className="flex-1 min-h-0 p-4 sm:p-8 lg:p-12 overflow-y-auto custom-scrollbar bg-white/[0.01] scroll-smooth">
         <div className="flex flex-col md:flex-row md:justify-between md:items-center gap-4 mb-6 md:mb-16">
            <div className="min-w-0">
              <h3 className="text-4xl sm:text-5xl lg:text-6xl font-black tracking-tighter italic leading-none truncate">{selectedCategory}</h3>
              <p className="text-primary font-black uppercase tracking-[0.28em] md:tracking-[0.5em] text-[9px] md:text-[10px] mt-2">Escolha seus favoritos</p>
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

         {scrollSpyCategories && viewMode === 'grid' ? (
           <div className="space-y-8 md:space-y-12 pb-4">
             {productsByCategory.map(({ category, products }) => (
               <section
                 key={category}
                 data-category={category}
                 ref={(node) => {
                   categorySectionRefs.current[category] = node;
                 }}
                 className="scroll-mt-4"
               >
                 <div className="mb-4 md:mb-6">
                   <p className="text-primary font-black uppercase tracking-[0.28em] text-[9px]">Categoria</p>
                   <h4 className="text-3xl sm:text-4xl font-black italic tracking-tighter leading-none">{category}</h4>
                 </div>
                 <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-8">
                   {products.map(p => (
                     <motion.button layout key={p.id} onClick={() => onProductSelect(p)} className="glass-card flex flex-col p-4 md:p-6 border-white/5 hover:border-primary/30 group transition-all text-left active:scale-[0.98]">
                        <div className="relative h-40 sm:h-48 md:h-64 mb-4 md:mb-6 rounded-2xl md:rounded-3xl overflow-hidden">
                          <img src={getImageSrc(p.image)} alt={p.name} onError={(event) => applyImageFallback(event.currentTarget)} className="w-full h-full object-cover group-hover:scale-110 transition-all duration-500" />
                          <div className="absolute top-3 right-3 md:top-4 md:right-4 bg-black/60 backdrop-blur-xl px-3 md:px-4 py-2 rounded-xl font-black text-accent border border-white/10 text-sm md:text-base">R$ {p.price.toFixed(2)}</div>
                        </div>
                        <h4 className="font-black text-xl md:text-2xl mb-2 italic tracking-tighter leading-none">{p.name}</h4>
                        <p className="text-gray-500 font-bold text-xs md:text-sm line-clamp-2 leading-relaxed">{p.description}</p>
                     </motion.button>
                   ))}
                 </div>
               </section>
             ))}
           </div>
         ) : viewMode === 'grid' ? (
           <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-8 pb-4">
             {visibleMenu.map(p => (
               <motion.button layout key={p.id} onClick={() => onProductSelect(p)} className="glass-card flex flex-col p-4 md:p-6 border-white/5 hover:border-primary/30 group transition-all text-left active:scale-[0.98]">
                  <div className="relative h-40 sm:h-48 md:h-64 mb-4 md:mb-6 rounded-2xl md:rounded-3xl overflow-hidden">
                    <img src={getImageSrc(p.image)} alt={p.name} onError={(event) => applyImageFallback(event.currentTarget)} className="w-full h-full object-cover group-hover:scale-110 transition-all duration-500" />
                    <div className="absolute top-3 right-3 md:top-4 md:right-4 bg-black/60 backdrop-blur-xl px-3 md:px-4 py-2 rounded-xl font-black text-accent border border-white/10 text-sm md:text-base">R$ {p.price.toFixed(2)}</div>
                  </div>
                  <h4 className="font-black text-xl md:text-2xl mb-2 italic tracking-tighter leading-none">{p.name}</h4>
                  <p className="text-gray-500 font-bold text-xs md:text-sm line-clamp-2 leading-relaxed">{p.description}</p>
               </motion.button>
             ))}
           </div>
         ) : (
           <div className="space-y-6">
             {visibleMenu.map(p => (
               <motion.button layout key={p.id} onClick={() => onProductSelect(p)} className="glass-card flex items-center p-6 border-white/5 hover:border-primary/30 group transition-all w-full text-left">
                 <div className="w-48 h-48 rounded-3xl overflow-hidden mr-8"><img src={getImageSrc(p.image)} alt={p.name} onError={(event) => applyImageFallback(event.currentTarget)} className="w-full h-full object-cover group-hover:scale-110 transition-all duration-500" /></div>
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
      </div>
    </div>
  );
}
