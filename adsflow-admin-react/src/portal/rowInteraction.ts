import type {MouseEvent,KeyboardEvent,SyntheticEvent} from 'react';

// Keep controls inside a row independent from the row's primary detail action.
export function ignoresRowAction(event:SyntheticEvent<HTMLElement>){
 const target=event.target as HTMLElement;
 if(event.defaultPrevented||target.closest?.('a,button,input,select,textarea,label,[role="button"],[role="checkbox"],[role="combobox"],[contenteditable="true"],[data-row-action-ignore]'))return true;
 const selection=typeof window==='undefined'?null:window.getSelection();
 return Boolean(selection?.toString()&&selection.anchorNode&&event.currentTarget.contains(selection.anchorNode));
}
export function detailRowProps(open:()=>void){
 return {
  tabIndex:0,
  sx:{cursor:'pointer','&:focus-visible':{outline:'2px solid',outlineColor:'primary.main',outlineOffset:-2}},
  onClick:(event:MouseEvent<HTMLElement>)=>{if(!event.ctrlKey&&!event.metaKey&&!event.altKey&&!event.shiftKey&&!ignoresRowAction(event))open();},
  onKeyDown:(event:KeyboardEvent<HTMLElement>)=>{if(['Enter',' '].includes(event.key)&&!event.repeat&&!event.ctrlKey&&!event.metaKey&&!event.altKey&&!event.shiftKey&&!ignoresRowAction(event)){event.preventDefault();open();}},
 };
}
