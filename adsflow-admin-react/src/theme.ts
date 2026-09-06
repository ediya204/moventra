import { alpha, createTheme, responsiveFontSizes } from '@mui/material/styles';
import type {} from '@mui/x-data-grid/themeAugmentation';

const GREY = {
  0: '#FFFFFF',
  100: '#F9FAFB',
  200: '#F4F6F8',
  300: '#DFE3E8',
  400: '#C4CDD5',
  500: '#919EAB',
  600: '#637381',
  700: '#454F5B',
  800: '#212B36',
  900: '#161C24',
};

const palette = {
  primary: {
    lighter: '#EFF6FC',
    light: '#50A0DC',
    main: '#0078D4',
    dark: '#005A9E',
    darker: '#003A66',
    contrastText: '#FFFFFF',
  },
  secondary: {
    lighter: '#EDF2F7',
    light: '#8AABCC',
    main: '#526F8D',
    dark: '#354F6B',
    darker: '#23374D',
    contrastText: '#FFFFFF',
  },
  info: {
    lighter: '#EFF6FC',
    light: '#71AFE5',
    main: '#106EBE',
    dark: '#005A9E',
    darker: '#003A66',
    contrastText: '#FFFFFF',
  },
  success: {
    lighter: '#D3FCD2',
    light: '#77ED8B',
    main: '#22C55E',
    dark: '#118D57',
    darker: '#065E49',
    contrastText: '#FFFFFF',
  },
  warning: {
    lighter: '#FFF5CC',
    light: '#FFD666',
    main: '#FFAB00',
    dark: '#B76E00',
    darker: '#7A4100',
    contrastText: GREY[800],
  },
  error: {
    lighter: '#FFE9D5',
    light: '#FFAC82',
    main: '#FF5630',
    dark: '#B71D18',
    darker: '#7A0916',
    contrastText: '#FFFFFF',
  },
};

declare module '@mui/material/styles' {
  interface PaletteColor {
    lighter?: string;
    darker?: string;
  }
  interface SimplePaletteColorOptions {
    lighter?: string;
    darker?: string;
  }
}

let theme = createTheme({
  palette: {
    mode: 'light',
    ...palette,
    grey: GREY,
    divider: alpha(GREY[500], 0.2),
    text: {
      primary: GREY[800],
      secondary: GREY[600],
      disabled: GREY[500],
    },
    background: {
      default: '#F8F9FB',
      paper: GREY[0],
    },
    action: {
      hover: alpha(GREY[500], 0.08),
      selected: alpha(GREY[500], 0.16),
      focus: alpha(GREY[500], 0.24),
      disabled: alpha(GREY[500], 0.8),
      disabledBackground: alpha(GREY[500], 0.24),
    },
  },
  shape: { borderRadius: 8 },
  typography: {
    fontFamily: '"Public Sans", sans-serif',
    fontWeightRegular: 400,
    fontWeightMedium: 500,
    fontWeightBold: 700,
    h3: { fontWeight: 700, lineHeight: 1.3 },
    h4: { fontWeight: 700, lineHeight: 1.35 },
    h5: { fontWeight: 700, lineHeight: 1.45 },
    h6: { fontWeight: 700, lineHeight: 1.5 },
    subtitle1: { fontWeight: 600 },
    subtitle2: { fontWeight: 600 },
    body1: { lineHeight: 1.5 },
    body2: { fontSize: '0.875rem', lineHeight: 1.55 },
    button: { fontWeight: 700, textTransform: 'none' },
  },
  shadows: [
    'none',
    '0 1px 2px 0 rgba(145, 158, 171, 0.08)',
    '0 4px 8px 0 rgba(145, 158, 171, 0.12)',
    '0 8px 16px 0 rgba(145, 158, 171, 0.14)',
    '0 12px 24px -4px rgba(145, 158, 171, 0.16)',
    ...Array(20).fill('0 12px 24px -4px rgba(145, 158, 171, 0.16)'),
  ] as unknown as typeof createTheme extends (...args: never[]) => infer T
    ? T extends { shadows: infer S }
      ? S
      : never
    : never,
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        html: { backgroundColor: '#F8F9FB' },
        ':root': { '--app-primary': palette.primary.main },
        '*': { boxSizing: 'border-box' },
        '::selection': { backgroundColor: palette.primary.lighter, color: palette.primary.darker },
        '*:focus-visible': { outline: `2px solid ${palette.primary.main}`, outlineOffset: 2 },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          borderRadius: 12,
          border: `1px solid ${alpha(GREY[500], 0.2)}`,
          boxShadow: 'none',
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        outlined: { borderRadius: 12, boxShadow: 'none' },
      },
    },
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: { minHeight: 40, borderRadius: 8 },
        containedPrimary: { '&:hover': { backgroundColor: palette.primary.dark } },
      },
    },
    MuiListItemButton: {
      styleOverrides: {
        root: {
          borderRadius: 8,
          minHeight: 44,
          color: GREY[600],
          '&.Mui-selected': {
            color: palette.primary.dark,
            backgroundColor: palette.primary.lighter,
            '&:hover': { backgroundColor: alpha(palette.primary.main, 0.12) },
          },
          '& .MuiListItemIcon-root': { minWidth: 36, color: 'inherit' },
        },
      },
    },
    MuiTableCell: {
      styleOverrides: {
        root: { borderBottom: `1px solid ${alpha(GREY[500], 0.16)}` },
        head: { backgroundColor: GREY[100], color: GREY[600], fontWeight: 600, whiteSpace: 'nowrap' },
      },
    },
    MuiTableRow: {
      styleOverrides: {
        root: {
          '&.MuiTableRow-hover:hover': { backgroundColor: alpha(palette.primary.main, 0.04) },
          '&.Mui-selected': { backgroundColor: alpha(palette.primary.main, 0.08) },
          '&.Mui-selected:hover': { backgroundColor: alpha(palette.primary.main, 0.12) },
        },
      },
    },
    MuiTab: {
      styleOverrides: { root: { minHeight: 48, fontWeight: 600, textTransform: 'none' } },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        notchedOutline: { borderColor: alpha(GREY[500], 0.32) },
        input: { '&::placeholder': { color: GREY[600], opacity: 1 } },
      },
    },
    MuiTooltip: { defaultProps: { arrow: true } },
    MuiTextField: {
      defaultProps: { size: 'small' },
    },
    MuiChip: {
      styleOverrides: {
        root: { fontWeight: 600 },
      },
    },
    MuiDataGrid: {
      styleOverrides: {
        root: {
          border: 0,
          '--DataGrid-rowBorderColor': alpha(GREY[500], 0.16),
        },
        columnHeaders: {
          backgroundColor: GREY[100],
          borderRadius: 0,
          color: GREY[600],
        },
        columnHeaderTitle: { fontWeight: 600 },
        row: { cursor: 'pointer' },
      },
    },
  },
});

theme = responsiveFontSizes(theme);

export default theme;
