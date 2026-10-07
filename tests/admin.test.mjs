import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { createHash,scryptSync } from 'node:crypto';
const require = createRequire(new URL('../apps/api/package.json',import.meta.url));
const sharp = require('sharp');
const cwd = fileURLToPath(new URL('../apps/api/',import.meta.url));
const origin = 'http://127.0.0.1:3200', base = 'http://127.0.0.1:4298/v1';

test('admin access, client profile isolation, uploads, persistence, and logout', async () => {
  const temporary = mkdtempSync(join(tmpdir(),'ablest-admin-test-'));
  const verifiedPath = realpathSync(temporary);
  let server, cookie = '';
  async function stop() { if (!server || server.exitCode !== null) return; const stopped = new Promise(resolve => server.once('exit',resolve)); server.kill(); await stopped; }
  async function start() {
    server = spawn(process.execPath,['dist/main.js'],{cwd,env:{...process.env,PORT:'4298',DATA_DIR:temporary,WEB_ORIGIN:origin,ADMIN_EMAIL:'owner@example.com'},stdio:'ignore'});
    for (let i=0;i<80;i++) { if (server.exitCode !== null) throw new Error('Test API exited before readiness.'); try { if ((await fetch(`${base}/health`)).ok) return; } catch {} await new Promise(r=>setTimeout(r,100)); }
    throw new Error('Test API did not start.');
  }
  async function request(path, method='GET', body, auth=false, source=origin) {
    const headers = {}; if (method!=='GET') headers.Origin=source; if (auth) headers.Cookie=cookie;
    if (body && !(body instanceof FormData)) headers['Content-Type']='application/json';
    const response=await fetch(`${base}/${path}`,{method,headers,body:body instanceof FormData ? body : body ? JSON.stringify(body) : undefined});
    return response;
  }
  const credentials={email:'owner@example.com',password:'a-strong-test-password-123'};
  try {
    await start();
    assert.equal((await request('admin/projects')).status,401);
    assert.equal((await request('admin/setup','POST',credentials,false,'https://other.example')).status,403);
    assert.equal((await request('admin/setup','POST',{...credentials,email:'intruder@example.com'})).status,401);
    const setup=await request('admin/setup','POST',credentials); assert.equal(setup.status,201);
    const setCookie=setup.headers.get('set-cookie'); assert.match(setCookie,/HttpOnly/); assert.match(setCookie,/SameSite=Strict/); cookie=setCookie.split(';')[0];
    assert.equal((await request('admin/setup','POST',credentials)).status,409);
    assert.equal((await (await request('projects')).json()).length,2);
    const input={title:'Test portfolio project',subtitle:'Test',category:'Software',description:'A private draft.',features:['One feature'],status:'In development',url:'',published:false};
    assert.equal((await request('admin/projects','POST',input)).status,401);
    assert.equal((await request('admin/projects','POST',{...input,url:'javascript:alert(1)'},true)).status,400);
    const created=await request('admin/projects','POST',input,true); assert.equal(created.status,201); const project=await created.json();
    assert.equal((await (await request('projects')).json()).some(p=>p.id===project.id),false);
    const invalid=new FormData(); invalid.set('alt','Invalid'); invalid.set('image',new Blob(['not an image'],{type:'image/png'}),'invalid.png');
    assert.equal((await request(`admin/projects/${project.id}/images`,'POST',invalid,true)).status,400);
    const png=await sharp({create:{width:100,height:80,channels:3,background:'#b9f36b'}}).png().toBuffer();
    const upload=new FormData(); upload.set('alt','Test project image'); upload.set('image',new Blob([png],{type:'image/png'}),'test.png');
    const uploaded=await request(`admin/projects/${project.id}/images`,'POST',upload,true); assert.equal(uploaded.status,201); const image=await uploaded.json();
    assert.equal((await request(`images/${image.id}`)).status,404);
    const draftImage=await request(`images/${image.id}`,'GET',undefined,true); assert.equal(draftImage.status,200); assert.equal(draftImage.headers.get('content-type'),'image/webp');
    assert.equal((await request(`admin/projects/${project.id}`,'PATCH',{...input,published:true},true)).status,200);
    assert.equal((await request(`images/${image.id}`)).status,200);
    await stop(); await start();
    const persisted=await (await request('projects')).json(); assert.equal(persisted.find(p=>p.id===project.id).images[0].id,image.id);
    assert.equal((await request('admin/projects','GET',undefined,true)).status,200);
    assert.equal((await request(`admin/projects/${project.id}`,'PATCH',{...input,published:false},true)).status,200);
    assert.equal((await request(`images/${image.id}`)).status,404);
    assert.equal((await request('admin/logout','POST',undefined,true)).status,201);
    assert.equal((await request('admin/projects','GET',undefined,true)).status,401);
    assert.equal((await request('admin/login','POST',{...credentials,password:'incorrect-password-123'})).status,401);
    const login=await request('admin/login','POST',credentials); assert.equal(login.status,201); cookie=login.headers.get('set-cookie').split(';')[0];
    const ownerCookie=cookie;
    assert.equal((await (await request('auth/session','GET',undefined,true)).json()).user.role,'admin');
    assert.equal((await request('account')).status,401);
    assert.equal((await request('auth/register','POST',{...credentials,name:'Reserved'})).status,409);
    assert.equal((await request('auth/register','POST',{email:'alice@example.com',password:'alice-password-12345',name:'Alice',role:'admin'})).status,400);
    const alice=await request('auth/register','POST',{email:'alice@example.com',password:'alice-password-12345',name:'Alice'}); assert.equal(alice.status,201); cookie=alice.headers.get('set-cookie').split(';')[0];
    const aliceData=await alice.json(); assert.equal(aliceData.user.role,'client'); assert.equal(Object.hasOwn(aliceData.user,'hash'),false); const aliceCookie=cookie;
    assert.equal((await request('admin/projects','GET',undefined,true)).status,403);
    assert.equal((await request('admin/clients','GET',undefined,true)).status,403);
    assert.equal((await request(`images/${image.id}`,'GET',undefined,true)).status,404);
    assert.equal((await request('account','PATCH',{name:'Alice',company:'A Company',phone:'123',role:'admin'},true)).status,400);
    assert.equal((await request('account','PATCH',{name:'Alice',company:'A Company',phone:'123',id:'owner'},true)).status,400);
    const profile=await request('account','PATCH',{name:'Alice Updated',company:'A Company',phone:'123'},true); assert.equal(profile.status,200); assert.equal((await profile.json()).company,'A Company');
    const bob=await request('auth/register','POST',{email:'bob@example.com',password:'bob-password-1234567',name:'Bob'}); assert.equal(bob.status,201); cookie=bob.headers.get('set-cookie').split(';')[0]; const bobCookie=cookie;
    assert.equal((await (await request('account','GET',undefined,true)).json()).name,'Bob');
    assert.equal((await request(`account/${aliceData.user.id}`,'GET',undefined,true)).status,404);
    cookie=aliceCookie; assert.equal((await (await request('account','GET',undefined,true)).json()).name,'Alice Updated');
    await stop();await start();
    cookie=bobCookie;assert.equal((await (await request('account','GET',undefined,true)).json()).company,'');
    cookie=aliceCookie;assert.equal((await (await request('account','GET',undefined,true)).json()).company,'A Company');
    assert.equal((await (await request('admin/session','GET',undefined,true)).json()).authenticated,false);
    assert.equal((await request('auth/logout','POST',undefined,true)).status,201);assert.equal((await request('account','GET',undefined,true)).status,401);
    const aliceLogin=await request('auth/login','POST',{email:'ALICE@example.com',password:'alice-password-12345'});assert.equal(aliceLogin.status,201);assert.equal((await aliceLogin.json()).user.role,'client');
    cookie=ownerCookie; const clients=await (await request('admin/clients','GET',undefined,true)).json();assert.equal(clients.length,2);assert.equal(clients.find(c=>c.email==='alice@example.com').company,'A Company');assert.equal(Object.hasOwn(clients[0],'salt'),false);
    assert.equal((await request(`admin/projects/${project.id}`,'DELETE',undefined,true)).status,200);
    assert.equal((await request(`images/${image.id}`,'GET',undefined,true)).status,404);
    for(let i=0;i<10;i++) assert.equal((await request('admin/login','POST',{...credentials,password:'wrong-password-12345'})).status,401);
    assert.equal((await request('admin/login','POST',credentials)).status,429);
  } finally {
    await stop();
    // Delete only the exact generated temporary directory, never the real content store.
    if (realpathSync(temporary) !== verifiedPath || !temporary.startsWith(join(tmpdir(),'ablest-admin-test-'))) throw new Error('Unexpected test cleanup target.');
    rmSync(temporary,{recursive:true,force:true});
  }
});

test('existing owner credentials and sessions migrate to the admin role',async()=>{
 const temporary=mkdtempSync(join(tmpdir(),'ablest-admin-test-')),verifiedPath=realpathSync(temporary);
 const fixture=new DatabaseSync(join(temporary,'content.sqlite')),token='a'.repeat(64),salt='legacy-test-salt';
 fixture.exec('CREATE TABLE owner(id INTEGER PRIMARY KEY,salt TEXT,hash TEXT);CREATE TABLE sessions(hash TEXT PRIMARY KEY,expires INTEGER);');
 fixture.prepare('INSERT INTO owner VALUES(1,?,?)').run(salt,scryptSync('legacy-password-123456',salt,64).toString('hex'));
 fixture.prepare('INSERT INTO sessions VALUES(?,?)').run(createHash('sha256').update(token).digest('hex'),Date.now()+60000);fixture.close();
 const server=spawn(process.execPath,['dist/main.js'],{cwd,env:{...process.env,PORT:'4298',DATA_DIR:temporary,WEB_ORIGIN:origin,ADMIN_EMAIL:'owner@example.com'},stdio:'ignore'});
 try{
  let ready=false;for(let i=0;i<80;i++){try{if((await fetch(`${base}/health`)).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}assert.equal(ready,true);
  const migrated=await fetch(`${base}/auth/session`,{headers:{Cookie:`ablest_admin=${token}`}});assert.equal((await migrated.json()).user.role,'admin');
  const login=await fetch(`${base}/auth/login`,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({email:'owner@example.com',password:'legacy-password-123456'})});assert.equal(login.status,201);assert.equal((await login.json()).user.role,'admin');
 }finally{
  if(server.exitCode===null){const done=new Promise(r=>server.once('exit',r));server.kill();await done;}
  if(realpathSync(temporary)!==verifiedPath||!temporary.startsWith(join(tmpdir(),'ablest-admin-test-')))throw new Error('Unexpected test cleanup target');rmSync(temporary,{recursive:true,force:true});
 }
});
