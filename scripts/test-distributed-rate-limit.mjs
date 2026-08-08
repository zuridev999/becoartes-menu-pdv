import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@libsql/client';

import { createDistributedRateLimiter } from '../server/security/distributed-rate-limit.mjs';

const dbFile = join(tmpdir(), `becoartes-rate-limit-${process.pid}.db`);
const dbUrl = `file:${dbFile}`;
const firstClient = createClient({ url: dbUrl });
const secondClient = createClient({ url: dbUrl });

try {
  await firstClient.execute(`
    CREATE TABLE security_rate_limits (
      bucket_key TEXT PRIMARY KEY,
      request_count INTEGER NOT NULL,
      reset_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  const firstInstance = createDistributedRateLimiter({ db: firstClient, clock: () => 1000 });
  const secondInstance = createDistributedRateLimiter({ db: secondClient, clock: () => 1000 });
  const input = { scope: 'login', identity: 'shared-user', limit: 3, windowMs: 60_000 };

  assert.equal((await firstInstance.consume(input)).blocked, false);
  assert.equal((await secondInstance.consume(input)).blocked, false);
  assert.equal((await firstInstance.consume(input)).blocked, false);
  const blocked = await secondInstance.consume(input);
  assert.equal(blocked.blocked, true);
  assert.equal(blocked.count, 4);

  const persisted = await firstClient.execute(
    'SELECT request_count FROM security_rate_limits LIMIT 1',
  );
  assert.equal(Number(persisted.rows[0].request_count), 4);

  console.log(JSON.stringify({
    ok: true,
    instances: 2,
    persistedCount: 4,
    backend: 'libsql',
  }));
} finally {
  firstClient.close();
  secondClient.close();
  rmSync(dbFile, { force: true });
}
