import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Client } from 'pg';

const NAME_RE = /^(\d{3,})_.*\.sql$/;

export async function runSqlMigrations(): Promise<void> {
  const dir = process.env.MIGRATIONS_DIR ?? join(process.cwd(), '../../deploy/db/migrations');
  const client = new Client({
    host: process.env.POSTGRES_HOST ?? 'localhost',
    port: Number(process.env.POSTGRES_PORT ?? 5432),
    user: process.env.POSTGRES_USER ?? 'admin',
    password: process.env.POSTGRES_PASSWORD ?? 'admin_password',
    database: process.env.POSTGRES_DB ?? 'monitoring_db',
  });
  await client.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [8723641]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    const files = (await readdir(dir))
      .filter((name) => NAME_RE.test(name))
      .sort();
    const applied = new Set(
      ((await client.query('SELECT version FROM schema_migrations')).rows as Array<{ version: string }>).map(
        (row) => row.version,
      ),
    );
    for (const file of files) {
      const version = file.replace(/\.sql$/, '');
      if (applied.has(version)) {
        continue;
      }
      const sql = await readFile(join(dir, file), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [version]);
        await client.query('COMMIT');
        console.log(`applied migration ${file}`);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [8723641]).catch(() => undefined);
    await client.end();
  }
}
