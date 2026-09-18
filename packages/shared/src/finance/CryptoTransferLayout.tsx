import type {ReactNode} from 'react';
import {Box,Paper,Stack,Typography} from '@mui/material';

export function TransferAsset({network}:{network?:string}) {
 const tron=network==='TRC20';
 return <Stack direction="row" spacing={1.25} alignItems="center">
  <Box component="svg" aria-hidden="true" viewBox="0 0 32 32" sx={{width:24,height:24,flexShrink:0}}>
   <circle cx="16" cy="16" r="16" fill={!network?'#00a478':tron?'#ef2449':'#627eea'}/>
   {!network?<><path d="M8 7h16v4h-6v14h-4V11H8z" fill="white"/><ellipse cx="16" cy="14" rx="10" ry="2.6" fill="none" stroke="white" strokeWidth="1.3"/></>:tron?<path d="m7 7 19 4-12 15L7 7Zm0 0 10 9 9-5M17 16l-3 10" fill="none" stroke="white" strokeWidth="1.25" strokeLinejoin="round"/>:<path d="m16 5-7 11 7 4 7-4-7-11Zm0 17-7-4 7 9 7-9-7 4Z" fill="white"/>}
  </Box>
  <Typography component="span" variant="body2">{!network?'USDT':tron?'Tron (TRC20)':'Ethereum (ERC20)'}</Typography>
  <Typography component="span" variant="caption" color="text.secondary">{network?'(USDT)':'Tether'}</Typography>
 </Stack>;
}
export function TransferStep({number,title,children,last=false}:{number:number;title:string;children:ReactNode;last?:boolean}) {
 return <Box sx={{position:'relative',pl:{xs:4.5,sm:5.5},pb:last?0:5.5,'&:before':last?{}:{content:'""',position:'absolute',left:13,top:26,bottom:0,width:'1px',bgcolor:'#65cf43'}}}>
  <Box aria-hidden="true" sx={{position:'absolute',left:0,top:0,width:28,height:28,borderRadius:'50%',bgcolor:'#65cf43',color:'#fff',display:'grid',placeItems:'center',fontSize:16}}>{number}</Box>
  <Typography variant="subtitle2" sx={{minHeight:28,display:'flex',alignItems:'center',mb:2}}>{title}</Typography>
  {children}
 </Box>;
}
export function CryptoTransferLayout({withdraw=false,children,notice}:{withdraw?:boolean;children:ReactNode;notice?:ReactNode}) {
 return <Box sx={{display:'grid',gridTemplateColumns:{xs:'minmax(0, 1fr)',lg:'minmax(0, 2fr) minmax(280px, 1fr)'},gap:3,alignItems:'start'}}>
  <Paper variant="outlined" sx={{p:{xs:2,sm:3},pb:{xs:3,sm:6},minWidth:0,borderRadius:2,boxShadow:'0 12px 28px rgba(25,40,55,.045)','& .MuiOutlinedInput-root':{minHeight:56,borderRadius:1},'& .MuiOutlinedInput-notchedOutline':{borderColor:'#e4e8ed'}}}>{children}</Paper>
  <Paper component="aside" variant="outlined" sx={{p:3,borderRadius:2,boxShadow:'0 8px 24px rgba(25,40,55,.035)'}}>
   <Typography variant="h6" sx={{mb:2.5}}>{withdraw?'提现须知':'充值须知'}</Typography>
   <Box component="ol" sx={{m:0,pl:2,fontSize:14,lineHeight:1.9,'& li + li':{mt:1}}}>
    <li>请确认所选网络与{withdraw?'收款':'转出'}钱包网络一致，网络错误可能导致资产丢失。</li>
    <li>{withdraw?'确认前请核对收款地址、金额和费用。提交后将预占本金与费用，审核通过后处理出金。':'仅向专属地址转入所选网络的 USDT，请勿转入其他资产。'}</li>
    <li>{withdraw?'审核通过不代表已到账，请在提现记录中查看渠道处理及记账结果。':'渠道通知不代表已入账，链上最终确认且记账完成后才会更新余额。'}</li>
   </Box>
   {notice&&<Box sx={{mt:2.5}}>{notice}</Box>}
  </Paper>
 </Box>;
}
export const transferTableSx={minWidth:850,'& th':{bgcolor:'#f5f6f8',color:'text.secondary',fontWeight:600,py:2,whiteSpace:'nowrap'},'& td':{py:2.25,borderBottom:'1px dashed #e8ecef',fontSize:13}};
