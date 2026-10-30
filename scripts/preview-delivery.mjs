import {spawn} from 'node:child_process';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {createClient} from '@libsql/client';
import {defaultDeliverySettings} from '../server/delivery/commerce.mjs';
const folder=await mkdtemp(join(tmpdir(),'beco-delivery-preview-')),port=Number(process.env.DELIVERY_PREVIEW_PORT||18447),url=`http://127.0.0.1:${port}`;
const child=spawn(process.execPath,['server/bff.mjs'],{stdio:'inherit',env:{PATH:process.env.PATH,HOME:process.env.HOME,PORT:String(port),BFF_LISTEN_HOST:'127.0.0.1',ALLOWED_WEB_ORIGINS:'http://127.0.0.1:18448',TURSO_DATABASE_URL:`file:${join(folder,'preview.db')}`,BFF_SESSION_SECRET:randomBytes(32).toString('hex'),DEFAULT_MANAGER_PIN:'7531',DEFAULT_OPERATOR_PIN:'1357',TABLET_SETUP_PIN:'9753',BOOTSTRAP_ADMIN_PIN:'8642',COMANDA_ACCESS_PIN:'8642',CASH_SANDBOX_MODE:'1',INVENTORY_RECONCILIATION_DISABLED:'1',DELIVERY_PUBLIC_STATUS:'open',DELIVERY_PAYMENT_PROVIDER:'mock',DELIVERY_LOCAL_SIMULATION:'1',DELIVERY_KITCHEN_DISPATCH_MODE:'production',DELIVERY_LOGISTICS_PROVIDER:'disabled',DELIVERY_OS_CRM_SYNC:'disabled',DELIVERY_EMAIL_PROVIDER:'disabled',DELIVERY_SMS_PROVIDER:'disabled',DELIVERY_WHATSAPP_PROVIDER:'disabled',OS_EMPRESA_ID:'local-delivery-demo',OS_SYSTEM_USER_ID:'local-delivery-test-user',OS_CHECKLIST_ALERTS_URL:`${url}/disabled-alerts`,APP_VERSION:'1.30.2-delivery-local'}});
process.on('SIGINT',()=>{child.kill();process.exit();});process.on('SIGTERM',()=>{child.kill();process.exit();});child.on('exit',code=>{process.exitCode=code||0;});
let ready=false;for(let i=0;i<100;i++){try{const r=await fetch(`${url}/api/health`);if(r.ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,150));}
if(!ready){child.kill();throw Error('Prévia indisponível');}
await fetch(`${url}/api/app/init?view=delivery`);
const db=createClient({url:`file:${join(folder,'preview.db')}`});
const settings={...defaultDeliverySettings,acceptingOrders:true,pickupEnabled:true,deliveryEnabled:true,pickupAddress:'Endereço de demonstração · São Paulo',postalPrefixes:['054'],deliveryFee:7.5,hours:defaultDeliverySettings.hours.map(()=>({enabled:true,start:'00:00',end:'23:59'}))};
await db.execute({sql:"INSERT OR REPLACE INTO app_settings(key,value) VALUES ('delivery_settings',?)",args:[JSON.stringify(settings)]});
await db.execute("INSERT OR REPLACE INTO categories(id,name,visible) VALUES ('demo-food','Porções',1),('demo-drinks','Bebidas',1)");
for(const p of [{id:'demo-fries',name:'Batata frita',price:32.99,cat:'demo-food',image:'/images/batata-frita.jpg'},{id:'demo-pastel',name:'Pastelzinho',price:35.99,cat:'demo-food',image:'/images/pastel.jpg'},{id:'demo-water',name:'Água sem gás',price:7.99,cat:'demo-drinks',image:'/images/agua-gas.jpg'},{id:'demo-juice',name:'Suco de laranja',price:14.99,cat:'demo-drinks',image:'/images/suco-laranja.png'}])await db.execute({sql:'INSERT OR REPLACE INTO menu(id,name,description,price,category_id,image,visible,delivery_visible) VALUES (?,?,?,?,?,?,1,1)',args:[p.id,p.name,'Produto de demonstração local',p.price,p.cat,p.image]});
await db.execute("INSERT OR REPLACE INTO modifier_groups(id,name,min_choices,max_choices,is_required,status) VALUES ('demo-flavors','Recheios',1,1,1,'active')");
for(const [id,name] of [['cheese','Queijo'],['chicken','Frango'],['beef','Carne']])await db.execute({sql:"INSERT OR REPLACE INTO modifiers(id,group_id,name,price,status) VALUES (?,'demo-flavors',?,0,'active')",args:[id,name]});
await db.execute("INSERT OR REPLACE INTO product_modifier_groups(product_id,group_id) VALUES ('demo-pastel','demo-flavors')");
await db.execute("INSERT OR REPLACE INTO app_settings(key,value) VALUES ('catalog_version','delivery-demo-v2')");
await db.execute("INSERT OR REPLACE INTO estoque_produtos(id,empresa_id,nome,quantidade_atual,estoque_minimo,ativo) VALUES ('demo-water-stock','local-delivery-demo','Água sem gás',20,2,1)");
await db.execute("UPDATE menu SET remote_stock_id='demo-water-stock' WHERE id='demo-water'");
db.close();
console.log(`DELIVERY LOCAL PRONTO: API ${url}. Banco temporário ${folder}. Nenhuma cobrança ou mensagem real. PIN admin de teste: 8642.`);
