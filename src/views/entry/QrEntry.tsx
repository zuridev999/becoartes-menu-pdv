import { useEffect } from 'react';
import { useStore } from '../../store';

interface QrEntryProps {
  onEnter: () => void;
}

export function QrEntry({ onEnter }: QrEntryProps) {
  const { tables, setCurrentTableId } = useStore();

  useEffect(() => {
    // URL format: qr.becoartes.com/mesa/10 or localhost:5173/qr/mesa/10
    const path = window.location.pathname;
    const match = path.match(/\/mesa\/(\d+)/);
    
    if (match) {
      const tableNumber = match[1];
      const table = tables.find(t => t.number === Number(tableNumber));
      if (table) {
        setCurrentTableId(table.id);
        onEnter();
      } else {
        // Mesa não encontrada? Fallback para escolha manual ou erro
        console.error("Mesa não encontrada:", tableNumber);
      }
    } else {
      // Se não tem mesa na URL, talvez mostrar erro ou pedir mesa?
      // O usuário pediu que QR venha pela URL.
    }
  }, [tables]);

  return (
    <div className="fixed inset-0 bg-[#0a0a0c] flex flex-col items-center justify-center p-12 text-center">
       <div className="w-20 h-20 bg-primary/20 rounded-full animate-pulse flex items-center justify-center mb-8">
          <div className="w-10 h-10 bg-primary rounded-full" />
       </div>
       <h2 className="text-3xl font-black italic tracking-tighter mb-2">Validando sua <span className="text-primary">Mesa</span></h2>
       <p className="text-gray-500 font-bold uppercase tracking-widest text-[10px]">Aguarde um instante...</p>
    </div>
  );
}
