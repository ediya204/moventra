import { useMemo, useState, type ReactNode } from 'react';
import {
  Box,
  Card,
  CardHeader,
  CircularProgress,
  Divider,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { Icon } from '@iconify/react';
import type { GridColDef, GridPaginationModel, GridRowId } from '@mui/x-data-grid';

function cellContent(column: GridColDef, row: Record<string, unknown>) {
  const raw = row[column.field];
  if (column.renderCell) return column.renderCell({ row, value: raw, field: column.field } as never);
  if (column.valueGetter) {
    const getter = column.valueGetter as unknown as (value: unknown, currentRow: Record<string, unknown>, definition: GridColDef, api: unknown) => ReactNode;
    return getter(raw, row, column, null);
  }
  return raw === undefined || raw === null || raw === '' ? '-' : String(raw);
}

export function DataTableCard({
  title,
  subheader,
  action,
  rows,
  columns,
  loading,
  total,
  pagination,
  onPagination,
  onRowClick,
  getRowId,
  minHeight = 520,
  toolbar = true,
}: {
  title: string;
  subheader?: string;
  action?: ReactNode;
  rows: Record<string, unknown>[];
  columns: GridColDef[];
  loading?: boolean;
  total?: number;
  pagination?: GridPaginationModel;
  onPagination?: (model: GridPaginationModel) => void;
  onRowClick?: (row: Record<string, unknown>) => void;
  getRowId?: (row: Record<string, unknown>) => GridRowId;
  minHeight?: number;
  toolbar?: boolean;
}) {
  const [query, setQuery] = useState('');
  const [localPage, setLocalPage] = useState(0);
  const [localPageSize, setLocalPageSize] = useState(10);
  const page = pagination?.page ?? localPage;
  const pageSize = pagination?.pageSize ?? localPageSize;

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return rows;
    return rows.filter((row) => Object.values(row).some((value) => String(value ?? '').toLowerCase().includes(keyword)));
  }, [query, rows]);
  const visibleRows = onPagination ? filtered : filtered.slice(page * pageSize, page * pageSize + pageSize);
  const rowCount = onPagination ? total ?? rows.length : filtered.length;

  const changePage = (nextPage: number) => {
    if (onPagination) onPagination({ page: nextPage, pageSize });
    else setLocalPage(nextPage);
  };
  const changePageSize = (nextSize: number) => {
    if (onPagination) onPagination({ page: 0, pageSize: nextSize });
    else { setLocalPage(0); setLocalPageSize(nextSize); }
  };

  return <Card>
    <CardHeader title={title} subheader={subheader} action={action} />
    <Divider />
    {toolbar ? <Stack direction={{ xs: 'column', sm: 'row' }} alignItems={{ sm: 'center' }} gap={1.5} sx={{ px: 2.5, py: 1.5 }}>
      <Stack direction="row" alignItems="center" gap={0.8} color="text.secondary"><Icon icon="solar:eye-linear" width={18} /><Typography variant="caption">只读明细</Typography></Stack>
      <Box sx={{ flex: 1 }} />
      <TextField size="small" value={query} onChange={(event) => { setQuery(event.target.value); setLocalPage(0); }} placeholder="在当前加载数据中查找" InputProps={{ startAdornment: <Icon icon="solar:magnifer-linear" width={18} /> }} sx={{ width: { xs: '100%', sm: 280 }, '& .MuiInputBase-root': { gap: 1 } }} />
      <TextField select size="small" label="每页" value={pageSize} onChange={(event) => changePageSize(Number(event.target.value))} sx={{ width: 105 }}>
        {[10, 25, 50, 100].map((size) => <MenuItem key={size} value={size}>{size}</MenuItem>)}
      </TextField>
    </Stack> : null}
    <TableContainer sx={{ minHeight, maxWidth: '100%', overflowX: 'auto' }}>
      <Table stickyHeader size="small" sx={{ minWidth: columns.reduce((sum, column) => sum + Number(column.width || column.minWidth || 140), 0) }}>
        <TableHead><TableRow>{columns.map((column) => <TableCell key={column.field} align={column.headerAlign || column.align || 'left'} sx={{ width: column.width, minWidth: column.minWidth || column.width, fontWeight: 700, bgcolor: 'background.paper', whiteSpace: 'nowrap' }}>{column.headerName || column.field}</TableCell>)}</TableRow></TableHead>
        <TableBody>
          {loading ? <TableRow><TableCell colSpan={columns.length} sx={{ height: 280, textAlign: 'center' }}><CircularProgress size={30} /></TableCell></TableRow> : null}
          {!loading && !visibleRows.length ? <TableRow><TableCell colSpan={columns.length} sx={{ height: 280, textAlign: 'center' }}><Icon icon="solar:inbox-line-linear" width={34} /><Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>当前范围暂无记录</Typography></TableCell></TableRow> : null}
          {!loading ? visibleRows.map((row, index) => {
            const id = getRowId ? getRowId(row) : (row.id as GridRowId | undefined) ?? `${page}-${index}`;
            return <TableRow key={String(id)} hover={Boolean(onRowClick)} onClick={() => onRowClick?.(row)} sx={{ cursor: onRowClick ? 'pointer' : 'default', '&:last-child td': { borderBottom: 0 } }}>
              {columns.map((column) => <TableCell key={column.field} align={column.align || 'left'} sx={{ whiteSpace: 'nowrap', maxWidth: column.width || column.minWidth || 260, overflow: 'hidden', textOverflow: 'ellipsis' }}>{cellContent(column, row)}</TableCell>)}
            </TableRow>;
          }) : null}
        </TableBody>
      </Table>
    </TableContainer>
    <Divider />
    <TablePagination component="div" count={rowCount} page={Math.min(page, Math.max(0, Math.ceil(rowCount / pageSize) - 1))} rowsPerPage={pageSize} onPageChange={(_, nextPage) => changePage(nextPage)} onRowsPerPageChange={(event) => changePageSize(Number(event.target.value))} rowsPerPageOptions={[10, 25, 50, 100]} labelRowsPerPage="每页" labelDisplayedRows={({ from, to, count }) => `${from}–${to} / ${count}`} />
  </Card>;
}
