import { BadRequestException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { PrismaService } from '../../prisma/prisma.service';
import { EnoughPurposesService } from './enough-purposes.service';
import { PlanPurpose, PurposeView } from './enough.interface';

const PlanPurposeSchema = z.object({
  name: z.string().min(1).max(100),
  targetPercent: z.number().int().min(1).max(100),
});
const PlanSchema = z.object({ purposes: z.array(PlanPurposeSchema).min(3).max(8) });

/**
 * PLAN.md "Enough: describe yourself -> plan" — the free-text "describe
 * yourself and your income" saved on EnoughAccount.description is the only
 * input; this never reads deposits/purposes to make its suggestion smarter,
 * keeping it a pure text-in/plan-out step the user can redo any time they
 * update their description. Same Anthropic calling pattern as
 * WhatsappCategoryClassifierService (model, SDK, zod output format) — that
 * one has a safe non-AI fallback (the menu) when unconfigured; this one
 * doesn't, since there's no sensible plan to suggest without it, so
 * unconfigured surfaces as a clear error instead of a silent null.
 */
@Injectable()
export class EnoughPlanService {
  private readonly logger = new Logger(EnoughPlanService.name);
  private readonly client: Anthropic | null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly purposes: EnoughPurposesService,
    config: ConfigService,
  ) {
    const apiKey = config.get<string>('ANTHROPIC_API_KEY');
    this.client = apiKey ? new Anthropic({ apiKey }) : null;
  }

  /** Normalizes a proposed split to sum to exactly 100, correcting typical LLM rounding drift on the largest entry. */
  private normalize(purposes: PlanPurpose[]): PlanPurpose[] {
    const total = purposes.reduce((sum, p) => sum + p.targetPercent, 0);
    if (total === 100) return purposes;
    const scaled = purposes.map((p) => ({ ...p, targetPercent: Math.max(1, Math.round((p.targetPercent / total) * 100)) }));
    const diff = 100 - scaled.reduce((sum, p) => sum + p.targetPercent, 0);
    if (diff !== 0) {
      const largest = scaled.reduce((bestIdx, p, i, arr) => (p.targetPercent > arr[bestIdx].targetPercent ? i : bestIdx), 0);
      scaled[largest].targetPercent += diff;
    }
    return scaled;
  }

  /**
   * Reads the saved description and proposes a split — a PREVIEW only,
   * nothing persisted here. The user reviews (and can edit) before
   * applyPlan actually creates/updates any purpose.
   */
  async generatePlan(userId: string): Promise<PlanPurpose[]> {
    if (!this.client) {
      throw new ServiceUnavailableException('AI plan generation is not configured yet — ANTHROPIC_API_KEY is not set.');
    }

    const account = await this.prisma.enoughAccount.findUnique({ where: { userId } });
    if (!account) throw new NotFoundException('Open your Enough account first.');
    if (!account.description) {
      throw new BadRequestException('Save a description of yourself and your income first.');
    }

    try {
      const response = await this.client.messages.parse({
        model: 'claude-opus-5',
        max_tokens: 1024,
        output_config: { effort: 'medium', format: zodOutputFormat(PlanSchema) },
        system:
          'You turn a free-text description of a person\'s life, income, and obligations into a practical money-allocation plan for a Nigerian salary or income earner. Break their income into 3 to 8 clearly-named purposes (e.g. "Rent", "Food", "Family support", "Transport", "Savings", "Buffer") with a percentage of income assigned to each, summing to approximately 100. Use short, specific names that reflect what they actually described, not generic categories they never mentioned.',
        messages: [{ role: 'user', content: account.description }],
      });

      const parsed = response.parsed_output;
      if (!parsed) throw new Error('No structured output returned');
      return this.normalize(parsed.purposes);
    } catch (err) {
      this.logger.error(`Plan generation failed for user ${userId}: ${err instanceof Error ? err.message : err}`);
      throw new ServiceUnavailableException('Could not generate a plan right now — try again shortly.');
    }
  }

  /** Creates/updates each proposed purpose with its target share — never moves any money. */
  async applyPlan(userId: string, proposed: PlanPurpose[]): Promise<PurposeView[]> {
    const results: PurposeView[] = [];
    for (const p of proposed) {
      results.push(await this.purposes.upsertWithTarget(userId, p.name, p.targetPercent));
    }
    return results;
  }
}
