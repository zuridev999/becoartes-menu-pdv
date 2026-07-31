import { createHash } from 'node:crypto';

const normalizeIdentity = (value) => String(value || 'unknown').trim().toLowerCase() || 'unknown';

const hashIdentity = (value) => createHash('sha256')
  .update(normalizeIdentity(value))
  .digest('hex');

export const createDistributedRateLimiter = ({ db, clock = Date.now }) => {
  if (!db?.execute) throw new Error('A shared database client is required for rate limiting.');

  let cleanupCounter = 0;

  const consume = async ({ scope, identity, limit, windowMs }) => {
    const now = Number(clock());
    const resetAt = now + Number(windowMs);
    const bucketKey = `${scope}:${hashIdentity(identity)}`;
    const result = await db.execute({
      sql: `
        INSERT INTO security_rate_limits (bucket_key, request_count, reset_at, updated_at)
        VALUES (?, 1, ?, ?)
        ON CONFLICT(bucket_key) DO UPDATE SET
          request_count = CASE
            WHEN security_rate_limits.reset_at <= ? THEN 1
            ELSE security_rate_limits.request_count + 1
          END,
          reset_at = CASE
            WHEN security_rate_limits.reset_at <= ? THEN excluded.reset_at
            ELSE security_rate_limits.reset_at
          END,
          updated_at = excluded.updated_at
        RETURNING request_count, reset_at
      `,
      args: [bucketKey, resetAt, now, now, now],
    });
    const row = result.rows[0] || {};
    const count = Number(row.request_count || 0);
    const persistedResetAt = Number(row.reset_at || resetAt);

    cleanupCounter += 1;
    if (cleanupCounter % 500 === 0) {
      void db.execute({
        sql: 'DELETE FROM security_rate_limits WHERE reset_at < ?',
        args: [now - 86_400_000],
      }).catch(() => null);
    }

    return {
      blocked: count > Number(limit),
      count,
      remaining: Math.max(0, Number(limit) - count),
      resetAt: persistedResetAt,
    };
  };

  return { consume };
};
