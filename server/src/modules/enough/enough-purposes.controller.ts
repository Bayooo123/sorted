import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { AuthenticatedUser, JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { EnoughPurposesService } from './enough-purposes.service';
import { CreatePurposeDto } from './dto/create-purpose.dto';
import { AllocatePurposeDto } from './dto/allocate-purpose.dto';

/** PLAN.md "Enough: landing spot + purposes" — see EnoughPurposesService's doc comment. */
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
    return this.purposes.allocate(user.userId, id, BigInt(dto.amountKobo));
  }
}
