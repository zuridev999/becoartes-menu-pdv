import { useEffect, useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Users, 
  Plus, 
  X,
  PlusCircle,
  LayoutDashboard,
  LogOut,
  Settings, Soup, Bell, Check, Trash2, Wallet, Sparkles, Clock, AlertTriangle, ChevronRight
} from 'lucide-react';
import { useStore, type OrderItem, type Product, type Table as TableType } from '../../store';
import { CheckoutModal } from '../../components/modals/CheckoutModal';
import { ActionDialog } from '../../components/common/ActionDialog';
import { ProductModal } from '../../components/modals/ProductModal';
import { can, getPermissionLabel } from '../../lib/permissions';
import { getOrderItemTotal, getOrderItemsTotal } from '../../lib/totals';

export function PDVView() {
  const { 
    tables, 
    menu, 
    categories, 
    closedBills, 
    currentSeller, 
    logout,
    addAuditLog,
    addToCart,
    removeOrderItem,
    setCurrentTableId,
    sendToKitchen,
    serviceRequests,
    resolveService,
    login,
    syncData,
    updateTableStatus
  } = useStore();

  const [pin, setPin] = useState('');
  const [isSendingOrder, setIsSendingOrder] = useState(false);
  const [loginError, setLoginError] = useState(false);
  const [selectedTable, setSelectedTable] = useState<TableType | null>(null);
  const [showCheckout, setShowCheckout] = useState(false);
  const [showProductMenu, setShowProductMenu] = useState(false);
  const [showManualLog, setShowManualLog] = useState(false);
  const [activeCategory, setActiveCategory] = useState<string | null>(categories[0]?.id || null);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [showOnlyActive, setShowOnlyActive] = useState(true);
  const [logAction, setLogAction] = useState('');
  const [logDetails, setLogDetails] = useState('');
  const [logTable, setLogTable] = useState('');
  const [cancelItemDialog, setCancelItemDialog] = useState<{ item: OrderItem; tableNumber: number } | null>(null);
  
  const [selectedRequestForDetails, setSelectedRequestForDetails] = useState<any>(null);
  const [isPanicDismissed, setIsPanicDismissed] = useState(false);
  const [hasPanicAlert, setHasPanicAlert] = useState(false);

  // Filtra solicitações das últimas 2 horas para manter a tela limpa
  const now = new Date();
  const visibleRequests = serviceRequests.filter(req => {
    const createdAt = req.createdAt instanceof Date ? req.createdAt : new Date(req.createdAt);
    const diffHours = (now.getTime() - createdAt.getTime()) / (1000 * 60 * 60);
    return diffHours < 2;
  });

  // Referência para o container de scroll da lista de solicitações
  const listRef = useRef<HTMLDivElement>(null);
  const prevRequestsLength = useRef(visibleRequests.length);

  // Auto-scroll para o topo quando uma nova solicitação chega
  useEffect(() => {
    if (visibleRequests.length > prevRequestsLength.current) {
      listRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    }
    prevRequestsLength.current = visibleRequests.length;
  }, [visibleRequests.length]);

  // Verificação de Modo Pânico (5 minutos) - considerando apenas as visíveis
  useEffect(() => {
    const checkPanic = () => {
      const nowCheck = new Date();
      const hasOldAlert = visibleRequests.some(req => {
        if (req.status === 'resolved') return false;
        const createdAt = req.createdAt instanceof Date ? req.createdAt : new Date(req.createdAt);
        const diffMinutes = (nowCheck.getTime() - createdAt.getTime()) / (1000 * 60);
        return diffMinutes >= 5;
      });

      if (hasOldAlert) {
        if (!isPanicDismissed) setHasPanicAlert(true);
      } else {
        setHasPanicAlert(false);
        setIsPanicDismissed(false);
      }
    };

    const interval = setInterval(checkPanic, 5000);
    return () => clearInterval(interval);
  }, [visibleRequests, isPanicDismissed]);

  // Se o número de solicitações visíveis mudar, reseta o dismiss
  useEffect(() => {
    setIsPanicDismissed(false);
  }, [visibleRequests.length]);

  // Auto-sync para o PDV em tempo real
  useEffect(() => {
    let isSyncing = false;

    const runSync = async (reason: string) => {
      if (isSyncing) return;
      isSyncing = true;
      try {
        console.log(`PDV syncing: ${reason}`);
        await syncData();
      } catch (error) {
        console.warn('Falha ao sincronizar PDV:', error);
      } finally {
        isSyncing = false;
      }
    };

    const interval = setInterval(() => {
      runSync('interval');
    }, 5000);

    const handleResume = () => {
      if (!document.hidden) runSync('resume');
    };

    window.addEventListener('focus', handleResume);
    window.addEventListener('online', handleResume);
    document.addEventListener('visibilitychange', handleResume);
    runSync('mount');

    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', handleResume);
      window.removeEventListener('online', handleResume);
      document.removeEventListener('visibilitychange', handleResume);
    };
  }, [syncData]);

  useEffect(() => {
    if (!categories.length) return;
    if (!activeCategory || !categories.some(category => category.id === activeCategory)) {
      setActiveCategory(categories[0].id);
    }
  }, [categories, activeCategory]);

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
  const managedTable = currentTable || selectedTable;
  const cart = currentTable?.cart || [];

  // Stats
  const activeTablesCount = tables.filter(t => t.status === 'ordering' || t.status === 'bill_requested').length;
  const todayStr = new Date().toLocaleDateString('pt-BR');
  const totalToday = closedBills
    .filter(bill => {
      const billDate = bill.closedAt instanceof Date ? bill.closedAt : new Date(bill.closedAt);
      return billDate.toLocaleDateString('pt-BR') === todayStr;
    })
    .reduce((acc, bill) => acc + bill.total, 0);
  const canViewSalesTotals = can(currentSeller, 'viewSalesTotals');
  const canCancelTableItem = can(currentSeller, 'cancelTableItem');

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

  const getModifierGroupsLabel = (product: Product) => {
    const groupCount = product.modifierGroups?.length || 0;
    if (groupCount === 0) return 'Sem opcionais';
    if (groupCount === 1) return '1 grupo de opcionais';
    return `${groupCount} grupos de opcionais`;
  };

  return (
    <div 
      className="min-h-screen bg-[#09090b] text-white font-['Outfit'] p-8 relative overflow-hidden"
      onClick={() => {
        if (hasPanicAlert) {
          setHasPanicAlert(false);
          setIsPanicDismissed(true);
        }
      }}
    >
      {/* MODO PÂNICO OVERLAY */}
      <AnimatePresence>
        {hasPanicAlert && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[999] bg-rose-600/95 backdrop-blur-2xl flex flex-col items-center justify-center"
          >
            <div className="animate-pulse flex flex-col items-center text-center p-12">
               <AlertTriangle size={120} className="text-white mb-8 animate-bounce" />
               <h1 className="text-8xl font-black italic tracking-tighter text-white mb-4">ATENÇÃO CRÍTICA!</h1>
               <p className="text-2xl font-black uppercase tracking-[0.3em] text-white/80">EXISTEM SOLICITAÇÕES PENDENTES HÁ MAIS DE 5 MINUTOS</p>
               <p className="mt-12 text-sm font-bold bg-white text-rose-600 px-8 py-4 rounded-full uppercase tracking-widest shadow-2xl">Clique em qualquer lugar para silenciar</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* HEADER */}
      <header className="flex justify-between items-center mb-12">
        <div>
          <h1 className="text-4xl font-black italic tracking-tighter flex items-center gap-4">
            CENTRAL <span className="text-primary">OPERACIONAL</span>
          </h1>
          <p className="text-zinc-500 text-sm font-bold uppercase tracking-widest mt-1">Becoartes • PDV Management</p>
        </div>

        <div className="flex gap-6">
          {canViewSalesTotals && (
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
          {canViewSalesTotals && (
            <button 
              onClick={() => useStore.getState().setActiveView('admin', 'finance', 'settings')} 
              className="glass-card p-4 hover:bg-emerald-500/10 hover:text-emerald-500 transition-all border-white/5"
              title="Fechamentos e pagamentos"
            >
              <Wallet size={24} />
            </button>
          )}
          {can(currentSeller, 'manageSettings') && (
            <button 
              onClick={() => useStore.getState().setActiveView('admin', 'config', 'settings')} 
              className="glass-card p-4 hover:bg-primary/10 hover:text-primary transition-all border-white/5"
              title="Configurações Gerais"
            >
              <Settings size={24} />
            </button>
          )}
          <div className="glass-card px-5 py-4 flex flex-col items-end border-white/5">
            <span className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.2em]">Perfil</span>
            <span className="text-sm font-black text-white">{getPermissionLabel(currentSeller)}</span>
          </div>
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
                        R$ {getOrderItemsTotal(table.orders).toFixed(2)}
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
          {visibleRequests.length > 0 && (
            <div className="flex-1 flex flex-col min-h-0 border-b border-white/5 relative z-10">
              <div className={`p-8 border-b border-white/20 flex justify-between items-center ${visibleRequests.some(r => r.status !== 'resolved') ? 'bg-rose-600 animate-pulse' : 'bg-emerald-600'} shrink-0`}>
                <h3 className="text-sm font-black uppercase tracking-[0.2em] flex items-center gap-3 text-white">
                  <Bell size={16} className={visibleRequests.some(r => r.status !== 'resolved') ? 'animate-bounce' : ''} /> 
                  {visibleRequests.some(r => r.status !== 'resolved') ? 'Novas Solicitações' : 'Solicitações Atendidas'}
                </h3>
                <span className="bg-white text-zinc-900 px-3 py-1 rounded-full text-xs font-black shadow-xl">
                  {visibleRequests.filter(r => r.status !== 'resolved').length || visibleRequests.length}
                </span>
              </div>
              <div ref={listRef} className="flex-1 overflow-y-auto custom-scrollbar bg-[#0d0d0f]">
                {visibleRequests.map((req) => {
                  const isResolved = req.status === 'resolved';
                  const isOrderActionable = req.type === 'order_ready' || req.type === 'new_order';
                  return (
                    <motion.div 
                      key={req.id} 
                      animate={!isResolved ? { y: [0, -4, 0] } : { y: 0 }}
                      transition={{ repeat: Infinity, duration: 1, ease: "easeInOut" }}
                      onClick={() => {
                        if (isOrderActionable && !isResolved) {
                          setSelectedRequestForDetails(req);
                        }
                      }}
                      className={`p-6 border-b border-white/10 last:border-0 flex justify-between items-center group transition-colors ${isResolved ? 'bg-emerald-500/20' : 'bg-rose-600'} ${(!isResolved && isOrderActionable) ? 'cursor-pointer hover:bg-rose-500' : ''}`}
                    >
                      <div className="flex items-center gap-4">
                         <div className={`w-12 h-12 rounded-2xl flex items-center justify-center font-black italic text-xl shadow-inner ${isResolved ? 'bg-emerald-500 text-white' : 'bg-white/20 text-white'}`}>
                           {req.tableNumber}
                         </div>
                         <div>
                           <div className="flex items-center gap-2 mb-1">
                             <p className="text-base font-black text-white uppercase tracking-tight">
                               {req.type === 'waiter' ? 'Chamar Garçom' : 
                                req.type === 'bill' ? 'Pedido de Conta' : 
                                req.type === 'glass' ? 'Copo Extra' :
                                req.type === 'cutlery' ? 'Pedir Talher' :
                                req.type === 'order_ready' ? 'Pedido Pronto' :
                                req.type === 'new_order' ? 'Novo Pedido' :
                                req.type}
                             </p>
                             {isOrderActionable && (
                               <span className="bg-white/20 text-[9px] px-2 py-0.5 rounded-full font-black uppercase">
                                 {req.type === 'order_ready' ? 'Entrega' : 'Bebidas'}
                               </span>
                             )}
                           </div>
                           <p className={`text-[10px] font-black uppercase tracking-widest flex items-center gap-2 ${isResolved ? 'text-emerald-400' : 'text-white/60'}`}>
                             <Clock size={10} /> 
                             {new Date(req.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} • 
                             {isResolved ? 'Atendimento Concluído' : (req.type === 'order_ready' ? 'Retirar na Cozinha' : (req.type === 'new_order' ? 'Preparar Bebidas/Drinks' : (req.message || 'Aguardando atendimento')))}
                           </p>
                           {!isResolved && isOrderActionable && (
                             <div className="mt-2 p-3 bg-white/10 rounded-xl border border-white/5">
                               <p className="text-[10px] font-bold text-white/80 leading-relaxed italic line-clamp-2">
                                 {req.message}
                               </p>
                               <div className="mt-1 flex items-center gap-1 text-[8px] font-black text-white/40 uppercase">
                                 Clique para ver detalhes <ChevronRight size={8} />
                               </div>
                             </div>
                           )}
                         </div>
                      </div>
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          resolveService(req.id);
                        }}
                        className={`w-12 h-12 rounded-2xl flex items-center justify-center shadow-2xl transition-all ${isResolved ? 'bg-emerald-500 text-white hover:scale-105' : 'bg-white text-rose-600 hover:scale-110 active:scale-90'}`}
                        title={isResolved ? "Desmarcar" : "Dar Ciente"}
                      >
                        <Check size={24} strokeWidth={4} />
                      </button>
                    </motion.div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="p-8 border-t border-white/5 space-y-4 shrink-0 bg-[#0d0d0f]/50 mt-auto">
             <button 
               onClick={() => {
                 setShowOnlyActive(false);
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

            {managedTable?.status === 'available' ? (
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
                  {(managedTable?.orders || []).map((o, idx) => (
                    <div key={idx} className="glass-card p-6 border-white/5 flex justify-between items-center gap-4">
                      <div>
                        <p className="font-bold text-lg">{o.quantity}x {o.name}</p>
                        {(o.categoryName || o.categoryId) && (
                          <p className="text-[9px] font-black uppercase tracking-widest text-zinc-500 mt-1">
                            {o.categoryName || o.categoryId}
                          </p>
                        )}
                        <div className="flex gap-2 mt-1">
                          {(o.selectedModifiers || []).map(m => (
                            <span key={m.id} className="text-[9px] font-black bg-white/5 px-2 py-0.5 rounded text-zinc-500">+{m.name}</span>
                          ))}
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <p className="font-black italic text-zinc-300">R$ {getOrderItemTotal(o).toFixed(2)}</p>
                        {canCancelTableItem && (
                          <button
                            onClick={() => setCancelItemDialog({ item: o, tableNumber: selectedTable.number })}
                            className="p-3 glass rounded-xl text-rose-500 hover:bg-rose-500/10 transition-all"
                            title="Cancelar item da mesa"
                          >
                            <Trash2 size={16} />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="space-y-4 pt-8 border-t border-white/5">
                  <div className="flex justify-between items-end mb-8">
                    <div>
                      <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Total Acumulado</span>
                      <p className="text-5xl font-black italic tracking-tighter text-emerald-400">
                        R$ {getOrderItemsTotal(managedTable?.orders || []).toFixed(2)}
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
                    {getOrderItemsTotal(managedTable?.orders || []) === 0 ? (
                      <button 
                        onClick={() => {
                          updateTableStatus(managedTable.id, 'available');
                          setSelectedTable(null);
                        }}
                        className="btn-beco bg-rose-500/20 text-rose-500 hover:bg-rose-500/30 py-6 rounded-2xl font-black text-sm"
                      >
                        LIMPAR MESA (R$ 0,00)
                      </button>
                    ) : (
                      <button 
                        onClick={() => setShowCheckout(true)}
                        className="btn-beco btn-beco-purple py-6 rounded-2xl font-black text-sm"
                      >
                        FINALIZAR CONTA
                      </button>
                    )}
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
                      className={`p-6 rounded-3xl font-black text-left uppercase text-xs tracking-widest transition-all ${
                        activeCategory === cat.id 
                          ? 'bg-primary text-white shadow-2xl shadow-primary/20 border border-primary' 
                          : 'bg-[#121214] border border-white/10 text-zinc-400 hover:text-white hover:bg-[#1a1a1e]'
                      }`}
                    >
                      {cat.name}
                    </button>
                  ))}
               </div>

               <div className="flex-1 overflow-y-auto pr-4 custom-scrollbar">
                  <div className="grid grid-cols-2 gap-4">
                    {menu.filter(p => !activeCategory || p.categoryId === activeCategory).map(product => (
                      <motion.button
                        key={product.id}
                        whileHover={{ x: 6 }}
                        onClick={() => {
                          if (product.modifierGroups?.length) {
                            setSelectedProduct(product);
                            return;
                          }

                          addToCart(product, 1, []);
                          addAuditLog({
                            action: 'item_added',
                            details: { product_name: product.name, price: product.price },
                            table_number: selectedTable.number.toString(),
                            origin: 'pdv'
                          });
                        }}
                        className="bg-[#121214] border border-white/10 rounded-3xl p-6 flex justify-between items-center group relative overflow-hidden text-left transition-all hover:bg-[#1a1a1e] shadow-lg"
                      >
                         <div className="flex items-center gap-4 min-w-0">
                           <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary group-hover:bg-primary group-hover:text-black transition-all shrink-0">
                              {product.modifierGroups?.length ? <Sparkles size={20} /> : <Plus size={20} />}
                           </div>
                           <div className="min-w-0">
                             <h4 className="text-xl font-bold italic tracking-tight leading-none text-white truncate">{product.name}</h4>
                             <div className="flex flex-wrap items-center gap-2 mt-2">
                               <span className="text-[10px] font-black uppercase text-zinc-500 tracking-widest">
                                 {product.categoryName || product.categoryId}
                               </span>
                               <span className={`text-[10px] font-black uppercase tracking-widest ${
                                 product.modifierGroups?.length ? 'text-primary' : 'text-zinc-600'
                               }`}>
                                 {getModifierGroupsLabel(product)}
                               </span>
                             </div>
                           </div>
                         </div>
                         
                         <div className="flex items-center gap-6 shrink-0">
                           <span className="text-lg font-black italic tracking-tighter text-emerald-400">R$ {product.price.toFixed(2)}</span>
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
                   <span className="text-3xl font-black italic tracking-tighter text-emerald-400">R$ {getOrderItemsTotal(cart).toFixed(2)}</span>
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
                  disabled={isSendingOrder || cart.length === 0}
                  onClick={async () => {
                    if (cart.length > 0) {
                      setIsSendingOrder(true);
                      try {
                        await sendToKitchen(selectedTable.id, 'pdv', currentSeller?.id || 'sistema');
                        addAuditLog({
                          action: 'item_added',
                          details: { items_count: cart.length },
                          table_number: selectedTable.number.toString(),
                          origin: 'pdv'
                        });
                        setShowProductMenu(false);
                      } catch (err) {
                        console.error("Erro ao enviar pedido para a cozinha:", err);
                      } finally {
                        setIsSendingOrder(false);
                      }
                    } else {
                      setShowProductMenu(false);
                    }
                  }}
                  className="btn-beco btn-beco-purple py-8 px-24 text-xl font-black rounded-3xl shadow-2xl shadow-primary/20 disabled:opacity-20 disabled:grayscale transition-all"
                >
                  {isSendingOrder ? 'ENVIANDO...' : 'CONFIRMAR E ENVIAR'}
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* CHECKOUT MODAL */}
      <AnimatePresence>
        {selectedProduct && (
          <ProductModal
            product={selectedProduct}
            onClose={() => setSelectedProduct(null)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {cancelItemDialog && (
          <ActionDialog
            isOpen
            tone="danger"
            title="Cancelar item?"
            description={`Remover ${cancelItemDialog.item.quantity}x ${cancelItemDialog.item.name} da Mesa ${cancelItemDialog.tableNumber}. O total do pedido será recalculado.`}
            confirmLabel="Cancelar item"
            onClose={() => setCancelItemDialog(null)}
            onConfirm={async () => {
              await removeOrderItem(cancelItemDialog.item.id, {
                tableNumber: cancelItemDialog.tableNumber,
                itemName: cancelItemDialog.item.name,
                quantity: cancelItemDialog.item.quantity,
                sellerName: currentSeller?.name,
                sellerPermission: currentSeller?.permission
              });
              await addAuditLog({
                action: 'item_cancelled',
                details: { product_name: cancelItemDialog.item.name, quantity: cancelItemDialog.item.quantity },
                table_number: cancelItemDialog.tableNumber.toString(),
                origin: 'pdv'
              });
            }}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showCheckout && selectedTable && (
          <CheckoutModal 
            table={managedTable || selectedTable} 
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

      {/* MODAL DE DETALHES DA SOLICITAÇÃO (PEDIDO PRONTO OU NOVO PEDIDO) */}
      <AnimatePresence>
        {selectedRequestForDetails && (
          <motion.div 
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[1000] bg-black/90 backdrop-blur-md flex items-center justify-center p-8"
          >
            <motion.div 
              initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }}
              className="w-full max-w-2xl bg-[#111115] rounded-[3rem] border border-white/10 shadow-2xl overflow-hidden"
            >
              <div className={`p-10 border-b border-white/5 flex justify-between items-center ${selectedRequestForDetails.type === 'new_order' ? 'bg-indigo-600' : 'bg-rose-600'}`}>
                <div>
                  <h2 className="text-4xl font-black italic tracking-tighter text-white">Mesa <span className="text-white/60">{selectedRequestForDetails.tableNumber}</span></h2>
                  <p className="text-white/80 font-black uppercase tracking-widest text-[10px] mt-1 flex items-center gap-2">
                    <Clock size={12} /> {new Date(selectedRequestForDetails.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} • {selectedRequestForDetails.type === 'new_order' ? 'Novo Pedido' : 'Pedido Pronto'}
                  </p>
                </div>
                <button onClick={() => setSelectedRequestForDetails(null)} className="p-4 bg-white/20 rounded-full text-white hover:bg-white/30 transition-all">
                  <X size={28} />
                </button>
              </div>

              <div className="p-10">
                <div className="bg-white/5 rounded-[2rem] p-8 border border-white/5">
                   <h3 className="text-xs font-black uppercase tracking-widest text-zinc-500 mb-6">
                     {selectedRequestForDetails.type === 'new_order' ? 'Itens do pedido (Bebidas/Drinks):' : 'Itens prontos para entrega:'}
                   </h3>
                   <p className="text-3xl font-black text-white leading-relaxed italic">
                     {selectedRequestForDetails.message}
                   </p>
                </div>

                <div className="grid grid-cols-1 gap-4 mt-10">
                  <button 
                    onClick={() => {
                      resolveService(selectedRequestForDetails.id);
                      setSelectedRequestForDetails(null);
                    }}
                    className="w-full py-8 bg-emerald-500 text-white rounded-[2rem] text-2xl font-black uppercase tracking-widest shadow-xl shadow-emerald-500/20 active:scale-95 transition-all flex items-center justify-center gap-4"
                  >
                    <Check size={32} strokeWidth={4} /> DAR CIENTE
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
