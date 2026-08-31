import { Body, Controller, ForbiddenException, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { GigsService } from './gigs.service';
import { AuthenticatedUser, JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { CreateGigDto } from './dto/create-gig.dto';
import { ListGigsDto } from './dto/list-gigs.dto';
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
    // clientId always comes from the verified token, never the request body
    // — a client can't post a gig as someone else by editing JSON.
    return this.gigs.createGig({
      clientId: user.userId,
      title: dto.title,
      description: dto.description,
      domain: dto.domain,
      submarket: dto.submarket,
      clientType: dto.clientType,
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
    if (gig.clientId !== user.userId) {
      throw new ForbiddenException('Only the gig owner can publish it');
    }
    return this.gigs.publishGig(id);
  }

  /**
   * Own gigs, any status (including draft) — registered ahead of `:id` so
   * "mine" isn't parsed as a gig id. clientId always comes from the
   * verified token, never a query param — see GigsService.listGigs's doc
   * comment for why that matters (draft titles/descriptions aren't public).
   */
  @UseGuards(JwtAuthGuard)
  @Get('mine')
  listMine(@CurrentUser() user: AuthenticatedUser, @Query() query: ListGigsDto) {
    return this.gigs.listGigs({ ...query, clientId: user.userId });
  }

  /** Public browse — draft is always excluded server-side regardless of `status`. */
  @Get()
  list(@Query() query: ListGigsDto) {
    return this.gigs.listGigs(query);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.gigs.getGig(id);
  }
}
