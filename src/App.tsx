import { lazy, Suspense, useEffect, useState } from 'react';
import { useStore } from './store';
import { AnimatePresence } from 'framer-motion';

// Componentes Comuns
import { AntigravityErrorBoundary } from './components/common/UI';
import { PremiumLoader } from './components/common/Loaders';

import { NotificationDisplay } from './components/common/NotificationDisplay';
import { ChecklistAlertDisplay } from './components/common/ChecklistAlertDisplay';
import { postOSMessage, subscribeOSMessages } from './lib/osBridge';

const TabletView = lazy(() => import('./views/tablet/TabletView').then(module => ({ default: module.TabletView })));
const PDVView = lazy(() => import('./views/pdv/PDVView').then(module => ({ default: module.PDVView })));
const KitchenView = lazy(() => import('./views/kitchen/KitchenView').then(module => ({ default: module.KitchenView })));
const AdminView = lazy(() => import('./views/admin/AdminView').then(module => ({ default: module.AdminView })));
const QRView = lazy(() => import('./views/qr/QRView').then(module => ({ default: module.QRView })));
const DeliveryView = lazy(() => import('./views/delivery/DeliveryView').then(module => ({ default: module.DeliveryView })));

function App() {
  const { 
    init, isLoading, activeView, syncData, setActiveView
  } = useStore();
  const [animationFinished, setAnimationFinished] = useState(() => {
    const path = window.location.pathname.replace(/^\/+/, '');
    const isDeliveryEntry = path.startsWith('delivery') || window.location.hostname.startsWith('delivery.');
    if (isDeliveryEntry) return true;
    // Skip animation if already shown in this session for this hostname
    return sessionStorage.getItem(`beco_anim_done_${window.location.hostname}`) === 'true';
  });

  useEffect(() => {
    const start = async () => {
      await init();
      postOSMessage('ready', {
        view: useStore.getState().activeView,
        path: window.location.pathname
      });
    };
    start();
  }, [init]);

  useEffect(() => {
    return subscribeOSMessages((message) => {
      if (message.type === 'context') {
        sessionStorage.setItem('beco_os_context', JSON.stringify(message.payload || {}));
        return;
      }

      if (message.type === 'sync') {
        syncData({ includeCatalog: Boolean(message.payload?.includeCatalog) });
        return;
      }

      if (message.type === 'refresh_catalog') {
        syncData({ includeCatalog: true });
        return;
      }

      if (message.type === 'navigate' && message.payload?.view) {
        setActiveView(message.payload.view, message.payload.tab, message.payload.mode);
      }
    });
  }, [setActiveView, syncData]);

  const handleAnimationComplete = () => {
    setAnimationFinished(true);
    sessionStorage.setItem(`beco_anim_done_${window.location.hostname}`, 'true');
  };

  return (
    <AntigravityErrorBoundary>
      <AnimatePresence>
        {(!animationFinished || isLoading) && (
          <PremiumLoader onComplete={handleAnimationComplete} isLoading={isLoading} />
        )}
      </AnimatePresence>

      <div className="min-h-screen bg-transparent">
        <NotificationDisplay />
        {activeView === 'pdv' && <ChecklistAlertDisplay />}
        {/* Roteamento de Views com Hostname Fallback */}
        <Suspense fallback={null}>
          {activeView === 'tablet' && <TabletView />}
          {activeView === 'qr' && <QRView />}
          {activeView === 'pdv' && <PDVView />}
          {activeView === 'kitchen' && <KitchenView />}
          {activeView === 'admin' && <AdminView />}
          {activeView === 'delivery' && <DeliveryView />}
        </Suspense>
        
        {/* Fallback amigável para URLs desconhecidas */}
        {!isLoading && !['tablet', 'pdv', 'kitchen', 'admin', 'qr', 'delivery'].includes(activeView) && (
          <div className="flex flex-col items-center justify-center h-screen text-center p-12">
            <h2 className="text-4xl font-black italic mb-4 text-white">Módulo não encontrado</h2>
            <p className="text-gray-500 mb-8">O hostname <span className="text-primary font-bold">{window.location.hostname}</span> não está mapeado para nenhum módulo operacional.</p>
            <button onClick={() => window.location.href = 'https://pdv.becoartes.com'} className="btn-beco btn-beco-purple px-8 py-4">Ir ao PDV Central</button>
          </div>
        )}
      </div>
    </AntigravityErrorBoundary>
  );
}

export default App;
