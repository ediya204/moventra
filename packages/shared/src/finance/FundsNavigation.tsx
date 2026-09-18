import { Button } from '@mui/material';
import SectionNavigation from '../components/SectionNavigation';

const sections = [
  ['', '总览'], ['deposit', 'USDT 充值'],
  ['withdraw', 'USDT 提款'], ['exchange', 'OTC'], ['history', '交易记录'],
];

export default function FundsNavigation({ basePath, section, onRefresh, busy = false }: {
  basePath: string; section: string; onRefresh?: () => void; busy?: boolean;
}) {
  const items = sections.map(([value, label]) => ({ value, label, to: basePath + (value ? '/' + value : '') }));
  return <SectionNavigation label="资金分区" items={items} active={section}
    action={onRefresh && <Button onClick={onRefresh} disabled={busy} aria-label="刷新资金数据">刷新</Button>} />;
}
