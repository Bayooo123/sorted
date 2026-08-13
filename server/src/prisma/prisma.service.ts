import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Shared Prisma handle. Business modules inject this to reach ONLY their own
 * tables (per HANDOFF.md §4). It is infrastructure, not one of the nine
 * modules, and it does not itself enforce the no-cross-module-table-access
 * rule — that discipline is on each module's service code and on review.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
