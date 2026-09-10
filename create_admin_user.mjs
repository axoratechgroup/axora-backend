import 'dotenv/config';
import pg from 'pg';
import bcrypt from 'bcrypt';

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });

async function main() {
  await client.connect();
  console.log('Connected to database.');

  const email = 'admintest@axora.com'.trim().toLowerCase();
  const username = 'admintest';
  const rawPassword = 'axora.test';
  const firstName = 'Admin';
  const lastName = 'Test';
  const role = 'admin';

  const passwordHash = await bcrypt.hash(rawPassword, 10);

  await client.query('BEGIN');

  try {
    // Check if user already exists
    const existing = await client.query(
      'SELECT id, email, username, role FROM users WHERE email = $1 OR username = $2',
      [email, username]
    );

    let userId;
    if (existing.rows.length > 0) {
      const user = existing.rows[0];
      userId = user.id;
      console.log(`User already exists (id: ${userId}, email: ${user.email}, role: ${user.role}). Updating role and password...`);
      await client.query(
        `UPDATE users
         SET password_hash = $1, role = $2, email = $3, first_name = $4, last_name = $5
         WHERE id = $6`,
        [passwordHash, role, email, firstName, lastName, userId]
      );
    } else {
      console.log('Creating new admin user...');
      const insertResult = await client.query(
        `INSERT INTO users (first_name, last_name, username, email, password_hash, role)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [firstName, lastName, username, email, passwordHash, role]
      );
      userId = insertResult.rows[0].id;
    }

    // Ensure wallet exists
    const walletResult = await client.query(
      `INSERT INTO wallets (user_id)
       VALUES ($1)
       ON CONFLICT (user_id) DO UPDATE SET user_id = EXCLUDED.user_id
       RETURNING id`,
      [userId]
    );
    const walletId = walletResult.rows[0].id;
    console.log(`Wallet confirmed (id: ${walletId})`);

    // Ensure balances exist for all currencies
    const balancesResult = await client.query(
      `INSERT INTO balances (wallet_id, currency, amount)
       SELECT $1, code, 0
       FROM currencies
       ON CONFLICT (wallet_id, currency) DO NOTHING
       RETURNING id, currency, amount`,
      [walletId]
    );
    console.log(`Balances checked/inserted (${balancesResult.rowCount} newly added).`);

    await client.query('COMMIT');

    // Verification
    const verifyUser = await client.query(
      `SELECT u.id, u.first_name, u.last_name, u.username, u.email, u.role, u.password_hash, w.id as wallet_id
       FROM users u
       LEFT JOIN wallets w ON w.user_id = u.id
       WHERE u.id = $1`,
      [userId]
    );
    const u = verifyUser.rows[0];
    const passwordValid = await bcrypt.compare(rawPassword, u.password_hash);

    const balances = await client.query(
      'SELECT currency, amount FROM balances WHERE wallet_id = $1 ORDER BY currency',
      [u.wallet_id]
    );

    console.log('\n========================================');
    console.log('✅ Admin User Successfully Configured!');
    console.log('========================================');
    console.log(`ID:        ${u.id}`);
    console.log(`Email:     ${u.email}`);
    console.log(`Username:  ${u.username}`);
    console.log(`Name:      ${u.first_name} ${u.last_name}`);
    console.log(`Role:      ${u.role}`);
    console.log(`Wallet ID: ${u.wallet_id}`);
    console.log(`Password Valid? ${passwordValid}`);
    console.log('Balances:');
    console.table(balances.rows);
    console.log('========================================\n');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('❌ Error configuring admin user:', err);
  process.exit(1);
});
