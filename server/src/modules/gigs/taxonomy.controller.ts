import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Read-only taxonomy listing. Deliberately NOT part of GigsService — that
 * stays fully stubbed until slice 3 (gig creation/lifecycle). This exists
 * now because Identity's role-profile picker (slice 2) needs somewhere to
 * read Domain/Submarket options from; "list the categories" carries no gig
 * lifecycle logic, so shipping it early doesn't front-run slice 3.
 */
@Controller('taxonomy')
export class TaxonomyController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('domains')
  listDomains() {
    return this.prisma.domain.findMany({ orderBy: { label: 'asc' } });
  }

  @Get('submarkets')
  listSubmarkets() {
    return this.prisma.submarket.findMany({
      orderBy: { label: 'asc' },
      include: { domain: true },
    });
  }

  @Get('client-types')
  listClientTypes() {
    return this.prisma.clientTypeRef.findMany({ orderBy: { label: 'asc' } });
  }
}
