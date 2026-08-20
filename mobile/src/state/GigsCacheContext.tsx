import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { GigRecord } from '../api/types';

/**
 * Stopgap for GigsService.listGigs still being a NotImplementedException
 * stub (PLAN.md, slice 5). There is no "list my gigs" or "browse open
 * gigs" endpoint yet, so the Home feed (screen 4) and Browse feed
 * (screen 10) can't read a real list from the server.
 *
 * This holds gigs the app itself created/fetched via the REAL createGig/
 * publishGig/getGig calls, in memory, for the current app session only —
 * it is not a substitute for slice 5 and does not persist across restarts.
 * Replace with real listGigs()/listOpenGigs() calls the moment slice 5
 * ships; every read site below is a single call, easy to swap.
 */
interface GigsCacheValue {
  gigs: GigRecord[];
  upsert: (gig: GigRecord) => void;
}

const GigsCacheContext = createContext<GigsCacheValue | undefined>(undefined);

export function GigsCacheProvider({ children }: { children: React.ReactNode }) {
  const [gigs, setGigs] = useState<GigRecord[]>([]);

  const upsert = useCallback((gig: GigRecord) => {
    setGigs((prev) => {
      const idx = prev.findIndex((g) => g.id === gig.id);
      if (idx === -1) return [gig, ...prev];
      const next = [...prev];
      next[idx] = gig;
      return next;
    });
  }, []);

  const value = useMemo(() => ({ gigs, upsert }), [gigs, upsert]);

  return <GigsCacheContext.Provider value={value}>{children}</GigsCacheContext.Provider>;
}

export function useGigsCache(): GigsCacheValue {
  const ctx = useContext(GigsCacheContext);
  if (!ctx) throw new Error('useGigsCache must be used inside GigsCacheProvider');
  return ctx;
}
