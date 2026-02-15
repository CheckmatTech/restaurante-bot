// create_admin.js
require('dotenv').config();
const bcrypt = require('bcrypt');
const { Pool } = require('pg');

if (process.argv.length < 4) {
  console.log('Usage: node create_admin.js <email> <password> [name]');
  process.exit(1);
}

const email = process.argv[2];
const password = process.argv[3];
const name = process.argv[4] || 'Gerente';

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

(async () => {
  try {
    const hash = await bcrypt.hash(password, 10);
    const { rows } = await pool.query(
      'INSERT INTO admins (email, name, password_hash) VALUES ($1, $2, $3) RETURNING id, email',
      [email, name, hash]
    );
    console.log('Admin criado:', rows[0]);
    await pool.end();
  } catch (err) {
    console.error('Erro:', err);
    await pool.end();
    process.exit(1);
  }
})();
