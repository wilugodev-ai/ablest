import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync,mkdtempSync,existsSync,rmSync,realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { PGlite } from '@electric-sql/pglite';
const require=createRequire(new URL('../apps/api/package.json',import.meta.url));
const {CloudController}=require('../api/dist/cloud.js');
const origin='https://www.ablestsolutions.com';
const id='11111111-1111-4111-8111-111111111111';
const alice={id,email:'alice@example.com',name:'Alice',company:'A Company',phone:'123',role:'client'};
const cookie=`ablest_admin=${'a'.repeat(64)}`;

function controller(replies,role='client'){
 const saved={url:process.env.SUPABASE_URL,key:process.env.SUPABASE_SECRET_KEY,origin:process.env.WEB_ORIGIN};
 process.env.SUPABASE_URL='https://testing.supabase.co';process.env.SUPABASE_SECRET_KEY='sb_secret_testing_not_a_real_key';process.env.WEB_ORIGIN=origin;
 const api=new CloudController(),calls=[];
 let remaining=[...replies];
 const db={from(table){const query={table,filters:[],operation:'select',value:null};calls.push(query);const builder={select(){return builder;},eq(key,value){query.filters.push([key,value]);return builder;},gt(){return builder;},lt(){return builder;},limit(){return builder;},order(){return builder;},update(value){query.operation='update';query.value=value;return builder;},insert(value){query.operation='insert';query.value=value;return builder;},delete(){query.operation='delete';return builder;},maybeSingle(){return execute();},single(){return execute();},then(resolve,reject){return execute().then(resolve,reject);}};function execute(){if(!remaining.length)throw new Error('Unexpected database operation');return Promise.resolve({data:remaining.shift(),error:null});}return builder;}};
 api.db=db;
 return{api,calls,db,restore(){for(const[name,value]of[['SUPABASE_URL',saved.url],['SUPABASE_SECRET_KEY',saved.key],['WEB_ORIGIN',saved.origin]]){if(value===undefined)delete process.env[name];else process.env[name]=value;}}};
}

test('hosted schema denies browser roles, seeds once, throttles, and caps uploads atomically',async()=>{
 const pg=new PGlite();
 try{
  await pg.exec('CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;CREATE SCHEMA storage;CREATE TABLE storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);');
  const migration=readFileSync(new URL('../supabase/migrations/202610070001_content.sql',import.meta.url),'utf8');await pg.exec(migration);await pg.exec(migration);
  assert.equal((await pg.query('SELECT count(*) AS n FROM public.ablest_projects')).rows[0].n,2);
  for(const role of ['anon','authenticated']){
   await pg.exec(`SET ROLE ${role}`);
   await assert.rejects(pg.query('SELECT * FROM public.ablest_users'),/permission denied/);
   await assert.rejects(pg.query("SELECT public.ablest_throttle('forged')"),/permission denied/);
   await assert.rejects(pg.query('SELECT * FROM public.ablest_images'),/permission denied/);await pg.exec('RESET ROLE');
  }
  await pg.exec('SET ROLE service_role');
  for(let i=0;i<10;i++)assert.equal((await pg.query("SELECT public.ablest_throttle('login:alice@example.com') AS allowed")).rows[0].allowed,true);
  assert.equal((await pg.query("SELECT public.ablest_throttle('login:alice@example.com') AS allowed")).rows[0].allowed,false);
  const project=(await pg.query('SELECT id FROM public.ablest_projects LIMIT 1')).rows[0].id;
  for(let i=0;i<12;i++){const row=(await pg.query('SELECT public.ablest_add_image(gen_random_uuid(),$1,$2,$3) AS image',[project,`Image ${i}`,`${project}/${i}.webp`])).rows[0].image;assert.equal(row.position,i);}
  await assert.rejects(pg.query('SELECT public.ablest_add_image(gen_random_uuid(),$1,$2,$3)',[project,'Overflow','overflow.webp']),/image_limit/);
  await pg.exec('RESET ROLE');
  assert.equal((await pg.query("SELECT public FROM storage.buckets WHERE id='ablest-project-images'")).rows[0].public,false);
  await pg.query("INSERT INTO public.ablest_users(email,name,role,salt,hash)VALUES('owner@example.com','Owner','admin','salt','hash')");
  await assert.rejects(pg.query("INSERT INTO public.ablest_users(email,name,role,salt,hash)VALUES('other@example.com','Other','admin','salt','hash')"),/ablest_single_admin/);
 }finally{await pg.close();}
});

test('cloud profile updates always target the authenticated user and reject role/ID injection',async()=>{
 const ctx=controller([{user_id:id},alice,{...alice,name:'Updated'}]);
 try{const result=await ctx.api.updateProfile({name:'Updated',company:'Company',phone:'123'},cookie,origin);assert.equal(result.name,'Updated');const update=ctx.calls.find(c=>c.operation==='update');assert.deepEqual(update.filters,[['id',id]]);assert.equal(Object.hasOwn(update.value,'role'),false);}finally{ctx.restore();}
 for(const forged of [{role:'admin'},{id:'22222222-2222-4222-8222-222222222222'}]){const ctx=controller([{user_id:id},alice]);try{await assert.rejects(ctx.api.updateProfile({name:'Alice',company:'',phone:'',...forged},cookie,origin),e=>e.getStatus()===400);assert.equal(ctx.calls.some(c=>c.operation==='update'),false);}finally{ctx.restore();}}
});
test('clients cannot use cloud administrator endpoints or view draft images',async()=>{
 const ctx=controller([{user_id:id},alice]);try{await assert.rejects(ctx.api.adminProjects(cookie),e=>e.getStatus()===403);}finally{ctx.restore();}
 const draft=controller([{path:'draft.webp',project:{published:false}},{user_id:id},alice]);try{await assert.rejects(draft.api.image(id,cookie,{}),e=>e.getStatus()===404);}finally{draft.restore();}
 const anon=controller([]);try{await assert.rejects(anon.api.profile(''),e=>e.getStatus()===401);await assert.rejects(anon.api.register({email:'forged@example.com',name:'Fake',password:'valid-password-12345',role:'admin'},origin,'',{}),e=>e.getStatus()===400);assert.equal(anon.calls.length,0);}finally{anon.restore();}
});
test('cloud owner setup requires the private setup code before saving any credentials',async()=>{
 const saved=process.env.ADMIN_SETUP_TOKEN;process.env.ADMIN_SETUP_TOKEN='setup-code-testing-only-12345678901234567890';
 const ctx=controller([[]]);try{await assert.rejects(ctx.api.setup({email:'wilugo91@gmail.com',password:'a-valid-password-12345'},origin,{}),e=>e.getStatus()===403);assert.equal(ctx.calls.some(c=>c.operation==='insert'),false);}finally{ctx.restore();if(saved===undefined)delete process.env.ADMIN_SETUP_TOKEN;else process.env.ADMIN_SETUP_TOKEN=saved;}
});

test('Supabase startup does not create or fall back to a SQLite database',()=>{
 const folder=mkdtempSync(join(tmpdir(),'ablest-cloud-test-')),verified=realpathSync(folder),data=join(folder,'no-sqlite');
 try{
  const env={...process.env,DATA_BACKEND:'supabase',DATA_DIR:data,SUPABASE_URL:'',SUPABASE_SECRET_KEY:''};
  const result=spawnSync(process.execPath,['dist/main.js'],{cwd:fileURLToPath(new URL('../apps/api/',import.meta.url)),env,encoding:'utf8',timeout:15000});
  assert.notEqual(result.status,0);assert.match(result.stdout+result.stderr,/Supabase mode requires/);assert.equal(existsSync(data),false);
 }finally{if(realpathSync(folder)!==verified||!folder.startsWith(join(tmpdir(),'ablest-cloud-test-')))throw new Error('Unexpected cleanup target');rmSync(folder,{recursive:true,force:true});}
});
