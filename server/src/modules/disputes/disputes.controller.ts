import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { DisputesService } from './disputes.service';
import { JwtAuthGuard, AuthenticatedUser } from '../../common/auth/jwt-auth.guard';
import { AdminGuard } from '../../common/auth/admin.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { RaiseDisputeDto } from './dto/raise-dispute.dto';
import { ResolveDisputeDto } from './dto/resolve-dispute.dto';

/**
 * The only thing in the Disputes module that touches HTTP/Express. Split
 * across two path prefixes on purpose: raising is gig-addressed (matches
 * GigsController/EscrowController's "/gigs/:id/..." convention, since a
 * dispute is always about one gig), resolving is dispute-addressed (an
 * admin acts on the Dispute record itself, same shape as escrow's
 * confirm-funding admin action).
 */
@Controller()
export class DisputesController {
  constructor(private readonly disputes: DisputesService) {}

  @UseGuards(JwtAuthGuard)
  @Post('gigs/:id/dispute')
  raise(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: RaiseDisputeDto) {
    return this.disputes.raiseDispute(id, user.userId, dto.reason);
  }

  /** Admin-only (ADMIN_API_KEY via x-admin-key header) — same disclosed-manual pattern as escrow's confirm-funding. No neutral panel in this pilot. */
  @UseGuards(AdminGuard)
  @Post('disputes/:id/resolve')
  resolve(@Param('id') id: string, @Body() dto: ResolveDisputeDto) {
    return this.disputes.recordRuling(id, dto.ruling);
  }
}
