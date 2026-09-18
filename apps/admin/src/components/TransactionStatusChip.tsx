import { Chip, Tooltip } from '@mui/material';
import {transactionChipSx} from '../../../../packages/shared/src/components/transactionVisuals';
import {Icon} from '@iconify/react';
import { transactionStatus } from './cardTransactionFields';

export function TransactionStatusChip({status, detailedStatus, showSource=true}: {status?:string|null;detailedStatus?:string|null;showSource?:boolean}) {
  const display = transactionStatus(status, detailedStatus);
  const label=!showSource&&display.label.startsWith('未知状态')?'未知状态':display.label;
  const icons={warning:'solar:clock-circle-linear',error:'solar:close-circle-linear',success:'solar:check-circle-linear',info:'solar:undo-left-round-linear',default:'solar:minus-circle-linear'};
  return <Tooltip describeChild title={showSource?`Slash status: ${status || '—'} · detailedStatus: ${detailedStatus || '—'}`:label}>
    <Chip tabIndex={0} size="small" icon={<Icon icon={icons[display.color]} width={14}/>} label={label} sx={theme=>transactionChipSx(theme,display.color)} />
  </Tooltip>;
}
