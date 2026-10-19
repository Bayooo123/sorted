import { Body, Controller, Get, Patch, Post, UseGuards } from '@nestjs/common';
import { AuthenticatedUser, JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { EnoughAccountsService } from './enough-accounts.service';
import { SubmitIdentityDto } from './dto/submit-identity.dto';
import { SetTransactionPinDto } from './dto/set-transaction-pin.dto';

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
}
