import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

export const corrections = JSON.parse(await readFile(new URL('./public-description-corrections.json', import.meta.url), 'utf8'));

export async function cleanPublicDescriptions(db) {
  const tx = await db.transaction('write');
  const changes = [];
  try {
    for (const { id, before, after } of corrections) {
      const row = (await tx.execute({ sql: 'SELECT description FROM menu WHERE id=?', args: [id] })).rows[0];
      // Preserve a more recent staff edit; only replace the exact audited legacy text.
      if (!row || row.description !== before) continue;
      await tx.execute({ sql: 'UPDATE menu SET description=? WHERE id=? AND description=?', args: [after, id, before] });
      changes.push({ id, before, after });
    }
    if (changes.length) {
      await tx.execute({
        sql: 'INSERT INTO audit_logs(id,action,details,origin,author_name) VALUES (?,?,?,?,?)',
        args: [randomUUID(), 'catalog_public_description_cleanup', JSON.stringify({ release: 'pdv-v1.30.1', changes }), 'admin', 'Correção autorizada pelo proprietário'],
      });
      await tx.execute({
        sql: "INSERT INTO app_settings(key,value,updated_at) VALUES ('catalog_version',?,CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=CURRENT_TIMESTAMP",
        args: [`pdv-1.30.1-${Date.now()}`],
      });
    }
    await tx.commit();
    return { changed: changes.map(change => change.id) };
  } catch (error) {
    await tx.rollback();
    throw error;
  } finally { tx.close(); }
}
