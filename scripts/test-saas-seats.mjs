import assert from 'node:assert/strict';
import { createClient } from '@libsql/client';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { insertUserWithinPlan, isCompanyOwnerSession } from '../server/auth/saas-seats.mjs';

const directory=mkdtempSync(join(tmpdir(),'zordon-seats-'));
const db=createClient({url:`file:${join(directory,'test.sqlite')}`});
process.env.ZORDON_SAAS_RUNTIME='true';
let checks=0;
try {
  await db.executeMultiple('CREATE TABLE users(id TEXT PRIMARY KEY,empresa_id TEXT,ativo INTEGER,role TEXT); CREATE TABLE saas_subscriptions(empresa_id TEXT PRIMARY KEY,plan TEXT,status TEXT,trial_ends_at INTEGER);');
  await db.execute({sql:'INSERT INTO saas_subscriptions VALUES(?,?,?,?)',args:['own','operacao','active',Date.now()+60000]});
  for(const [plan,limit] of [['operacao',3],['equipe',6],['gestao',10]]) {
    await db.execute('DELETE FROM users');await db.execute({sql:'UPDATE saas_subscriptions SET plan=?',args:[plan]});
    for(let n=0;n<limit;n++) await insertUserWithinPlan(db,'own',{sql:'INSERT INTO users VALUES(?,?,1,?)',args:[`u${n}`,'own',n?'colaborador':'admin']});
    await assert.rejects(insertUserWithinPlan(db,'own',{sql:'INSERT INTO users VALUES(?,?,1,?)',args:['over','own','colaborador']}),new RegExp(`${limit} usuários`));checks++;
    assert.equal(await isCompanyOwnerSession(db,'own',{id:'os:u0'}),true);checks++;
    assert.equal(await isCompanyOwnerSession(db,'other',{id:'os:u0'}),false);checks++;
  }
  await db.execute('UPDATE saas_subscriptions SET trial_ends_at=0');
  await assert.rejects(insertUserWithinPlan(db,'own',{sql:'INSERT INTO users VALUES(?,?,1,?)',args:['expired','own','colaborador']}),/indisponível/);checks++;
  console.log(JSON.stringify({ok:true,checks,scope:'real SQLite seat claims for 3/6/10 users and company owner isolation'}));
} finally { db.close();rmSync(directory,{recursive:true,force:true}); }
