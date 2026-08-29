import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';

export interface AuthenticatedUser {
  userId: string;
}

/**
 * Guards every auth'd IdentityController route. Verifies the Bearer token
 * issued by IdentityService.verifyOtp() and attaches { userId } to
 * req.user for the route handler to read. The token deliberately carries
 * only sub (userId) — phone is no longer guaranteed to exist on every
 * user (email-OTP signups may have none), so it was dropped from the
 * payload rather than carried as possibly-null; nothing downstream read
 * user.phone off the guard anyway (checked before this change).
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const header = request.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : null;

    if (!token) throw new UnauthorizedException('Missing bearer token');

    try {
      const payload = await this.jwt.verifyAsync<{ sub: string }>(token);
      (request as Request & { user: AuthenticatedUser }).user = {
        userId: payload.sub,
      };
      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}
