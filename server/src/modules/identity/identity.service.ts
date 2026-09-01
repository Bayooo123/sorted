import * as bcrypt from 'bcryptjs';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  NotImplementedException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../prisma/prisma.service';
import { NIGERIAN_STATES } from '../../common/nigerian-states';
import { NOTIFICATIONS_PORT, NotificationsPort } from '../reputation-notifications/notifications.interface';
import {
  ApplyForKycInput,
  AuthResult,
  CompleteRoleProfileInput,
  ForgotPasswordInput,
  IdentityPort,
  IdentityUser,
  KycRequestAdminView,
  KycRequestView,
  KycStatus,
  LoginInput,
  PayoutDestination,
  ResetPasswordInput,
  ReviewKycInput,
  Role,
  SignupInput,
  UpdateAvatarInput,
  UpdateProfileInput,
} from './identity.interface';

const BCRYPT_ROUNDS = 12;
const RESET_CODE_TTL_MS = 15 * 60 * 1000;
const RESET_CODE_MAX_ATTEMPTS = 5;
const GENERIC_RESET_MESSAGE = { message: 'If an account exists for that email or phone, a reset code has been sent.' };

// ~2.6MB raw image, ~3.5MB once base64-encoded — leaves headroom under
// Vercel's serverless request body ceiling (see main.ts/api/index.ts's
// bodyParser limit) after JSON envelope overhead.
const MAX_IMAGE_DATA_URI_LENGTH = 3_500_000;
const IMAGE_DATA_URI_RE = /^data:image\/(png|jpe?g|webp);base64,/i;

function generateResetCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function assertValidImageDataUri(value: string, fieldName: string): void {
  if (!IMAGE_DATA_URI_RE.test(value)) {
    throw new BadRequestException(`${fieldName} must be a base64 image data URI (png/jpeg/webp)`);
  }
  if (value.length > MAX_IMAGE_DATA_URI_LENGTH) {
    throw new BadRequestException(`${fieldName} is too large — please use a smaller image`);
  }
}

function toKycRequestView(request: {
  id: string;
  status: string;
  note: string | null;
  reviewNote: string | null;
  createdAt: Date;
  reviewedAt: Date | null;
}): KycRequestView {
  return {
    id: request.id,
    status: request.status as KycRequestView['status'],
    note: request.note,
    reviewNote: request.reviewNote,
    createdAt: request.createdAt,
    reviewedAt: request.reviewedAt,
  };
}

/**
 * Accepts Nigerian local format (0-prefixed, e.g. "09031812675") as well
 * as E.164 — SignupDto's own phone field requires strict E.164 already
 * (a picker/mask can enforce that at signup time), but a raw profile-edit
 * text field is exactly where someone types the number the way they'd say
 * it out loud. Same normalization the mobile app's phone sign-in used to
 * do client-side (deleted with the OTP flow) — done server-side here so
 * every caller gets it, not just one screen.
 */
function normalizeNigerianPhone(input: string): string {
  const trimmed = input.trim();
  if (trimmed.startsWith('+')) return trimmed;
  if (trimmed.startsWith('0')) return `+234${trimmed.slice(1)}`;
  return `+${trimmed}`;
}

@Injectable()
export class IdentityService implements IdentityPort {
  private readonly logger = new Logger(IdentityService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    @Inject(NOTIFICATIONS_PORT) private readonly notifications: NotificationsPort,
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

    // Fire-and-log, not fire-and-fail: a Resend outage is real, but it
    // must never turn an otherwise-successful signup into a 500 — the
    // account already exists in the DB by this point.
    this.notifications.notify({ userId: user.id, email }, { kind: 'user_signed_up', name }).catch((err) => {
      this.logger.warn(`Welcome email failed for user ${user.id}: ${err instanceof Error ? err.message : err}`);
    });

    const accessToken = await this.jwt.signAsync({ sub: user.id });
    return { accessToken, user: await this.getUser(user.id) };
  }

  async login(input: LoginInput): Promise<AuthResult> {
    const user = await this.findUserByIdentifier(input.identifier);
    if (!user || !user.passwordHash) throw new UnauthorizedException('Incorrect email/phone or password');

    const isMatch = await bcrypt.compare(input.password, user.passwordHash);
    if (!isMatch) throw new UnauthorizedException('Incorrect email/phone or password');

    const accessToken = await this.jwt.signAsync({ sub: user.id });
    return { accessToken, user: await this.getUser(user.id) };
  }

  /**
   * Shared by login/forgot-password/reset-password — accepts a phone typed
   * either in local (0-prefixed) or E.164 form, same reasoning as
   * updateProfile's normalization, since all three are the same kind of
   * raw text field.
   */
  private findUserByIdentifier(identifier: string) {
    const trimmed = identifier.trim();
    return this.prisma.user.findFirst({
      where: { OR: [{ email: trimmed.toLowerCase() }, { phone: trimmed }, { phone: normalizeNigerianPhone(trimmed) }] },
    });
  }

  /**
   * Always returns the same generic message whether or not the identifier
   * matched an account — same account-enumeration defense login already
   * uses, just for this surface too. When it does match, invalidates any
   * outstanding codes and emails a fresh 6-digit one. This is exactly the
   * gap that locks out every pre-password-era account (no passwordHash at
   * all — login always fails, and there was previously no way back in):
   * see PLAN.md "Forgot password".
   */
  async requestPasswordReset(input: ForgotPasswordInput): Promise<{ message: string }> {
    const user = await this.findUserByIdentifier(input.identifier);
    if (!user || !user.email) return GENERIC_RESET_MESSAGE;

    const code = generateResetCode();
    const codeHash = await bcrypt.hash(code, BCRYPT_ROUNDS);

    await this.prisma.$transaction([
      this.prisma.passwordResetToken.updateMany({
        where: { userId: user.id, consumedAt: null },
        data: { consumedAt: new Date() },
      }),
      this.prisma.passwordResetToken.create({
        data: { userId: user.id, codeHash, expiresAt: new Date(Date.now() + RESET_CODE_TTL_MS) },
      }),
    ]);

    // Awaited (unlike signup's welcome email) — sending this email IS the
    // action the caller is waiting on, not a side effect of one that
    // already succeeded. A failure is only logged, never surfaced to the
    // caller, so the response stays identical to the no-such-account case.
    try {
      await this.notifications.notify(
        { userId: user.id, email: user.email },
        { kind: 'password_reset_requested', code },
      );
    } catch (err) {
      this.logger.warn(`Password reset email failed for user ${user.id}: ${err instanceof Error ? err.message : err}`);
    }

    return GENERIC_RESET_MESSAGE;
  }

  async resetPassword(input: ResetPasswordInput): Promise<{ message: string }> {
    const invalidCode = () => new BadRequestException('Invalid or expired code');
    const user = await this.findUserByIdentifier(input.identifier);
    if (!user) throw invalidCode();

    const token = await this.prisma.passwordResetToken.findFirst({
      where: { userId: user.id, consumedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    if (!token || token.attempts >= RESET_CODE_MAX_ATTEMPTS) {
      if (token) await this.prisma.passwordResetToken.update({ where: { id: token.id }, data: { consumedAt: new Date() } });
      throw invalidCode();
    }

    const isMatch = await bcrypt.compare(input.code.trim(), token.codeHash);
    if (!isMatch) {
      await this.prisma.passwordResetToken.update({ where: { id: token.id }, data: { attempts: { increment: 1 } } });
      throw invalidCode();
    }

    const passwordHash = await bcrypt.hash(input.newPassword, BCRYPT_ROUNDS);
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: user.id }, data: { passwordHash } }),
      this.prisma.passwordResetToken.update({ where: { id: token.id }, data: { consumedAt: new Date() } }),
    ]);

    return { message: 'Password updated — you can now log in.' };
  }

  async updateProfile(userId: string, input: UpdateProfileInput): Promise<IdentityUser> {
    const data: { name?: string; phone?: string; state?: string } = {};

    if (input.name !== undefined) {
      const name = input.name.trim();
      if (!name) throw new BadRequestException('name cannot be empty');
      data.name = name;
    }

    if (input.state !== undefined) {
      const state = input.state.trim();
      if (!(NIGERIAN_STATES as readonly string[]).includes(state)) {
        throw new BadRequestException(`Unknown state "${state}"`);
      }
      data.state = state;
    }

    if (input.phone !== undefined) {
      const phone = normalizeNigerianPhone(input.phone);
      if (!/^\+[1-9]\d{7,14}$/.test(phone)) {
        throw new BadRequestException('phone must be a valid Nigerian or E.164-style number');
      }
      const existing = await this.prisma.user.findUnique({ where: { phone } });
      if (existing && existing.id !== userId) {
        throw new ConflictException('An account with this phone number already exists');
      }
      data.phone = phone;
    }

    if (Object.keys(data).length === 0) return this.getUser(userId);

    await this.prisma.user.update({ where: { id: userId }, data });
    return this.getUser(userId);
  }

  async updateAvatar(userId: string, input: UpdateAvatarInput): Promise<IdentityUser> {
    assertValidImageDataUri(input.avatarBase64, 'avatarBase64');
    await this.prisma.user.update({ where: { id: userId }, data: { avatarBase64: input.avatarBase64 } });
    return this.getUser(userId);
  }

  // ---------------------------------------------------------------------
  // KYC apply/review — manual pilot (see PLAN.md "Profile photo + KYC
  // apply flow"). Professional-only: this is about a professional's odds
  // of being picked for a gig, so a client applying wouldn't mean
  // anything yet — enforced here, not just in the UI.
  // ---------------------------------------------------------------------

  async applyForKyc(userId: string, input: ApplyForKycInput): Promise<KycRequestView> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    if (!user.roleFlags.includes('professional')) {
      throw new ForbiddenException('Verification is for professionals — it affects your odds of being picked for gigs');
    }
    assertValidImageDataUri(input.documentBase64, 'documentBase64');

    const [request] = await this.prisma.$transaction([
      this.prisma.kycRequest.create({
        data: { userId, documentBase64: input.documentBase64, note: input.note?.trim() || null },
      }),
      this.prisma.user.update({ where: { id: userId }, data: { kycStatus: 'pending' } }),
    ]);

    return toKycRequestView(request);
  }

  async getMyKycRequest(userId: string): Promise<KycRequestView | null> {
    const request = await this.prisma.kycRequest.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    return request ? toKycRequestView(request) : null;
  }

  /** Admin-only listing — see IdentityController's AdminGuard-gated route. */
  async listPendingKycRequests(): Promise<KycRequestAdminView[]> {
    const requests = await this.prisma.kycRequest.findMany({
      where: { status: 'pending' },
      orderBy: { createdAt: 'asc' },
      include: { user: true },
    });
    return requests.map((r) => ({
      ...toKycRequestView(r),
      userId: r.userId,
      userName: r.user.name,
      userEmail: r.user.email,
      userPhone: r.user.phone,
      documentBase64: r.documentBase64,
    }));
  }

  /** Admin-only — flips both the request status and the applicant's User.kycStatus in one transaction. */
  async reviewKyc(requestId: string, input: ReviewKycInput): Promise<KycRequestView> {
    const request = await this.prisma.kycRequest.findUnique({ where: { id: requestId } });
    if (!request) throw new NotFoundException('KYC request not found');

    const updated = await this.prisma.$transaction(async (tx) => {
      const updatedRequest = await tx.kycRequest.update({
        where: { id: requestId },
        data: { status: input.decision, reviewNote: input.reviewNote?.trim() || null, reviewedAt: new Date() },
      });
      await tx.user.update({
        where: { id: request.userId },
        data: { kycStatus: input.decision === 'approved' ? 'verified' : 'rejected' },
      });
      return updatedRequest;
    });

    return toKycRequestView(updated);
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
      avatarBase64: user.avatarBase64,
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
