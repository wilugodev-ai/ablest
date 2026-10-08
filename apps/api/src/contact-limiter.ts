import { createHash } from 'node:crypto';
import { createNeonPool } from './neon-database';

const windowMs = 15 * 60 * 1000;

// Uses the existing durable attempt store; no inquiry text is saved here.
export class ContactLimiter {
  private readonly backend = process.env.DATA_BACKEND || 'sqlite';
  private pool?: ReturnType<typeof createNeonPool>;

  private async consume(key: string, limit: number): Promise<boolean> {
    const now = Date.now();
    if (this.backend === 'neon') {
      this.pool ??= createNeonPool();
      await this.pool.query("DELETE FROM ablest_attempts WHERE key LIKE 'contact:%' AND start<$1", [now - windowMs]);
      const result = await this.pool.query(
        `INSERT INTO ablest_attempts(key,count,start) VALUES($1,1,$2)
         ON CONFLICT(key) DO UPDATE SET
           count=CASE WHEN ablest_attempts.start<=$2-$3 THEN 1 ELSE least(ablest_attempts.count+1,$4+1) END,
           start=CASE WHEN ablest_attempts.start<=$2-$3 THEN $2 ELSE ablest_attempts.start END
         RETURNING count`, [key, now, windowMs, limit],
      );
      return Number(result.rows[0].count) <= limit;
    }
    if (this.backend === 'sqlite') {
      // Hosted mode never imports the module that opens the local SQLite file.
      const { db } = await import('./store');
      db.exec('CREATE TABLE IF NOT EXISTS login_attempts(key TEXT PRIMARY KEY,count INTEGER NOT NULL,start INTEGER NOT NULL)');
      db.prepare("DELETE FROM login_attempts WHERE key LIKE 'contact:%' AND start<?").run(now - windowMs);
      const row = db.prepare(
        `INSERT INTO login_attempts(key,count,start) VALUES(?,1,?)
         ON CONFLICT(key) DO UPDATE SET
           count=CASE WHEN login_attempts.start<=?-? THEN 1 ELSE min(login_attempts.count+1,?+1) END,
           start=CASE WHEN login_attempts.start<=?-? THEN ? ELSE login_attempts.start END
         RETURNING count`,
      ).get(key, now, now, windowMs, limit, now, windowMs, now);
      return Number(row?.count) <= limit;
    }
    // The retained legacy Supabase adapter has no contact delivery setup.
    throw new Error('Contact delivery requires SQLite or Neon.');
  }

  async check(email: string): Promise<boolean> {
    // Limit global attempts first, bounding the number of sender keys created.
    if (!await this.consume('contact:global', 10)) return false;
    const hash = createHash('sha256').update(email).digest('hex');
    return this.consume(`contact:sender:${hash}`, 3);
  }

  async close() { await this.pool?.end(); }
}
