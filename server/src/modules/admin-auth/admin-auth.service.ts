import * as bcrypt from 'bcryptjs';
import { ConflictException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../prisma/prisma.service';
import { AdminAuthResult, AdminChangePasswordInput, AdminLoginInput, AdminRegisterInput } from './admin-auth.interface';

const BCRYPT_ROUNDS = 12;

/**
 * PLAN.md "Admin username/password login". A single operator today, same
 * trust model as the rest of this pilot (manual-pilot.provider.ts,
 * AdminGuard's doc comment) — register() enforces that by refusing once
 * any AdminUser row exists, rather than building a permission system for
 * a table that's meant to stay at one row.
 */
@Injectable()
export class AdminAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  /**
   * Public but self-limiting — only ever succeeds once. Exists purely so
   * the one admin account can be created over HTTP after this ships: the
   * sandbox this was built in can't reach production Postgres directly to
   * seed it, and a permanent open registration endpoint would defeat the
   * whole point of moving off a shared secret.
   */
  async register(input: AdminRegisterInput): Promise<AdminAuthResult> {
    const existing = await this.prisma.adminUser.count();
    if (existing > 0) throw new ConflictException('An admin account already exists — use PATCH /admin/password to change it, not register.');

    const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);
    const admin = await this.prisma.adminUser.create({ data: { username: input.username, passwordHash } });
    return this.issueToken(admin.id, admin.username);
  }

  async login(input: AdminLoginInput): Promise<AdminAuthResult> {
    const admin = await this.prisma.adminUser.findUnique({ where: { username: input.username } });
    if (!admin) throw new UnauthorizedException('Incorrect username or password');

    const isMatch = await bcrypt.compare(input.password, admin.passwordHash);
    if (!isMatch) throw new UnauthorizedException('Incorrect username or password');

    return this.issueToken(admin.id, admin.username);
  }

  /** adminId comes from AdminGuard's req.admin — only reachable via a real login token, never the legacy x-admin-key (see AdminGuard's doc comment). */
  async changePassword(adminId: string, input: AdminChangePasswordInput): Promise<void> {
    const admin = await this.prisma.adminUser.findUnique({ where: { id: adminId } });
    if (!admin) throw new NotFoundException('Admin account not found');

    const isMatch = await bcrypt.compare(input.currentPassword, admin.passwordHash);
    if (!isMatch) throw new UnauthorizedException('Current password is incorrect');

    const passwordHash = await bcrypt.hash(input.newPassword, BCRYPT_ROUNDS);
    await this.prisma.adminUser.update({ where: { id: adminId }, data: { passwordHash } });
  }

  private async issueToken(adminId: string, username: string): Promise<AdminAuthResult> {
    const accessToken = await this.jwt.signAsync({ sub: adminId, username, kind: 'admin' });
    return { accessToken, username };
  }
}
