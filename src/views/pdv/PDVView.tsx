import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Users, 
  History, 
  Plus, 
  X,
  PlusCircle,
  LayoutDashboard,
  LogOut,
  Settings, Soup, Bell, Check
} from 'lucide-react';
import { useStore, type Table as TableType } from '../../store';
import { CheckoutModal } from '../../components/modals/CheckoutModal';

export function PDVView() {
  const { 
    tables, 
    menu, 
    categories, 
    auditLogs, 
    closedBills, 
    currentSeller, 
    logout,
    addAuditLog,
    addToCart,
    setCurrentTableId,
    sendToKitchen,
    serviceRequests,
    resolveService,
    login
  } = useStore();

  const [pin, setPin] = useState('');
  const [loginError, setLoginError] = useState(false);
  const [selectedTable, setSelectedTable] = useState<TableType | null>(null);
  const [showCheckout, setShowCheckout] = useState(false);
  const [showProductMenu, setShowProductMenu] = useState(false);
  const [showManualLog, setShowManualLog] = useState(false);
  const [activeCategory, setActiveCategory] = useState<string | null>(categories[0]?.id || null);
  const [showOnlyActive, setShowOnlyActive] = useState(true);
  const [logAction, setLogAction] = useState('');
  const [logDetails, setLogDetails] = useState('');
  const [logTable, setLogTable] = useState('');

  const handleLogin = async () => {
    const success = await login(pin);
    if (!success) {
      setLoginError(true);
      setPin('');
      setTimeout(() => setLoginError(false), 2000);
    }
  };

  if (!currentSeller) {
    return (
      <div className="min-h-screen bg-[#09090b] flex items-center justify-center font-['Outfit'] p-8">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-card w-full max-w-md p-12 border-white/10 shadow-2xl flex flex-col items-center"
        >
          <div className="w-20 h-20 bg-primary/10 rounded-[2rem] flex items-center justify-center text-primary mb-8">
            <Users size={40} />
          </div>
          <h2 className="text-3xl font-black italic tracking-tighter mb-2">IDENTIFICAÇÃO <span className="text-primary">PDV</span></h2>
          <p className="text-zinc-500 text-[10px] font-black uppercase tracking-widest mb-12 text-center leading-relaxed">Insira seu PIN de acesso para entrar no terminal operacional</p>

          <div className="w-full space-y-6">
            <div className="relative">
              <input 
                type="password"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
                className={`w-full glass py-8 px-6 rounded-3xl text-4xl text-center font-black tracking-[0.5em] outline-none border-2 transition-all ${loginError ? 'border-rose-500 animate-shake text-rose-500' : 'border-white/10 focus:border-primary'}`}
                placeholder="****"
                maxLength={4}
                autoFocus
              />
              {loginError && <p className="text-[10px] font-black uppercase text-rose-500 text-center mt-4">PIN INCORRETO. TENTE NOVAMENTE.</p>}
            </div>

            <button 
              onClick={handleLogin}
              className="w-full btn-beco btn-beco-purple py-6 text-xl font-black rounded-2xl shadow-2xl shadow-primary/20"
            >
              ENTRAR
            </button>
          </div>
        </motion.div>
      </div>
    );
  }

  // Derived state
  const currentTable = tables.find(t => t.id === selectedTable?.id);
  const cart = currentTable?.cart || [];

  // Stats
  const activeTablesCount = tables.filter(t => t.status === 'ordering' || t.status === 'bill_requested').length;
  const totalToday = closedBills.reduce((acc, bill) => acc + bill.total, 0);

  const handleTableClick = (table: TableType) => {
    setSelectedTable(table);
    setCurrentTableId(table.id);
    if (table.status === 'available') {
      setShowProductMenu(true);
      if (categories.length > 0) setActiveCategory(categories[0].id);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'available': return 'bg-zinc-800/50 border-zinc-700/50 text-zinc-500';
      case 'ordering': return 'bg-purple-600/20 border-purple-500/30 text-purple-400';
      case 'bill_requested': return 'bg-amber-600/20 border-amber-500/30 text-amber-400';
      default: return 'bg-zinc-800/50 border-zinc-700/50 text-zinc-500';
    }
  };

  return (
    <div className="min-h-screen bg-[#09090b] text-white font-['Outfit'] p-8">
      {/* HEADER */}
      <header className="flex justify-between items-center mb-12">
        <div>
          <h1 className="text-4xl font-black italic tracking-tighter flex items-center gap-4">
            CENTRAL <span className="text-primary">OPERACIONAL</span>
          </h1>
          <p className="text-zinc-500 text-sm font-bold uppercase tracking-widest mt-1">Becoartes • PDV Management</p>
        </div>

        <div className="flex gap-6">
          {currentSeller?.permission === 'admin' && (
            <div className="glass-card px-8 py-4 flex flex-col items-end border-white/5">
              <span className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.2em]">Vendas Hoje</span>
              <span className="text-2xl font-black text-emerald-400">R$ {totalToday.toFixed(2)}</span>
            </div>
          )}
          <div className="glass-card px-8 py-4 flex flex-col items-end border-white/5">
            <span className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.2em]">Mesas Ativas</span>
            <span className="text-2xl font-black text-purple-400">{activeTablesCount}</span>
          </div>
          <button 
            onClick={() => useStore.getState().setActiveView('admin', 'products', 'menu')} 
            className="glass-card p-4 hover:bg-emerald-500/10 hover:text-emerald-500 transition-all border-white/5"
            title="Gestão de Cardápio"
          >
            <Soup size={24} />
          </button>
          {currentSeller?.permission === 'admin' && (
            <button 
              onClick={() => useStore.getState().setActiveView('admin', 'config', 'settings')} 
              className="glass-card p-4 hover:bg-primary/10 hover:text-primary transition-all border-white/5"
              title="Configurações Gerais"
            >
              <Settings size={24} />
            </button>
          )}
          <button onClick={logout} className="glass-card p-4 hover:bg-rose-500/10 hover:text-rose-500 transition-all border-white/5">
            <LogOut size={24} />
          </button>
        </div>
      </header>

      <div className="grid grid-cols-12 gap-8 h-[calc(100vh-200px)]">
        {/* LEFT: MAPA DE MESAS */}
        <div className="col-span-8 flex flex-col gap-6 overflow-y-auto pr-4 custom-scrollbar">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-black italic tracking-tight uppercase flex items-center gap-3">
              <LayoutDashboard size={20} className="text-primary" /> Mapa de Mesas
            </h2>
            <div className="flex gap-4">
              <button 
                onClick={() => setShowOnlyActive(!showOnlyActive)}
                className={`px-6 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${showOnlyActive ? 'bg-primary text-black' : 'bg-white/5 text-zinc-500'}`}
              >
                {showOnlyActive ? 'Apenas Ativas' : 'Todas as Mesas'}
              </button>
              <span className="flex items-center gap-2 text-[10px] font-black uppercase text-zinc-500">
                <div className="w-3 h-3 rounded-full bg-zinc-800 border border-zinc-700" /> Livre
              </span>
              <span className="flex items-center gap-2 text-[10px] font-black uppercase text-purple-400">
                <div className="w-3 h-3 rounded-full bg-purple-600/40 border border-purple-500" /> Ocupada
              </span>
              <span className="flex items-center gap-2 text-[10px] font-black uppercase text-amber-400">
                <div className="w-3 h-3 rounded-full bg-amber-600/40 border border-amber-500" /> Conta
              </span>
            </div>
          </div>

          <div className="grid grid-cols-4 lg:grid-cols-5 gap-4">
            {tables
              .filter(t => !showOnlyActive || t.status !== 'available')
              .map((table) => (
              <motion.button
                key={table.id}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => handleTableClick(table)}
                className={`h-40 rounded-[2.5rem] border-2 p-6 flex flex-col justify-between transition-all relative overflow-hidden group ${getStatusColor(table.status)}`}
              >
                <div className="flex justify-between items-start relative z-10">
                  <span className="text-3xl font-black italic tracking-tighter">{table.number}</span>
                  {table.status !== 'available' && (
                    <Users size={20} className="opacity-40" />
                  )}
                </div>
                
                <div className="relative z-10">
                  {table.status === 'available' ? (
                    <span className="text-[10px] font-black uppercase tracking-widest opacity-40 group-hover:opacity-100 transition-opacity">Iniciar</span>
                  ) : (
                    <div className="flex flex-col items-start">
                      <span className="text-[10px] font-black uppercase tracking-widest opacity-60">Total</span>
                      <span className="text-lg font-black italic tracking-tighter">
                        R$ {table.orders.reduce((acc, o) => acc + (o.price * o.quantity), 0).toFixed(2)}
                      </span>
                    </div>
                  )}
                </div>

                <div className="absolute -right-4 -bottom-4 w-20 h-20 bg-white/5 rounded-full blur-2xl group-hover:bg-white/10 transition-all" />
              </motion.button>
            ))}
          </div>
        </div>

        {/* RIGHT: LANÇAMENTOS & ACTIVITY */}
        <div className="col-span-4 glass-card border-white/5 flex flex-col overflow-hidden">
          {/* SOLICITAÇÕES DE SERVIÇO */}
          {serviceRequests.length > 0 && (
            <div className="border-b border-white/5 bg-amber-500/5">
              <div className="p-8 border-b border-white/5 flex justify-between items-center">
                <h3 className="text-sm font-black uppercase tracking-[0.2em] flex items-center gap-3 text-amber-400">
                  <Bell size={16} /> Solicitações Ativas
                </h3>
                <span className="bg-amber-500 text-black px-2 py-0.5 rounded-full text-[10px] font-black">{serviceRequests.length}</span>
              </div>
              <div className="max-h-64 overflow-y-auto custom-scrollbar">
                {serviceRequests.map((req) => (
                  <div key={req.id} className="p-6 border-b border-white/5 last:border-0 flex justify-between items-center group hover:bg-white/[0.02]">
                    <div className="flex items-center gap-4">
                       <div className="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center text-amber-400 font-black italic">
                         {req.tableNumber}
                       </div>
                       <div>
                         <p className="text-sm font-bold text-white uppercase tracking-tight">{req.type === 'waiter' ? 'Chamar Garçom' : req.type === 'bill' ? 'Pedido de Conta' : req.type}</p>
                         <p className="text-[10px] text-zinc-500 font-black uppercase tracking-widest">{req.message || 'Sem observações'}</p>
                       </div>
                    </div>
                    <button 
                      onClick={() => resolveService(req.id)}
                      className="p-3 glass rounded-xl text-emerald-500 opacity-0 group-hover:opacity-100 transition-all hover:bg-emerald-500/10"
                    >
                      <Check size={18} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="p-8 border-b border-white/5 bg-white/2">
             <h3 className="text-sm font-black uppercase tracking-[0.2em] flex items-center gap-3">
               <History size={16} className="text-emerald-400" /> Lançamentos Recentes
             </h3>
          </div>
          
          <div className="flex-1 overflow-y-auto p-8 space-y-6 custom-scrollbar">
            {auditLogs.length > 0 ? auditLogs.map((log) => (
              <div key={log.id} className="flex gap-4 group">
                <div className="flex flex-col items-center">
                  <div className="w-2 h-2 rounded-full bg-zinc-700 mt-2 group-hover:bg-primary transition-colors" />
                  <div className="w-[1px] flex-1 bg-zinc-800/50 my-2" />
                </div>
                <div className="flex-1 pb-4">
                  <div className="flex justify-between items-start">
                    <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500">
                      {new Date(log.timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                    </p>
                    <span className="text-[9px] font-black bg-white/5 px-2 py-0.5 rounded text-zinc-500 uppercase">{log.origin}</span>
                  </div>
                  <h4 className="text-sm font-bold mt-1 text-zinc-300">
                    {log.action === 'table_opened' && 'Abertura de Mesa'}
                    {log.action === 'item_added' && 'Novo Pedido'}
                    {log.action === 'bill_requested' && 'Pedido de Conta'}
                    {log.action === 'bill_closed' && 'Fechamento'}
                    {!['table_opened', 'item_added', 'bill_requested', 'bill_closed'].includes(log.action) && log.action}
                  </h4>
                  <p className="text-[11px] text-zinc-500 mt-1">
                    {log.author_name} na Mesa {log.table_number || '---'}
                  </p>
                </div>
              </div>
            )) : (
              <div className="h-full flex flex-col items-center justify-center opacity-20 text-center px-12">
                <History size={48} className="mb-4" />
                <p className="text-xs font-black uppercase tracking-widest">Nenhuma atividade registrada ainda</p>
              </div>
            )}
          </div>

          <div className="p-8 border-t border-white/5 space-y-4">
             <button 
               onClick={() => {
                 setShowOnlyActive(false);
                 // Opcional: scroll para o mapa de mesas
               }}
               className="w-full btn-beco bg-zinc-800 hover:bg-zinc-700 py-6 font-black uppercase tracking-widest text-xs rounded-2xl flex items-center justify-center gap-3"
             >
               <LayoutDashboard size={18} /> Abrir Mesa
             </button>
             <button 
               onClick={() => setShowManualLog(true)}
               className="w-full btn-beco btn-beco-purple py-6 font-black uppercase tracking-widest text-xs rounded-2xl flex items-center justify-center gap-3"
             >
               <PlusCircle size={18} /> Novo Lançamento Manual
             </button>
          </div>
        </div>
      </div>

      {/* SELECTED TABLE OVERLAY (Management) */}
      <AnimatePresence>
        {selectedTable && (
          <motion.div 
            initial={{ x: 600 }}
            animate={{ x: 0 }}
            exit={{ x: 600 }}
            className="fixed top-0 right-0 w-[500px] h-screen bg-[#0d0d0f] border-l border-white/10 z-[300] shadow-2xl p-12 flex flex-col"
          >
            <div className="flex justify-between items-center mb-12">
              <h2 className="text-5xl font-black italic tracking-tighter">Mesa <span className="text-primary">{selectedTable.number}</span></h2>
              <button onClick={() => setSelectedTable(null)} className="p-4 glass rounded-2xl hover:text-rose-500 transition-all"><X size={24}/></button>
            </div>

            {selectedTable.status === 'available' ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center px-12">
                <div className="w-24 h-24 rounded-full bg-emerald-500/10 flex items-center justify-center text-emerald-500 mb-8 animate-pulse">
                  <PlusCircle size={48} />
                </div>
                <h3 className="text-2xl font-black italic tracking-tight mb-4">Mesa disponível</h3>
                <p className="text-zinc-500 text-sm font-medium mb-12">Inicie um novo atendimento para adicionar itens e gerenciar esta mesa.</p>
                <button 
                  onClick={() => setShowProductMenu(true)}
                  className="w-full btn-beco btn-beco-purple py-8 text-xl font-black rounded-3xl"
                >
                  ABRIR ATENDIMENTO
                </button>
              </div>
            ) : (
              <div className="flex-1 flex flex-col overflow-hidden">
                <div className="flex-1 overflow-y-auto space-y-6 pr-4 custom-scrollbar mb-12">
                  <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500 mb-4">Pedidos Ativos</h4>
                  {selectedTable.orders.map((o, idx) => (
                    <div key={idx} className="glass-card p-6 border-white/5 flex justify-between items-center">
                      <div>
                        <p className="font-bold text-lg">{o.quantity}x {o.name}</p>
                        <div className="flex gap-2 mt-1">
                          {o.selectedModifiers.map(m => (
                            <span key={m.id} className="text-[9px] font-black bg-white/5 px-2 py-0.5 rounded text-zinc-500">+{m.name}</span>
                          ))}
                        </div>
                      </div>
                      <p className="font-black italic text-zinc-300">R$ {(o.price * o.quantity).toFixed(2)}</p>
                    </div>
                  ))}
                </div>

                <div className="space-y-4 pt-8 border-t border-white/5">
                  <div className="flex justify-between items-end mb-8">
                    <div>
                      <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Total Acumulado</span>
                      <p className="text-5xl font-black italic tracking-tighter text-emerald-400">
                        R$ {selectedTable.orders.reduce((acc, o) => acc + (o.price * o.quantity), 0).toFixed(2)}
                      </p>
                    </div>
                    <button 
                      onClick={() => setShowCheckout(true)}
                      className="glass px-8 py-4 rounded-2xl font-black text-[10px] uppercase tracking-widest text-amber-400 border-amber-500/20 hover:bg-amber-500/10"
                    >
                      Solicitar Conta
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <button 
                      onClick={() => setShowProductMenu(true)}
                      className="btn-beco bg-zinc-800 hover:bg-zinc-700 py-6 rounded-2xl font-black text-sm"
                    >
                      ADICIONAR ITENS
                    </button>
                    <button 
                      onClick={() => setShowCheckout(true)}
                      className="btn-beco btn-beco-purple py-6 rounded-2xl font-black text-sm"
                    >
                      FINALIZAR CONTA
                    </button>
                  </div>
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* PRODUCT SELECTION OVERLAY */}
      <AnimatePresence>
        {showProductMenu && selectedTable && (
          <motion.div 
            initial={{ opacity: 0, scale: 1.1 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 1.1 }}
            className="fixed inset-0 z-[500] glass-card m-12 bg-[#09090b]/95 border-white/10 flex flex-col overflow-hidden p-12"
          >
            <div className="flex justify-between items-center mb-12">
               <div>
                 <h2 className="text-4xl font-black italic tracking-tighter">Adicionar à <span className="text-primary">Mesa {selectedTable.number}</span></h2>
                 <p className="text-zinc-500 text-[10px] font-black uppercase tracking-widest">Selecione os produtos abaixo</p>
               </div>
               <button onClick={() => setShowProductMenu(false)} className="p-6 glass rounded-3xl hover:text-rose-500 transition-all"><X size={32}/></button>
            </div>

            <div className="flex-1 flex gap-8 overflow-hidden">
               {/* CATEGORIES */}
               <div className="w-64 flex flex-col gap-3 overflow-y-auto pr-2 custom-scrollbar">
                  {categories.map(cat => (
                    <button 
                      key={cat.id}
                      onClick={() => setActiveCategory(cat.id)}
                      className={`p-6 rounded-3xl font-black text-left uppercase text-xs tracking-widest transition-all ${activeCategory === cat.id ? 'bg-primary text-white shadow-2xl shadow-primary/20' : 'glass border-white/5 opacity-40 hover:opacity-100'}`}
                    >
                      {cat.name}
                    </button>
                  ))}
               </div>

               <div className="flex-1 overflow-y-auto pr-4 custom-scrollbar">
                  <div className="flex flex-col gap-2">
                    {menu.filter(p => !activeCategory || p.categoryId === activeCategory).map(product => (
                      <motion.button
                        key={product.id}
                        whileHover={{ x: 10 }}
                        onClick={() => {
                          addToCart(product, 1, []);
                          addAuditLog({
                            action: 'item_added',
                            details: { product_name: product.name, price: product.price },
                            table_number: selectedTable.number.toString(),
                            origin: 'pdv'
                          });
                        }}
                        className="glass-card p-4 border-white/5 flex justify-between items-center group relative overflow-hidden text-left"
                      >
                         <div className="flex items-center gap-4">
                           <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary group-hover:bg-primary group-hover:text-black transition-all">
                              <Plus size={20} />
                           </div>
                           <h4 className="text-xl font-bold italic tracking-tight leading-none text-white">{product.name}</h4>
                         </div>
                         
                         <div className="flex items-center gap-6">
                           <span className="text-[10px] font-black uppercase text-zinc-500 tracking-widest">{product.categoryId}</span>
                         </div>
                      </motion.button>
                    ))}
                  </div>
               </div>
            </div>

            <div className="mt-12 pt-12 border-t border-white/10 flex justify-between items-center">
              <div className="flex gap-8">
                 <div>
                   <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest block mb-1">Itens no Pedido</span>
                   <span className="text-3xl font-black italic tracking-tighter text-white">{cart.length} ITENS</span>
                 </div>
                 <div>
                   <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest block mb-1">Subtotal</span>
                   <span className="text-3xl font-black italic tracking-tighter text-emerald-400">R$ {cart.reduce((acc, i) => acc + (i.price * i.quantity), 0).toFixed(2)}</span>
                 </div>
              </div>
              <div className="flex gap-4">
                <button 
                  onClick={() => setShowProductMenu(false)}
                  className="btn-beco bg-zinc-800 py-8 px-12 text-xl font-black rounded-3xl"
                >
                  CANCELAR
                </button>
                <button 
                  onClick={async () => {
                    if (cart.length > 0) {
                      await sendToKitchen(selectedTable.id, 'pdv', currentSeller?.id || 'sistema');
                      addAuditLog({
                        action: 'item_added',
                        details: { items_count: cart.length },
                        table_number: selectedTable.number.toString(),
                        origin: 'pdv'
                      });
                    }
                    setShowProductMenu(false);
                  }}
                  className="btn-beco btn-beco-purple py-8 px-24 text-xl font-black rounded-3xl shadow-2xl shadow-primary/20"
                >
                  CONFIRMAR E ENVIAR
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* CHECKOUT MODAL */}
      <AnimatePresence>
        {showCheckout && selectedTable && (
          <CheckoutModal 
            table={selectedTable} 
            onClose={() => {
              setShowCheckout(false);
              setSelectedTable(null);
            }} 
          />
        )}
      </AnimatePresence>

      {/* MANUAL LOG MODAL */}
      <AnimatePresence>
        {showManualLog && (
          <motion.div 
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[600] flex items-center justify-center p-12"
          >
            <div className="absolute inset-0 bg-black/90 backdrop-blur-3xl" onClick={() => setShowManualLog(false)} />
            <div className="glass-card w-full max-w-xl p-12 relative z-10 border-white/10 shadow-2xl">
               <div className="flex justify-between items-center mb-12">
                  <h2 className="text-3xl font-black italic tracking-tighter uppercase">Novo <span className="text-primary">Lançamento</span></h2>
                  <button onClick={() => setShowManualLog(false)} className="p-4 glass rounded-2xl hover:text-rose-500"><X size={20}/></button>
               </div>

               <div className="space-y-6">
                  <div>
                    <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-2 block">Ação / Título</label>
                    <input 
                      value={logAction} onChange={(e) => setLogAction(e.target.value)}
                      className="w-full glass p-5 rounded-2xl border-white/10 outline-none font-bold text-lg bg-transparent"
                      placeholder="Ex: Sangria de Caixa, Entrada Manual..."
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-2 block">Detalhes / Observações</label>
                    <textarea 
                      value={logDetails} onChange={(e) => setLogDetails(e.target.value)}
                      className="w-full glass p-5 rounded-2xl border-white/10 outline-none font-bold text-lg bg-transparent h-32"
                      placeholder="Descreva o motivo do lançamento..."
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-2 block">Mesa Relacionada (Opcional)</label>
                    <input 
                      value={logTable} onChange={(e) => setLogTable(e.target.value)}
                      className="w-full glass p-5 rounded-2xl border-white/10 outline-none font-bold text-lg bg-transparent"
                      placeholder="Ex: 12"
                    />
                  </div>
               </div>

               <button 
                  onClick={async () => {
                    await addAuditLog({
                      action: logAction || 'Lançamento Manual',
                      details: logDetails,
                      table_number: logTable,
                      origin: 'pdv'
                    });
                    setShowManualLog(false);
                    setLogAction('');
                    setLogDetails('');
                    setLogTable('');
                  }}
                  className="w-full btn-beco btn-beco-purple py-8 text-xl font-black rounded-3xl mt-12"
               >
                  REGISTRAR LANÇAMENTO
               </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

    </div>
  );
}
