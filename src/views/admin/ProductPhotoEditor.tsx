import { useRef, useState } from 'react';
import { ImagePlus, ImageOff, Link2, Trash2 } from 'lucide-react';
import { getImageSrc } from '../../lib/image';

export function ProductPhotoEditor({ value, name, disabled, onChange, onBusyChange }: { value: string; name: string; disabled: boolean; onChange: (value: string) => void; onBusyChange?: (busy: boolean) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [failed, setFailed] = useState(false);
  const [url, setUrl] = useState(value.startsWith('data:') ? '' : value);
  const upload = async (file?: File) => {
    if (!file || disabled || busy) return;
    if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size > 15 * 1024 * 1024) { setError('Escolha JPG, PNG ou WebP de até 15 MB.'); return; }
    setBusy(true); onBusyChange?.(true); setError('');
    const source = URL.createObjectURL(file);
    try {
      const image = new Image(); image.src = source; await image.decode();
      const ratio = Math.min(1, 960 / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement('canvas'); canvas.width = Math.round(image.naturalWidth * ratio); canvas.height = Math.round(image.naturalHeight * ratio);
      const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('Imagem indisponível');
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      onChange(canvas.toDataURL('image/webp', .82)); setFailed(false); setUrl('');
    } catch { setError('Não foi possível abrir essa foto. Tente outro arquivo.'); }
    finally { URL.revokeObjectURL(source); setBusy(false); onBusyChange?.(false); }
  };
  return <section className="product-photo-editor">
    <h4>Foto do produto</h4>
    <div className="product-photo-row">
      <div className="product-photo-preview">{value && !failed ? <img src={getImageSrc(value, 640)} alt={name} onError={() => setFailed(true)}/> : <ImageOff size={32}/>}</div>
      <div className="product-photo-actions"><button type="button" className="editor-primary" disabled={disabled || busy} onClick={() => input.current?.click()}><ImagePlus size={19}/>{busy ? 'Preparando…' : value ? 'Trocar foto' : 'Adicionar foto'}</button><button type="button" className="editor-secondary" disabled={disabled || busy || !value} onClick={() => { onChange(''); setUrl(''); setFailed(false); }}><Trash2 size={17}/>Remover</button><small>JPG, PNG ou WebP · até 15 MB</small></div>
    </div>
    <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={e => { const file = e.currentTarget.files?.[0]; e.currentTarget.value = ''; void upload(file); }}/>
    <details className="editor-rules"><summary><Link2 size={17}/> Usar link de imagem</summary><label>Link da foto<input type="url" value={url} disabled={disabled || busy} onChange={e => setUrl(e.target.value)} placeholder="https://…"/></label><button type="button" className="editor-secondary" disabled={disabled || busy || !url.trim()} onClick={() => { const v = url.trim(); if (!/^https?:\/\//i.test(v) && !/^\/(?!\/)/.test(v)) { setError('Use um link https ou uma imagem do catálogo.'); return; } setError(''); setFailed(false); onChange(v); }}>Aplicar link</button></details>
    {failed && <p className="editor-error">Essa foto não carregou. Troque o arquivo ou revise o link.</p>}
    {error && <p role="alert" className="editor-error">{error}</p>}
  </section>;
}
