import { BadRequestException, Body, ConflictException, Controller, Delete, ForbiddenException, Get, Headers, HttpException, NotFoundException, Param, Patch, Post, Res, ServiceUnavailableException, UnauthorizedException, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createHash,randomBytes,randomUUID,scryptSync,timingSafeEqual } from 'node:crypto';
import sharp from 'sharp';
import { projectInput } from './project-validation';

type Row=Record<string,unknown>;
type Reply={setHeader(name:string,value:string):void;send(body:Buffer):void};
type User={id:string;email:string;name:string;company:string;phone:string;role:'admin'|'client';salt?:string;hash?:string};
const profileColumns='id,email,name,company,phone,role';
const bucket='ablest-project-images';
const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
const token=(cookie='')=>cookie.split(';').map(v=>v.trim()).find(v=>v.startsWith('ablest_admin='))?.slice(13)||'';
function originCheck(origin?:string){const allowed=process.env.WEB_ORIGIN?[process.env.WEB_ORIGIN]:['http://127.0.0.1:3200','http://localhost:3200'];if(!origin||!allowed.includes(origin))throw new ForbiddenException('This request must come from the website.');}
function object(body:unknown):Row{if(!body||typeof body!=='object'||Array.isArray(body))throw new BadRequestException('Invalid details.');return body as Row;}
function field(b:Row,key:string,max:number,required=false){if(typeof b[key]!=='string'||(b[key]as string).length>max)throw new BadRequestException(`Invalid ${key}.`);const value=(b[key]as string).trim();if(required&&!value)throw new BadRequestException(`${key} is required.`);return value;}
function email(b:Row){const value=field(b,'email',200,true).toLowerCase();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))throw new BadRequestException('Enter a valid email address.');return value;}
function password(b:Row){if(typeof b.password!=='string'||b.password.length<12||b.password.length>128)throw new BadRequestException('Use a password between 12 and 128 characters.');return b.password;}
function uuid(value:string){if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value))throw new NotFoundException('Record not found.');return value;}
function check(error:{code?:string;message:string}|null){if(!error)return;if(error.code==='23505')throw new ConflictException('This record already exists. Try signing in if you have an account.');throw new ServiceUnavailableException('The data service is temporarily unavailable. Please try again.');}

@Controller('v1')
export class CloudController {
 private readonly db:SupabaseClient;
 constructor(){
  const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_SECRET_KEY;
  if(!url||!key?.startsWith('sb_secret_'))throw new Error('Supabase mode requires SUPABASE_URL and a server-only SUPABASE_SECRET_KEY.');
  const parsed=new URL(url);if(parsed.protocol!=='https:')throw new Error('SUPABASE_URL must use HTTPS.');
  this.db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
 }
 private async user(cookie?:string):Promise<User|null>{
  const value=token(cookie);if(value.length!==64)return null;
  const session=await this.db.from('ablest_sessions').select('user_id').eq('hash',digest(value)).gt('expires',Date.now()).maybeSingle();check(session.error);if(!session.data)return null;
  const user=await this.db.from('ablest_users').select(profileColumns).eq('id',session.data.user_id).maybeSingle();check(user.error);return user.data as User|null;
 }
 private async account(cookie?:string){const user=await this.user(cookie);if(!user)throw new UnauthorizedException('Please sign in to continue.');return user;}
 private async admin(cookie?:string){const user=await this.account(cookie);if(user.role!=='admin')throw new ForbiddenException('Administrator access is required.');return user;}
 private async initialized(){const result=await this.db.from('ablest_users').select('id').eq('role','admin').limit(1);check(result.error);return Boolean(result.data?.length);}
 private async throttle(key:string){const result=await this.db.rpc('ablest_throttle',{attempt_key:key});check(result.error);if(!result.data)throw new HttpException('Too many attempts. Try again in 15 minutes.',429);}
 private async issue(response:Reply,userId:string,origin:string,cookie?:string){
  const cleanup=await this.db.from('ablest_sessions').delete().lt('expires',Date.now());check(cleanup.error);
  const value=randomBytes(32).toString('hex'),saved=await this.db.from('ablest_sessions').insert({hash:digest(value),expires:Date.now()+8*60*60*1000,user_id:userId});check(saved.error);
  if(token(cookie)){const previous=await this.db.from('ablest_sessions').delete().eq('hash',digest(token(cookie)));check(previous.error);}
  response.setHeader('Set-Cookie',`ablest_admin=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${origin.startsWith('https:')?'; Secure':''}`);
 }
 private async login(body:unknown,origin:string,cookie:string,response:Reply,adminOnly=false){
  originCheck(origin);const b=object(body),address=email(b),secret=password(b);await this.throttle(`login:${address}`);
  const result=await this.db.from('ablest_users').select('*').eq('email',address).maybeSingle();check(result.error);const user=result.data as User|null;
  const valid=timingSafeEqual(scryptSync(secret,user?.salt||'invalid-user-salt',64),Buffer.from(user?.hash||'0'.repeat(128),'hex'));
  if(!user||!valid||(adminOnly&&user.role!=='admin'))throw new UnauthorizedException('Incorrect email or password.');
  const cleared=await this.db.from('ablest_attempts').delete().eq('key',`login:${address}`);check(cleared.error);await this.issue(response,user.id,origin,cookie);
  const {salt:unusedSalt,hash:unusedHash,...profile}=user;void unusedSalt;void unusedHash;return{authenticated:true,user:profile};
 }
 private async logout(cookie:string,origin:string,response:Reply){originCheck(origin);const result=await this.db.from('ablest_sessions').delete().eq('hash',digest(token(cookie)));check(result.error);response.setHeader('Set-Cookie','ablest_admin=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');return{authenticated:false,user:null};}
 @Get('health/database')async health(){const result=await this.db.from('ablest_meta').select('value').eq('key','seeded').maybeSingle();if(result.error||!result.data)throw new ServiceUnavailableException('Supabase schema is not ready.');const storage=await this.db.storage.getBucket(bucket);if(storage.error||storage.data?.public)throw new ServiceUnavailableException('Private image storage is not ready.');return{status:'ok',backend:'supabase'};}
 @Get('auth/session')async session(@Headers('cookie')cookie:string){const user=await this.user(cookie);return{authenticated:Boolean(user),user};}
 @Get('admin/session')async adminSession(@Headers('cookie')cookie:string){const user=await this.user(cookie);return{initialized:await this.initialized(),authenticated:user?.role==='admin',user,setupTokenRequired:true};}
 @Post('auth/register')async register(@Body()body:unknown,@Headers('origin')origin:string,@Headers('cookie')cookie:string,@Res({passthrough:true})response:Reply){
  originCheck(origin);const b=object(body);if(Object.keys(b).some(k=>!['name','email','password'].includes(k)))throw new BadRequestException('Unsupported registration field.');
  const address=email(b),name=field(b,'name',100,true),secret=password(b);await this.throttle(`register:${address}`);
  if(address===(process.env.ADMIN_EMAIL||'wilugo91@gmail.com').toLowerCase())throw new ConflictException('This email cannot be registered. Try signing in.');
  const salt=randomBytes(32).toString('hex'),hash=scryptSync(secret,salt,64).toString('hex');
  const result=await this.db.from('ablest_users').insert({id:randomUUID(),email:address,name,role:'client',salt,hash}).select(profileColumns).single();check(result.error);
  const user=result.data as User;await this.issue(response,user.id,origin,cookie);return{authenticated:true,user};
 }
 @Post('admin/setup')async setup(@Body()body:unknown,@Headers('origin')origin:string,@Res({passthrough:true})response:Reply){
  originCheck(origin);if(await this.initialized())throw new ConflictException('An admin account already exists. Please sign in.');
  const b=object(body),expected=process.env.ADMIN_SETUP_TOKEN;
  if(!expected||expected.length<32||typeof b.setupToken!=='string'||!timingSafeEqual(createHash('sha256').update(b.setupToken).digest(),createHash('sha256').update(expected).digest()))throw new ForbiddenException('A valid owner setup code is required.');
  const address=email(b);if(address!==(process.env.ADMIN_EMAIL||'wilugo91@gmail.com').toLowerCase())throw new UnauthorizedException('Incorrect admin email or password.');
  const salt=randomBytes(32).toString('hex'),hash=scryptSync(password(b),salt,64).toString('hex');
  const result=await this.db.from('ablest_users').insert({id:randomUUID(),email:address,name:'Administrator',role:'admin',salt,hash}).select(profileColumns).single();check(result.error);const user=result.data as User;await this.issue(response,user.id,origin);return{authenticated:true,user};
 }
 @Post('auth/login')async signIn(@Body()b:unknown,@Headers('origin')o:string,@Headers('cookie')c:string,@Res({passthrough:true})r:Reply){return this.login(b,o,c,r);}
 @Post('admin/login')async adminLogin(@Body()b:unknown,@Headers('origin')o:string,@Headers('cookie')c:string,@Res({passthrough:true})r:Reply){return this.login(b,o,c,r,true);}
 @Post('auth/logout')async signOut(@Headers('origin')o:string,@Headers('cookie')c:string,@Res({passthrough:true})r:Reply){return this.logout(c,o,r);}
 @Post('admin/logout')async adminLogout(@Headers('origin')o:string,@Headers('cookie')c:string,@Res({passthrough:true})r:Reply){return this.logout(c,o,r);}
 @Get('account')async profile(@Headers('cookie')c:string){return this.account(c);}
 @Patch('account')async updateProfile(@Body()body:unknown,@Headers('cookie')c:string,@Headers('origin')o:string){originCheck(o);const user=await this.account(c),b=object(body);if(Object.keys(b).some(k=>!['name','company','phone'].includes(k)))throw new BadRequestException('Only your profile details can be changed.');const result=await this.db.from('ablest_users').update({name:field(b,'name',100,true),company:field(b,'company',150),phone:field(b,'phone',40)}).eq('id',user.id).select(profileColumns).single();check(result.error);return result.data;}
 @Get('admin/clients')async clients(@Headers('cookie')c:string){await this.admin(c);const result=await this.db.from('ablest_users').select(profileColumns).eq('role','client').order('name').order('email');check(result.error);return result.data;}
 private async project(id:string){const result=await this.db.from('ablest_projects').select('*').eq('id',uuid(id)).maybeSingle();check(result.error);if(!result.data)throw new NotFoundException('Project not found.');return result.data;}
 private async list(publishedOnly:boolean){let query=this.db.from('ablest_projects').select('*,images:ablest_images(id,alt,position)');if(publishedOnly)query=query.eq('published',true);const result=await query.order('position').order('id');check(result.error);return(result.data||[]).map(row=>({...row,images:(row.images as {position:number}[]).sort((a,b)=>a.position-b.position)}));}
 private input(body:unknown){const [title,subtitle,category,description,features,status,url,published]=projectInput(body);return{title,subtitle,category,description,features:JSON.parse(String(features)),status,url,published:Boolean(published)};}
 @Get('projects')async projects(){return this.list(true);}
 @Get('admin/projects')async adminProjects(@Headers('cookie')c:string){await this.admin(c);return this.list(false);}
 @Post('admin/projects')async create(@Body()body:unknown,@Headers('cookie')c:string,@Headers('origin')o:string){originCheck(o);await this.admin(c);const values=this.input(body),count=await this.db.from('ablest_projects').select('id',{count:'exact',head:true});check(count.error);if((count.count||0)>=100)throw new BadRequestException('Maximum 100 projects.');const latest=await this.db.from('ablest_projects').select('position').order('position',{ascending:false}).limit(1);check(latest.error);const result=await this.db.from('ablest_projects').insert({...values,id:randomUUID(),position:(latest.data?.[0]?.position??-1)+1}).select().single();check(result.error);return{...result.data,images:[]};}
 @Patch('admin/projects/:id')async edit(@Param('id')id:string,@Body()body:unknown,@Headers('cookie')c:string,@Headers('origin')o:string){originCheck(o);await this.admin(c);await this.project(id);const result=await this.db.from('ablest_projects').update(this.input(body)).eq('id',id).select().single();check(result.error);const images=await this.db.from('ablest_images').select('id,alt,position').eq('project_id',id).order('position');check(images.error);return{...result.data,images:images.data||[]};}
 @Delete('admin/projects/:id')async deleteProject(@Param('id')id:string,@Headers('cookie')c:string,@Headers('origin')o:string){originCheck(o);await this.admin(c);await this.project(id);const images=await this.db.from('ablest_images').select('path').eq('project_id',id);check(images.error);const deleted=await this.db.from('ablest_projects').delete().eq('id',id);check(deleted.error);if(images.data?.length){const removed=await this.db.storage.from(bucket).remove(images.data.map(i=>i.path));check(removed.error);}return{deleted:true};}
 @Post('admin/projects/:id/images')
 @UseInterceptors(FileInterceptor('image',{limits:{fileSize:8*1024*1024,files:1,fields:1,fieldSize:1000}}))
 async upload(@Param('id')id:string,@UploadedFile()file:{buffer:Buffer;mimetype:string}|undefined,@Body('alt')alt:unknown,@Headers('cookie')c:string,@Headers('origin')o:string){
  originCheck(o);await this.admin(c);await this.project(id);if(!file||!['image/jpeg','image/png','image/webp'].includes(file.mimetype))throw new BadRequestException('Choose a JPEG, PNG, or WebP image up to 8 MB.');if(typeof alt!=='string'||!alt.trim()||alt.length>300)throw new BadRequestException('Add an image description, up to 300 characters.');
  let buffer:Buffer;try{const source=sharp(file.buffer,{limitInputPixels:25000000,animated:false}),meta=await source.metadata();if(!['jpeg','png','webp'].includes(meta.format||''))throw new Error();buffer=await source.rotate().resize({width:2000,height:2000,fit:'inside',withoutEnlargement:true}).webp({quality:85}).toBuffer();}catch{throw new BadRequestException('Choose a valid JPEG, PNG, or WebP under 25 megapixels.');}
  const imageId=randomUUID(),path=`${id}/${imageId}.webp`;const uploaded=await this.db.storage.from(bucket).upload(path,buffer,{contentType:'image/webp',upsert:false});check(uploaded.error);
  const added=await this.db.rpc('ablest_add_image',{image_id:imageId,target_project:id,image_alt:alt.trim(),image_path:path});
  if(added.error){await this.db.storage.from(bucket).remove([path]);if(added.error.message.includes('image_limit'))throw new BadRequestException('Maximum 12 images per project.');if(added.error.message.includes('project_missing'))throw new NotFoundException('Project not found.');check(added.error);}
  return{id:added.data.id,alt:added.data.alt,position:added.data.position};
 }
 @Patch('admin/images/:id')async editImage(@Param('id')id:string,@Body()body:unknown,@Headers('cookie')c:string,@Headers('origin')o:string){originCheck(o);await this.admin(c);const b=object(body),alt=field(b,'alt',300,true),image=await this.db.from('ablest_images').select('project_id').eq('id',uuid(id)).maybeSingle();check(image.error);if(!image.data)throw new NotFoundException('Image not found.');const values:{alt:string;position?:number}={alt};if(b.cover===true){const first=await this.db.from('ablest_images').select('position').eq('project_id',image.data.project_id).order('position').limit(1);check(first.error);values.position=(first.data?.[0]?.position||0)-1;}const updated=await this.db.from('ablest_images').update(values).eq('id',id);check(updated.error);return{updated:true};}
 @Delete('admin/images/:id')async deleteImage(@Param('id')id:string,@Headers('cookie')c:string,@Headers('origin')o:string){originCheck(o);await this.admin(c);const image=await this.db.from('ablest_images').select('path').eq('id',uuid(id)).maybeSingle();check(image.error);if(!image.data)throw new NotFoundException('Image not found.');const deleted=await this.db.from('ablest_images').delete().eq('id',id);check(deleted.error);const removed=await this.db.storage.from(bucket).remove([image.data.path]);check(removed.error);return{deleted:true};}
 @Get('images/:id')async image(@Param('id')id:string,@Headers('cookie')c:string,@Res()response:Reply){const image=await this.db.from('ablest_images').select('path,project:ablest_projects!inner(published)').eq('id',uuid(id)).maybeSingle();check(image.error);const row=image.data as {path:string;project:{published:boolean}}|null;if(!row||(!row.project.published&&(await this.user(c))?.role!=='admin'))throw new NotFoundException('Image not found.');const file=await this.db.storage.from(bucket).download(row.path);check(file.error);if(!file.data)throw new NotFoundException('Image not found.');response.setHeader('Content-Type','image/webp');response.setHeader('Cache-Control','no-store');response.setHeader('X-Content-Type-Options','nosniff');response.send(Buffer.from(await file.data.arrayBuffer()));}
}
