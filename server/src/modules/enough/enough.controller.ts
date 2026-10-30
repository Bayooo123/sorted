import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { AuthenticatedUser, JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { AdminGuard } from '../../common/auth/admin.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { EnoughAccountsService } from './enough-accounts.service';
import { SubmitIdentityDto } from './dto/submit-identity.dto';
import { SetTransactionPinDto } from './dto/set-transaction-pin.dto';
import { UpdateDescriptionDto } from './dto/update-description.dto';

/**
 * PLAN.md "Enough: Bachs Connect account per signup" — reuses Sorted's
 * existing JwtAuthGuard/User, not a parallel auth system. See
 * EnoughAccountsService's doc comment for the full flow.
 */
@Controller('enough/account')
export class EnoughController {
  constructor(private readonly accounts: EnoughAccountsService) {}

  @UseGuards(JwtAuthGuard)
  @Post()
  submitIdentity(@CurrentUser() user: AuthenticatedUser, @Body() dto: SubmitIdentityDto) {
    return this.accounts.submitIdentity(user.userId, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Get()
  getAccount(@CurrentUser() user: AuthenticatedUser) {
    return this.accounts.getAccountView(user.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('pin')
  async setPin(@CurrentUser() user: AuthenticatedUser, @Body() dto: SetTransactionPinDto) {
    await this.accounts.setTransactionPin(user.userId, dto.pin, dto.currentPin);
    return { ok: true };
  }

  @UseGuards(JwtAuthGuard)
  @Get('history')
  getHistory(@CurrentUser() user: AuthenticatedUser) {
    return this.accounts.getHistory(user.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('description')
  async updateDescription(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateDescriptionDto) {
    await this.accounts.updateDescription(user.userId, dto.description);
    return { ok: true };
  }

  /**
   * Admin-only (x-admin-key) — see AdminGuard's doc comment. A real
   * user's deposit account number changes as a result (their old Bachs/
   * Nomba virtual account stops being monitored), so this is deliberately
   * a manual, one-at-a-time admin action rather than anything automatic.
   * See EnoughAccountsService.migrateToPaga's doc comment.
   */
  @UseGuards(AdminGuard)
  @Post('admin/:userId/migrate-to-paga')
  migrateToPaga(@Param('userId') userId: string) {
    return this.accounts.migrateToPaga(userId);
  }
}
