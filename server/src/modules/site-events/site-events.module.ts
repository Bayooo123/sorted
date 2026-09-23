import { Module } from '@nestjs/common';
import { SiteEventsController } from './site-events.controller';

/** Only needs the global PrismaService + ConfigService — no cross-module deps. See SiteEventsController's doc comment. */
@Module({
  controllers: [SiteEventsController],
})
export class SiteEventsModule {}
