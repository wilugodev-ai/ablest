import 'reflect-metadata';
import { Controller, Get, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ContentController } from './content';
import { AccountsController } from './accounts';
@Controller('v1')
class SiteController {
  @Get('health') health() { return { status: 'ok', service: 'ablest-api' }; }
}
@Module({ controllers: [SiteController, ContentController, AccountsController] })
class AppModule {}
async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.enableShutdownHooks();
  app.useBodyParser('json', { limit: '100kb' });
  app.enableCors({ origin: process.env.WEB_ORIGIN || 'http://127.0.0.1:3200' });
  await app.listen(Number(process.env.PORT || 4200), '127.0.0.1');
}
void bootstrap();
