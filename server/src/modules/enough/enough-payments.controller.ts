import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { AuthenticatedUser, JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { EnoughPaymentsService } from './enough-payments.service';
import { ResolveAccountDto } from './dto/resolve-account.dto';
import { InitiatePaymentDto } from './dto/initiate-payment.dto';

/** PLAN.md "Enough: Make Payment" — see EnoughPaymentsService's doc comment. */
@Controller('enough/payments')
export class EnoughPaymentsController {
  constructor(private readonly payments: EnoughPaymentsService) {}

  @UseGuards(JwtAuthGuard)
  @Get('banks')
  listBanks() {
    return this.payments.listBanks();
  }

  @UseGuards(JwtAuthGuard)
  @Post('resolve')
  resolve(@CurrentUser() user: AuthenticatedUser, @Body() dto: ResolveAccountDto) {
    return this.payments.resolveAccount(user.userId, dto.bankCode, dto.accountNumber);
  }

  @UseGuards(JwtAuthGuard)
  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.payments.listPayments(user.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Post()
  initiate(@CurrentUser() user: AuthenticatedUser, @Body() dto: InitiatePaymentDto) {
    return this.payments.initiatePayment(
      user.userId,
      dto.source.type === 'purpose' ? { type: 'purpose', purposeId: dto.source.purposeId! } : { type: 'landing_spot' },
      BigInt(dto.amountKobo),
      dto.bankCode,
      dto.accountNumber,
      dto.pin,
    );
  }
}
