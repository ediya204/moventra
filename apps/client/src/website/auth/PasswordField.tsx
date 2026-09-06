import { useLocale } from '../../../../../packages/shared/src/website/i18n/index.tsx';
import { IconButton, InputAdornment } from '@mui/material';
import { useBoolean } from '../../minimals/hooks/use-boolean';
import RHFTextField from '../../minimals/components/hook-form/rhf-text-field';
import Iconify from '../../../../../packages/shared/src/minimals/components/iconify/iconify';
export function PasswordField({ name = 'password', label, autoComplete = 'current-password' }: {
    name?: string;
    label?: string;
    autoComplete?: string;
}) {
    const { t } = useLocale();
    const visible = useBoolean();
    return <RHFTextField name={name} label={label || t('密码')} autoComplete={autoComplete} type={visible.value ? 'text' : 'password'} InputProps={{ endAdornment: <InputAdornment position="end"><IconButton aria-label={visible.value ? t("隐藏密码") : t("显示密码")} onClick={visible.onToggle} edge="end"><Iconify icon={visible.value ? 'solar:eye-bold' : 'solar:eye-closed-bold'}/></IconButton></InputAdornment> }}/>;
}
