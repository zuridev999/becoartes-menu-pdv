import { useEffect, useState } from 'react';
import { useStore } from './store';
import { initDB } from './lib/db';
import { AnimatePresence } from 'framer-motion';

// Componentes Comuns
import { AntigravityErrorBoundary } from './components/common/UI';
import { PremiumLoader } from './components/common/Loaders';

// Componentes de Autenticação
import { PinLoginModal } from './components/auth/PinLoginModal';

// Visualizações
import { TabletView } from './views/tablet/TabletView';
import { PDVView } from './views/pdv/PDVView';
import { KitchenView } from './views/kitchen/KitchenView';
import { AdminView } from './views/admin/AdminView';
import { QRView } from './views/qr/QRView';

function App() {
  const { 
    init, isLoading, activeView, 
    currentSeller
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
        {/* Lógica de Autenticação Global */}
        {!currentSeller && activeView !== 'kitchen' && activeView !== 'tablet' && (
          <PinLoginModal />
        )}

        {/* Roteamento de Views com Hostname Fallback */}
        {activeView === 'tablet' && <TabletView />}
        {activeView === 'qr' && <QRView />}
        {activeView === 'pdv' && currentSeller && <PDVView />}
        {activeView === 'kitchen' && <KitchenView />}
        {activeView === 'admin' && currentSeller && <AdminView />}
        
        {/* Fallback amigável */}
        {!['tablet', 'pdv', 'kitchen', 'admin'].includes(activeView) && (
          <div className="flex flex-col items-center justify-center h-screen text-center p-12">
            <h2 className="text-4xl font-black italic mb-4">Módulo não encontrado</h2>
            <p className="text-gray-500 mb-8">A área que você tenta acessar não existe ou não está carregada.</p>
            <button onClick={() => window.location.href = '/tablet'} className="btn-beco btn-beco-purple px-8 py-4">Voltar ao Início</button>
          </div>
        )}
      </div>
    </AntigravityErrorBoundary>
  );
}

export default App;
