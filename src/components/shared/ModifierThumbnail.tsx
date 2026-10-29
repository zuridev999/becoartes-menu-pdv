import { useState } from 'react';
import { ImageOff } from 'lucide-react';
import type { Modifier, Product } from '../../types';
import { getModifierImage } from '../../lib/modifier-image';
import { getImageSrc } from '../../lib/image';

export function ModifierThumbnail({ modifier, products, name, className = '' }: { modifier: Modifier; products: Product[]; name: string; className?: string }) {
  const src = getModifierImage(modifier, products);
  const [failed, setFailed] = useState('');
  return <span className={`modifier-thumbnail ${className}`}>
    {src && failed !== src ? <img src={getImageSrc(src, 320)} alt={name} width={56} height={56} loading="lazy" decoding="async" onError={() => setFailed(src)} /> : <ImageOff size={22} aria-hidden="true" />}
  </span>;
}
