import { Box, Button, Stack, Typography } from '@mui/material';
import { Icon } from '@iconify/react';
import { useNavigate } from 'react-router-dom';

export function NotFoundPage() {
  const navigate = useNavigate();
  return (
    <Stack minHeight="70vh" alignItems="center" justifyContent="center" textAlign="center" spacing={2}>
      <Box sx={{ color: "primary.main" }}><Icon icon="solar:map-point-wave-bold-duotone" width={68} /></Box>
      <Typography variant="h4">页面不存在</Typography>
      <Typography color="text.secondary">该地址不属于新的只读运营后台。</Typography>
      <Button variant="contained" onClick={() => navigate('/workbench')}>返回工作台</Button>
    </Stack>
  );
}
