import { Chip } from '@mui/material';

export function StatusChip({ value, labels }: { value: unknown; labels?: Record<string, string> }) {
  const raw = String(value ?? '未知');
  const text = labels?.[raw] || raw;
  const normalized = text.toLowerCase();
  const color =
    normalized.includes('成功') || normalized.includes('激活') || normalized === '1'
      ? 'success'
      : normalized.includes('失败') || normalized.includes('风险') || normalized.includes('冻结')
        ? 'error'
        : normalized.includes('处理') || normalized.includes('待') || normalized.includes('中')
          ? 'warning'
          : 'default';

  return <Chip size="small" label={text} color={color} variant="outlined" />;
}
