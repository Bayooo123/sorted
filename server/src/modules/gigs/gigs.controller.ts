import { Body, Controller, ForbiddenException, Get, Param, Post, UseGuards } from '@nestjs/common';
import { GigsService } from './gigs.service';
import { AuthenticatedUser, JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { CreateGigDto } from './dto/create-gig.dto';
import { kobo } from '../../common/money';

/**
 * The only thing in the Gigs module that touches HTTP/Express. Matches
 * PLAN.md's slice 3 endpoint list.
 */
@Controller('gigs')
export class GigsController {
  constructor(private readonly gigs: GigsService) {}

  @UseGuards(JwtAuthGuard)
  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateGigDto) {
    // payerId always comes from the verified token, never the request body
    // — a client can't post a gig as someone else by editing JSON.
    return this.gigs.createGig({
      payerId: user.userId,
      title: dto.title,
      description: dto.description,
      domain: dto.domain,
      submarket: dto.submarket,
      payerType: dto.payerType,
      locationText: dto.locationText,
      locationGeo: dto.locationGeo,
      materialsMode: dto.materialsMode,
      bountyKobo: kobo(dto.bountyKobo),
      criteria: dto.criteria,
      templateId: dto.templateId,
    });
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/publish')
  async publish(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    const gig = await this.gigs.getGig(id);
    if (gig.payerId !== user.userId) {
      throw new ForbiddenException('Only the gig owner can publish it');
    }
    return this.gigs.publishGig(id);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.gigs.getGig(id);
  }
}
