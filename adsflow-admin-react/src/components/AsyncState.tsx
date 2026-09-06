import { Icon } from '@iconify/react';
import { Alert, Box, Button, Skeleton, Stack, Typography } from '@mui/material';

export function PageSkeleton() {
  return (
    <Stack spacing={3} aria-label="正在读取数据">
      <Skeleton variant="rounded" width="34%" height={38} />
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} variant="rounded" height={132} sx={{ flex: 1 }} />
        ))}
      </Stack>
      <Skeleton variant="rounded" height={390} />
    </Stack>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <Alert
      severity="error"
      action={
        onRetry ? (
          <Button color="inherit" size="small" onClick={onRetry}>
            重新读取
          </Button>
        ) : undefined
      }
    >
      {message}
    </Alert>
  );
}

export function EmptyState({
  title = '没有符合条件的数据',
  description = '调整筛选条件后重新查询。',
}: {
  title?: string;
  description?: string;
}) {
  return (
    <Box sx={{ py: 8, px: 3, textAlign: 'center', color: 'text.secondary' }}>
      <Icon icon="solar:inbox-line-linear" width={42} />
      <Typography variant="subtitle1" color="text.primary" sx={{ mt: 1.5 }}>
        {title}
      </Typography>
      <Typography variant="body2" sx={{ mt: 0.5 }}>
        {description}
      </Typography>
    </Box>
  );
}
