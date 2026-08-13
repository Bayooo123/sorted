/**
 * Money is always an integer number of kobo. Never a float, anywhere.
 * Branded type so a raw `number` can't be passed where kobo is expected
 * without an explicit cast at the boundary (parsing user input, etc.).
 */
export type Kobo = number & { readonly __brand: 'Kobo' };

export function kobo(value: number): Kobo {
  if (!Number.isInteger(value)) {
    throw new Error(`Money must be an integer number of kobo, got ${value}`);
  }
  return value as Kobo;
}

export function addKobo(...values: Kobo[]): Kobo {
  return kobo(values.reduce((sum, v) => sum + v, 0));
}

/** floor(bps * amount / 10000), matching HANDOFF.md §5 fee math. */
export function applyBps(amountKobo: Kobo, bps: number): Kobo {
  return kobo(Math.floor((amountKobo * bps) / 10_000));
}
