const { createClient } = require('@libsql/client');

const url = 'libsql://becoartes-os-zuridev999.turso.io';
const authToken = 'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJpYXQiOjE3Nzc2ODAyMDgsImlkIjoiMDE5ZGQ5YWMtOTcwMS03ZjEzLThjOWMtNmE0MDgxNDRkZjVjIiwicmlkIjoiMTMyYWQxZDYtNGNhOS00ZmEwLWE1YjctODc3NGRlOGJlZjQ4In0.XMRQ-YUHQ6IZh-qn3z201x3yxsZ6OSiTVypUwzLlwBc8ZA_vPRQReVWLhx8BcdigYQjeQdPgOTbRqlMvNnjHCQ';

const db = createClient({ url, authToken });

async function run() {
  try {
    console.log("=== ACTIVE SERVICE REQUESTS ===");
    const res = await db.execute("SELECT * FROM service_requests WHERE status != 'resolved' ORDER BY created_at DESC");
    console.log(JSON.stringify(res.rows, null, 2));
  } catch (err) {
    console.error(err);
  }
}

run();
