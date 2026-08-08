import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const contract = JSON.parse(
  readFileSync(resolve(process.cwd(), "config/shared-database-contract.json"), "utf8"),
);

assert.match(contract.contractVersion, /^\d{4}-\d{2}-\d{2}\.\d+$/);
assert.equal(contract.compatibilityWindow, "N/N-1");
assert.ok(Array.isArray(contract.tables) && contract.tables.length > 0);

const names = new Set();
for (const table of contract.tables) {
  assert.ok(table.name && table.owner, "Every shared table needs a name and owner.");
  assert.ok(["OS", "PDV"].includes(table.owner), `Invalid owner for ${table.name}`);
  assert.ok(Array.isArray(table.writers) && table.writers.length > 0, `Missing writer for ${table.name}`);
  assert.ok(Array.isArray(table.readers) && table.readers.length > 0, `Missing reader for ${table.name}`);
  assert.equal(names.has(table.name), false, `Duplicate contract entry for ${table.name}`);
  names.add(table.name);
}

for (const required of [
  "users",
  "estoque_produtos",
  "estoque_movimentacoes",
  "fichas_tecnicas",
  "orders",
  "order_items",
  "closed_bills",
]) {
  assert.equal(names.has(required), true, `Critical shared table is not owned: ${required}`);
}

console.log(JSON.stringify({
  ok: true,
  contractVersion: contract.contractVersion,
  compatibilityWindow: contract.compatibilityWindow,
  ownedTables: names.size,
}, null, 2));
