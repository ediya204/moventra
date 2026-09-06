import { Box, Typography } from '@mui/material';

export function InfoField({ label, value }: { label: string; value: unknown }) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="body2" sx={{ mt: 0.5, fontWeight: 600, wordBreak: 'break-word' }}>
        {String(value ?? '-')}
      </Typography>
    </Box>
  );
}
