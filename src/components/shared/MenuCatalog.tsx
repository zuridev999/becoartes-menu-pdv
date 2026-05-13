import { useState } from 'react';
import { motion } from 'framer-motion';
import { Search, ChevronRight, Plus } from 'lucide-react';
import { useStore, type Product } from '../../store';
import { isItemAvailable } from '../../lib/utils';

interface MenuCatalogProps {
  onProductSelect: (product: Product) => void;
  viewMode?: 'grid' | 'list';
}

export function MenuCatalog({ onProductSelect, viewMode = 'grid' }: MenuCatalogProps) {
  const { menu, categories: dbCategories } = useStore();
  const availableCategories = dbCategories.filter(c => {
    const { available } = isItemAvailable(c.schedule);
    if (!available && c.schedule?.hideTotally) return false;
    return true;
  }).map(c => c.name);

  const [selectedCategory, setSelectedCategory] = useState(availableCategories[0] || '');
  const [searchQuery, setSearchQuery] = useState('');

  const filteredMenu = menu.filter(p => {
    if (!p.visible) return false;
    
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
  });

  return (
    <div className="flex h-full overflow-hidden">
      {/* Sidebar de Categorias */}
      <div className="w-72 glass border-r border-white/5 flex flex-col pt-10 pb-8 px-4 z-30">
        <div className="flex-1 space-y-3 overflow-y-auto pr-2 custom-scrollbar">
          {availableCategories.map(cat => (
            <button 
              key={cat} 
              onClick={() => setSelectedCategory(cat)} 
              className={`w-full p-6 rounded-[2rem] text-left transition-all flex items-center justify-between group ${selectedCategory === cat ? 'bg-gradient-to-br from-primary to-purple-600 text-white shadow-2xl scale-[1.05]' : 'text-gray-500 hover:bg-white/5'}`}
            >
              <div>
                <p className={`font-black text-[10px] uppercase tracking-widest ${selectedCategory === cat ? 'text-white/70' : 'text-primary'}`}>
                  Categoria
                </p>
                <h4 className="font-black text-lg tracking-tighter italic">{cat}</h4>
              </div>
              <ChevronRight size={20} className={`${selectedCategory === cat ? 'opacity-100' : 'opacity-0'}`} />
            </button>
          ))}
        </div>
      </div>

      {/* Grid de Produtos */}
      <div className="flex-1 p-12 overflow-y-auto custom-scrollbar bg-white/[0.01]">
         <div className="flex justify-between items-center mb-16">
            <div>
              <h3 className="text-6xl font-black tracking-tighter italic">{selectedCategory}</h3>
              <p className="text-primary font-black uppercase tracking-[0.5em] text-[10px] mt-2">Escolha seus favoritos</p>
            </div>
            <div className="relative w-96">
               <input 
                type="text" 
                placeholder="Pesquisar..." 
                value={searchQuery} 
                onChange={(e) => setSearchQuery(e.target.value)} 
                className="w-full glass p-6 pl-14 rounded-3xl border-white/10 text-xl font-bold focus:border-primary outline-none transition-all" 
               />
               <Search className="absolute left-6 top-1/2 -translate-y-1/2 text-gray-500" size={20} />
            </div>
         </div>

         {viewMode === 'grid' ? (
           <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
             {filteredMenu.map(p => (
               <motion.button layout key={p.id} onClick={() => onProductSelect(p)} className="glass-card flex flex-col p-6 border-white/5 hover:border-primary/30 group transition-all">
                  <div className="relative h-64 mb-6 rounded-3xl overflow-hidden">
                    <img src={p.image} className="w-full h-full object-cover group-hover:scale-110 transition-all duration-500" />
                    <div className="absolute top-4 right-4 bg-black/60 backdrop-blur-xl px-4 py-2 rounded-xl font-black text-accent border border-white/10">R$ {p.price.toFixed(2)}</div>
                  </div>
                  <h4 className="font-black text-2xl mb-2 italic tracking-tighter leading-none">{p.name}</h4>
                  <p className="text-gray-500 font-bold text-sm line-clamp-2 leading-relaxed">{p.description}</p>
               </motion.button>
             ))}
           </div>
         ) : (
           <div className="space-y-6">
             {filteredMenu.map(p => (
               <motion.button layout key={p.id} onClick={() => onProductSelect(p)} className="glass-card flex items-center p-6 border-white/5 hover:border-primary/30 group transition-all w-full text-left">
                 <div className="w-48 h-48 rounded-3xl overflow-hidden mr-8"><img src={p.image} className="w-full h-full object-cover group-hover:scale-110 transition-all duration-500" /></div>
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
