import {Box} from '@mui/material';

const appearances:Record<string,{color:string;background:string;path:string;circle?:boolean}>={
 active:{color:'#087F23',background:'#DFF3E3',path:'m10 8 6 4-6 4Z',circle:true},
 paused:{color:'#A84B08',background:'#FBECD6',path:'M9 8v8m6-8v8',circle:true},
 inactive:{color:'#A84B08',background:'#FBECD6',path:'M12 3v3m0 12v3M3 12h3m12 0h3M5.6 5.6l2.1 2.1m8.6 8.6 2.1 2.1M5.6 18.4l2.1-2.1m8.6-8.6 2.1-2.1'},
 closed:{color:'#B42318',background:'#FEE9E7',path:'m9 9 6 6m0-6-6 6',circle:true},
};
// Display the channel value verbatim; sync and command states never replace it.
export default function ChannelCardStatus({status}:{status?:string|null}){
 const label=status||'未知';
 const appearance=appearances[label]||{color:'#54616D',background:'#EEF1F4',circle:true,path:'M9 9a3 3 0 0 1 6 0c0 2-3 2-3 4m0 3h.01'};
 return <Box component="span" sx={{display:'inline-flex',alignItems:'center',gap:0.5,px:0.75,py:0.25,minHeight:24,borderRadius:'6px',width:'fit-content',maxWidth:'100%',color:appearance.color,bgcolor:appearance.background,fontSize:14,fontWeight:500,lineHeight:'20px',verticalAlign:'middle'}}>
  <Box component="svg" aria-hidden="true" viewBox="0 0 24 24" sx={{width:14,height:14,color:'inherit',flexShrink:0}} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{appearance.circle&&<circle cx="12" cy="12" r="9"/>}<path d={appearance.path}/></Box>
  <Box component="span" sx={{overflowWrap:'anywhere',minWidth:0}}>{label}</Box>
 </Box>;
}
