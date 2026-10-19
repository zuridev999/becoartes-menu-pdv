import { usePublicI18n } from '../../lib/public-i18n';

export function MenuSkeleton() {
  const { t } = usePublicI18n();
  return (
    <main className="qr-mobile-shell bg-[#0a0a0c] p-4 text-white" aria-busy="true" aria-label={t('menu')}>
      <h1 className="mb-5 text-2xl font-black">{t('menu')}</h1>
      <div className="mb-5 h-11 rounded-xl bg-white/5" aria-hidden="true" />
      {[0, 1, 2].map((item) => (
        <div key={item} className="mb-3 flex h-32 gap-4 rounded-xl border border-white/10 p-3" aria-hidden="true">
          <div className="flex-1 space-y-3"><div className="h-5 w-3/4 rounded bg-white/10" /><div className="h-3 rounded bg-white/5" /><div className="h-4 w-1/3 rounded bg-white/10" /></div>
          <div className="w-24 rounded-xl bg-white/5" />
        </div>
      ))}
    </main>
  );
}
