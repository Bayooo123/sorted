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

/**
 * Always resolves — the server returns the same generic message whether
 * or not the identifier matched an account (account-enumeration defense).
 */
export function forgotPassword(identifier: string) {
  return api.post<{ message: string }>('auth/forgot-password', { identifier }, false);
}

export function resetPassword(identifier: string, code: string, newPassword: string) {
  return api.post<{ message: string }>('auth/reset-password', { identifier, code, newPassword }, false);
}

export function getMe() {
  return api.get<IdentityUser>('me');
}

/** All optional — only fields present are changed. Mirrors server's UpdateProfileInput. */
export interface UpdateProfileInput {
  name?: string;
  phone?: string;
  state?: string;
}

export function updateProfile(input: UpdateProfileInput) {
  return api.patch<IdentityUser>('me/profile', input);
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
