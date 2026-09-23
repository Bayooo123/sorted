export type LeadStatus = 'new' | 'contacted' | 'converted' | 'closed';

export interface CaptureLeadInput {
  phone: string;
  waProfileName?: string | null;
  message: string;
  /** Submarket.key — best-effort, see WhatsappCategoryClassifierService. Null when unconfigured/ambiguous. */
  submarketGuess?: string | null;
}

export interface LeadView {
  id: string;
  phone: string;
  waProfileName: string | null;
  message: string;
  submarketGuess: string | null;
  /** Resolved from submarketGuess — null until listLeads resolves it, never persisted. */
  submarketLabel: string | null;
  status: LeadStatus;
  createdAt: Date;
  updatedAt: Date;
}
