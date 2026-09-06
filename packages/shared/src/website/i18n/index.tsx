import { useSyncExternalStore } from 'react';
import { Button } from '@mui/material';
import english from './en.json';
import Iconify from '../../minimals/components/iconify/iconify';

export type Language = 'zh' | 'en';
const storageKey = 'moventra.website.language';
function initialLanguage(): Language {
  try { const saved = localStorage.getItem(storageKey); if (saved === 'zh' || saved === 'en') return saved; } catch { /* Storage is optional. */ }
  return navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}
let language = initialLanguage();
const listeners = new Set<() => void>();
function subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
function setLanguage(value: Language) {
  language = value;
  try { localStorage.setItem(storageKey, value); } catch { /* Keep switching available in private browsing. */ }
  document.documentElement.lang = value === 'zh' ? 'zh-CN' : 'en';
  listeners.forEach(listener => listener());
}
document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en';
window.addEventListener('storage', event => {
  if (event.key === storageKey && (event.newValue === 'zh' || event.newValue === 'en')) {
    language = event.newValue;
    document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en';
    listeners.forEach(listener => listener());
  }
});
export function translate(text: string, lang: Language): string { return lang === 'en' ? (english as Record<string, string>)[text] ?? text : text; }
export function useLocale() {
  const locale = useSyncExternalStore(subscribe, () => language);
  return { locale, setLanguage, t: (text: string) => translate(text, locale) };
}
export function LanguageSwitch() {
  const { locale } = useLocale();
  return <Button color="inherit" size="small" aria-label={locale === 'zh' ? 'Switch to English' : '切换到中文'} onClick={() => setLanguage(locale === 'zh' ? 'en' : 'zh')} startIcon={<Iconify icon="solar:global-linear" width={18} />} sx={{ flexShrink: 0, minWidth: 65 }}>{locale === 'zh' ? 'EN' : '中文'}</Button>;
}
