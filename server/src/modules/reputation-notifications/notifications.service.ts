import { Injectable, NotImplementedException } from '@nestjs/common';
import { NotificationEvent, NotificationsPort } from './notifications.interface';

/**
 * Skeleton only — slice 2 needs the 'otp' channel first (phone+OTP auth);
 * other event kinds come online as their owning slice lands.
 */
@Injectable()
export class NotificationsService implements NotificationsPort {
  notify(_userId: string, _event: NotificationEvent): Promise<void> {
    throw new NotImplementedException('NotificationsService.notify — slice 2 (otp channel first)');
  }
}
