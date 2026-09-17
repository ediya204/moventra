import { useEffect } from 'react';
import { useLocale } from '../../../../packages/shared/src/website/i18n/index';
import { websiteSeo, websiteStructuredData, websiteUrl } from './seo';

// Also reset metadata on SPA navigation; private routes must not inherit the homepage canonical.
export function useWebsiteSeo(pathname: string) {
  const { locale } = useLocale();
  useEffect(() => {
    const home = pathname === '/';
    const publicHost = ['moventra.me', 'www.moventra.me'].includes(window.location.hostname);
    const copy = websiteSeo[locale];
    document.head.querySelectorAll('[data-website-seo]').forEach(node => node.remove());
    let robots = document.head.querySelector<HTMLMetaElement>('meta[name="robots"]');
    if (!robots) { robots = document.createElement('meta'); robots.name = 'robots'; document.head.append(robots); }
    robots.content = home && publicHost ? 'index,follow,max-image-preview:large' : 'noindex,nofollow';
    if (!home) { document.title = 'Moventra 客户端'; return; }
    document.title = copy.title;
    const meta = (name: string, content: string, property = false) => {
      const node = document.createElement('meta');
      node.setAttribute(property ? 'property' : 'name', name);
      node.content = content; node.dataset.websiteSeo = ''; document.head.append(node);
    };
    meta('description', copy.description);
    meta('og:title', copy.title, true); meta('og:description', copy.description, true);
    meta('og:url', websiteUrl, true); meta('og:type', 'website', true); meta('og:site_name', 'Moventra', true);
    meta('og:locale', locale === 'zh' ? 'zh_CN' : 'en_US', true);
    meta('twitter:card', 'summary'); meta('twitter:title', copy.title); meta('twitter:description', copy.description);
    const canonical = document.createElement('link');
    canonical.rel = 'canonical'; canonical.href = websiteUrl; canonical.dataset.websiteSeo = ''; document.head.append(canonical);
    const schema = document.createElement('script');
    schema.type = 'application/ld+json'; schema.dataset.websiteSeo = '';
    schema.textContent = JSON.stringify(websiteStructuredData); document.head.append(schema);
  }, [pathname, locale]);
}
