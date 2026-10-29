import { useState, type ReactNode } from 'react';
import { Languages, ChevronRight } from 'lucide-react';
import { usePublicI18n } from '../../lib/public-i18n';

export function QrLanguageEntry({ children }: { children: ReactNode }) {
  const { languages, setLocale } = usePublicI18n();
  const enabled = languages.filter(language => language.enabled);
  const key = `beco_qr_language_visit:${window.location.pathname}`;
  const [chosen, setChosen] = useState(() => { try { return sessionStorage.getItem(key) || ''; } catch { return ''; } });
  if (enabled.length <= 1 || enabled.some(language => language.code === chosen)) return <>{children}</>;
  return <main className="qr-language-entry">
    <section aria-labelledby="choose-language-title">
      <Languages size={36} aria-hidden="true" />
      <h1 id="choose-language-title" lang="en">Choose your language</h1>
      <p lang="pt-BR">Escolha seu idioma</p>
      <nav aria-label="Language / Idioma">
        {enabled.map(language => <button key={language.code} lang={language.code} onClick={() => {
          setLocale(language.code); setChosen(language.code);
          try { sessionStorage.setItem(key, language.code); } catch { /* Selection also works without storage. */ }
        }}><span aria-hidden="true">{language.flag}</span><strong>{language.nativeName}</strong><ChevronRight size={20} aria-hidden="true" /></button>)}
      </nav>
    </section>
  </main>;
}
