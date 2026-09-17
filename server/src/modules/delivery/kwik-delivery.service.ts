import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CreateDeliveryTaskInput,
  DeliveryProviderPort,
  DeliveryTaskResult,
  DeliveryTaskStatus,
} from './delivery.interface';

/**
 * KWIK adapter (PLAN.md "KWIK delivery integration").
 *
 * IMPORTANT — read before relying on this in production: this was written
 * directly from the Apiary documentation the user pasted into chat, which
 * gives request/response FIELD tables but not a full base URL or, for two
 * endpoints, any literal path at all. Endpoints below fall into two groups:
 *
 *   - Paths with a literal "/xxx api" reference in the source docs
 *     (send_payment_for_task, get_bill_breakdown, getVehicle, getLoaderList)
 *     — used verbatim, but the HTTP method and exact response envelope for
 *     each were not shown, only that the top-level shape is
 *     {status, message, data}.
 *   - Paths with NO literal reference in the docs at all (task creation,
 *     job-status lookup) — named as best-guesses below and marked TODO.
 *     These WILL be wrong until confirmed against KWIK's real docs/support
 *     and corrected via the KWIK_PATH_* env vars.
 *
 * Nothing here has been run against KWIK's real API — there is no sandbox
 * or credential available in this environment to test against. Treat this
 * as a faithful first draft, not a verified integration.
 */
@Injectable()
export class KwikDeliveryService implements DeliveryProviderPort {
  private readonly logger = new Logger(KwikDeliveryService.name);

  // Nigeria (WAT, UTC+1) as a fixed offset — KWIK's own examples encode
  // "ahead of UTC" zones as negative minutes (e.g. IST +5:30 -> -330), so
  // UTC+1 -> -60. Hardcoded rather than computed since this product only
  // operates in one timezone.
  private static readonly TIMEZONE_OFFSET_MINUTES = '-60';

  constructor(private readonly config: ConfigService) {}

  private credentials() {
    const baseUrl = this.config.get<string>('KWIK_API_BASE_URL');
    const domainName = this.config.get<string>('KWIK_DOMAIN_NAME');
    const accessToken = this.config.get<string>('KWIK_ACCESS_TOKEN');
    const vendorId = this.config.get<string>('KWIK_VENDOR_ID');
    if (!baseUrl || !domainName || !accessToken || !vendorId) return null;
    return { baseUrl: baseUrl.replace(/\/+$/, ''), domainName, accessToken, vendorId };
  }

  private paths() {
    return {
      // Literal references exist in KWIK's docs for these four.
      sendPaymentForTask: this.config.get<string>('KWIK_PATH_SEND_PAYMENT_FOR_TASK') || '/send_payment_for_task',
      getBillBreakdown: this.config.get<string>('KWIK_PATH_GET_BILL_BREAKDOWN') || '/get_bill_breakdown',
      getVehicle: this.config.get<string>('KWIK_PATH_GET_VEHICLE') || '/getVehicle',
      // TODO — no literal path given in the source docs for these two;
      // confirm against KWIK's real API reference and override via env.
      createTask: this.config.get<string>('KWIK_PATH_CREATE_TASK') || '/create_task',
      fetchJobStatus: this.config.get<string>('KWIK_PATH_FETCH_JOB_STATUS') || '/fetch_job_status',
    };
  }

  private async post<T>(path: string, body: Record<string, unknown>): Promise<T | null> {
    const creds = this.credentials();
    if (!creds) {
      this.logger.warn('KWIK not configured (missing KWIK_API_BASE_URL/KWIK_DOMAIN_NAME/KWIK_ACCESS_TOKEN/KWIK_VENDOR_ID) — skipping dispatch');
      return null;
    }
    try {
      const response = await fetch(`${creds.baseUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          domain_name: creds.domainName,
          access_token: creds.accessToken,
          vendor_id: creds.vendorId,
          ...body,
        }),
      });
      const json = (await response.json()) as { status?: number; message?: string; data?: T };
      if (!response.ok || json.status !== 200) {
        this.logger.warn(`KWIK ${path} failed: ${json.status ?? response.status} ${json.message ?? ''}`);
        return null;
      }
      return json.data ?? null;
    } catch (err) {
      this.logger.warn(`KWIK ${path} request failed: ${err instanceof Error ? err.message : err}`);
      return null;
    }
  }

  /**
   * Calls /send_payment_for_task to get the priced fields KWIK's own docs
   * say the task-creation call must echo back (amount, vehicle_id, etc.).
   * Loaders/insurance/COD are fixed off — none apply to a garment delivery.
   */
  private async quotePrice(input: CreateDeliveryTaskInput): Promise<Record<string, unknown> | null> {
    const vehicleId = this.config.get<string>('KWIK_VEHICLE_ID');
    if (!vehicleId) {
      this.logger.warn('KWIK_VEHICLE_ID not set — fetch a vehicle id from KWIK\'s /getVehicle api and configure it before dispatch can work');
      return null;
    }

    return this.post('' + this.paths().sendPaymentForTask, {
      auto_assignment: 1,
      layout_type: 0,
      has_pickup: 1,
      has_delivery: 1,
      is_multiple_tasks: 1,
      is_schedule_task: 0,
      is_cod_job: 0,
      is_loader_required: 0,
      loaders_amount: 0,
      loaders_count: 0,
      vehicle_id: Number(vehicleId),
      delivery_instruction: input.itemDescription,
      pickups: [
        {
          address: input.pickup.address,
          latitiude: input.pickup.lat,
          longitude: input.pickup.lng,
          phone: input.pickup.phone,
        },
      ],
      deliveries: [
        {
          address: input.dropoff.address,
          latitiude: input.dropoff.lat,
          longitude: input.dropoff.lng,
          phone: input.dropoff.phone,
          has_return_task: false,
        },
      ],
    });
  }

  async createTask(input: CreateDeliveryTaskInput): Promise<DeliveryTaskResult | null> {
    const quote = await this.quotePrice(input);
    if (!quote) return null;

    const teamId = this.config.get<string>('KWIK_TEAM_ID');
    const paymentMethod = this.config.get<string>('KWIK_PAYMENT_METHOD') || '524288'; // 524288 = EOMB, matching a vendor account paid on account rather than per-task — confirm this is actually how the Sorted<->KWIK commercial relationship works

    const data = await this.post<{ job_id?: string; job_token?: string; pickup_tracking_link?: string; delivery_tracking_link?: string }>(
      this.paths().createTask,
      {
        is_multiple_tasks: 1,
        timezone: KwikDeliveryService.TIMEZONE_OFFSET_MINUTES,
        has_pickup: 1,
        has_delivery: 1,
        layout_type: 0,
        auto_assignment: 1,
        team_id: teamId ? Number(teamId) : undefined,
        payment_method: paymentMethod,
        is_cod_job: 0,
        is_task_otp_required: 0,
        pickups: [
          {
            address: input.pickup.address,
            name: input.pickup.name,
            latitude: input.pickup.lat,
            longitude: input.pickup.lng,
            phone: input.pickup.phone,
          },
        ],
        deliveries: [
          {
            address: input.dropoff.address,
            name: input.dropoff.name,
            latitude: input.dropoff.lat,
            longitude: input.dropoff.lng,
            phone: input.dropoff.phone,
          },
        ],
        ...quote,
      },
    );
    if (!data?.job_id) return null;

    return {
      providerJobId: data.job_id,
      trackingLink: data.pickup_tracking_link || data.delivery_tracking_link,
    };
  }

  async getTaskStatus(providerJobId: string): Promise<DeliveryTaskStatus | null> {
    const data = await this.post<{ job_status?: number }>(this.paths().fetchJobStatus, {
      job_id: providerJobId,
    });
    if (data?.job_status === undefined) return null;
    return KwikDeliveryService.STATUS_MAP[data.job_status] ?? null;
  }

  // KWIK's documented job_status values — see "Task Statuses" in their docs.
  private static readonly STATUS_MAP: Record<number, DeliveryTaskStatus> = {
    0: 'upcoming',
    1: 'started',
    2: 'ended',
    3: 'failed',
    4: 'arrived',
    6: 'unassigned',
    7: 'accepted',
    8: 'declined',
    9: 'cancelled',
    10: 'deleted',
  };
}
