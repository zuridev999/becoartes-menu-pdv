import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { createClient } from '@libsql/client';
import { businessDateKey } from '../server/business-time.mjs';

const real = process.argv.includes('--real');
const port = Number(process.env.QR_PREVIEW_PORT || (real ? 18442 : 18441));
const folder = await mkdtemp(join(tmpdir(), 'beco-qr-payment-preview-'));
const url = `http://127.0.0.1:${port}`;
const dbUrl = `file:${join(folder, 'preview.db')}`;
let gateway = {};
if (real) {
  // Read only this PDV runtime's payment settings. Never print or save credentials.
  const raw = execFileSync('ssh', ['-i', '/Users/guimameluco/.ssh/id_rsa_becoartes_ed', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', 'root@72.60.252.50',
    'docker exec becoartes-operational node -e \'process.stdout.write(JSON.stringify({token:process.env.PAGBANK_TOKEN,apiBase:process.env.PAGBANK_API_BASE_URL}))\''], { encoding: 'utf8', timeout: 15000 });
  gateway = JSON.parse(raw);
  if (!gateway.token || gateway.apiBase !== 'https://api.pagseguro.com') throw new Error('Configuração do gateway do PDV indisponível');
}
const child = spawn(process.execPath, ['server/bff.mjs'], {
  cwd: process.cwd(), stdio: ['ignore', 'inherit', 'inherit'],
  env: { PATH: process.env.PATH, HOME: process.env.HOME, PORT: String(port), BFF_LISTEN_HOST: '127.0.0.1',
    TURSO_DATABASE_URL: dbUrl, BFF_SESSION_SECRET: randomBytes(32).toString('hex'),
    DEFAULT_MANAGER_PIN: '7531', DEFAULT_OPERATOR_PIN: '1357', TABLET_SETUP_PIN: '9753',
    BOOTSTRAP_ADMIN_PIN: '8642', COMANDA_ACCESS_PIN: '8642',
    QR_PAYMENTS_PROVIDER: real ? 'pagbank' : 'simulator',
    ...(real ? { PAGBANK_TOKEN: gateway.token, PAGBANK_API_BASE_URL: gateway.apiBase, QR_PAYMENT_MAX_CENTS: '113' } : {}),
    // No webhook URL: local preview confirms by authenticated Orders polling.
    CASH_SANDBOX_MODE: '1', INVENTORY_RECONCILIATION_DISABLED: '1',
    DELIVERY_OS_CRM_SYNC: 'disabled', DELIVERY_LOGISTICS_PROVIDER: 'disabled',
    DELIVERY_WHATSAPP_PROVIDER: 'disabled', DELIVERY_EMAIL_PROVIDER: 'disabled', DELIVERY_SMS_PROVIDER: 'disabled',
    OS_EMPRESA_ID: 'local-qr-payment-demo', OS_CHECKLIST_ALERTS_URL: `${url}/disabled-alerts`,
    ZURI_WHATSAPP_BASE_URL: '', APP_VERSION: '1.29.2-qr-payment-local',
  },
});
const stop = () => { child.kill('SIGTERM'); process.exit(0); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
child.on('exit', code => { process.exitCode = code || 0; });
let ready = false;
for (let i = 0; i < 80; i++) {
  try { const response = await fetch(`${url}/api/health`); if (response.ok) { ready = true; break; } } catch { /* starting */ }
  await new Promise(resolve => setTimeout(resolve, 150));
}
if (!ready) { child.kill(); throw new Error('Prévia não iniciou.'); }
const db = createClient({ url: dbUrl });
const settings = { serviceTax: 13, qrMode: 'mesa', publicLanguages: ['pt'], pdv: { tickerEnabled: false }, tables: { count: 12 } };
await db.execute({ sql: "INSERT OR REPLACE INTO app_settings(key,value) VALUES ('settings',?)", args: [JSON.stringify(settings)] });
await db.execute({ sql: "INSERT INTO pdv_cash_sandbox(id,empresa_id,data,responsavel_id,status,created_at,updated_at) VALUES ('preview-cash','local-qr-payment-demo',?,'admin-bootstrap','Aberto',?,?)", args: [businessDateKey(new Date()), Math.floor(Date.now()/1000), Math.floor(Date.now()/1000)] });
const fixtures = real ? [{ number: 7, products: [{ id: 'test-real', name: 'Teste de pagamento', price: 1 }] }, { number: 8, products: [{ id: 'test-real-card', name: 'Teste de cartão', price: 1 }] }]
  : [{ number: 6, products: [{ id: 'demo-water', name: 'Água sem gás', price: 7.99 }, { id: 'demo-fries', name: 'Batata frita', price: 32.99 }] }, { number: 7, products: [{ id: 'demo-credit', name: 'Conta para testar cartão', price: 0.88 }] }];
await db.execute("INSERT INTO categories(id,name,visible) VALUES ('qr-demo','Itens de demonstração',1)");
for (const fixture of fixtures) {
  const table = (await db.execute({ sql: 'SELECT id FROM tables WHERE CAST(number AS INTEGER)=?', args: [fixture.number] })).rows[0];
  const orderId = `demo-order-${fixture.number}`;
  await db.execute({ sql: "UPDATE tables SET status='ordering' WHERE id=?", args: [table.id] });
  await db.execute({ sql: "INSERT INTO orders(id,table_id,total,status,origin) VALUES (?,?,?,'ready','qr')", args: [orderId, table.id, fixture.products.reduce((s,p) => s+p.price,0)] });
  for (const product of fixture.products) {
    await db.execute({ sql: "INSERT INTO menu(id,name,description,price,category_id,visible) VALUES (?,?,?,?,'qr-demo',1)", args: [product.id, product.name, 'Demonstração local', product.price] });
    await db.execute({ sql: "INSERT INTO order_items(id,order_id,product_id,quantity,price_at_time,selected_modifiers) VALUES (?,?,?,1,?,'[]')", args: [`item-${product.id}`, orderId, product.id, product.price] });
  }
}
db.close();
console.log(real ? '\nTESTE REAL: cada mesa tem total de R$ 1,13 (R$ 1,00 + taxa de serviço). A cobrança só é criada ao confirmar no formulário.' : '\nSIMULAÇÃO: nenhuma cobrança real e nenhum acesso ao banco do restaurante.');
for (const fixture of fixtures) console.log(`${url}/mesa/${fixture.number}`);
console.log(`PDV local: ${url}/pdv — PIN de teste 8642`);
