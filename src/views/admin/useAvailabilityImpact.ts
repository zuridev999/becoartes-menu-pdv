import { useState } from 'react';
import type { Product } from '../../store';
import { CatalogApi, type AvailabilityImpact } from '../../lib/api';

type Options = {
  canAdmin: boolean;
  toggleProductVisibility: (id: string) => void | Promise<void>;
  addNotification: (message: string, type?: 'info' | 'error') => void;
  syncData: (options?: { includeCatalog?: boolean }) => Promise<void>;
  onSaved: () => void;
};

export function useAvailabilityImpact({ canAdmin, toggleProductVisibility, addNotification, syncData, onSaved }: Options) {
  const [product, setProduct] = useState<Product | null>(null);
  const [impact, setImpact] = useState<AvailabilityImpact | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const close = () => { setProduct(null); setImpact(null); };

  const open = async (target: Product, sourceId?: string) => {
    if (!canAdmin || (!target.visible && !target.availabilityBlocked)) {
      await toggleProductVisibility(target.id);
      return;
    }
    setBusy(true);
    try {
      const next = await CatalogApi.getAvailabilityImpact(target.id, sourceId);
      if (!next.sources.length) {
        if (target.visible) await toggleProductVisibility(target.id);
        else addNotification('Produto sem vínculo de insumo para restaurar. Revise o cadastro.', 'error');
        return;
      }
      setProduct(target);
      setImpact(next);
      setSelected(next.candidates.filter(candidate => candidate.selected).map(candidate => candidate.key));
    } catch (error: any) {
      addNotification(error?.message || 'Não foi possível consultar os vínculos do produto.', 'error');
    } finally { setBusy(false); }
  };

  const changeSource = async (sourceId: string) => {
    if (!product) return;
    setBusy(true);
    try {
      const next = await CatalogApi.getAvailabilityImpact(product.id, sourceId);
      setImpact(next);
      setSelected(next.candidates.filter(candidate => candidate.selected).map(candidate => candidate.key));
    } catch (error: any) {
      addNotification(error?.message || 'Não foi possível consultar este insumo.', 'error');
    } finally { setBusy(false); }
  };

  const save = async (hidden: boolean) => {
    if (!product || !impact?.sourceId || busy) return;
    setBusy(true);
    try {
      await CatalogApi.setSourceVisibility({
        productId: product.id, sourceId: impact.sourceId, hidden,
        selectedKeys: hidden ? selected : [],
      });
      await syncData({ includeCatalog: true });
      close();
      onSaved();
      addNotification(hidden ? 'Insumo ocultado nos usos selecionados.' : 'Insumo restaurado; ocultações individuais foram preservadas.', 'info');
    } catch (error: any) {
      addNotification(error?.message || 'Não foi possível atualizar a disponibilidade.', 'error');
    } finally { setBusy(false); }
  };

  const hideOnly = async () => {
    if (!product) return;
    await toggleProductVisibility(product.id);
    close();
  };

  return { product, impact, selected, setSelected, busy, open, changeSource, save, hideOnly, close };
}
