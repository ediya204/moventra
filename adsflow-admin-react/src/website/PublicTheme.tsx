import { createTheme, ThemeProvider } from '@mui/material/styles';
import { useMemo, type ReactNode } from 'react';
import { enUS, zhCN } from '@mui/material/locale';
import { useLocale } from './i18n';
import baseTheme from '../theme';

// Scoped to the public site; operations retain their existing theme.
const publicTheme = createTheme(baseTheme, {
  palette: {
    primary: { main: '#084CFF', light: '#7599FF', dark: '#0039CC', darker: '#082B85', lighter: '#EDF2FF', contrastText: '#FFFFFF' },
    text: { primary: '#212B36', secondary: '#637381' },
    background: { default: '#F9FAFB', paper: '#FFFFFF' },
  },
  components: {
    MuiCard: { styleOverrides: { root: { borderRadius: 16, border: '1px solid #EDF0F3', boxShadow: '0 0 2px 0 rgba(145,158,171,0.12), 0 12px 24px -4px rgba(145,158,171,0.08)' } } },
    MuiButton: { styleOverrides: { containedPrimary: { '&:hover': { backgroundColor: '#0039CC' } } } },
    MuiTextField: { defaultProps: { size: 'medium' } },
    MuiLink: { defaultProps: { underline: 'hover' } },
  },
});
export function PublicTheme({ children }: { children: ReactNode }) { const { locale } = useLocale(); const theme = useMemo(() => createTheme(publicTheme, locale === 'zh' ? zhCN : enUS), [locale]); return <ThemeProvider theme={theme}>{children}</ThemeProvider>; }
