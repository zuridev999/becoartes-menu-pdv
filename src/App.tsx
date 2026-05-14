import { useEffect, useState } from 'react';
import { useStore } from './store';
import { initDB } from './lib/db';
import { AnimatePresence } from 'framer-motion';

// Componentes Comuns
import { AntigravityErrorBoundary } from './components/common/UI';
import { PremiumLoader } from './components/common/Loaders';

// Visualizações
import { TabletView } from './views/tablet/TabletView';
import { PDVView } from './views/pdv/PDVView';
import { KitchenView } from './views/kitchen/KitchenView';
import { AdminView } from './views/admin/AdminView';
import { QRView } from './views/qr/QRView';
import { NotificationDisplay } from './components/common/NotificationDisplay';

// Componentes de Autenticação
function App() {
  const { 
    init, isLoading, activeView
  } = useStore();
  const [animationFinished, setAnimationFinished] = useState(false);

  useEffect(() => {
    const start = async () => {
      await initDB();
      await init();
    };
    start();
  }, []);

  return (
    <AntigravityErrorBoundary>
      <AnimatePresence>
        {(!animationFinished || isLoading) && (
          <PremiumLoader onComplete={() => setAnimationFinished(true)} isLoading={isLoading} />
        )}
      </AnimatePresence>

      <div className="min-h-screen bg-[#0a0a0c]">
        <NotificationDisplay />
        {/* Roteamento de Views com Hostname Fallback */}
        {activeView === 'tablet' && <TabletView />}
        {activeView === 'qr' && <QRView />}
        {activeView === 'pdv' && <PDVView />}
        {activeView === 'kitchen' && <KitchenView />}
        {activeView === 'admin' && <AdminView />}
        
        {/* Fallback amigável para URLs desconhecidas */}
        {!isLoading && !['tablet', 'pdv', 'kitchen', 'admin', 'qr'].includes(activeView) && (
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
