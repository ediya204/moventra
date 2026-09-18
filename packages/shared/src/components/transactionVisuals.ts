import type { Theme } from '@mui/material/styles';

// Shared presentation only: callers retain their existing source-state mapping.
export function transactionChipSx(theme: Theme, color: 'success' | 'warning' | 'error' | 'info' | 'default') {
  const tones = {
    success: { color: '#087F23', bgcolor: '#DFF3E3' },
    warning: { color: '#A84B08', bgcolor: '#FBECD6' },
    error: { color: '#B42318', bgcolor: '#FEE9E7' },
    info: { color: theme.palette.info.dark, bgcolor: '#E8F3FC' },
    default: { color: theme.palette.text.secondary, bgcolor: theme.palette.action.hover },
  };
  return { ...tones[color], height: 24, borderRadius: '6px', fontSize: 13, fontWeight: 500,
    '& .MuiChip-icon': { color: 'inherit', ml: 0.75, width: 14, height: 14 },
    '& .MuiChip-label': { px: 0.75 },
    '&:focus-visible': { outline: `2px solid ${theme.palette.primary.main}`, outlineOffset: 2 },
  };
}

export const transactionTableSx = {
  '& .MuiTableCell-root': { height: 56, py: 0.75, px: 2, borderColor: 'divider', fontSize: 14, fontVariantNumeric: 'tabular-nums' },
  '& .MuiTableHead .MuiTableCell-root': { height: 40, bgcolor: 'grey.50', color: 'text.secondary', whiteSpace: 'nowrap' },
  '& .MuiTableRow-root:hover': { bgcolor: 'action.hover' },
};

export function transactionTableRowSx(color: string) {
  const tone = color === 'error' ? 'error.dark' : color === 'warning' ? 'text.secondary' : 'text.primary';
  return { '& .MuiTableCell-root': { color: tone },
    ...(color === 'error' || color === 'warning' ? {
      '& .MuiButton-root, & .MuiTypography-root:not([data-merchant-subtitle])': { color: 'inherit' },
      '& [data-merchant-subtitle]': { color: tone },
    } : {}),
  };
}
