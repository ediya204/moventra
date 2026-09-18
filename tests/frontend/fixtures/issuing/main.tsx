// Standalone local test entry; never imported by either production app.
import { createRoot } from 'react-dom/client';
import { BrowserRouter,useLocation } from 'react-router-dom';
import { CssBaseline, ThemeProvider, Container } from '@mui/material';
import theme from '../../../../packages/shared/src/theme';
import CardIssuing from '../../../../apps/client/src/issuing/CardIssuing';
import BinCatalogPage from '../../../../apps/admin/src/operations/BinCatalogPage';
import CardSnapshots from '../../../../apps/client/src/portal/CardSnapshots';
function ClientFixture(){const {pathname}=useLocation();return /^\/portal\/cards\/(?!new$)/.test(pathname)||pathname==='/portal/cards'?<CardSnapshots customerId="10000000-0000-0000-0000-000000000001"/>:<CardIssuing customerId="10000000-0000-0000-0000-000000000001" uid="alice"/>}
const admin = location.pathname.startsWith('/card-bins');
createRoot(document.getElementById('root')!).render(<ThemeProvider theme={theme}><CssBaseline/><BrowserRouter>{admin ? <BinCatalogPage/> : <Container sx={{py:4}}><ClientFixture/></Container>}</BrowserRouter></ThemeProvider>);
