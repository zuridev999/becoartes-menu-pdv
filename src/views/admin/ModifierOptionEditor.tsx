import type { Modifier, Product } from '../../types';

type Props = {
  modifier: Modifier;
  products: Product[];
  siblingModifiers: Modifier[];
  index: number;
  onChange: (modifier: Modifier) => void;
};

export function ModifierOptionEditor({ modifier, products, siblingModifiers, index, onChange }: Props) {
  const availableProducts = products.filter(product => (
    !siblingModifiers.some((candidate, candidateIndex) => (
      candidateIndex !== index && candidate.linkedProductId === product.id
    ))
  ));

  return (
    <div className="min-w-0 space-y-2">
      <select
        value={modifier.linkedProductId || ''}
        onChange={(event) => {
          const product = products.find(candidate => candidate.id === event.target.value);
          onChange(product
            ? {
                ...modifier,
                linkedProductId: product.id,
                productCode: product.productCode,
                name: product.name,
                price: product.price,
                inheritedUnavailable: !product.visible,
              }
            : { ...modifier, linkedProductId: undefined, productCode: undefined, inheritedUnavailable: false });
        }}
        className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-3 text-sm font-bold outline-none focus:border-primary/50"
      >
        <option value="">Opção de preparo sem produto</option>
        {availableProducts.map(product => (
          <option key={product.id} value={product.id}>
            {product.productCode ? `${product.productCode} · ` : ''}{product.name}{product.visible ? '' : ' · oculto'}
          </option>
        ))}
      </select>

      {modifier.linkedProductId ? (
        <p className="truncate text-[10px] font-black uppercase tracking-widest text-zinc-500">
          Produto {modifier.productCode || 'sem código'} · nome, preço, estoque e visibilidade herdados
        </p>
      ) : (
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            value={modifier.name}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            placeholder="Ex.: sem cebola ou sabor limão"
            onChange={(event) => onChange({ ...modifier, name: event.target.value })}
            className="min-w-0 flex-1 rounded-xl bg-white/[0.03] px-3 py-2 outline-none font-bold text-sm"
          />
          <div className="flex items-center gap-2 rounded-xl bg-white/[0.03] px-3">
            <span className="text-[10px] font-black text-gray-500 uppercase">R$</span>
            <input
              type="number"
              autoComplete="off"
              value={modifier.price}
              onChange={(event) => onChange({ ...modifier, price: Number(event.target.value) || 0 })}
              className="w-20 bg-transparent py-2 outline-none font-bold text-sm text-right"
            />
          </div>
        </div>
      )}

      {modifier.inheritedUnavailable && (
        <p className="text-[10px] font-black uppercase tracking-widest text-rose-400">
          Oculto porque o produto mestre está invisível
        </p>
      )}
    </div>
  );
}
