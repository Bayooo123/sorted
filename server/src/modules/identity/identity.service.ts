import { Injectable, NotImplementedException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CompleteRoleProfileInput,
  IdentityPort,
  IdentityUser,
  KycStatus,
  PayoutDestination,
  Role,
} from './identity.interface';

/**
 * Skeleton only — slice 2 in HANDOFF.md §7 implements this body (phone+OTP,
 * roles). Every method below is the module's full public surface; nothing
 * else is exported.
 */
@Injectable()
export class IdentityService implements IdentityPort {
  constructor(private readonly prisma: PrismaService) {}

  getUser(_userId: string): Promise<IdentityUser> {
    throw new NotImplementedException('IdentityService.getUser — slice 2');
  }

  verifyIdentity(_userId: string, _input: unknown): Promise<KycStatus> {
    throw new NotImplementedException('IdentityService.verifyIdentity — slice 9 (KYC gate)');
  }

  getPayoutDestination(_userId: string): Promise<PayoutDestination | null> {
    throw new NotImplementedException('IdentityService.getPayoutDestination — slice 2');
  }

  assertRole(_userId: string, _role: Role): Promise<void> {
    throw new NotImplementedException('IdentityService.assertRole — slice 2');
  }

  /**
   * Enforces the registration rule from identity.interface.ts:
   * roles.includes('solver') requires serviceOfferingSubmarketIds.length >= 1;
   * roles.includes('payer') requires seekingCategorySubmarketIds.length >= 1.
   * Hybrid (both roles, the default) requires both — reject with a 400 if
   * either required list is missing/empty, don't silently skip it.
   *
   * Writes User.roleFlags plus the SolverServiceOffering / PayerSeekingCategory
   * join rows inside one transaction — partial writes here would leave a
   * solver-flagged user with no offerings, which breaks any future matching
   * that assumes the invariant holds.
   */
  completeRoleProfile(_userId: string, _input: CompleteRoleProfileInput): Promise<IdentityUser> {
    throw new NotImplementedException('IdentityService.completeRoleProfile — slice 2');
  }
}
