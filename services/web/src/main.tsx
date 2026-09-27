import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  ThemeProvider,
  Toaster,
  ToasterComponent,
  ToasterProvider,
  type Theme,
} from '@gravity-ui/uikit';
import React, { useCallback, useMemo, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import '@gravity-ui/uikit/styles/fonts.css';
import '@gravity-ui/uikit/styles/styles.css';
import App from './App';
import { ThemeContext } from './theme';
import './index.css';

const THEME_KEY = 'monitoring-theme';
const toaster = new Toaster();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { refetchOnWindowFocus: false, retry: 1 },
  },
});

function readTheme(): Theme {
  const stored = localStorage.getItem(THEME_KEY);
  return stored === 'dark' ? 'dark' : 'light';
}

function Root() {
  const [theme, setThemeState] = useState<Theme>(readTheme);
  const setTheme = useCallback((next: Theme) => {
    localStorage.setItem(THEME_KEY, next);
    setThemeState(next);
  }, []);
  const themeValue = useMemo(() => ({ theme, setTheme }), [theme, setTheme]);

  return (
    <ThemeProvider theme={theme}>
      <ThemeContext.Provider value={themeValue}>
        <ToasterProvider toaster={toaster}>
          <QueryClientProvider client={queryClient}>
            <BrowserRouter>
              <App />
              <ToasterComponent />
            </BrowserRouter>
          </QueryClientProvider>
        </ToasterProvider>
      </ThemeContext.Provider>
    </ThemeProvider>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
