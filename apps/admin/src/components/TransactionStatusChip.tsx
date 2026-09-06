import { Chip, Tooltip } from '@mui/material';
import {alpha} from '@mui/material/styles';
import {Icon} from '@iconify/react';
import { transactionStatus } from './cardTransactionFields';

export function TransactionStatusChip({status, detailedStatus}: {status?:string|null;detailedStatus?:string|null}) {
  const display = transactionStatus(status, detailedStatus);
  const icons={warning:'solar:clock-circle-linear',error:'solar:close-circle-linear',success:'solar:check-circle-linear',info:'solar:undo-left-round-linear',default:'solar:minus-circle-linear'};
  return <Tooltip describeChild title={`Slash status: ${status || '—'} · detailedStatus: ${detailedStatus || '—'}`}>
    <Chip tabIndex={0} size="small" icon={<Icon icon={icons[display.color]} width={14}/>} label={display.label} sx={theme=>{
      const palette=display.color==='default'?null:theme.palette[display.color];
      return {height:24,borderRadius:0.75,fontWeight:600,color:palette?.dark||theme.palette.text.secondary,
        bgcolor:alpha(palette?.main||theme.palette.text.secondary,0.12),
        '& .MuiChip-icon':{color:'inherit',ml:0.75},'& .MuiChip-label':{px:0.75},
        '&:focus-visible':{outline:`2px solid ${theme.palette.primary.main}`,outlineOffset:2}};
    }} />
  </Tooltip>;
}
