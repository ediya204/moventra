import { useEffect, useRef, type ReactNode } from 'react';
import { Box, Button, Stack } from '@mui/material';
import { Link } from 'react-router-dom';

/** Route links, not local tabs: deep links and browser history remain native. */
export default function SectionNavigation({ label, items, active, action }: {
  label: string;
  items: { value: string; label: string; to: string }[];
  active: string;
  action?: ReactNode;
}) {
  const navigation = useRef<HTMLElement>(null);
  useEffect(() => {
    const container = navigation.current;
    const selected = container?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!container || !selected) return;
    const bounds = container.getBoundingClientRect(), item = selected.getBoundingClientRect();
    if (item.left < bounds.left) container.scrollLeft += item.left - bounds.left;
    else if (item.right > bounds.right) container.scrollLeft += item.right - bounds.right;
  }, [active]);
  return <Stack direction="row" gap={1} sx={{ minWidth: 0, borderBottom: 1, borderColor: 'divider' }}>
    <Box component="nav" ref={navigation} aria-label={label} sx={{ display: 'flex', gap: { xs: 1, md: 2 }, flex: 1, minWidth: 0, overflowX: 'auto', scrollbarWidth: 'thin' }}>
      {items.map(item => <Button key={item.value} component={Link} to={item.to}
        aria-current={active === item.value ? 'page' : undefined}
        sx={{ flexShrink: 0, minHeight: 48, px: 1, borderRadius: 0, borderBottom: 2,
          borderColor: active === item.value ? 'primary.main' : 'transparent',
          color: active === item.value ? 'primary.main' : 'text.secondary',
          '&:hover': { bgcolor: 'action.hover' } }}>
        {item.label}
      </Button>)}
    </Box>
    {action && <Box sx={{ alignSelf: 'center', flexShrink: 0 }}>{action}</Box>}
  </Stack>;
}
