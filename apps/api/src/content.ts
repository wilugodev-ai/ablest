import { BadRequestException, Body, ConflictException, Controller, Delete, ForbiddenException, Get, Headers, HttpException, NotFoundException, Param, Patch, Post, Res, UnauthorizedException, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { projectInput, text } from './project-validation';

import { db, type Row } from './store';
import { accountFor, requireAdministrator, setupAdministrator, signIn, signOut } from './accounts';
type Reply = { setHeader(name: string, value: string): void; send(body: Buffer): void };
function loggedIn(cookie?: string) { return accountFor(cookie)?.role === 'admin'; }
function requireAdmin(cookie?: string) { requireAdministrator(cookie); }
function originCheck(origin?: string) {
 const allowed = process.env.WEB_ORIGIN ? [process.env.WEB_ORIGIN] : ['http://127.0.0.1:3200','http://localhost:3200'];
 if (!origin || !allowed.includes(origin)) throw new ForbiddenException('This request must come from the website.');
}
function project(id: string) { const row = db.prepare('SELECT * FROM projects WHERE id=?').get(id) as Row | undefined; if (!row) throw new NotFoundException('Project not found.'); return row; }
function serialize(row: Row) { return { ...row, published: Boolean(row.published), features: JSON.parse(String(row.features)), images: db.prepare('SELECT id,alt,position FROM images WHERE project_id=? ORDER BY position,id').all(String(row.id)) }; }

@Controller('v1')
export class ContentController {
  @Get('admin/session') session(@Headers('cookie') cookie?: string) { const user=accountFor(cookie);return { initialized: Boolean(db.prepare('SELECT id FROM owner').get()), authenticated: user?.role==='admin', user, setupTokenRequired: process.env.NODE_ENV==='production' || Boolean(process.env.ADMIN_SETUP_TOKEN) }; }
  @Post('admin/setup') setup(@Body() body: unknown, @Headers('origin') origin: string, @Res({ passthrough: true }) response: Reply) { return setupAdministrator(body,response,origin); }
  @Post('admin/login') login(@Body() body: unknown, @Headers('origin') origin: string, @Headers('cookie') cookie: string, @Res({ passthrough: true }) response: Reply) { return signIn(body,response,origin,cookie,true); }
  @Post('admin/logout') logout(@Headers('cookie') cookie: string, @Headers('origin') origin: string, @Res({ passthrough: true }) response: Reply) { return signOut(cookie,origin,response); }
  @Get('projects') publicProjects() { return db.prepare('SELECT * FROM projects WHERE published=1 ORDER BY position,id').all().map(serialize); }
  @Get('admin/projects') projects(@Headers('cookie') cookie: string) { requireAdmin(cookie); return db.prepare('SELECT * FROM projects ORDER BY position,id').all().map(serialize); }
  @Post('admin/projects') create(@Body() body: unknown, @Headers('cookie') cookie: string, @Headers('origin') origin: string) {
    originCheck(origin); requireAdmin(cookie);
    if (Number((db.prepare('SELECT COUNT(*) AS n FROM projects').get() as Row).n) >= 100) throw new BadRequestException('Maximum 100 projects.');
    const values = projectInput(body), id = randomUUID(); const position = Number((db.prepare('SELECT COALESCE(MAX(position),-1)+1 AS n FROM projects').get() as Row).n);
    db.prepare('INSERT INTO projects VALUES (?,?,?,?,?,?,?,?,?,?)').run(id, ...values as string[], position); return serialize(project(id));
  }
  @Patch('admin/projects/:id') update(@Param('id') id: string, @Body() body: unknown, @Headers('cookie') cookie: string, @Headers('origin') origin: string) {
    originCheck(origin); requireAdmin(cookie); project(id); const values = projectInput(body);
    db.prepare('UPDATE projects SET title=?,subtitle=?,category=?,description=?,features=?,status=?,url=?,published=? WHERE id=?').run(...values as string[], id); return serialize(project(id));
  }
  @Delete('admin/projects/:id') remove(@Param('id') id: string, @Headers('cookie') cookie: string, @Headers('origin') origin: string) { originCheck(origin); requireAdmin(cookie); project(id); db.prepare('DELETE FROM projects WHERE id=?').run(id); return { deleted: true }; }
  @Post('admin/projects/:id/images')
  @UseInterceptors(FileInterceptor('image', { limits: { fileSize: 8 * 1024 * 1024, files: 1, fields: 1, fieldSize: 1000 } }))
  async upload(@Param('id') id: string, @UploadedFile() file: { buffer: Buffer; mimetype: string } | undefined, @Body('alt') alt: unknown, @Headers('cookie') cookie: string, @Headers('origin') origin: string) {
    originCheck(origin); requireAdmin(cookie); project(id);
    if (!file || !['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) throw new BadRequestException('Choose a JPEG, PNG, or WebP image up to 8 MB.');
    if (typeof alt !== 'string' || !alt.trim() || alt.length > 300) throw new BadRequestException('Add an image description, up to 300 characters.');
    if (Number((db.prepare('SELECT COUNT(*) AS n FROM images WHERE project_id=?').get(id) as Row).n) >= 12) throw new BadRequestException('Maximum 12 images per project.');
    let image: Buffer;
    try { const source = sharp(file.buffer, { limitInputPixels: 25000000, animated: false }); const meta = await source.metadata(); if (!['jpeg', 'png', 'webp'].includes(meta.format || '')) throw new Error(); image = await source.rotate().resize({ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true }).webp({ quality: 85 }).toBuffer(); }
    catch { throw new BadRequestException('This image cannot be read. Choose a valid JPEG, PNG, or WebP under 25 megapixels.'); }
    // Recheck after async decoding: the project or its image count may have changed.
    project(id);
    if (Number((db.prepare('SELECT COUNT(*) AS n FROM images WHERE project_id=?').get(id) as Row).n) >= 12) throw new BadRequestException('Maximum 12 images per project.');
    const imageId = randomUUID(), position = Number((db.prepare('SELECT COALESCE(MAX(position),-1)+1 AS n FROM images WHERE project_id=?').get(id) as Row).n);
    db.prepare('INSERT INTO images VALUES(?,?,?,?,?)').run(imageId, id, alt.trim(), image, position); return { id: imageId, alt: alt.trim(), position };
  }
  @Patch('admin/images/:id') editImage(@Param('id') id: string, @Body() body: Row, @Headers('cookie') cookie: string, @Headers('origin') origin: string) {
    originCheck(origin); requireAdmin(cookie); const alt = text(body || {}, 'alt', 300, true);
    const image = db.prepare('SELECT project_id FROM images WHERE id=?').get(id) as Row | undefined;
    if (!image) throw new NotFoundException('Image not found.');
    db.prepare('UPDATE images SET alt=? WHERE id=?').run(alt,id);
    if (body.cover === true) { const n = Number((db.prepare('SELECT COALESCE(MIN(position),0)-1 AS n FROM images WHERE project_id=?').get(String(image.project_id)) as Row).n); db.prepare('UPDATE images SET position=? WHERE id=?').run(n,id); }
    return { updated: true };
  }
  @Delete('admin/images/:id') deleteImage(@Param('id') id: string, @Headers('cookie') cookie: string, @Headers('origin') origin: string) { originCheck(origin); requireAdmin(cookie); if (!db.prepare('DELETE FROM images WHERE id=?').run(id).changes) throw new NotFoundException('Image not found.'); return { deleted: true }; }
  @Get('images/:id') image(@Param('id') id: string, @Headers('cookie') cookie: string, @Res() response: Reply) {
    const image = db.prepare('SELECT images.data,projects.published FROM images JOIN projects ON projects.id=images.project_id WHERE images.id=?').get(id) as Row | undefined;
    if (!image || (!image.published && !loggedIn(cookie))) throw new NotFoundException('Image not found.');
    response.setHeader('Content-Type', 'image/webp'); response.setHeader('X-Content-Type-Options', 'nosniff'); response.setHeader('Cache-Control', 'no-store'); response.send(Buffer.from(image.data as Uint8Array));
  }
}
