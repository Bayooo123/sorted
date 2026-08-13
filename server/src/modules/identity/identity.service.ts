import { Injectable, NotImplementedException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
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
}
