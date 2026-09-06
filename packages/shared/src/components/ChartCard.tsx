import type { ApexOptions } from 'apexcharts';
import { Box, Card, CardHeader, Stack, Typography, useTheme } from '@mui/material';

type AxisItem = { name?: string; data: unknown[] };

function numeric(value: unknown) {
  const result = Number(value ?? 0);
  return Number.isFinite(result) ? result : 0;
}

function axisSeries(series: ApexAxisChartSeries | ApexNonAxisChartSeries): { name: string; data: number[] }[] {
  if (!Array.isArray(series)) return [];
  return (series as unknown[])
    .filter((item): item is AxisItem => Boolean(item && typeof item === 'object' && 'data' in item && Array.isArray((item as AxisItem).data)))
    .map((item, index) => ({ name: String(item.name || `序列 ${index + 1}`), data: item.data.map(numeric) }));
}

function Legend({ labels, colors }: { labels: string[]; colors: string[] }) {
  return <Stack direction="row" gap={1.5} flexWrap="wrap" justifyContent="flex-end" sx={{ mb: 1.5 }}>
    {labels.map((label, index) => <Stack key={`${label}-${index}`} direction="row" alignItems="center" gap={0.6}>
      <Box sx={{ width: 9, height: 9, borderRadius: '50%', bgcolor: colors[index % colors.length] }} />
      <Typography variant="caption" color="text.secondary">{label}</Typography>
    </Stack>)}
  </Stack>;
}

function DonutChart({ values, labels, colors, height }: { values: number[]; labels: string[]; colors: string[]; height: number }) {
  const total = values.reduce((sum, value) => sum + Math.max(0, value), 0);
  let offset = 0;
  return <Stack alignItems="center" justifyContent="center" sx={{ minHeight: height }}>
    <Box sx={{ position: 'relative', width: Math.min(190, height * 0.58), height: Math.min(190, height * 0.58) }}>
      <svg width="100%" height="100%" viewBox="0 0 100 100" style={{ transform: 'rotate(-90deg)' }}>
        <circle cx="50" cy="50" r="36" fill="none" stroke="#F1F3F5" strokeWidth="16" />
        {values.map((value, index) => {
          const length = total ? (Math.max(0, value) / total) * 226.2 : 0;
          const circle = <circle key={`${labels[index]}-${index}`} cx="50" cy="50" r="36" fill="none" stroke={colors[index % colors.length]} strokeWidth="16" strokeDasharray={`${length} ${226.2 - length}`} strokeDashoffset={-offset} />;
          offset += length;
          return circle;
        })}
      </svg>
      <Stack alignItems="center" justifyContent="center" sx={{ position: 'absolute', inset: 0 }}>
        <Typography variant="h5">{total.toLocaleString('zh-CN', { maximumFractionDigits: 1 })}</Typography>
        <Typography variant="caption" color="text.secondary">合计</Typography>
      </Stack>
    </Box>
    <Legend labels={labels} colors={colors} />
  </Stack>;
}

function HorizontalBars({ series, categories, colors, height }: { series: { name: string; data: number[] }[]; categories: string[]; colors: string[]; height: number }) {
  const max = Math.max(1, ...series.flatMap((item) => item.data.map(Math.abs)));
  const rowCount = Math.max(...series.map((item) => item.data.length), categories.length, 1);
  return <Box sx={{ height, overflow: 'auto', pr: 1 }}>
    {series.length > 1 ? <Legend labels={series.map((item) => item.name)} colors={colors} /> : null}
    <Stack gap={1.25}>{Array.from({ length: rowCount }, (_, index) => <Box key={`${categories[index]}-${index}`}>
      <Stack direction="row" justifyContent="space-between" gap={2} sx={{ mb: 0.45 }}>
        <Typography variant="caption" noWrap sx={{ maxWidth: '70%' }}>{categories[index] || `项目 ${index + 1}`}</Typography>
        <Typography variant="caption" color="text.secondary">{Math.max(...series.map((item) => item.data[index] || 0)).toLocaleString('zh-CN', { maximumFractionDigits: 2 })}</Typography>
      </Stack>
      <Stack gap={0.35}>{series.map((item, seriesIndex) => <Box key={`${item.name}-${index}`} sx={{ height: series.length > 1 ? 7 : 10, width: `${Math.max(1.5, (Math.abs(item.data[index] || 0) / max) * 100)}%`, bgcolor: colors[seriesIndex % colors.length], borderRadius: 1 }} />)}</Stack>
    </Box>)}</Stack>
  </Box>;
}

function VerticalBars({ series, categories, colors, height }: { series: { name: string; data: number[] }[]; categories: string[]; colors: string[]; height: number }) {
  const max = Math.max(1, ...series.flatMap((item) => item.data.map((value) => Math.abs(value))));
  const count = Math.max(...series.map((item) => item.data.length), categories.length, 1);
  return <Box sx={{ height }}>
    <Legend labels={series.map((item) => item.name)} colors={colors} />
    <Stack direction="row" alignItems="flex-end" gap={1} sx={{ height: height - 54, borderBottom: 1, borderColor: 'divider', px: 1, overflow: 'hidden' }}>
      {Array.from({ length: count }, (_, index) => <Stack key={`${categories[index]}-${index}`} alignItems="center" justifyContent="flex-end" direction="row" gap={0.35} sx={{ height: '100%', flex: 1, minWidth: 12 }} title={categories[index]}>
        {series.map((item, seriesIndex) => <Box key={`${item.name}-${index}`} sx={{ width: `${Math.max(18, 70 / series.length)}%`, maxWidth: 26, height: `${Math.max(2, (Math.abs(item.data[index] || 0) / max) * 92)}%`, bgcolor: colors[seriesIndex % colors.length], borderRadius: '4px 4px 0 0' }} />)}
      </Stack>)}
    </Stack>
    <Stack direction="row" justifyContent="space-between" sx={{ mt: 0.7, px: 1 }}><Typography variant="caption" color="text.secondary">{categories[0] || '-'}</Typography><Typography variant="caption" color="text.secondary">{categories.at(-1) || '-'}</Typography></Stack>
  </Box>;
}

function TrendChart({ series, categories, colors, height, area }: { series: { name: string; data: number[] }[]; categories: string[]; colors: string[]; height: number; area: boolean }) {
  const all = series.flatMap((item) => item.data);
  const max = Math.max(1, ...all);
  const min = Math.min(0, ...all);
  const range = Math.max(1, max - min);
  const pointsFor = (values: number[]) => values.map((value, index) => `${values.length <= 1 ? 50 : (index / (values.length - 1)) * 96 + 2},${56 - ((value - min) / range) * 50}`).join(' ');
  return <Box sx={{ height }}>
    <Legend labels={series.map((item) => item.name)} colors={colors} />
    <Box sx={{ height: height - 55 }}><svg width="100%" height="100%" viewBox="0 0 100 60" preserveAspectRatio="none">
      {[10, 25, 40, 55].map((y) => <line key={y} x1="2" y1={y} x2="98" y2={y} stroke="#E8EAED" strokeWidth="0.35" strokeDasharray="2 2" />)}
      {series.map((item, index) => { const points = pointsFor(item.data); return <g key={item.name}>{area ? <polygon points={`2,58 ${points} 98,58`} fill={colors[index % colors.length]} opacity="0.08" /> : null}<polyline points={points} fill="none" stroke={colors[index % colors.length]} strokeWidth="1.4" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" /></g>; })}
    </svg></Box>
    <Stack direction="row" justifyContent="space-between"><Typography variant="caption" color="text.secondary">{categories[0] || '-'}</Typography><Typography variant="caption" color="text.secondary">{categories.at(-1) || '-'}</Typography></Stack>
  </Box>;
}

export function ChartCard({ title, subheader, type = 'line', series, categories = [], height = 340, options }: {
  title: string;
  subheader?: string;
  type?: 'line' | 'area' | 'bar' | 'donut' | 'radialBar';
  series: ApexAxisChartSeries | ApexNonAxisChartSeries;
  categories?: string[];
  height?: number;
  options?: ApexOptions;
}) {
  const theme = useTheme();
  const colors = (options?.colors as string[] | undefined) || [theme.palette.primary.main, theme.palette.info.main, theme.palette.warning.main, theme.palette.error.main, theme.palette.secondary.main];
  const axes = axisSeries(series);
  const values = Array.isArray(series) ? series.filter((item): item is number => typeof item === 'number').map(numeric) : [];
  const labels = (options?.labels || categories).map(String);
  const hasData = values.length > 0 || axes.some((item) => item.data.length > 0);
  const horizontal = Boolean(options?.plotOptions?.bar?.horizontal);

  return <Card><CardHeader title={title} subheader={subheader} /><Box sx={{ p: 3, pt: 1 }}>
    {!hasData ? <Box sx={{ height, display: 'grid', placeItems: 'center', bgcolor: 'grey.100', borderRadius: 1.5 }}><Typography variant="body2" color="text.secondary">当前范围暂无可绘制数据</Typography></Box>
      : type === 'donut' || type === 'radialBar' ? <DonutChart values={values} labels={labels} colors={colors} height={height} />
        : type === 'bar' && horizontal ? <HorizontalBars series={axes} categories={categories} colors={colors} height={height} />
          : type === 'bar' ? <VerticalBars series={axes} categories={categories} colors={colors} height={height} />
            : <TrendChart series={axes} categories={categories} colors={colors} height={height} area={type === 'area'} />}
  </Box></Card>;
}
