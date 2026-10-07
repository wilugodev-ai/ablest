import { BadRequestException, Body, ConflictException, Controller, Delete, ForbiddenException, Get, Headers, HttpException, NotFoundException, Param, Patch, Post, Res, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { db, type Row } from './store';

export type Account = { id: string; email: string; name: string; company: string; phone: string; role: 'admin' | 'client' };
type Reply = { setHeader(name: string,value: string): void };
db.exec(`CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,email TEXT NOT NULL UNIQUE COLLATE NOCASE,name TEXT NOT NULL,company TEXT NOT NULL DEFAULT '',phone TEXT NOT NULL DEFAULT '',role TEXT NOT NULL CHECK(role IN ('admin','client')),salt TEXT NOT NULL,hash TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS login_attempts(key TEXT PRIMARY KEY,count INTEGER NOT NULL,start INTEGER NOT NULL);
`);
if (!db.prepare('PRAGMA table_info(sessions)').all().some(c=>c.name==='user_id')) db.exec('ALTER TABLE sessions ADD COLUMN user_id TEXT REFERENCES users(id)');
const owner = db.prepare('SELECT * FROM owner').get() as Row | undefined;
if (owner && !db.prepare("SELECT id FROM users WHERE role='admin'").get()) {
  db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?,?,?)').run('owner',(process.env.ADMIN_EMAIL || 'wilugo91@gmail.com').toLowerCase(),'Administrator','','','admin',String(owner.salt),String(owner.hash));
  db.prepare('UPDATE sessions SET user_id=? WHERE user_id IS NULL').run('owner');
}
const digest=(token: string)=>createHash('sha256').update(token).digest('hex');
const cookieToken=(cookie='')=>cookie.split(';').map(s=>s.trim()).find(s=>s.startsWith('ablest_admin='))?.slice(13)||'';
export function accountFor(cookie?: string): Account | null {
  const token=cookieToken(cookie); if(token.length!==64)return null;
  const row=db.prepare('SELECT users.id,email,name,company,phone,role FROM sessions JOIN users ON users.id=sessions.user_id WHERE sessions.hash=? AND expires>?').get(digest(token),Date.now());
  return row ? row as unknown as Account : null;
}
export function requireAccount(cookie?: string) { const user=accountFor(cookie);if(!user)throw new UnauthorizedException('Please sign in to continue.');return user; }
export function requireAdministrator(cookie?: string) { const user=requireAccount(cookie);if(user.role!=='admin')throw new ForbiddenException('Administrator access is required.');return user; }
function originCheck(origin?: string) { const allowed=process.env.WEB_ORIGIN?[process.env.WEB_ORIGIN]:['http://127.0.0.1:3200','http://localhost:3200'];if(!origin||!allowed.includes(origin))throw new ForbiddenException('This request must come from the website.'); }
function object(body: unknown): Row { if(!body||typeof body!=='object'||Array.isArray(body))throw new BadRequestException('Invalid account details.');return body as Row; }
function field(b: Row,key: string,max: number,required=false) { if(typeof b[key]!=='string'||(b[key] as string).length>max)throw new BadRequestException(`Invalid ${key}.`);const value=(b[key] as string).trim();if(required&&!value)throw new BadRequestException(`${key} is required.`);return value; }
function emailFor(b: Row) { const email=field(b,'email',200,true).toLowerCase();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new BadRequestException('Enter a valid email address.');return email; }
function passwordFor(b: Row) { if(typeof b.password!=='string'||b.password.length<12||b.password.length>128)throw new BadRequestException('Use a password between 12 and 128 characters.');return b.password; }
function throttle(key: string) { const now=Date.now();db.prepare('DELETE FROM login_attempts WHERE start<?').run(now-15*60*1000);const row=db.prepare('SELECT count FROM login_attempts WHERE key=?').get(key);if(row&&Number(row.count)>=10)throw new HttpException('Too many attempts. Try again in 15 minutes.',429);db.prepare('INSERT INTO login_attempts VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1').run(key,now); }
function session(response: Reply,id: string,origin?: string,cookie?: string) {
 db.prepare('DELETE FROM sessions WHERE expires<? OR hash=?').run(Date.now(),digest(cookieToken(cookie)));
 const token=randomBytes(32).toString('hex');db.prepare('INSERT INTO sessions(hash,expires,user_id) VALUES(?,?,?)').run(digest(token),Date.now()+8*60*60*1000,id);
 response.setHeader('Set-Cookie',`ablest_admin=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${origin?.startsWith('https:')?'; Secure':''}`);
}
export function setupAdministrator(body: unknown,response: Reply,origin: string) {
 originCheck(origin);if(db.prepare('SELECT id FROM owner').get()||db.prepare("SELECT id FROM users WHERE role='admin'").get())throw new ConflictException('An admin account already exists. Please sign in.');
 const b=object(body),email=emailFor(b);if(email!==(process.env.ADMIN_EMAIL||'wilugo91@gmail.com').toLowerCase())throw new UnauthorizedException('Incorrect admin email or password.');
 const salt=randomBytes(32).toString('hex'),hash=scryptSync(passwordFor(b),salt,64).toString('hex');
 db.exec('BEGIN');try{db.prepare('INSERT INTO owner VALUES(1,?,?)').run(salt,hash);db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?,?,?)').run('owner',email,'Administrator','','','admin',salt,hash);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
 session(response,'owner',origin);return{authenticated:true,user:accountForFromId('owner')};
}
function accountForFromId(id: string) { return db.prepare('SELECT id,email,name,company,phone,role FROM users WHERE id=?').get(id) as unknown as Account; }
export function signIn(body: unknown,response: Reply,origin: string,cookie?: string,adminOnly=false) {
 originCheck(origin);const b=object(body),email=emailFor(b),password=passwordFor(b);throttle(`login:${email}`);
 const user=db.prepare('SELECT * FROM users WHERE email=?').get(email) as Row|undefined;
 const valid=timingSafeEqual(scryptSync(password,String(user?.salt||'invalid-user-salt'),64),Buffer.from(String(user?.hash||'0'.repeat(128)),'hex'));
 if(!user||!valid||(adminOnly&&user.role!=='admin'))throw new UnauthorizedException('Incorrect email or password.');
 db.prepare('DELETE FROM login_attempts WHERE key=?').run(`login:${email}`);session(response,String(user.id),origin,cookie);return{authenticated:true,user:accountForFromId(String(user.id))};
}
export function signOut(cookie: string,origin: string,response: Reply) {originCheck(origin);db.prepare('DELETE FROM sessions WHERE hash=?').run(digest(cookieToken(cookie)));response.setHeader('Set-Cookie','ablest_admin=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');return{authenticated:false,user:null};}
@Controller('v1')
export class AccountsController {
 @Get('auth/session') session(@Headers('cookie')cookie?: string){const user=accountFor(cookie);return{authenticated:Boolean(user),user};}
 @Post('auth/register') register(@Body()body:unknown,@Headers('origin')origin:string,@Headers('cookie')cookie:string,@Res({passthrough:true})response:Reply){
  originCheck(origin);const b=object(body);if(Object.keys(b).some(k=>!['email','password','name'].includes(k)))throw new BadRequestException('Unsupported registration field.');
  const email=emailFor(b);throttle(`register:${email}`);const name=field(b,'name',100,true),password=passwordFor(b);
  if(email===(process.env.ADMIN_EMAIL||'wilugo91@gmail.com').toLowerCase()||db.prepare('SELECT id FROM users WHERE email=?').get(email))throw new ConflictException('This email cannot be registered. Try signing in.');
  const id=randomUUID(),salt=randomBytes(32).toString('hex'),hash=scryptSync(password,salt,64).toString('hex');
  db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?,?,?)').run(id,email,name,'','','client',salt,hash);session(response,id,origin,cookie);return{authenticated:true,user:accountForFromId(id)};
 }
 @Post('auth/login') login(@Body()b:unknown,@Headers('origin')o:string,@Headers('cookie')c:string,@Res({passthrough:true})r:Reply){return signIn(b,r,o,c);}
 @Post('auth/logout') logout(@Headers('origin')o:string,@Headers('cookie')c:string,@Res({passthrough:true})r:Reply){return signOut(c,o,r);}
 @Get('account') profile(@Headers('cookie')c:string){return requireAccount(c);}
 @Patch('account') updateProfile(@Body()body:unknown,@Headers('cookie')c:string,@Headers('origin')o:string){originCheck(o);const user=requireAccount(c),b=object(body);if(Object.keys(b).some(k=>!['name','company','phone'].includes(k)))throw new BadRequestException('Only your profile details can be changed.');db.prepare('UPDATE users SET name=?,company=?,phone=? WHERE id=?').run(field(b,'name',100,true),field(b,'company',150),field(b,'phone',40),user.id);return accountForFromId(user.id);}
 @Get('admin/clients') clients(@Headers('cookie')c:string){requireAdministrator(c);return db.prepare("SELECT id,email,name,company,phone,role FROM users WHERE role='client' ORDER BY name,email").all();}
}
