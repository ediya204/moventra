import type {ReactNode} from 'react';
import {Box} from '@mui/material';
import './finance-workspace.css';

/** Presentation scope only: never changes the app theme or financial permissions. */
export default function FinanceWorkspace({children,className=''}:{children:ReactNode;className?:string}) {
 return <Box className={`finance-workspace ${className}`}>{children}</Box>;
}
