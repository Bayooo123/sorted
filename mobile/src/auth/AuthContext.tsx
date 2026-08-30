import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { getMe } from '../api/identity';
import { getStoredToken, setStoredToken } from '../api/client';
import { IdentityUser } from '../api/types';

interface AuthContextValue {
  /** undefined = still restoring from storage; null = signed out. */
  user: IdentityUser | null | undefined;
  signIn: (accessToken: string, user: IdentityUser) => Promise<void>;
  signOut: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<IdentityUser | null | undefined>(undefined);

  useEffect(() => {
    (async () => {
      const token = await getStoredToken();
      if (!token) {
        setUser(null);
        return;
      }
      try {
        setUser(await getMe());
      } catch {
        // Token invalid/expired — drop it rather than looping on a
        // request that will keep failing (PRD.md §10: fail visibly, but
        // also don't get stuck retrying a dead token forever).
        await setStoredToken(null);
        setUser(null);
      }
    })();
  }, []);

  const signIn = useCallback(async (accessToken: string, identityUser: IdentityUser) => {
    await setStoredToken(accessToken);
    setUser(identityUser);
  }, []);

  const signOut = useCallback(async () => {
    await setStoredToken(null);
    setUser(null);
  }, []);

  const refreshUser = useCallback(async () => {
    setUser(await getMe());
  }, []);

  const value = useMemo(() => ({ user, signIn, signOut, refreshUser }), [user, signIn, signOut, refreshUser]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

/**
 * A user with roles: [] has signed up (or logged in) but not completed
 * registration step 2 (PLAN.md: "the app should treat a user with
 * roles: [] (empty) as still mid-signup, not as a fully registered
 * account").
 */
export function isMidSignup(user: IdentityUser | null | undefined): boolean {
  return !!user && user.roles.length === 0;
}
