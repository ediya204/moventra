import {useEffect,useState} from 'react';
import {Stack,TextField,Typography} from '@mui/material';
import {cryptoUnits,type CryptoSettings} from '../auth/cryptoContract';
const fields=[['TRC20','TRC20 提款费（USDT）','USDT'],['ERC20','ERC20 提款费（USDT）','USDT'],['cardDepositFeeMinor','卡片充值费（USD）','USD'],['cardWithdrawFeeMinor','卡片提现费（USD）','USD']] as const;
function display(minor:string|null|undefined,currency:string){if(minor==null)return '';const unit=10n**BigInt(currency==='USD'?2:6);return `${BigInt(minor)/unit}.${(BigInt(minor)%unit).toString().padStart(currency==='USD'?2:6,'0')}`}
export default function FundsFeeSettings({settings,onChange,onValidityChange,disabled}:{settings:CryptoSettings;onChange:(v:CryptoSettings)=>void;onValidityChange?:(valid:boolean)=>void;disabled:boolean}){
 const values=()=>Object.fromEntries(fields.map(([k,,c])=>[k,display(k==='TRC20'||k==='ERC20'?settings.networkFees?.[k]:settings[k],c)]));
 const [text,setText]=useState<Record<string,string>>(values),[errors,setErrors]=useState<Record<string,boolean>>({});
 useEffect(()=>{setText(values());setErrors({});onValidityChange?.(true)},[settings.revision]);
 function change(k:typeof fields[number][0],v:string,currency:string){setText(old=>({...old,[k]:v}));try{const minor=!v.trim()?null:/^0(?:\.0+)?$/.test(v)?'0':cryptoUnits(v,currency);const next={...errors,[k]:false};setErrors(next);onValidityChange?.(!Object.values(next).some(Boolean));onChange(k==='TRC20'||k==='ERC20'?{...settings,networkFees:{...settings.networkFees,[k]:minor}}:{...settings,[k]:minor})}catch{setErrors(old=>({...old,[k]:true}));onValidityChange?.(false)}}
 return <Stack spacing={2} className="finance-fees"><Typography>网络及卡片费用（空白表示未配置，0 表示免费）</Typography>{fields.map(([k,label,c])=><TextField key={k} label={label} disabled={disabled} value={text[k]} error={!!errors[k]} helperText={errors[k]?'金额格式不正确':undefined} onChange={e=>change(k,e.target.value,c)}/>)}</Stack>
}
