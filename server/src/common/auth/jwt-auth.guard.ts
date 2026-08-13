import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';

export interface AuthenticatedUser {
  userId: string;
  phone: string;
}

/**
 * Guards every auth'd IdentityController route. Verifies the Bearer token
 * issued by IdentityService.verifyOtp() and attaches { userId, phone } to
 * req.user for the route handler to read.
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
      const payload = await this.jwt.verifyAsync<{ sub: string; phone: string }>(token);
      (request as Request & { user: AuthenticatedUser }).user = {
        userId: payload.sub,
        phone: payload.phone,
      };
      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}
