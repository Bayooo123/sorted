import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { corsOrigins } from './cors';

/**
 * Entry point for running the API as a normal long-running process (local
 * dev, or any non-serverless host). The deployed API on Vercel instead
 * boots through api/index.ts, which wraps the same AppModule as a
 * serverless function — see that file's doc comment for why.
 */
async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.enableCors({ origin: corsOrigins() });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  // Default (100kb) is too small for a base64 profile photo / KYC document
  // upload — see identity.service.ts's MAX_IMAGE_DATA_URI_LENGTH, which
  // stays comfortably under this.
  app.useBodyParser('json', { limit: '4mb' });
  const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
  await app.listen(port);
}

bootstrap();
