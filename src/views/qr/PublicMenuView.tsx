import { useState } from 'react';
import { X } from 'lucide-react';
import { MenuCatalog } from '../../components/shared/MenuCatalog';
import { PublicLanguageMenu } from '../../components/shared/PublicLanguageMenu';
import { usePublicI18n } from '../../lib/public-i18n';
import { formatCurrency } from '../../lib/format';
import { applyImageFallback, getImageSrc } from '../../lib/image';
import type { Product } from '../../store';

// This view deliberately has no table context, cart, ordering modal or operational API action.
export function PublicMenuView() {
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const { t, locale, catalogText } = usePublicI18n();

  return (
    <main className="flex h-dvh min-h-0 flex-col bg-[#0a0a0c] text-white">
      <header className="z-40 flex min-h-16 shrink-0 items-center justify-between gap-3 border-b border-white/10 bg-[#0a0a0c] px-4 py-3 sm:px-6">
        <div>
          <p className="text-lg font-black italic tracking-tight">Becoartes</p>
          <p className="text-[10px] font-bold uppercase tracking-widest text-primary">{t('menu')}</p>
        </div>
        <PublicLanguageMenu />
      </header>
      <p className="shrink-0 border-b border-white/10 px-4 py-3 text-center text-xs font-semibold text-zinc-400">
        {t('publicMenuReadOnlyHint')}
      </p>
      <MenuCatalog
        onProductSelect={setSelectedProduct}
        viewMode="grid"
        navigationMode="continuous"
        constrainToParent
      />
      {selectedProduct && (
        <div className="fixed inset-0 z-[750] flex items-center justify-center bg-black/90 p-4" onClick={() => setSelectedProduct(null)}>
          <section
            role="dialog"
            aria-modal="true"
            aria-label={catalogText(selectedProduct.id, selectedProduct.name, 'name')}
            className="relative max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-3xl border border-white/10 bg-[#17131d] shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <button type="button" aria-label={t('close')} className="absolute right-3 top-3 rounded-full bg-black/70 p-3" onClick={() => setSelectedProduct(null)}><X size={20} /></button>
            <img src={getImageSrc(selectedProduct.image)} alt={selectedProduct.name} onError={applyImageFallback} className="h-56 w-full object-cover" />
            <div className="space-y-3 p-6">
              <p className="text-xs font-black uppercase tracking-widest text-primary">{catalogText(selectedProduct.categoryId || '', selectedProduct.categoryName || '', 'name')}</p>
              <h2 className="text-3xl font-black italic">{catalogText(selectedProduct.id, selectedProduct.name, 'name')}</h2>
              <p className="text-sm text-zinc-300">{catalogText(selectedProduct.id, selectedProduct.description || '', 'description')}</p>
              <p className="text-2xl font-black text-accent">{formatCurrency(selectedProduct.price, locale)}</p>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
