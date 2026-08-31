import { Body, Controller, Get, Patch, Post, UseGuards } from '@nestjs/common';
import { IdentityService } from './identity.service';
import { AuthenticatedUser, JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { SignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';
import { CompleteRoleProfileDto } from './dto/complete-role-profile.dto';
import { PayoutDestinationDto } from './dto/payout-destination.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';

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
}
