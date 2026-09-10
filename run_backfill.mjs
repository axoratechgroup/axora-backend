import 'dotenv/config';
import { readFileSync } from 'fs';
import pg from 'pg';

const sql = readFileSync(process.argv[2] || 'backfill_wallets_and_balances.sql', 'utf8');
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });

async function main() {
  await client.connect();

  const before = await client.query(`
    SELECT COUNT(*) FILTER (WHERE w.id IS NULL) AS users_sin_wallet,
           COUNT(*) FILTER (WHERE w.id IS NOT NULL AND b.currency IS NULL) AS wallets_sin_balances
    FROM users u
    LEFT JOIN wallets w ON w.user_id = u.id
    LEFT JOIN LATERAL (SELECT currency FROM balances WHERE wallet_id = w.id LIMIT 1) b ON true
  `);
  console.log('ANTES:', before.rows[0]);

  await client.query(sql);

  const after = await client.query(`
    SELECT u.username, u.email, w.id AS wallet_id, COUNT(b.id) AS balances_count
    FROM users u
    JOIN wallets w ON w.user_id = u.id
    LEFT JOIN balances b ON b.wallet_id = w.id
    GROUP BY u.username, u.email, w.id
    ORDER BY balances_count
  `);
  console.log('DESPUES (por usuario):');
  console.table(after.rows);

  await client.end();
}

main().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
