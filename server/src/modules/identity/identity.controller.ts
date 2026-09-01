import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { IdentityService } from './identity.service';
import { AuthenticatedUser, JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { AdminGuard } from '../../common/auth/admin.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { SignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';
import { CompleteRoleProfileDto } from './dto/complete-role-profile.dto';
import { PayoutDestinationDto } from './dto/payout-destination.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { UpdateAvatarDto } from './dto/update-avatar.dto';
import { ApplyKycDto } from './dto/apply-kyc.dto';
import { ReviewKycDto } from './dto/review-kyc.dto';

/**
 * The only thing in the Identity module that touches HTTP/Express — every
 * other file is transport-agnostic, per the "modules talk through
 * interfaces" rule. Endpoints match PLAN.md's "Registration: account type"
 * section.
 */
@Controller()
export class IdentityController {
  constructor(private readonly identity: IdentityService) {}

  @Post('auth/signup')
  signup(@Body() dto: SignupDto) {
    return this.identity.signup(dto);
  }

  @Post('auth/login')
  login(@Body() dto: LoginDto) {
    return this.identity.login(dto);
  }

  @Post('auth/forgot-password')
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.identity.requestPasswordReset(dto);
  }

  @Post('auth/reset-password')
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.identity.resetPassword(dto);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  getMe(@CurrentUser() user: AuthenticatedUser) {
    return this.identity.getUser(user.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('me/profile')
  updateProfile(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateProfileDto) {
    return this.identity.updateProfile(user.userId, dto);
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

  @UseGuards(JwtAuthGuard)
  @Patch('me/avatar')
  updateAvatar(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateAvatarDto) {
    return this.identity.updateAvatar(user.userId, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Post('me/kyc/apply')
  applyForKyc(@CurrentUser() user: AuthenticatedUser, @Body() dto: ApplyKycDto) {
    return this.identity.applyForKyc(user.userId, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me/kyc')
  getMyKyc(@CurrentUser() user: AuthenticatedUser) {
    return this.identity.getMyKycRequest(user.userId);
  }

  /** Admin-only (x-admin-key) — see AdminGuard's doc comment. No web UI in the main app on purpose; reviewed from a separate, unlinked admin page. */
  @UseGuards(AdminGuard)
  @Get('admin/kyc/pending')
  listPendingKyc() {
    return this.identity.listPendingKycRequests();
  }

  @UseGuards(AdminGuard)
  @Post('admin/kyc/:id/review')
  reviewKyc(@Param('id') id: string, @Body() dto: ReviewKycDto) {
    return this.identity.reviewKyc(id, dto);
  }
}
