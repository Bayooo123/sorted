import { Body, Controller, ForbiddenException, Get, Inject, Param, Post, UseGuards } from '@nestjs/common';
import { EscrowService } from './escrow.service';
import { GigsService } from '../gigs/gigs.service';
import { PAYMENTS_PROVIDER, PaymentsProvider } from '../payments/payments.interface';
import { JwtAuthGuard, AuthenticatedUser } from '../../common/auth/jwt-auth.guard';
import { AdminGuard } from '../../common/auth/admin.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { ConfirmFundingDto } from './dto/confirm-funding.dto';

/**
 * The only thing in the Escrow module that touches HTTP/Express, same
 * pattern as GigsController. Routes live under /gigs/:id/... rather than
 * /escrow/... because they're always addressed by gig, matching how the
 * mobile app (FundEscrowScreen) already navigates.
 */
@Controller('gigs')
export class EscrowController {
  constructor(
    private readonly escrow: EscrowService,
    private readonly gigs: GigsService,
    @Inject(PAYMENTS_PROVIDER) private readonly payments: PaymentsProvider,
  ) {}

  /**
   * Client-only. Creates the EscrowRecord and returns the transfer
   * instructions to show on FundEscrowScreen. During the manual pilot
   * this is the same fixed account every time (manual-pilot.provider.ts)
   * — re-calling this for a gig that's already funded just re-returns its
   * current state (EscrowService.fundGig is idempotent), it never opens a
   * second holding account.
   */
  @UseGuards(JwtAuthGuard)
  @Post(':id/fund')
  async fund(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    const gig = await this.gigs.getGig(id);
    if (gig.clientId !== user.userId) {
      throw new ForbiddenException('Only the gig owner can fund it');
    }
    const [record, holdingAccount] = await Promise.all([
      this.escrow.fundGig(id),
      this.payments.createHoldingAccount(id),
    ]);
    return {
      ...record,
      transferInstructions: {
        accountNumber: holdingAccount.accountNumber,
        bankName: holdingAccount.bankName,
        provider: holdingAccount.provider,
      },
    };
  }

  /**
   * Admin-only (ADMIN_API_KEY via x-admin-key header). During the manual
   * pilot this is called by the founder after they see the transfer land
   * in their own bank/Opay app — see PLAN.md's "Manual escrow pilot"
   * section and manual-pilot.provider.ts's doc comment for why there's no
   * automated webhook path here.
   */
  @UseGuards(AdminGuard)
  @Post(':id/confirm-funding')
  confirmFunding(@Param('id') id: string, @Body() dto: ConfirmFundingDto) {
    return this.escrow.confirmFunding(id, dto.providerRef);
  }

  /** For FundEscrowScreen to poll while it's waiting on the founder to confirm. */
  @UseGuards(JwtAuthGuard)
  @Get(':id/escrow')
  getEscrow(@Param('id') id: string) {
    return this.escrow.getEscrow(id);
  }
}
