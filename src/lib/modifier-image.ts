import type { Modifier, Product } from '../types';

const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
// Shared visual references; these do not change SKUs, prices or stock links.
const references: Record<string, string> = {
  'ovo frito': '/images/options/ovo-frito.webp',
  limao: '/images/options/limao.webp', maracuja: '/images/options/maracuja.webp',
  morango: '/images/options/morango.webp', abacaxi: '/images/options/abacaxi.webp',
  carne: '/images/options/carne.webp', frango: '/images/options/frango.webp', queijo: '/images/options/queijo.webp',
  'batata frita': '/images/batata-frita.jpg', 'batata com cheddar & bacon': '/images/batata-cheddar--bacon.jpg',
  'calabresa pra 2': '/images/calabresa.jpg', 'file de frango pra dois': '/images/file-de-frango.jpg',
  'contra file pra dois': '/images/contra-file-acebolado.jpg', 'omelete pra dois': '/images/omelete.jpg',
};
export function getModifierImage(modifier: Modifier, products: Product[] = []) {
  const linked = products.find(p => p.id === modifier.linkedProductId);
  if (linked?.image) return linked.image;
  const name = normalize(modifier.name);
  const alias = ({'coca-cola':'Coca-Cola Lata','coca zero':'Coca-Cola Zero Lata'} as Record<string,string>)[name];
  if (alias) return products.find(p => normalize(p.name) === normalize(alias))?.image || ''; 
  return products.find(p => normalize(p.name) === name && p.image)?.image || references[name] || '';
}
