import { api } from './client';
import {
  ClientTypeRef,
  Domain,
  IdentityUser,
  OtpRequestResult,
  OtpVerifyResult,
  PayoutDestination,
  Role,
  Submarket,
} from './types';

export function requestOtp(phone: string) {
  return api.post<OtpRequestResult>('auth/otp/request', { phone }, false);
}

export function verifyOtp(requestId: string, code: string) {
  return api.post<OtpVerifyResult>('auth/otp/verify', { requestId, code }, false);
}

export function getMe() {
  return api.get<IdentityUser>('me');
}

export function setPayoutDestination(dest: PayoutDestination) {
  return api.patch<PayoutDestination>('me/payout-destination', dest);
}

export interface CompleteRoleProfileInput {
  roles: Role[];
  serviceOfferingSubmarketIds?: string[];
  seekingCategorySubmarketIds?: string[];
}

export function completeRoleProfile(input: CompleteRoleProfileInput) {
  return api.post<IdentityUser>('me/role-profile', input);
}

export function listDomains() {
  return api.get<Domain[]>('taxonomy/domains', false);
}

export function listSubmarkets() {
  return api.get<Submarket[]>('taxonomy/submarkets', false);
}

export function listClientTypes() {
  return api.get<ClientTypeRef[]>('taxonomy/client-types', false);
}
