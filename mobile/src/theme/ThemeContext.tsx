import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import * as SecureStore from 'expo-secure-store';
import { darkColors, lightColors, ThemeColors } from './tokens';

export type ThemeMode = 'light' | 'dark';

const THEME_MODE_KEY = 'sorted_theme_mode';

interface ThemeContextValue {
  mode: ThemeMode;
  colors: ThemeColors;
  setMode: (mode: ThemeMode) => void;
  toggleMode: () => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

/**
 * Defaults to dark — the "app flow" mockups this was built from are dark,
 * and light is the one already proven live (the web app never left it).
 * Persisted via SecureStore (same module already used for the access
 * token) so the choice survives an app restart; falls back to the default
 * silently if storage read fails, same "fail visibly for money, not for
 * preferences" bar as the rest of the app.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>('dark');

  useEffect(() => {
    SecureStore.getItemAsync(THEME_MODE_KEY)
      .then((stored) => {
        if (stored === 'light' || stored === 'dark') setModeState(stored);
      })
      .catch(() => {});
  }, []);

  function setMode(next: ThemeMode) {
    setModeState(next);
    SecureStore.setItemAsync(THEME_MODE_KEY, next).catch(() => {});
  }

  function toggleMode() {
    setMode(mode === 'dark' ? 'light' : 'dark');
  }

  const value = useMemo(
    () => ({ mode, colors: mode === 'dark' ? darkColors : lightColors, setMode, toggleMode }),
    [mode],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider');
  return ctx;
}
