import * as bcrypt from 'bcryptjs';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  NotImplementedException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../prisma/prisma.service';
import { NIGERIAN_STATES } from '../../common/nigerian-states';
import {
  AuthResult,
  CompleteRoleProfileInput,
  IdentityPort,
  IdentityUser,
  KycStatus,
  LoginInput,
  PayoutDestination,
  Role,
  SignupInput,
} from './identity.interface';

const BCRYPT_ROUNDS = 12;

@Injectable()
export class IdentityService implements IdentityPort {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  // ---------------------------------------------------------------------
  // Password auth (not on IdentityPort — HTTP-triggered, see the note at
  // the bottom of identity.interface.ts)
  // ---------------------------------------------------------------------

  async signup(input: SignupInput): Promise<AuthResult> {
    const email = input.email.trim().toLowerCase();
    const phone = input.phone.trim();
    const name = input.name.trim();
    const state = input.state.trim();

    if (!(NIGERIAN_STATES as readonly string[]).includes(state)) {
      throw new BadRequestException(`Unknown state "${state}"`);
    }

    const existing = await this.prisma.user.findFirst({ where: { OR: [{ email }, { phone }] } });
    if (existing) {
      throw new ConflictException(
        existing.email === email ? 'An account with this email already exists' : 'An account with this phone number already exists',
      );
    }

    const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);
    const user = await this.prisma.user.create({
      data: { email, phone, name, state, passwordHash, roleFlags: [] },
    });

    const accessToken = await this.jwt.signAsync({ sub: user.id });
    return { accessToken, user: await this.getUser(user.id) };
  }

  async login(input: LoginInput): Promise<AuthResult> {
    const identifier = input.identifier.trim().toLowerCase();
    const user = await this.prisma.user.findFirst({
      where: { OR: [{ email: identifier }, { phone: input.identifier.trim() }] },
    });
    if (!user || !user.passwordHash) throw new UnauthorizedException('Incorrect email/phone or password');

    const isMatch = await bcrypt.compare(input.password, user.passwordHash);
    if (!isMatch) throw new UnauthorizedException('Incorrect email/phone or password');

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
      state: user.state,
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
}
