import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Languages } from 'lucide-react';
import { usePublicI18n } from '../../lib/public-i18n';

export function PublicLanguageMenu() {
  const { locale, languages, setLocale, t } = usePublicI18n();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const active = languages.find((language) => language.code === locale) || languages[0];
  const enabledLanguages = languages.filter((language) => language.enabled);

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, []);

  if (!active || enabledLanguages.length <= 1) return null;

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-label={t('language')}
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="flex h-11 min-w-11 items-center justify-center gap-1 rounded-xl border border-white/10 bg-white/[0.04] px-2 text-base shadow-lg shadow-black/20 transition hover:border-primary/60 hover:bg-white/[0.08]"
      >
        <span aria-hidden="true">{active.flag}</span>
        <ChevronDown size={13} className={`text-zinc-400 transition ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute right-0 top-[calc(100%+0.5rem)] z-[100] w-48 overflow-hidden rounded-2xl border border-white/10 bg-[#131116]/[0.98] p-1.5 shadow-2xl shadow-black/60 backdrop-blur-xl">
          <p className="flex items-center gap-2 px-3 py-2 text-[9px] font-black uppercase tracking-[0.2em] text-zinc-500">
            <Languages size={13} /> {t('language')}
          </p>
          {enabledLanguages.map((language) => (
            <button
              key={language.code}
              type="button"
              onClick={() => { setLocale(language.code); setOpen(false); }}
              className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-black transition ${language.code === locale ? 'bg-primary text-white' : 'text-zinc-300 hover:bg-white/[0.06]'}`}
            >
              <span className="text-base" aria-hidden="true">{language.flag}</span>
              {language.nativeName}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
