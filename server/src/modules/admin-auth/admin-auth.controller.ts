import { Body, Controller, Patch, Post, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import { AdminAuthService } from './admin-auth.service';
import { AdminGuard, RequestWithAdmin } from '../../common/auth/admin.guard';
import { AdminRegisterDto } from './dto/admin-register.dto';
import { AdminLoginDto } from './dto/admin-login.dto';
import { AdminChangePasswordDto } from './dto/admin-change-password.dto';

/**
 * The only thing in this module that touches HTTP/Express. Lives under
 * /admin (not /admin/auth) since dashboard.html and friends already treat
 * /admin/... as "the admin API" — see AdminGuard for how these routes are
 * protected and PLAN.md "Admin username/password login" for the full story.
 */
@Controller('admin')
export class AdminAuthController {
  constructor(private readonly adminAuth: AdminAuthService) {}

  @Post('register')
  register(@Body() dto: AdminRegisterDto) {
    return this.adminAuth.register(dto);
  }

  @Post('login')
  login(@Body() dto: AdminLoginDto) {
    return this.adminAuth.login(dto);
  }

  /** Requires the caller to have actually logged in — the legacy x-admin-key fallback never sets req.admin, so it can't change a password that isn't tied to any admin identity. */
  @UseGuards(AdminGuard)
  @Patch('password')
  changePassword(@Req() req: RequestWithAdmin, @Body() dto: AdminChangePasswordDto) {
    if (!req.admin) {
      throw new UnauthorizedException('Log in with your username and password first — the legacy admin key can\'t change a password.');
    }
    return this.adminAuth.changePassword(req.admin.adminId, dto);
  }
}
