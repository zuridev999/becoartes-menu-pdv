const checks = [
  ['pdv health', 'https://pdv.becoartes.com/api/health', 750],
  ['tablet root', 'https://tablet.becoartes.com/', 1000],
  ['coz root', 'https://coz.becoartes.com/', 1000],
  ['bar root', 'https://bar.becoartes.com/', 1000],
  ['qr root', 'https://qr.becoartes.com/', 1000],
  ['qr isca image', 'https://qr.becoartes.com/images/isca-de-frango.jpg', 1000],
  ['qr slideshow image', 'https://qr.becoartes.com/slideshow/beco-food.jpg', 1000],
  ['os health', 'https://os.becoartes.com/api/health', 1200],
  ['os checklist alerts', 'https://os.becoartes.com/api/operational/checklist-alerts', 3000],
  ['os sales reports', 'https://os.becoartes.com/becoartes/relatorios-vendas', 1500],
];

const results = [];
for (const [name, url, budgetMs] of checks) {
  const started = Date.now();
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
    const elapsedMs = Date.now() - started;
    results.push({
      name,
      url,
      status: response.status,
      elapsedMs,
      budgetMs,
      ok: response.ok && elapsedMs <= budgetMs,
      contentType: response.headers.get('content-type') || '',
    });
  } catch (error) {
    results.push({ name, url, status: 0, elapsedMs: Date.now() - started, budgetMs, ok: false, error: error.message });
  }
}

const failed = results.filter((result) => !result.ok);
console.log(JSON.stringify({ failed: failed.length, results }, null, 2));
if (failed.length > 0) process.exit(1);
