import { Container } from '@mui/material';
import { Outlet } from 'react-router-dom';
import { PublicTheme } from '../../../../../packages/shared/src/website/PublicTheme';
import LegalLinks from './LegalLinks';

export default function LegalAccountLayout() {
  return <><Outlet /><PublicTheme><Container component="footer" maxWidth="lg"><LegalLinks /></Container></PublicTheme></>;
}
