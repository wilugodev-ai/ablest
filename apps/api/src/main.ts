import 'reflect-metadata';
import { Controller, Get, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
@Controller('v1')
class SiteController {
  @Get('health') health() { return { status: 'ok', service: 'ablest-api' }; }
}
@Module({ controllers: [SiteController] })
class AppModule {}
async function bootstrap() {
  const backend=process.env.DATA_BACKEND || 'sqlite';
  if(!['sqlite','supabase','neon'].includes(backend))throw new Error('DATA_BACKEND must be sqlite, neon, or supabase.');
  if(process.env.RENDER==='true' && backend==='sqlite')throw new Error('Render Free requires a hosted database backend for durable data.');
  if(backend==='neon')await (await import('./neon-database')).initialiseNeonDatabase();
  const controllers=backend==='neon'?[(await import('./neon')).NeonController]:backend==='supabase' ? [(await import('./cloud')).CloudController] : [(await import('./content')).ContentController,(await import('./accounts')).AccountsController];
  const app = await NestFactory.create<NestExpressApplication>({module:AppModule,controllers});
  app.enableShutdownHooks();
  app.useBodyParser('json', { limit: '100kb' });
  app.enableCors({ origin: process.env.WEB_ORIGIN || 'http://127.0.0.1:3200' });
  await app.listen(Number(process.env.PORT || 4200), process.env.HOST || '127.0.0.1');
}
void bootstrap();
