import { Body, Controller, ForbiddenException, Get, Param, Post, UseGuards } from '@nestjs/common';
import { EscrowService } from './escrow.service';
import { GigsService } from '../gigs/gigs.service';
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
  ) {}

  /**
   * Client-only. Creates the EscrowRecord (idempotent — re-calling this
   * for a gig that already has one just returns the same record and the
   * same holdingAccount details, never opens a second holding account /
   * a second Paystack checkout session for the same gig). The record's
   * `holdingAccount` field is what the client actually pays with —
   * shape depends on the active PaymentsProvider (see
   * payments.interface.ts's HoldingAccount doc comment).
   */
  @UseGuards(JwtAuthGuard)
  @Post(':id/fund')
  async fund(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    const gig = await this.gigs.getGig(id);
    if (gig.clientId !== user.userId) {
      throw new ForbiddenException('Only the gig owner can fund it');
    }
    return this.escrow.fundGig(id);
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

  /**
   * Professional-only. Claims an open gig and holds its stake in one call
   * — see EscrowService.holdStake's doc comment for why (no real stake
   * money moves in this pilot, so there's no separate payment step to
   * wait on between "claimed" and "in_progress").
   */
  @UseGuards(JwtAuthGuard)
  @Post(':id/claim')
  claim(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.escrow.holdStake(id, user.userId);
  }

  /**
   * Client-only, owner-only. "Approve & release payment" on
   * ReviewSignOffScreen — never a client-side-only status flip, always
   * this call, which disburses to the professional via PaymentsProvider.
   */
  @UseGuards(JwtAuthGuard)
  @Post(':id/release')
  async release(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    const gig = await this.gigs.getGig(id);
    if (gig.clientId !== user.userId) {
      throw new ForbiddenException('Only the gig owner can release payment');
    }
    return this.escrow.releaseToProfessional(id);
  }
}
