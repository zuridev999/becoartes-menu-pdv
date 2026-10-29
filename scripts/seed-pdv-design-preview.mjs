import {readFile,realpath} from 'node:fs/promises';
import {dirname,basename} from 'node:path';
import {tmpdir} from 'node:os';
import {createClient} from '@libsql/client';
import {repairJuiceImages} from './catalog/repair-juice-images.mjs';
import {consolidateCocktailFlavors} from './catalog/consolidate-cocktail-flavors.mjs';
const path = await realpath(process.argv[2] || '');
if (dirname(dirname(path)) !== await realpath(tmpdir()) || !basename(dirname(path)).startsWith('beco-qr-payment-preview-') || basename(path) !== 'preview.db') throw new Error('Permitido somente em banco temporário da prévia local.');
const catalog=JSON.parse(await readFile('.local-preview/catalog.json','utf8'));
const db=createClient({url:`file:${path}`});
const tx=await db.transaction('write');
try {
  await tx.execute("UPDATE menu SET product_code=NULL WHERE id LIKE 'demo-%'");
  for(const table of ['categories','menu','modifier_groups','modifiers','product_modifier_groups','category_modifier_groups']) {
    const columns = new Set((await tx.execute(`PRAGMA table_info(${table})`)).rows.map(r=>r.name));
    for(const row of catalog[table]) {
      const keys=Object.keys(row).filter(k=>columns.has(k));
      await tx.execute({sql:`INSERT OR REPLACE INTO ${table}(${keys.join(',')}) VALUES (${keys.map(()=>'?').join(',')})`,args:keys.map(k=>row[k])});
    }
  }
  await tx.execute("INSERT OR REPLACE INTO users(id,empresa_id,nome,email,role,ativo,pin,is_operador,permitir_acesso_remoto,pdv_sell_enabled) VALUES ('preview-owner','local-qr-payment-demo','Superadmin de teste','preview@localhost','super_admin',1,'8642',1,1,1)");
  let code = 9900;
  for (const row of (await tx.execute("SELECT id FROM menu WHERE id LIKE 'demo-%'")).rows) await tx.execute({sql:'UPDATE menu SET product_code=? WHERE id=?',args:[code++,row.id]});
  await tx.commit();
} catch(err) { await tx.rollback(); throw err; } finally {tx.close();}
console.log(await consolidateCocktailFlavors(db));
await repairJuiceImages(db);
db.close();
console.log('Catálogo copiado apenas para prévia isolada; sem usuários ou movimentações reais.');
