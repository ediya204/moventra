import {useEffect,useState} from 'react';
import {Alert,Button} from '@mui/material';

// Compare only Vite's entry script. Never reload a payment form automatically.
export default function VersionNotice({embedded=false}:{embedded?:boolean}={}){
 const [available,setAvailable]=useState(false);
 useEffect(()=>{
  const current=document.querySelector<HTMLScriptElement>('script[type="module"][src]')?.src;
  if(!current||!new URL(current).pathname.startsWith('/assets/'))return;
  let active=true,running=false;
  const controller=new AbortController();
  const check=async()=>{
   if(running||document.hidden)return;
   running=true;
   try{
    const response=await fetch('/',{cache:'no-store',signal:controller.signal});
    if(!response.ok||!response.headers.get('content-type')?.includes('text/html'))return;
    const html=new DOMParser().parseFromString(await response.text(),'text/html');
    const src=html.querySelector('script[type="module"][src]')?.getAttribute('src');
    if(!src)return;
    const next=new URL(src,window.location.origin);
    if(active&&next.origin===window.location.origin&&next.pathname.startsWith('/assets/')&&next.href!==current)setAvailable(true);
   }catch{/* A failed update check must not block authenticated business requests. */}
   finally{running=false}
  };
  void check();const timer=setInterval(()=>void check(),60000);
  document.addEventListener('visibilitychange',check);
  return()=>{active=false;controller.abort();clearInterval(timer);document.removeEventListener('visibilitychange',check)};
 },[]);
 return available?<Alert severity="info" sx={embedded?{}:{position:'sticky',top:0,zIndex:1500}} action={<Button onClick={()=>window.location.reload()}>更新页面</Button>}>有新版本可用。请先完成或保存当前操作，再更新页面。</Alert>:null;
}
