import { Body, Controller, ForbiddenException, Get, Param, Post, UseGuards } from '@nestjs/common';
import { EscrowService } from './escrow.service';
import { GigsService } from '../gigs/gigs.service';
import { JwtAuthGuard, AuthenticatedUser } from '../../common/auth/jwt-auth.guard';
import { AdminGuard } from '../../common/auth/admin.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { ConfirmReleaseDto } from './dto/confirm-release.dto';

/**
 * The only thing in the Escrow module that touches HTTP/Express, same
 * pattern as GigsController. Routes live under /gigs/:id/... rather than
 * /escrow/... because they're always addressed by gig.
 *
 * PLAN.md "Split payment pivot" — the old fund/confirm-funding routes are
 * gone: nothing is charged at publish time anymore, so there's no funding
 * step for a client to complete before a gig opens. release/confirm-release
 * are the new payment moment instead — see EscrowService.
 */
@Controller('gigs')
export class EscrowController {
  constructor(
    private readonly escrow: EscrowService,
    private readonly gigs: GigsService,
  ) {}

  /** For the app to poll while it's waiting on a release charge/split to confirm. */
  @UseGuards(JwtAuthGuard)
  @Get(':id/escrow')
  getEscrow(@Param('id') id: string) {
    return this.escrow.getEscrow(id);
  }

  /**
   * Professional-only. Claims an open gig and creates its EscrowRecord in
   * one call — see EscrowService.holdStake's doc comment for why (no real
   * stake money moves in this pilot, so there's no separate payment step
   * to wait on between "claimed" and "in_progress").
   */
  @UseGuards(JwtAuthGuard)
  @Post(':id/claim')
  claim(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.escrow.holdStake(id, user.userId);
  }

  /**
   * Client-only, owner-only. "Approve & pay" on ReviewSignOffScreen —
   * never a client-side-only status flip, always this call. Initiates the
   * charge+split (PLAN.md "Split payment pivot") and returns where to pay
   * (releaseCheckout on the response) — the gig isn't actually released
   * until confirm-release below fires.
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

  /**
   * Admin-only (ADMIN_API_KEY via x-admin-key header). During the manual
   * pilot this is called by the founder after they see the client's
   * transfer land and have sent the professional their share by hand —
   * see ManualPilotProvider.chargeWithSplit's doc comment for why there's
   * no automated webhook path here.
   */
  @UseGuards(AdminGuard)
  @Post(':id/confirm-release')
  confirmRelease(@Param('id') id: string, @Body() dto: ConfirmReleaseDto) {
    return this.escrow.confirmRelease(id, dto.providerRef);
  }
}
