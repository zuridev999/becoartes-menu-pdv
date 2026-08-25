import { lazy, Suspense, useEffect, useState } from 'react';
import { useStore } from './store';
import { AnimatePresence } from 'framer-motion';
import { RefreshCw, TriangleAlert } from 'lucide-react';

// Componentes Comuns
import { AntigravityErrorBoundary } from './components/common/UI';
import { PremiumLoader } from './components/common/Loaders';

import { NotificationDisplay } from './components/common/NotificationDisplay';
import { ChecklistAlertDisplay } from './components/common/ChecklistAlertDisplay';
import { HouseAdBanner } from './components/common/HouseAdBanner';
import { GoogleAdBanner } from './components/common/GoogleAdBanner';
import { postOSMessage, subscribeOSMessages } from './lib/osBridge';
import { PublicI18nProvider } from './lib/public-i18n';

const TabletView = lazy(() => import('./views/tablet/TabletView').then(module => ({ default: module.TabletView })));
const PDVView = lazy(() => import('./views/pdv/PDVView').then(module => ({ default: module.PDVView })));
const KitchenView = lazy(() => import('./views/kitchen/KitchenView').then(module => ({ default: module.KitchenView })));
const AdminView = lazy(() => import('./views/admin/AdminView').then(module => ({ default: module.AdminView })));
const QRView = lazy(() => import('./views/qr/QRView').then(module => ({ default: module.QRView })));
const DeliveryView = lazy(() => import('./views/delivery/DeliveryView').then(module => ({ default: module.DeliveryView })));

function App() {
  const { 
    init, isLoading, initError, activeView, syncData, setActiveView, settings
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

  const isPublicMenuView = activeView === 'qr' || activeView === 'tablet' || activeView === 'delivery';
  const hasOperationalView = ['pdv', 'kitchen', 'admin'].includes(activeView);

  return (
    <AntigravityErrorBoundary>
      <AnimatePresence>
        {(!animationFinished || isLoading) && (
          <PremiumLoader onComplete={handleAnimationComplete} isLoading={isLoading} />
        )}
      </AnimatePresence>

      <PublicI18nProvider settings={settings}>
      <div className="min-h-screen bg-transparent">
        <NotificationDisplay />
        <ChecklistAlertDisplay />
        {!isLoading && <HouseAdBanner />}
        {!isLoading && !initError && isPublicMenuView && <GoogleAdBanner placement="top" />}
        {!isLoading && initError && (
          <main className="flex min-h-[100dvh] items-center justify-center bg-[#0a0a0c] p-6 text-center text-white">
            <section className="w-full max-w-md border-y border-white/10 py-8">
              <TriangleAlert className="mx-auto mb-5 h-10 w-10 text-amber-300" aria-hidden="true" />
              <p className="text-[10px] font-black uppercase tracking-[0.22em] text-amber-300">Conexão indisponível</p>
              <h1 className="mt-2 text-3xl font-black">Não foi possível abrir a operação</h1>
              <p className="mt-3 text-sm font-semibold text-zinc-400">{initError}</p>
              <button
                type="button"
                onClick={() => init()}
                className="btn-beco btn-beco-purple mx-auto mt-6 inline-flex min-h-11 items-center gap-2 px-5 py-3"
              >
                <RefreshCw className="h-4 w-4" aria-hidden="true" />
                Tentar novamente
              </button>
            </section>
          </main>
        )}
        {/* Roteamento de Views com Hostname Fallback */}
        <Suspense fallback={null}>
          {!initError && activeView === 'tablet' && <TabletView />}
          {!initError && activeView === 'qr' && <QRView />}
          {!initError && activeView === 'pdv' && <PDVView />}
          {!initError && activeView === 'kitchen' && <KitchenView />}
          {!initError && activeView === 'admin' && <AdminView />}
          {!initError && activeView === 'delivery' && <DeliveryView />}
        </Suspense>

        {!isLoading && !initError && activeView === 'qr' && <GoogleAdBanner placement="mobile-bottom" />}
        {!isLoading && !initError && activeView === 'delivery' && <GoogleAdBanner placement="mobile-bottom" />}
        {!isLoading && !initError && hasOperationalView && <GoogleAdBanner placement="operational-bottom" />}
        
        {/* Fallback amigável para URLs desconhecidas */}
        {!isLoading && !initError && !['tablet', 'pdv', 'kitchen', 'admin', 'qr', 'delivery'].includes(activeView) && (
          <div className="flex flex-col items-center justify-center h-screen text-center p-12">
            <h2 className="text-4xl font-black italic mb-4 text-white">Módulo não encontrado</h2>
            <p className="text-gray-500 mb-8">O hostname <span className="text-primary font-bold">{window.location.hostname}</span> não está mapeado para nenhum módulo operacional.</p>
            <button type="button" onClick={() => window.location.href = 'https://pdv.becoartes.com'} className="btn-beco btn-beco-purple px-8 py-4">Ir ao PDV Central</button>
          </div>
        )}
      </div>
      </PublicI18nProvider>
    </AntigravityErrorBoundary>
  );
}

export default App;
