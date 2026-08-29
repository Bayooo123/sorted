import { randomBytes, randomInt, scryptSync, timingSafeEqual } from 'crypto';
import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  NotImplementedException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../prisma/prisma.service';
import { NOTIFICATIONS_PORT, NotificationsPort } from '../reputation-notifications/notifications.interface';
import {
  CompleteRoleProfileInput,
  IdentityPort,
  IdentityUser,
  KycStatus,
  OtpRequestResult,
  OtpVerifyResult,
  PayoutDestination,
  RequestOtpInput,
  Role,
} from './identity.interface';

const OTP_CODE_DIGITS = 6;
const SCRYPT_KEY_LENGTH = 64;

@Injectable()
export class IdentityService implements IdentityPort {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly jwt: JwtService,
    @Inject(NOTIFICATIONS_PORT) private readonly notifications: NotificationsPort,
  ) {}

  // ---------------------------------------------------------------------
  // Phone + OTP auth (not on IdentityPort — HTTP-triggered, see the note
  // at the bottom of identity.interface.ts)
  // ---------------------------------------------------------------------

  async requestOtp(input: RequestOtpInput): Promise<OtpRequestResult> {
    const phone = input.phone?.trim() || undefined;
    const email = input.email?.trim().toLowerCase() || undefined;
    if ((phone && email) || (!phone && !email)) {
      throw new BadRequestException('Provide exactly one of phone or email');
    }

    // Upsert so a first-time phone/email gets a bare account (empty
    // roleFlags — registration step 2, completeRoleProfile, fills that in)
    // and a returning phone/email just reuses its existing row.
    const user = phone
      ? await this.prisma.user.upsert({ where: { phone }, create: { phone, roleFlags: [] }, update: {} })
      : await this.prisma.user.upsert({ where: { email }, create: { email, roleFlags: [] }, update: {} });

    const code = randomInt(0, 10 ** OTP_CODE_DIGITS).toString().padStart(OTP_CODE_DIGITS, '0');
    const salt = randomBytes(16).toString('hex');
    const codeHash = this.hashOtpCode(code, salt);
    const ttlSeconds = Number(this.config.get('OTP_TOKEN_TTL_SECONDS') ?? 300);

    const otpRequest = await this.prisma.otpRequest.create({
      data: {
        phone: phone ?? null,
        email: email ?? null,
        codeHash,
        salt,
        expiresAt: new Date(Date.now() + ttlSeconds * 1000),
      },
    });

    await this.notifications.notify({ userId: user.id, phone, email }, { kind: 'otp', code });

    return { requestId: otpRequest.id };
  }

  async verifyOtp(requestId: string, code: string): Promise<OtpVerifyResult> {
    const otpRequest = await this.prisma.otpRequest.findUnique({ where: { id: requestId } });
    if (!otpRequest) throw new NotFoundException('OTP request not found');
    if (otpRequest.consumedAt) throw new BadRequestException('OTP already used');
    if (otpRequest.expiresAt.getTime() < Date.now()) throw new BadRequestException('OTP expired');

    const maxAttempts = Number(this.config.get('OTP_MAX_ATTEMPTS') ?? 5);
    if (otpRequest.attempts >= maxAttempts) {
      throw new BadRequestException('Too many incorrect attempts — request a new OTP');
    }

    const isMatch = this.verifyOtpCode(code, otpRequest.salt, otpRequest.codeHash);
    if (!isMatch) {
      await this.prisma.otpRequest.update({
        where: { id: requestId },
        data: { attempts: { increment: 1 } },
      });
      throw new UnauthorizedException('Incorrect code');
    }

    await this.prisma.otpRequest.update({
      where: { id: requestId },
      data: { consumedAt: new Date() },
    });

    const user = otpRequest.phone
      ? await this.prisma.user.findUnique({ where: { phone: otpRequest.phone } })
      : await this.prisma.user.findUnique({ where: { email: otpRequest.email! } });
    if (!user) throw new NotFoundException('Account no longer exists for this phone number or email');

    const accessToken = await this.jwt.signAsync({ sub: user.id });
    return { accessToken, user: await this.getUser(user.id) };
  }

  // ---------------------------------------------------------------------
  // IdentityPort — the cross-module interface
  // ---------------------------------------------------------------------

  async getUser(userId: string): Promise<IdentityUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { serviceOfferings: true, seekingCategories: true },
    });
    if (!user) throw new NotFoundException('User not found');

    return {
      id: user.id,
      phone: user.phone,
      email: user.email,
      name: user.name,
      roles: user.roleFlags as Role[],
      kycStatus: user.kycStatus as KycStatus,
      serviceOfferingSubmarketIds: user.serviceOfferings.map((o) => o.submarketId),
      seekingCategorySubmarketIds: user.seekingCategories.map((c) => c.submarketId),
    };
  }

  verifyIdentity(_userId: string, _input: unknown): Promise<KycStatus> {
    throw new NotImplementedException('IdentityService.verifyIdentity — slice 9 (KYC gate)');
  }

  async getPayoutDestination(userId: string): Promise<PayoutDestination | null> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    if (!user.payoutBankCode || !user.payoutAccountNumber || !user.payoutAccountName) return null;
    return {
      bankCode: user.payoutBankCode,
      accountNumber: user.payoutAccountNumber,
      accountName: user.payoutAccountName,
    };
  }

  async setPayoutDestination(userId: string, dest: PayoutDestination): Promise<PayoutDestination> {
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        payoutBankCode: dest.bankCode,
        payoutAccountNumber: dest.accountNumber,
        payoutAccountName: dest.accountName,
      },
    });
    return dest;
  }

  async assertRole(userId: string, role: Role): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    if (!user.roleFlags.includes(role)) {
      throw new ForbiddenException(`This action requires the '${role}' role`);
    }
  }

  /**
   * Enforces the registration rule from identity.interface.ts:
   * roles.includes('professional') requires serviceOfferingSubmarketIds.length >= 1;
   * roles.includes('client') requires seekingCategorySubmarketIds.length >= 1.
   * Hybrid (both roles) requires both — reject with 400 if either required
   * list is missing/empty, never silently skip it.
   */
  async completeRoleProfile(userId: string, input: CompleteRoleProfileInput): Promise<IdentityUser> {
    const roles = input.roles;
    if (!roles || roles.length === 0) {
      throw new BadRequestException('roles must include at least one of "client" or "professional"');
    }
    if (roles.some((r) => r !== 'client' && r !== 'professional')) {
      throw new BadRequestException('roles may only contain "client" and/or "professional"');
    }

    const wantsProfessional = roles.includes('professional');
    const wantsClient = roles.includes('client');
    const serviceOfferingIds = input.serviceOfferingSubmarketIds ?? [];
    const seekingCategoryIds = input.seekingCategorySubmarketIds ?? [];

    if (wantsProfessional && serviceOfferingIds.length === 0) {
      throw new BadRequestException('serviceOfferingSubmarketIds must have at least one entry for the "professional" role');
    }
    if (wantsClient && seekingCategoryIds.length === 0) {
      throw new BadRequestException('seekingCategorySubmarketIds must have at least one entry for the "client" role');
    }

    const allSubmarketIds = [...new Set([...serviceOfferingIds, ...seekingCategoryIds])];
    if (allSubmarketIds.length > 0) {
      const found = await this.prisma.submarket.findMany({
        where: { id: { in: allSubmarketIds } },
        select: { id: true },
      });
      if (found.length !== allSubmarketIds.length) {
        throw new BadRequestException('One or more submarket IDs do not exist');
      }
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: userId }, data: { roleFlags: roles } });

      // Replace-in-full rather than diff — simpler, and this call is rare
      // (registration, or a deliberate profile edit) so the extra writes
      // don't matter.
      await tx.professionalServiceOffering.deleteMany({ where: { userId } });
      if (wantsProfessional && serviceOfferingIds.length > 0) {
        await tx.professionalServiceOffering.createMany({
          data: serviceOfferingIds.map((submarketId) => ({ userId, submarketId })),
        });
      }

      await tx.clientSeekingCategory.deleteMany({ where: { userId } });
      if (wantsClient && seekingCategoryIds.length > 0) {
        await tx.clientSeekingCategory.createMany({
          data: seekingCategoryIds.map((submarketId) => ({ userId, submarketId })),
        });
      }
    });

    return this.getUser(userId);
  }

  // ---------------------------------------------------------------------
  // OTP hashing — scrypt (Node built-in, no extra dependency). Codes are
  // short (6 digits) and short-lived, so scrypt's cost here is about
  // resisting a leaked-DB offline guess, not brute force over the wire
  // (attempts/expiresAt already bound that).
  // ---------------------------------------------------------------------

  private hashOtpCode(code: string, salt: string): string {
    return scryptSync(code, salt, SCRYPT_KEY_LENGTH).toString('hex');
  }

  private verifyOtpCode(code: string, salt: string, expectedHash: string): boolean {
    const actual = scryptSync(code, salt, SCRYPT_KEY_LENGTH);
    const expected = Buffer.from(expectedHash, 'hex');
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }
}
