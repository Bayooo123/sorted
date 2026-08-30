import { api } from './client';
import {
  AuthResult,
  ClientTypeRef,
  Domain,
  IdentityUser,
  PayoutDestination,
  Role,
  Submarket,
} from './types';

export interface SignupInput {
  name: string;
  email: string;
  phone: string;
  state: string;
  password: string;
}

export function signup(input: SignupInput) {
  return api.post<AuthResult>('auth/signup', input, false);
}

/** identifier is an email or a phone number — the server checks both columns. */
export function login(identifier: string, password: string) {
  return api.post<AuthResult>('auth/login', { identifier, password }, false);
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
