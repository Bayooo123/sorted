import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { corsOrigins } from './cors';

/**
 * Entry point for running the API as a normal long-running process (local
 * dev, or any non-serverless host). The deployed API on Vercel instead
 * boots through api/index.ts, which wraps the same AppModule as a
 * serverless function — see that file's doc comment for why.
 */
async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({ origin: corsOrigins() });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
  await app.listen(port);
}

bootstrap();
