import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { AuthenticatedUser, JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { EnoughPlanService } from './enough-plan.service';
import { ApplyPlanDto } from './dto/apply-plan.dto';

/** PLAN.md "Enough: describe yourself -> plan" — see EnoughPlanService's doc comment. */
@Controller('enough/plan')
export class EnoughPlanController {
  constructor(private readonly plan: EnoughPlanService) {}

  @UseGuards(JwtAuthGuard)
  @Post('generate')
  generate(@CurrentUser() user: AuthenticatedUser) {
    return this.plan.generatePlan(user.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Post('apply')
  apply(@CurrentUser() user: AuthenticatedUser, @Body() dto: ApplyPlanDto) {
    return this.plan.applyPlan(user.userId, dto.purposes);
  }
}
