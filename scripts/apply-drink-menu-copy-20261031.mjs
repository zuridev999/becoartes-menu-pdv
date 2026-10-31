import { createClient } from '@libsql/client';

const descriptions = [
  {
    id: '5cb33298-f4ee-4a04-927b-cb893aa7aecf',
    name: 'Caipirinha',
    before: 'Caipirinha premium de limão com Cachaça Saliníssima.',
    after: 'Caipirinha. O clássico para quem gosta do sabor da cachaça com limão fresco. É cítrica, doce na medida e combina com uma porção no meio da mesa e uma conversa que vai longe. Feita com cachaça premium, limão e açúcar.',
  },
  {
    id: 'eitvvb40r',
    name: 'Caipiroska',
    before: '',
    after: 'Caipiroska. Para quem gosta de caipirinha, mas prefere deixar a cachaça de lado. A vodka dá espaço ao frescor do limão e deixa o sabor mais neutro, sem perder o jeito do clássico. Boa para começar a noite com um petisco. Feita com vodka, limão e açúcar.',
  },
  {
    id: '46gcrhr62',
    name: 'Saquerinha',
    before: '',
    after: 'Saquerinha. Uma versão mais leve da caipirinha, para quem gosta do clássico, mas prefere um sabor mais suave. Tem o frescor do limão sem o gosto marcante da cachaça. Uma boa pedida para acompanhar um petisco e ficar mais um pouco na conversa. Feita com saquê, limão e açúcar.',
  },
  {
    id: 'dr2',
    name: 'Gin Tônica Nacional (Apogee)',
    before: 'Gin premium, tônica e especiarias.',
    after: 'Gin Tônica Nacional. Um drink fresco, com o amarguinho da tônica e o sabor do gin. É uma boa pedida para quem prefere algo menos doce e gosta de beber sem pressa, enquanto aproveita a mesa e a conversa. Feita com gin nacional e água tônica.',
  },
  {
    id: 'k6yieoj4z',
    name: 'Gin Tropical',
    before: '',
    after: 'Gin Tropical. Para quem quer um gin mais frutado e uma noite mais animada. Tem sabor de manga, é refrescante e leva energético — informação importante para quem vai escolher. Feito com gin e Monster Mango Loco.',
  },
  {
    id: 'uwrgopxgm',
    name: 'Negroni',
    before: '',
    after: 'Negroni. Para quem gosta de um drink amargo e marcante, daqueles de beber aos poucos. Tem sabor que fica na boca e combina com um petisco e uma conversa sem pressa. Feito com gin, Campari e Aperol.',
  },
];

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;
if (!url || !authToken) throw new Error('Turso credentials are required');
const db = createClient({ url, authToken });

const current = await db.execute({
  sql: `SELECT id, name, description FROM menu WHERE id IN (${descriptions.map(() => '?').join(',')})`,
  args: descriptions.map(({ id }) => id),
});
const byId = new Map(current.rows.map((row) => [String(row.id), row]));
for (const item of descriptions) {
  const row = byId.get(item.id);
  if (!row || row.name !== item.name || ![item.before, item.after].includes(String(row.description || ''))) {
    throw new Error(`Unexpected catalog state for ${item.id}; no changes made`);
  }
}

const pending = descriptions.filter((item) => String(byId.get(item.id).description || '') !== item.after);
if (pending.length) {
  const version = String(Date.now());
  const results = await db.batch([
    ...pending.map(({ id, before, after }) => ({
      sql: 'UPDATE menu SET description = ? WHERE id = ? AND COALESCE(description, ?) = ?',
      args: [after, id, '', before],
    })),
    {
      sql: "INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES ('catalog_version', ?, CURRENT_TIMESTAMP)",
      args: [version],
    },
  ], 'write');
  if (results.slice(0, pending.length).some((result) => result.rowsAffected !== 1)) {
    throw new Error('One or more descriptions were not updated; inspect catalog before retrying');
  }
}

const verified = await db.execute({
  sql: `SELECT id, description FROM menu WHERE id IN (${descriptions.map(() => '?').join(',')})`,
  args: descriptions.map(({ id }) => id),
});
for (const item of descriptions) {
  if (verified.rows.find((row) => row.id === item.id)?.description !== item.after) {
    throw new Error(`Verification failed for ${item.id}`);
  }
}
console.log(JSON.stringify({ ok: true, updated: pending.map(({ name }) => name), verified: descriptions.length }));
