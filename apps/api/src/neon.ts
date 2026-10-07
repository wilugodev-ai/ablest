import { BadRequestException, Body, ConflictException, Controller, Delete, ForbiddenException, Get, Headers, HttpException, NotFoundException, OnModuleDestroy, Param, Patch, Post, Res, ServiceUnavailableException, UnauthorizedException, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { createHash,randomBytes,randomUUID,scryptSync,timingSafeEqual } from 'node:crypto';
import sharp from 'sharp';
import { createNeonPool } from './neon-database';
import { projectInput } from './project-validation';

type Row=Record<string,unknown>;
type Reply={setHeader(name:string,value:string):void;send(body:Buffer):void};
type User={id:string;email:string;name:string;company:string;phone:string;role:'admin'|'client'};
const profileColumns='id,email,name,company,phone,role';
const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
const token=(cookie='')=>cookie.split(';').map(v=>v.trim()).find(v=>v.startsWith('ablest_admin='))?.slice(13)||'';
function originCheck(origin?:string){const allowed=process.env.WEB_ORIGIN?[process.env.WEB_ORIGIN]:['http://127.0.0.1:3200','http://localhost:3200'];if(!origin||!allowed.includes(origin))throw new ForbiddenException('This request must come from the website.');}
function object(body:unknown):Row{if(!body||typeof body!=='object'||Array.isArray(body))throw new BadRequestException('Invalid details.');return body as Row;}
function field(b:Row,key:string,max:number,required=false){if(typeof b[key]!=='string'||(b[key]as string).length>max)throw new BadRequestException(`Invalid ${key}.`);const value=(b[key]as string).trim();if(required&&!value)throw new BadRequestException(`${key} is required.`);return value;}
function email(b:Row){const value=field(b,'email',200,true).toLowerCase();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))throw new BadRequestException('Enter a valid email address.');return value;}
function password(b:Row){if(typeof b.password!=='string'||b.password.length<12||b.password.length>128)throw new BadRequestException('Use a password between 12 and 128 characters.');return b.password;}
function uuid(value:string){if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value))throw new NotFoundException('Record not found.');return value;}

@Controller('v1')
export class NeonController implements OnModuleDestroy {
  private readonly pool=createNeonPool();
  async onModuleDestroy(){await this.pool.end();}
  private async query(text:string,values:unknown[]=[]):Promise<Row[]> {
    try { return (await this.pool.query(text,values)).rows; }
    catch(error) {
      const code=(error as {code?:string}).code,message=(error as Error).message;
      if(code==='23505')throw new ConflictException('This record already exists. Try signing in if you have an account.');
      if(message==='image_limit')throw new BadRequestException('Maximum 12 images per project.');
      if(message==='project_limit')throw new BadRequestException('Maximum 100 projects.');
      if(message==='project_missing')throw new NotFoundException('Project not found.');
      throw new ServiceUnavailableException('The data service is temporarily unavailable. Please try again.');
    }
  }
  private async user(cookie?:string):Promise<User|null>{
    const value=token(cookie);if(value.length!==64)return null;
    const rows=await this.query(`SELECT u.id,u.email,u.name,u.company,u.phone,u.role FROM ablest_sessions s JOIN ablest_users u ON u.id=s.user_id WHERE s.hash=$1 AND s.expires>floor(extract(epoch FROM clock_timestamp())*1000)`,[digest(value)]);
    return(rows[0] as User|undefined)||null;
  }
  private async account(cookie?:string){const user=await this.user(cookie);if(!user)throw new UnauthorizedException('Please sign in to continue.');return user;}
  private async admin(cookie?:string){const user=await this.account(cookie);if(user.role!=='admin')throw new ForbiddenException('Administrator access is required.');return user;}
  private async initialized(){return Boolean((await this.query("SELECT id FROM ablest_users WHERE role='admin' LIMIT 1")).length);}
  private async throttle(key:string){if(!(await this.query('SELECT ablest_throttle($1) AS allowed',[key]))[0].allowed)throw new HttpException('Too many attempts. Try again in 15 minutes.',429);}
  private async issue(response:Reply,id:string,origin:string,cookie?:string){
    const value=randomBytes(32).toString('hex');
    await this.query('SELECT ablest_issue_session($1,$2,$3)',[digest(value),id,digest(token(cookie))]);
    response.setHeader('Set-Cookie',`ablest_admin=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${origin.startsWith('https:')?'; Secure':''}`);
  }
  private async login(body:unknown,origin:string,cookie:string,response:Reply,adminOnly=false){
    originCheck(origin);const b=object(body),address=email(b),secret=password(b);await this.throttle(`login:${address}`);
    const user=(await this.query('SELECT * FROM ablest_users WHERE email=$1',[address]))[0];
    const valid=timingSafeEqual(scryptSync(secret,String(user?.salt||'invalid-user-salt'),64),Buffer.from(String(user?.hash||'0'.repeat(128)),'hex'));
    if(!user||!valid||(adminOnly&&user.role!=='admin'))throw new UnauthorizedException('Incorrect email or password.');
    await this.query('DELETE FROM ablest_attempts WHERE key=$1',[`login:${address}`]);
    await this.issue(response,String(user.id),origin,cookie);
    return{authenticated:true,user:(await this.query(`SELECT ${profileColumns} FROM ablest_users WHERE id=$1`,[user.id]))[0]};
  }
  private async logout(cookie:string,origin:string,response:Reply){originCheck(origin);await this.query('DELETE FROM ablest_sessions WHERE hash=$1',[digest(token(cookie))]);response.setHeader('Set-Cookie','ablest_admin=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');return{authenticated:false,user:null};}
  @Get('health/database')async health(){const rows=await this.query("SELECT key FROM ablest_meta WHERE key IN ('seeded','schema_version')");if(rows.length!==2)throw new ServiceUnavailableException('Neon schema is not ready.');return{status:'ok',backend:'neon'};}
  @Get('auth/session')async session(@Headers('cookie')cookie:string){const user=await this.user(cookie);return{authenticated:Boolean(user),user};}
  @Get('admin/session')async adminSession(@Headers('cookie')cookie:string){const user=await this.user(cookie);return{initialized:await this.initialized(),authenticated:user?.role==='admin',user,setupTokenRequired:true};}
  @Post('auth/register')async register(@Body()body:unknown,@Headers('origin')origin:string,@Headers('cookie')cookie:string,@Res({passthrough:true})response:Reply){
    originCheck(origin);const b=object(body);if(Object.keys(b).some(k=>!['name','email','password'].includes(k)))throw new BadRequestException('Unsupported registration field.');
    const address=email(b),name=field(b,'name',100,true),secret=password(b);await this.throttle(`register:${address}`);
    if(address===(process.env.ADMIN_EMAIL||'wilugo91@gmail.com').toLowerCase())throw new ConflictException('This email cannot be registered. Try signing in.');
    const salt=randomBytes(32).toString('hex'),hash=scryptSync(secret,salt,64).toString('hex');
    const user=(await this.query(`INSERT INTO ablest_users(id,email,name,role,salt,hash) VALUES($1,$2,$3,'client',$4,$5) RETURNING ${profileColumns}`,[randomUUID(),address,name,salt,hash]))[0];
    await this.issue(response,String(user.id),origin,cookie);return{authenticated:true,user};
  }
  @Post('admin/setup')async setup(@Body()body:unknown,@Headers('origin')origin:string,@Res({passthrough:true})response:Reply){
    originCheck(origin);if(await this.initialized())throw new ConflictException('An admin account already exists. Please sign in.');
    const b=object(body),expected=process.env.ADMIN_SETUP_TOKEN;
    if(!expected||expected.length<32||typeof b.setupToken!=='string'||!timingSafeEqual(createHash('sha256').update(b.setupToken).digest(),createHash('sha256').update(expected).digest()))throw new ForbiddenException('A valid owner setup code is required.');
    const address=email(b);if(address!==(process.env.ADMIN_EMAIL||'wilugo91@gmail.com').toLowerCase())throw new UnauthorizedException('Incorrect admin email or password.');
    const salt=randomBytes(32).toString('hex'),hash=scryptSync(password(b),salt,64).toString('hex');
    const user=(await this.query(`INSERT INTO ablest_users(id,email,name,role,salt,hash) VALUES($1,$2,'Administrator','admin',$3,$4) RETURNING ${profileColumns}`,[randomUUID(),address,salt,hash]))[0];
    await this.issue(response,String(user.id),origin);return{authenticated:true,user};
  }
  @Post('auth/login')async signIn(@Body()b:unknown,@Headers('origin')o:string,@Headers('cookie')c:string,@Res({passthrough:true})r:Reply){return this.login(b,o,c,r);}
  @Post('admin/login')async adminLogin(@Body()b:unknown,@Headers('origin')o:string,@Headers('cookie')c:string,@Res({passthrough:true})r:Reply){return this.login(b,o,c,r,true);}
  @Post('auth/logout')async signOut(@Headers('origin')o:string,@Headers('cookie')c:string,@Res({passthrough:true})r:Reply){return this.logout(c,o,r);}
  @Post('admin/logout')async adminLogout(@Headers('origin')o:string,@Headers('cookie')c:string,@Res({passthrough:true})r:Reply){return this.logout(c,o,r);}
  @Get('account')async profile(@Headers('cookie')c:string){return this.account(c);}
  @Patch('account')async updateProfile(@Body()body:unknown,@Headers('cookie')c:string,@Headers('origin')o:string){
    originCheck(o);const user=await this.account(c),b=object(body);if(Object.keys(b).some(k=>!['name','company','phone'].includes(k)))throw new BadRequestException('Only your profile details can be changed.');
    return(await this.query(`UPDATE ablest_users SET name=$1,company=$2,phone=$3 WHERE id=$4 RETURNING ${profileColumns}`,[field(b,'name',100,true),field(b,'company',150),field(b,'phone',40),user.id]))[0];
  }
  @Get('admin/clients')async clients(@Headers('cookie')c:string){await this.admin(c);return this.query(`SELECT ${profileColumns} FROM ablest_users WHERE role='client' ORDER BY name,email`);}
  private async project(id:string){const row=(await this.query('SELECT * FROM ablest_projects WHERE id=$1',[uuid(id)]))[0];if(!row)throw new NotFoundException('Project not found.');return row;}
  private async list(publishedOnly:boolean){return this.query(`SELECT p.*,coalesce((SELECT jsonb_agg(jsonb_build_object('id',i.id,'alt',i.alt,'position',i.position) ORDER BY i.position,i.id) FROM ablest_images i WHERE i.project_id=p.id),'[]'::jsonb) AS images FROM ablest_projects p ${publishedOnly?'WHERE p.published=true':''} ORDER BY p.position,p.id`);}
  @Get('projects')async projects(){return this.list(true);}
  @Get('admin/projects')async adminProjects(@Headers('cookie')c:string){await this.admin(c);return this.list(false);}
  @Post('admin/projects')async create(@Body()body:unknown,@Headers('cookie')c:string,@Headers('origin')o:string){originCheck(o);await this.admin(c);const values=projectInput(body);const row=(await this.query('SELECT ablest_create_project($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9) AS project',[randomUUID(),...values.slice(0,7),Boolean(values[7])]))[0];return{...row.project as Row,images:[]};}
  @Patch('admin/projects/:id')async edit(@Param('id')id:string,@Body()body:unknown,@Headers('cookie')c:string,@Headers('origin')o:string){originCheck(o);await this.admin(c);const values=projectInput(body);const row=(await this.query('UPDATE ablest_projects SET title=$1,subtitle=$2,category=$3,description=$4,features=$5::jsonb,status=$6,url=$7,published=$8 WHERE id=$9 RETURNING *',[...values.slice(0,7),Boolean(values[7]),uuid(id)]))[0];if(!row)throw new NotFoundException('Project not found.');return{...row,images:await this.query('SELECT id,alt,position FROM ablest_images WHERE project_id=$1 ORDER BY position,id',[id])};}
  @Delete('admin/projects/:id')async deleteProject(@Param('id')id:string,@Headers('cookie')c:string,@Headers('origin')o:string){originCheck(o);await this.admin(c);if(!(await this.query('DELETE FROM ablest_projects WHERE id=$1 RETURNING id',[uuid(id)])).length)throw new NotFoundException('Project not found.');return{deleted:true};}
  @Post('admin/projects/:id/images')
  @UseInterceptors(FileInterceptor('image',{limits:{fileSize:8*1024*1024,files:1,fields:1,fieldSize:1000}}))
  async upload(@Param('id')id:string,@UploadedFile()file:{buffer:Buffer;mimetype:string}|undefined,@Body('alt')alt:unknown,@Headers('cookie')c:string,@Headers('origin')o:string){
    originCheck(o);await this.admin(c);await this.project(id);if(!file||!['image/jpeg','image/png','image/webp'].includes(file.mimetype))throw new BadRequestException('Choose a JPEG, PNG, or WebP image up to 8 MB.');if(typeof alt!=='string'||!alt.trim()||alt.length>300)throw new BadRequestException('Add an image description, up to 300 characters.');
    let buffer:Buffer;try{const source=sharp(file.buffer,{limitInputPixels:25000000,animated:false}),meta=await source.metadata();if(!['jpeg','png','webp'].includes(meta.format||''))throw new Error();buffer=await source.rotate().resize({width:2000,height:2000,fit:'inside',withoutEnlargement:true}).webp({quality:85}).toBuffer();}catch{throw new BadRequestException('Choose a valid JPEG, PNG, or WebP under 25 megapixels.');}
    if(buffer.length>2097152)throw new BadRequestException('The optimized image is too large. Choose an image with smaller dimensions.');
    return(await this.query('SELECT ablest_add_image($1,$2,$3,$4) AS image',[randomUUID(),id,alt.trim(),buffer]))[0].image;
  }
  @Patch('admin/images/:id')async editImage(@Param('id')id:string,@Body()body:unknown,@Headers('cookie')c:string,@Headers('origin')o:string){originCheck(o);await this.admin(c);const b=object(body);if(!(await this.query('SELECT ablest_edit_image($1,$2,$3) AS updated',[uuid(id),field(b,'alt',300,true),b.cover===true]))[0].updated)throw new NotFoundException('Image not found.');return{updated:true};}
  @Delete('admin/images/:id')async deleteImage(@Param('id')id:string,@Headers('cookie')c:string,@Headers('origin')o:string){originCheck(o);await this.admin(c);if(!(await this.query('DELETE FROM ablest_images WHERE id=$1 RETURNING id',[uuid(id)])).length)throw new NotFoundException('Image not found.');return{deleted:true};}
  @Get('images/:id')async image(@Param('id')id:string,@Headers('cookie')c:string,@Res()response:Reply){
    const meta=(await this.query('SELECT p.published FROM ablest_images i JOIN ablest_projects p ON p.id=i.project_id WHERE i.id=$1',[uuid(id)]))[0];if(!meta)throw new NotFoundException('Image not found.');
    const allowDraft=!meta.published&&(await this.user(c))?.role==='admin';if(!meta.published&&!allowDraft)throw new NotFoundException('Image not found.');
    const image=(await this.query('SELECT i.data FROM ablest_images i JOIN ablest_projects p ON p.id=i.project_id WHERE i.id=$1 AND (p.published=true OR $2=true)',[id,Boolean(allowDraft)]))[0];if(!image)throw new NotFoundException('Image not found.');
    response.setHeader('Content-Type','image/webp');response.setHeader('Cache-Control','no-store');response.setHeader('X-Content-Type-Options','nosniff');response.send(image.data as Buffer);
  }
}
