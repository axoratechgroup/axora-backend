import 'dotenv/config';
import pg from 'pg';

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });

async function main() {
  await client.connect();

  // 1. Chequeo de seguridad: ¿hay emails que colisionarían al normalizar?
  const collisions = await client.query(`
    SELECT LOWER(TRIM(email)) AS normalized, array_agg(email) AS variants, array_agg(id) AS ids
    FROM users
    GROUP BY LOWER(TRIM(email))
    HAVING COUNT(*) > 1
  `);

  if (collisions.rows.length > 0) {
    console.log('⚠️  Hay emails que colisionarían al normalizar. Resolvé esto a mano antes de correr el backfill:');
    console.table(collisions.rows);
    await client.end();
    process.exit(1);
  }

  console.log('Sin colisiones. Normalizando...');

  const before = await client.query(
    `SELECT id, username, email FROM users WHERE email <> LOWER(TRIM(email))`
  );
  console.log(`Usuarios a normalizar: ${before.rows.length}`);
  console.table(before.rows);

  const result = await client.query(
    `UPDATE users SET email = LOWER(TRIM(email)) WHERE email <> LOWER(TRIM(email))
     RETURNING id, username, email`
  );

  console.log(`Listo, ${result.rowCount} emails normalizados:`);
  console.table(result.rows);

  await client.end();
}

main().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });