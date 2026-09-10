import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { RatingsService } from './ratings.service';
import { JwtAuthGuard, AuthenticatedUser } from '../../common/auth/jwt-auth.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { RateGigDto } from './dto/rate-gig.dto';

/**
 * The only thing in the Ratings module that touches HTTP/Express. Split
 * across two path prefixes, same convention as DisputesController: rating
 * is gig-addressed (it's about one completed transaction), reading a
 * summary is professional-addressed (a profile-level aggregate).
 */
@Controller()
export class RatingsController {
  constructor(private readonly ratings: RatingsService) {}

  @UseGuards(JwtAuthGuard)
  @Post('gigs/:id/rate')
  rate(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: RateGigDto) {
    return this.ratings.rateGig(id, user.userId, dto.stars, dto.comment);
  }

  /** Public — same visibility as a professional's other profile info elsewhere in the app. */
  @Get('professionals/:id/rating')
  getSummary(@Param('id') id: string) {
    return this.ratings.getProfessionalRatingSummary(id);
  }
}
