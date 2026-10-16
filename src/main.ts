import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import { DomainExceptionFilter } from './shared/interface/http/domain-exception.filter';

import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.useGlobalFilters(app.get(DomainExceptionFilter));
  const port = process.env.PORT ?? '3000';

  await app.listen(port);
}

void bootstrap();
