import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

/**
 * The landing page (sorted.com.ng) and this API (sorted.sites.naijabase.dev)
 * are different origins, so the browser needs an explicit CORS allowlist —
 * without this, every fetch from the landing page's login/signup modal
 * fails before it reaches a controller (Safari surfaces this as the opaque
 * "Load failed", easy to mistake for a dead backend). Mobile isn't affected
 * — React Native's fetch isn't browser-origin-checked.
 */
function corsOrigins(): string[] {
  const configured = process.env.CORS_ALLOWED_ORIGINS;
  if (configured) return configured.split(',').map((o) => o.trim());
  return ['https://sorted.com.ng', 'https://www.sorted.com.ng', 'http://localhost:3000', 'http://localhost:5173'];
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({ origin: corsOrigins() });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
  await app.listen(port);
}

bootstrap();
