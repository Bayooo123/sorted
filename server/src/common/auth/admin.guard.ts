import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';

/**
 * Gates the manual-pilot admin actions (confirm-funding today; disburse/
 * refund confirmation later) — see escrow.controller.ts. Not a user-role
 * check: there's no admin User record, just a shared secret the founder
 * holds outside the app, matching the pilot's "human eyeballing their own
 * bank app" trust model (manual-pilot.provider.ts). Replace with a real
 * admin-role check once there's more than one operator.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const provided = request.headers['x-admin-key'];
    const expected = this.config.get<string>('ADMIN_API_KEY');

    if (!expected) {
      throw new UnauthorizedException('ADMIN_API_KEY is not configured on the server');
    }
    if (provided !== expected) {
      throw new UnauthorizedException('Invalid admin key');
    }
    return true;
  }
}
