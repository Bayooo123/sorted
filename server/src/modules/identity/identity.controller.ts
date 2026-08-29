import { Body, Controller, Get, Patch, Post, UseGuards } from '@nestjs/common';
import { IdentityService } from './identity.service';
import { AuthenticatedUser, JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { RequestOtpDto } from './dto/request-otp.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { CompleteRoleProfileDto } from './dto/complete-role-profile.dto';
import { PayoutDestinationDto } from './dto/payout-destination.dto';

/**
 * The only thing in the Identity module that touches HTTP/Express — every
 * other file is transport-agnostic, per the "modules talk through
 * interfaces" rule. Endpoints match PLAN.md's "Registration: account type"
 * section.
 */
@Controller()
export class IdentityController {
  constructor(private readonly identity: IdentityService) {}

  @Post('auth/otp/request')
  requestOtp(@Body() dto: RequestOtpDto) {
    return this.identity.requestOtp({ phone: dto.phone, email: dto.email });
  }

  @Post('auth/otp/verify')
  verifyOtp(@Body() dto: VerifyOtpDto) {
    return this.identity.verifyOtp(dto.requestId, dto.code);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  getMe(@CurrentUser() user: AuthenticatedUser) {
    return this.identity.getUser(user.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('me/payout-destination')
  setPayoutDestination(@CurrentUser() user: AuthenticatedUser, @Body() dto: PayoutDestinationDto) {
    return this.identity.setPayoutDestination(user.userId, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Post('me/role-profile')
  completeRoleProfile(@CurrentUser() user: AuthenticatedUser, @Body() dto: CompleteRoleProfileDto) {
    return this.identity.completeRoleProfile(user.userId, dto);
  }
}
