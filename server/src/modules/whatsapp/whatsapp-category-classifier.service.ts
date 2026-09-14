import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';

export interface SubmarketOption {
  id: string;
  key: string;
  label: string;
}

/**
 * PLAN.md "AI category classification" — replaces the numbered
 * ~20-item category menu with a single free-text description whenever
 * Claude is confident about the match. A wrong guess is a worse failure
 * mode than one extra question (same principle this module already
 * applies to location/price), so this only ever SKIPS the menu step —
 * it never forces an answer the menu itself wouldn't also produce, and
 * any unconfigured/ambiguous/error case falls back to it unchanged.
 */
@Injectable()
export class WhatsappCategoryClassifierService {
  private readonly logger = new Logger(WhatsappCategoryClassifierService.name);
  private readonly client: Anthropic | null;

  constructor(config: ConfigService) {
    const apiKey = config.get<string>('ANTHROPIC_API_KEY');
    this.client = apiKey ? new Anthropic({ apiKey }) : null;
  }

  /** Returns the matched submarket, or null if unconfigured, ambiguous, or no confident match. */
  async classify(description: string, submarkets: SubmarketOption[]): Promise<SubmarketOption | null> {
    if (!this.client) return null;

    const keys = submarkets.map((s) => s.key) as [string, ...string[]];
    const ClassificationSchema = z.object({ key: z.enum([...keys, 'none']) });

    try {
      const response = await this.client.messages.parse({
        model: 'claude-opus-5',
        max_tokens: 256,
        output_config: { effort: 'low', format: zodOutputFormat(ClassificationSchema) },
        system:
          'You classify a short job description into exactly one category key from the given list. Reply "none" if nothing is a clear, confident match — a wrong category is worse than asking the user to pick manually, so "none" is the right answer whenever you are unsure.',
        messages: [
          {
            role: 'user',
            content: `Categories:\n${submarkets.map((s) => `${s.key}: ${s.label}`).join('\n')}\n\nJob description: "${description}"`,
          },
        ],
      });

      const key = response.parsed_output?.key;
      if (!key || key === 'none') return null;
      return submarkets.find((s) => s.key === key) ?? null;
    } catch (err) {
      this.logger.warn(`Category classification failed, falling back to the menu: ${err instanceof Error ? err.message : err}`);
      return null;
    }
  }
}
