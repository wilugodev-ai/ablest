import {createRequire}from'node:module';
import{DatabaseSync}from'node:sqlite';
import{createHash}from'node:crypto';
import{resolve}from'node:path';
import{fileURLToPath}from'node:url';
const require=createRequire(new URL('../apps/api/package.json',import.meta.url));
const{createNeonPool,initialiseNeonDatabase}=require('./dist/neon-database.js');
if(!process.argv.includes('--confirm')){process.stderr.write('Run with --confirm to copy local account settings, projects, and images to an empty Ablests Neon database. Local SQLite is not changed. Sessions are not copied.\n');process.exit(1);}
const path=process.env.DATA_DIR?resolve(process.env.DATA_DIR,'content.sqlite'):fileURLToPath(new URL('../.data/content.sqlite',import.meta.url));
function identifier(value){if(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value))return value;const hash=createHash('sha256').update(`ablest-local:${value}`).digest('hex');return`${hash.slice(0,8)}-${hash.slice(8,12)}-5${hash.slice(13,16)}-a${hash.slice(17,20)}-${hash.slice(20,32)}`;}
let pool,client,source;
try{
 source=new DatabaseSync(path,{readOnly:true});source.exec('BEGIN');
 const users=source.prepare('SELECT * FROM users').all();
 const projects=source.prepare('SELECT * FROM projects ORDER BY position,id').all();
 const images=source.prepare('SELECT * FROM images ORDER BY position,id').all();
 source.exec('COMMIT');source.close();source=undefined;
 await initialiseNeonDatabase();pool=createNeonPool();client=await pool.connect();await client.query('BEGIN');
 await client.query("SELECT pg_advisory_xact_lock(hashtext('ablest-import-local'))");
 await client.query('LOCK TABLE ablest_users,ablest_projects,ablest_images IN ACCESS EXCLUSIVE MODE');
 const already=await client.query("SELECT value FROM ablest_meta WHERE key='local_imported'");
 if(already.rows.length)throw new Error('Local data has already been imported. No data was changed.');
 const contents=await client.query('SELECT (SELECT count(*) FROM ablest_users)::int AS users,(SELECT count(*) FROM ablest_images)::int AS images');
 const existing=await client.query('SELECT title FROM ablest_projects ORDER BY position,id');
 if(contents.rows[0].users||contents.rows[0].images||existing.rows.length!==2||existing.rows[0].title!=='InTouch'||existing.rows[1].title!=='IterateView')throw new Error('The target already contains user data or custom projects. Import refused; no records were overwritten.');
 await client.query('DELETE FROM ablest_projects');
 for(const user of users)await client.query('INSERT INTO ablest_users(id,email,name,company,phone,role,salt,hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[identifier(user.id),user.email,user.name,user.company,user.phone,user.role,user.salt,user.hash]);
 for(const project of projects)await client.query('INSERT INTO ablest_projects(id,title,subtitle,category,description,features,status,url,published,position) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10)',[identifier(project.id),project.title,project.subtitle,project.category,project.description,project.features,project.status,project.url,Boolean(project.published),project.position]);
 for(const image of images){const data=Buffer.from(image.data);if(data.length>2097152)throw new Error('A local image exceeds the hosted 2 MB optimized-image limit. Import cancelled.');await client.query('INSERT INTO ablest_images(id,project_id,alt,data,position) VALUES($1,$2,$3,$4,$5)',[identifier(image.id),identifier(image.project_id),image.alt,data,image.position]);}
 await client.query("INSERT INTO ablest_meta(key,value)VALUES('local_imported',$1)",[new Date().toISOString()]);await client.query('COMMIT');
 process.stdout.write(JSON.stringify({importedUsers:users.length,importedProjects:projects.length,importedImages:images.length,localDatabaseChanged:false,sessionsCopied:false})+'\n');
}catch(error){if(client)await client.query('ROLLBACK').catch(()=>{});process.stderr.write((error instanceof Error&&/^Local data|^The target|^A local image/.test(error.message)?error.message:'Import failed. Check the local database, DATABASE_URL, and hosted schema. No local records were changed.')+'\n');process.exitCode=1;}
finally{source?.close();client?.release();await pool?.end();}
