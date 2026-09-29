import { createContext, useContext } from 'react';
import type { Theme } from '@gravity-ui/uikit';

export type ThemeContextValue = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
};

export const ThemeContext = createContext<ThemeContextValue>({
  theme: 'light',
  setTheme: () => undefined,
});

export function useAppTheme() {
  return useContext(ThemeContext);
}
