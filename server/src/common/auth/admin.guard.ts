import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';

export interface AuthenticatedAdmin {
  adminId: string;
  username: string;
}

export interface RequestWithAdmin extends Request {
  admin?: AuthenticatedAdmin;
}

/**
 * Gates every admin-only route (KYC review, dispute resolution, escrow
 * confirm-release, and the four admin dashboards). PLAN.md "Admin
 * username/password login" — two ways in, checked in this order:
 *
 *  1. A Bearer token from POST /admin/login (AdminAuthService), carrying
 *     { sub: adminId, username, kind: 'admin' }. This is the real login
 *     flow now and attaches req.admin for handlers that need to know
 *     who's acting (PATCH /admin/password does).
 *  2. The legacy x-admin-key shared secret (ADMIN_API_KEY) — kept ONLY as
 *     a break-glass fallback while the login flow is new, so a bug in the
 *     JWT path can never fully lock the sole operator out of admin. Does
 *     NOT set req.admin (there's no admin identity behind a shared key),
 *     so routes that need one (password change) correctly refuse it.
 *     Safe to delete once the login flow has been in use for a while.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(
    private readonly config: ConfigService,
    private readonly jwt: JwtService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithAdmin>();

    const authHeader = request.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : null;
    if (token) {
      try {
        const payload = await this.jwt.verifyAsync<{ sub: string; username: string; kind?: string }>(token);
        if (payload.kind === 'admin') {
          request.admin = { adminId: payload.sub, username: payload.username };
          return true;
        }
      } catch {
        // Not a valid/admin token — fall through to the legacy key check.
      }
    }

    const provided = request.headers['x-admin-key'];
    const expected = this.config.get<string>('ADMIN_API_KEY');
    if (expected && provided === expected) return true;

    throw new UnauthorizedException('Invalid admin credentials');
  }
}
