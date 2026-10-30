import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard, AuthenticatedUser } from '../../common/auth/jwt-auth.guard';
import { RiderService } from './rider.service';

type AuthedRequest = Request & { user: AuthenticatedUser };

/**
 * PLAN.md "Sorted-owned rider fleet". Same auth shape as every other
 * JwtAuthGuard-protected controller in this codebase: the token only
 * carries { userId }, role checks happen in RiderService (requireRiderProfile),
 * not a route guard — see jwt-auth.guard.ts's own doc comment.
 */
@Controller('riders')
@UseGuards(JwtAuthGuard)
export class RiderController {
  constructor(private readonly riders: RiderService) {}

  @Post('me')
  async becomeRider(@Req() req: AuthedRequest) {
    await this.riders.becomeRider(req.user.userId);
    return { ok: true };
  }

  @Patch('me/online')
  async setOnline(@Req() req: AuthedRequest, @Body('online') online: unknown) {
    if (typeof online !== 'boolean') throw new BadRequestException('online must be a boolean.');
    return this.riders.setOnline(req.user.userId, online);
  }

  @Get('me/jobs')
  async listMyJobs(@Req() req: AuthedRequest) {
    return this.riders.listMyJobs(req.user.userId);
  }

  @Post('jobs/:id/start')
  async start(@Req() req: AuthedRequest, @Param('id') id: string) {
    await this.riders.start(req.user.userId, id);
    return { ok: true };
  }

  @Post('jobs/:id/arrive')
  async arrive(@Req() req: AuthedRequest, @Param('id') id: string) {
    await this.riders.arrive(req.user.userId, id);
    return { ok: true };
  }

  @Post('jobs/:id/confirm-pickup')
  async confirmPickup(@Req() req: AuthedRequest, @Param('id') id: string, @Body() body: { pieceCount?: unknown; code?: unknown }) {
    const pieceCount = Number(body.pieceCount);
    if (!Number.isInteger(pieceCount) || pieceCount < 0) throw new BadRequestException('pieceCount must be a non-negative integer.');
    const code = typeof body.code === 'string' ? body.code : undefined;
    await this.riders.confirmPickup(req.user.userId, id, pieceCount, code);
    return { ok: true };
  }

  @Post('jobs/:id/in-transit')
  async goInTransit(@Req() req: AuthedRequest, @Param('id') id: string) {
    await this.riders.goInTransit(req.user.userId, id);
    return { ok: true };
  }

  @Post('jobs/:id/complete')
  async complete(@Req() req: AuthedRequest, @Param('id') id: string) {
    await this.riders.complete(req.user.userId, id);
    return { ok: true };
  }
}
