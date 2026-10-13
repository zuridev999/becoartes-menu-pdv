import { RefreshCw, TriangleAlert } from 'lucide-react';
import { usePublicI18n } from '../../lib/public-i18n';
import { PublicLanguageMenu } from '../shared/PublicLanguageMenu';

export function ConnectionError({ error, isPublic, retry }: { error: string; isPublic: boolean; retry: () => void }) {
  const { t, errorText } = usePublicI18n();
  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-[#0a0a0c] p-6 text-center text-white">
      <section className="w-full max-w-md border-y border-white/10 py-8">
        {isPublic && <div className="mb-4 flex justify-end"><PublicLanguageMenu /></div>}
        <TriangleAlert className="mx-auto mb-5 h-10 w-10 text-amber-300" aria-hidden="true" />
        <p className="text-[10px] font-black uppercase tracking-[0.22em] text-amber-300">{isPublic ? t('connectionUnavailable') : 'Conexão indisponível'}</p>
        <h1 className="mt-2 text-3xl font-black">{isPublic ? t('menuUnavailable') : 'Não foi possível abrir a operação'}</h1>
        <p className="mt-3 text-sm font-semibold text-zinc-400">{isPublic ? errorText(error, 'connectionError') : error}</p>
        <button type="button" onClick={retry} className="btn-beco btn-beco-purple mx-auto mt-6 inline-flex min-h-11 items-center gap-2 px-5 py-3">
          <RefreshCw className="h-4 w-4" aria-hidden="true" />{isPublic ? t('retry') : 'Tentar novamente'}
        </button>
      </section>
    </main>
  );
}
