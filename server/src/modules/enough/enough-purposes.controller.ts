import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { AuthenticatedUser, JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { EnoughPurposesService } from './enough-purposes.service';
import { CreatePurposeDto } from './dto/create-purpose.dto';
import { AllocatePurposeDto } from './dto/allocate-purpose.dto';
import { ExtendScheduleDto } from './dto/extend-schedule.dto';
import { UnlockTrancheDto } from './dto/unlock-tranche.dto';

/** PLAN.md "Enough: landing spot + purposes" / "Enough: scheduled tranches" — see EnoughPurposesService's doc comment. */
@Controller('enough/purposes')
export class EnoughPurposesController {
  constructor(private readonly purposes: EnoughPurposesService) {}

  @UseGuards(JwtAuthGuard)
  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.purposes.listPurposes(user.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreatePurposeDto) {
    return this.purposes.createPurpose(user.userId, dto.name);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/allocate')
  allocate(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: AllocatePurposeDto) {
    return this.purposes.allocate(user.userId, id, BigInt(dto.amountKobo), dto.schedule);
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id/tranches')
  listTranches(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.purposes.listTranches(user.userId, id);
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id/tranches/schedule')
  extendSchedule(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: ExtendScheduleDto) {
    return this.purposes.extendSchedule(user.userId, id, dto.intervalDays);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/tranches/:trancheId/unlock')
  unlockTranche(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('trancheId') trancheId: string,
    @Body() dto: UnlockTrancheDto,
  ) {
    return this.purposes.unlockTrancheEarly(user.userId, id, trancheId, dto.pin);
  }
}
