// Run against the local app; all API requests are intercepted. No real order is created.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium, webkit } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.QR_TEST_URL || 'http://127.0.0.1:5188';
assert.ok(new URL(base).hostname === '127.0.0.1' || new URL(base).hostname === 'localhost', 'Browser order tests require a local app.');
const snapshot = JSON.parse(readFileSync(process.env.QR_CATALOG_SNAPSHOT, 'utf8')).data;

for (const [engineName, engine] of [['chromium', chromium], ['webkit', webkit]]) {
  const browser = await engine.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
    // Playwright's blocked register() resolves without a registration object.
    // Supply the no-op update expected by the app without installing a worker.
    await context.addInitScript(() => {
      if ('serviceWorker' in navigator) navigator.serviceWorker.register = async () => ({ update: async () => undefined });
    });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(e.stack || e.message));
    const table = { id: 'mesa-test', number: 14, status: 'occupied', orders: [], cart: [], payments: [], lastActivity: new Date().toISOString() };
    let mode = 'mesa';
    let failOrder = true;
    const orders = [];
    await context.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== base && !url.protocol.startsWith('data')) return route.abort();
      if (!url.pathname.startsWith('/api/')) return route.continue();
      const ok = (data) => route.fulfill({ json: { ok: true, data } });
      if (url.pathname === '/api/app/init' || url.pathname === '/api/app/sync') return ok({
        ...snapshot, tables: [table], savedSettings: { ...snapshot.savedSettings, qrMode: mode, adsense: { enabled: false } },
        kitchenData: { orders: [], serverNow: new Date().toISOString() },
      });
      if (url.pathname === '/api/qr/resolve') return ok({ flow: mode, physicalTable: { id: table.id, number: table.number }, access: { token: 'test-token', tableId: table.id, origin: 'qr', expiresAt: '2099-01-01T00:00:00Z' } });
      if (url.pathname === '/api/public-table/state') return ok({ table });
      if (url.pathname === '/api/orders/send-to-kitchen') {
        if (failOrder) return route.abort('failed');
        const payload = route.request().postDataJSON();
        orders.push(payload);
        table.orders.push(...payload.items);
        return ok({ request: { status: 'pending' }, sentToProduction: true });
      }
      if (url.pathname === '/api/health') return route.fulfill({ json: { ok: true, commit: '' } });
      return ok({ recorded: true });
    });
    await page.goto(`${base}/qr/mesa/14`);
    await page.getByRole('button', { name: 'Idioma', exact: true }).click({ timeout: 12000 }).catch(async (error) => {
      console.error({ pageErrors, url: page.url(), text: await page.locator('body').innerText() });
      throw error;
    });
    await page.getByRole('button', { name: /Français/ }).click();
    await page.getByRole('heading', { name: 'Plats pour deux', exact: true }).first().waitFor();
    assert.ok(await page.getByText('1 article', { exact: true }).count(), 'Single-item categories must use the singular label.');
    assert.equal(await page.locator('html').getAttribute('lang'), 'fr-FR');
    const search = page.getByRole('textbox', { name: 'Rechercher dans la carte' });
    await search.fill('poulet');
    await page.getByRole('button').filter({ hasText: 'Poulet à la parmigiana pour deux (frites incluses)' }).first().click();
    await page.getByText('Pour accompagner', { exact: true }).waitFor();
    await page.getByRole('button').filter({ hasText: 'Coca-Cola en canette' }).last().click({ force: true });
    await page.getByRole('button', { name: /Ajouter à la commande/i }).click();
    await search.fill('caipirinha');
    await page.getByRole('button').filter({ hasText: 'Caipirinha (choisissez votre saveur)' }).first().click();
    await page.getByRole('button', { name: /Ajouter à la commande/i }).click();
    assert.equal(await page.getByText(/Choisissez votre saveur: Choisissez 1 option/).count(), 1, 'Required flavor must still block adding.');
    await page.getByRole('button').filter({ hasText: 'Fruit de la passion' }).last().click({ force: true });
    await page.getByRole('button', { name: /Ajouter à la commande/i }).click();
    await page.getByRole('button', { name: 'Ma commande', exact: true }).click();
    await page.getByRole('heading', { name: 'Ma commande', exact: true }).waitFor();
    assert.match(await page.locator('body').innerText(), /fruit de la passion/i);
    await page.waitForTimeout(500); // Let the modal entry transition settle for visual QA.
    await page.screenshot({ path: `/tmp/qr-french-${engineName}-cart.png`, animations: 'disabled' });
    await page.getByRole('button', { name: /^Envoyer la commande$/i }).click();
    await page.getByText('Impossible de traiter votre demande. Réessayez ou demandez de l’aide à notre équipe.', { exact: true }).waitFor();
    assert.equal(orders.length, 0);
    assert.equal(await page.getByText('Votre commande a été envoyée.', { exact: true }).count(), 0, 'Network failure must not display success.');
    await page.getByRole('heading', { name: 'Ma commande', exact: true }).waitFor();
    failOrder = false;
    await page.getByRole('button', { name: /^Envoyer la commande$/i }).click();
    await page.getByText('Votre commande a été envoyée.', { exact: true }).first().waitFor();
    await page.getByRole('heading', { name: 'Mon addition', exact: true }).waitFor();
    assert.equal(orders.length, 1);
    assert.equal(orders[0].tableId, 'mesa-test');
    assert.equal(Math.round(orders[0].total * 100), 16197);
    assert.equal(orders[0].items[0].name, 'Parmegiana de Frango para 2 (batata inclusa)');
    assert.equal(orders[0].items[1].selectedModifiers[0].name, 'Maracujá');
    assert.equal(orders[0].items[1].productId, 'caipirinha_51_varios_sabores');
    await page.getByRole('button', { name: 'Fermer', exact: true }).first().click();
    // Keep locale on reload, switch to English and verify the bill also translates.
    await page.reload();
    await page.getByRole('button', { name: 'Langue', exact: true }).click();
    await page.getByRole('button', { name: /English/ }).click();
    await page.getByRole('button', { name: 'View my bill', exact: true }).click();
    await page.getByRole('heading', { name: 'My bill', exact: true }).waitFor();
    assert.match(await page.locator('body').innerText(), /passion fruit/i);
    assert.equal(await page.locator('html').getAttribute('lang'), 'en-US');
    // French must also be accessible before opening a personal tab.
    mode = 'comanda';
    await page.reload();
    await page.getByRole('button', { name: 'Language', exact: true }).click();
    await page.getByRole('button', { name: /Français/ }).click();
    await page.getByRole('heading', { name: 'Ouvrir ma note', exact: true }).waitFor();
    await page.getByPlaceholder('Votre nom').waitFor();
    await page.getByRole('button', { name: 'J’ai déjà une note', exact: true }).click();
    await page.getByRole('heading', { name: 'Accéder à ma note', exact: true }).waitFor();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `/tmp/qr-french-${engineName}-access.png`, animations: 'disabled' });
    // Small screen still supports vertical scrolling and never grows horizontally.
    await page.setViewportSize({ width: 320, height: 568 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    assert.deepEqual(pageErrors, []);
    console.log(JSON.stringify({ ok: true, engine: engineName, ordersSimulated: orders.length, total: orders[0].total, checks: ['French menu/search/modifiers', 'required flavor', 'cart', 'network failure/retry', 'canonical Portuguese payload', 'bill', 'English', 'saved preference', 'personal-tab access', '320px layout'] }));
    await context.close();
  } finally { await browser.close(); }
}
