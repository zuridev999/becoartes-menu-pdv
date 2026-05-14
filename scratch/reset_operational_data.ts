import { createClient } from '@libsql/client';

const url = "libsql://becoartes-os-zuridev999.turso.io";
const authToken = "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJpYXQiOjE3Nzc2ODAyMDgsImlkIjoiMDE5ZGQ5YWMtOTcwMS03ZjEzLThjOWMtNmE0MDgxNDRkZjVjIiwicmlkIjoiMTMyYWQxZDYtNGNhOS00ZmEwLWE1YjctODc3NGRlOGJlZjQ4In0.XMRQ-YUHQ6IZh-qn3z201x3yxsZ6OSiTVypUwzLlwBc8ZA_vPRQReVWLhx8BcdigYQjeQdPgOTbRqlMvNnjHCQ";

const db = createClient({
  url: url,
  authToken: authToken,
});

async function resetOperationalData() {
  console.log("🧹 Iniciando limpeza de dados operacionais...");
  
  try {
    const result = await db.batch([
      "DELETE FROM order_items",
      "DELETE FROM orders",
      "DELETE FROM service_requests",
      "UPDATE tables SET status = 'available', last_activity = CURRENT_TIMESTAMP",
      "DELETE FROM audit_logs"
    ], "write");
    
    console.log("✅ Dados operacionais limpos com sucesso!");
    console.log("📊 Tabelas resetadas: order_items, orders, service_requests, audit_logs");
    console.log("🪑 Mesas voltaram para o status 'available'.");
  } catch (error) {
    console.error("❌ Erro ao resetar dados:", error);
  } finally {
    process.exit(0);
  }
}

resetOperationalData();
