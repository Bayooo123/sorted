import { Controller, Get, Inject } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PAYMENTS_PROVIDER, PaymentsProvider } from '../payments/payments.interface';

/**
 * Read-only taxonomy listing. Deliberately NOT part of GigsService — that
 * stays fully stubbed until slice 3 (gig creation/lifecycle). This exists
 * now because Identity's role-profile picker (slice 2) needs somewhere to
 * read Domain/Submarket options from; "list the categories" carries no gig
 * lifecycle logic, so shipping it early doesn't front-run slice 3.
 *
 * PLAN.md "Bank list endpoint" — `banks` isn't Prisma-backed like the rest
 * of this controller (it comes from PaymentsProvider.listBanks), but the
 * ROLE is identical: reference data to power a picker, needed by
 * Identity's payout-destination screen the same way domains/submarkets
 * are needed by the role-profile picker. Same precedent as those.
 */
@Controller('taxonomy')
export class TaxonomyController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(PAYMENTS_PROVIDER) private readonly payments: PaymentsProvider,
  ) {}

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

  @Get('banks')
  listBanks() {
    return this.payments.listBanks();
  }
}
