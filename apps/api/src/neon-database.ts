import { Pool } from 'pg';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export function createNeonPool() {
  const value=process.env.DATABASE_URL;
  if(!value)throw new Error('Neon mode requires the server-only DATABASE_URL.');
  let url:URL;
  try { url=new URL(value); } catch { throw new Error('DATABASE_URL must be a valid Neon PostgreSQL connection string.'); }
  if(!['postgresql:','postgres:'].includes(url.protocol)||!url.hostname.endsWith('.neon.tech')||!url.username||!url.password)throw new Error('DATABASE_URL must be a Neon PostgreSQL connection string with credentials.');
  url.searchParams.set('sslmode','verify-full');
  return new Pool({connectionString:url.toString(),max:5,idleTimeoutMillis:10000,connectionTimeoutMillis:75000,query_timeout:30000,enableChannelBinding:true,application_name:'ablest-api'});
}

export async function initialiseNeonDatabase() {
  const pool=createNeonPool();
  try {
    const schema=readFileSync(resolve(__dirname,'../../../postgres/schema.sql'),'utf8');
    await pool.query(schema);
  } catch { throw new Error('Neon initialization failed. Check DATABASE_URL, database permissions, and postgres/schema.sql.'); }
  finally { await pool.end(); }
}
