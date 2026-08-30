import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import { ValidationPipe } from '@nestjs/common';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import express from 'express';
import { AppModule } from '../src/app.module';
import { corsOrigins } from '../src/cors';

/**
 * Vercel entry point. Vercel functions are short-lived — there's no
 * app.listen() here, just an Express instance Vercel calls per request —
 * so the Nest app is bootstrapped once and cached across warm invocations
 * (bootstrapped stays a resolved promise after the first cold start; a
 * concurrent cold start awaits the same in-flight promise instead of
 * racing a second bootstrap).
 *
 * Known tradeoff, not a hidden one: each function instance holds its own
 * Prisma connection pool, so under real concurrent traffic this can put
 * more simultaneous connections on the database than a single
 * long-running process would (server/src/main.ts's model). Fine at this
 * stage's traffic; revisit with PgBouncer/Prisma Accelerate (or move to a
 * persistent host) before that becomes real load.
 */
const expressApp = express();
let bootstrapped: Promise<void> | null = null;

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, new ExpressAdapter(expressApp));
  app.enableCors({ origin: corsOrigins() });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!bootstrapped) bootstrapped = bootstrap();
  await bootstrapped;
  expressApp(req, res);
}
