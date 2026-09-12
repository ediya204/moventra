import LegalLinks from './legal/LegalLinks';
import { companyDetails } from './legal/policies';
import { useLocale, LanguageSwitch } from '../../../../packages/shared/src/website/i18n/index.tsx';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Accordion, AccordionDetails, AccordionSummary, Alert, Box, Button, Card, Container, Divider, Drawer, Grid, IconButton, Link, List, ListItemButton, ListItemText, MenuItem, Stack, Step, StepLabel, Stepper, Tab, Tabs, TextField, Typography, } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { PublicTheme } from '../../../../packages/shared/src/website/PublicTheme';
import Label from '../minimals/components/label/label';
import Iconify from '../../../../packages/shared/src/minimals/components/iconify/iconify';
import SeoIllustration from '../../../../packages/shared/src/minimals/assets/illustrations/seo-illustration';
import { BrandLogo } from '../../../../packages/shared/src/components/BrandLogo';
function ForwardIcon() { return <Iconify icon="eva:arrow-forward-fill" width={18}/>; }
export default function Website() {
    const { t, locale } = useLocale();
    const services = [
        { title: t("广告营销"), icon: 'solar:chart-2-bold-duotone', description: t("为出海品牌提供广告投放策略、素材优化与效果分析。"), items: [t("投放渠道与预算规划"), t("广告创意与落地页优化"), t("投放数据分析与复盘")] },
        { title: t("AI 订阅"), icon: 'solar:magic-stick-3-bold-duotone', description: t("根据个人和团队的工作场景，选择合适的 AI 工具与订阅方案。"), items: [t("AI 工具选型"), t("个人与团队订阅方案"), t("订阅周期与使用管理")] },
        { title: t("云服务"), icon: 'solar:cloud-bold-duotone', description: t("围绕业务规模和技术需求，提供部署与云资源配置服务。"), items: [t("应用与网站部署"), t("云资源配置与扩容规划"), t("运行监测与维护")] },
    ];
    const solutions = [
        { name: t("出海营销团队"), title: t("广告投放与内容生产"), description: t("适合需要开展海外投放、制作营销内容和部署落地页的团队。"), services: [t("广告营销"), t("AI 订阅"), t("云服务")], tasks: [[t("投放准备"), t("确认目标市场、渠道、预算与转化目标。")], [t("内容与页面"), t("配置内容工具，准备广告素材和落地页。")], [t("上线与复盘"), t("完成上线检查，根据投放反馈持续调整。")]] },
        { name: t("企业办公团队"), title: t("工具订阅与团队配置"), description: t("适合需要统一采购 AI 工具，提升内容、研究与日常协作效率的团队。"), services: [t("AI 订阅")], tasks: [[t("需求梳理"), t("整理岗位、使用人数和常用任务。")], [t("工具选型"), t("比较工具能力、订阅周期和团队权限。")], [t("使用配置"), t("按确认的方案配置服务和使用流程。")]] },
    ];
    const questions = [
        [t("可以单独购买一项服务吗？"), t("可以。三类服务均可单独咨询，也可以根据业务需求组合。具体服务内容和交付范围会在合作前确认。")],
        [t("服务如何收费？"), t("根据服务范围、订阅类型、预计用量和维护需求报价。确认方案时会列明费用与服务周期。")],
        [t("开始合作需要准备什么？"), t("提供业务需求、预计用量或团队人数、预算和目标时间即可。技术接入类需求还需说明现有系统和技术栈。")],
    ];
    const nav = [[t("产品与服务"), '#services'], [t("解决方案"), '#solutions'], [t("常见问题"), '#faq']];
    const sectionSx = { py: { xs: 7, md: 11 }, scrollMarginTop: 96 };
    const [mobile, setMobile] = useState(false);
    const [active, setActive] = useState(0);
    const [interest, setInterest] = useState(0);
    const [saved, setSaved] = useState(false);
    const [sending, setSending] = useState(false);
    const [sendError, setSendError] = useState(false);
    const submitting = useRef(false);
    const formRef = useRef<HTMLFormElement>(null);
    useEffect(() => {
      Array.from(formRef.current?.elements ?? []).forEach(field => {
        if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) field.setCustomValidity('');
      });
    }, [locale]);
    const solution = solutions[active];
    useEffect(() => { const previous = document.title; document.title = t("Moventra | 广告营销、AI 与云服务"); return () => { document.title = previous; }; }, [locale]);
    function choose(service: string) { setInterest(services.findIndex(item => item.title === service)); setSaved(false); document.getElementById('contact')?.scrollIntoView({ behavior: 'smooth' }); }
    async function submitInquiry(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (submitting.current) return;
        submitting.current = true;
        const form = event.currentTarget;
        const data = new FormData(form);
        setSending(true); setSaved(false); setSendError(false);
        try {
            const result = await fetch('/api/contact', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: data.get('name'), email: data.get('email'), description: data.get('description'), service: [0, 1, 3, 4][interest], website: data.get('website') }),
            });
            if (result.status !== 202 || (await result.json()).code !== 'accepted') throw new Error('submission_failed');
            setSaved(true); form.reset();
        } catch { setSendError(true); }
        finally { setSending(false); submitting.current = false; }
    }
    return <PublicTheme><Box sx={{ bgcolor: 'background.paper', color: 'text.primary' }}>
    <Link href="#main" sx={{ position: 'fixed', top: -100, zIndex: 1500, bgcolor: 'background.paper', p: 2, '&:focus': { top: 0 } }}>{t("跳至主要内容")}</Link>
    <Box component="header" sx={{ position: 'sticky', top: 0, zIndex: 1100, bgcolor: 'background.paper', borderBottom: 1, borderColor: 'divider' }}>
      <Container maxWidth="lg"><Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ height: { xs: 72, md: 88 } }}>
        <Link href="/" aria-label={t("Moventra 首页")}><Box sx={{ width: { xs: 128, sm: 170 } }}><BrandLogo width={170}/></Box></Link>
        <Stack component="nav" aria-label={t("主导航")} direction="row" spacing={4} alignItems="center" sx={{ display: { xs: 'none', md: 'flex' } }}>{nav.map(([label, href]) => <Link key={href} href={href} color="text.primary" variant="subtitle2">{label}</Link>)}</Stack>
        <Stack direction="row" spacing={{ xs: 0, md: 2 }} alignItems="center"><LanguageSwitch /><IconButton aria-label={t("打开菜单")} onClick={() => setMobile(true)} sx={{ display: { md: 'none' } }}><Iconify icon="solar:hamburger-menu-linear"/></IconButton></Stack>
      </Stack></Container>
    </Box>
    <Drawer anchor="right" open={mobile} onClose={() => setMobile(false)} PaperProps={{ sx: { width: 280 } }}><Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ p: 3 }}><BrandLogo width={165}/><IconButton aria-label={t("关闭菜单")} onClick={() => setMobile(false)}><Iconify icon="eva:close-fill"/></IconButton></Stack><Divider /><List sx={{ p: 2 }}>{nav.map(([label, href]) => <ListItemButton key={href} component="a" href={href} onClick={() => setMobile(false)}><ListItemText primary={label}/></ListItemButton>)}</List></Drawer>
    <Box component="main" id="main">
      <Container maxWidth="lg"><Grid container spacing={{ xs: 4, md: 8 }} alignItems="center" sx={{ pt: { xs: 7, md: 10 }, pb: { xs: 6, md: 10 } }}>
        <Grid item xs={12} md={6}><Stack spacing={3.5} alignItems="flex-start"><Typography variant="overline" color="text.secondary">{t("面向企业与开发团队")}</Typography><Typography component="h1" sx={{ fontSize: { xs: 36, sm: 44, md: 48 }, fontWeight: 800, lineHeight: 1.35 }}>{t("广告营销、AI 工具")}<br />{t("与")}<Box component="span" sx={{ color: 'primary.main' }}>{t("云服务")}</Box></Typography><Typography color="text.secondary" sx={{ maxWidth: 440, lineHeight: 1.8 }}>{t("提供广告投放、AI 订阅和云端部署服务。按你的业务需求，选择合适的方案。")}</Typography><Stack direction="row" spacing={2}><Button variant="contained" size="large" href="#services" endIcon={<ForwardIcon />}>{t("查看服务")}</Button><Button variant="outlined" color="inherit" size="large" href="#contact">{t("咨询方案")}</Button></Stack></Stack></Grid>
        <Grid item xs={12} md={6}><SeoIllustration aria-label={t("营销分析与应用服务插画")} role="img" sx={{ display: 'block', maxWidth: { xs: 360, md: 480 }, height: 'auto', mx: 'auto' }}/></Grid>
      </Grid></Container>
      <Divider />
      <Container component="section" id="services" maxWidth="lg" sx={sectionSx}>
        <Stack spacing={2} sx={{ mb: 5 }}><Typography variant="h3" component="h2">{t("产品与服务")}</Typography><Typography color="text.secondary">{t("可单独选择，也可根据项目需要组合。")}</Typography></Stack>
        <Grid container spacing={3}>{services.map((service, i) => <Grid item xs={12} sm={6} md={4} key={service.title}><Card sx={{ p: { xs: 3, md: 4 }, height: 1 }}><Stack direction="row" spacing={2.5} alignItems="flex-start"><Iconify icon={service.icon} width={40} sx={{ flexShrink: 0, color: ['primary.main', 'warning.dark', 'success.dark'][i] }}/><Box><Typography variant="h5" component="h3" sx={{ mb: 1 }}>{service.title}</Typography><Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.8 }}>{service.description}</Typography></Box></Stack><Stack spacing={1.2} sx={{ mt: 3, mb: 2 }}>{service.items.map(item => <Stack key={item} direction="row" spacing={1.5} alignItems="center"><Iconify icon="eva:checkmark-fill" width={17} color="text.disabled"/><Typography variant="body2">{item}</Typography></Stack>)}</Stack><Button onClick={() => choose(service.title)} color="inherit" endIcon={<ForwardIcon />} sx={{ ml: -1 }}>{t("了解方案")}</Button></Card></Grid>)}</Grid>
      </Container>
      <Box component="section" id="solutions" sx={{ ...sectionSx, bgcolor: 'background.default' }}><Container maxWidth="lg">
        <Typography variant="h3" component="h2" sx={{ mb: 2 }}>{t("按使用场景选择")}</Typography><Typography color="text.secondary" sx={{ mb: 4 }}>{t("从工作内容出发，确定所需的服务和实施范围。")}</Typography>
        <Tabs value={active} onChange={(_, value: number) => setActive(value)} variant="scrollable" scrollButtons="auto" aria-label={t("使用场景")} sx={{ borderBottom: 1, borderColor: 'divider', mb: 5 }}>{solutions.map((item, index) => <Tab key={item.name} label={item.name} id={`solution-tab-${index}`} aria-controls="solution-panel"/>)}</Tabs>
        <Grid container spacing={{ xs: 4, md: 8 }} id="solution-panel" role="tabpanel" aria-labelledby={`solution-tab-${active}`}><Grid item xs={12} md={5}><Stack spacing={2.5}><Typography variant="h4" component="h3">{solution.title}</Typography><Typography color="text.secondary" sx={{ lineHeight: 1.8 }}>{solution.description}</Typography><Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>{solution.services.map(item => <Label key={item} color="primary">{item}</Label>)}</Stack><Box><Button color="primary" onClick={() => choose(solution.services[0])} endIcon={<ForwardIcon />}>{t("咨询这项方案")}</Button></Box></Stack></Grid><Grid item xs={12} md={7}><Stack spacing={3}>{solution.tasks.map(([title, description], index) => <Stack direction="row" spacing={2.5} key={title}><Box sx={{ width: 32, height: 32, flexShrink: 0, borderRadius: '50%', bgcolor: theme => alpha(theme.palette.primary.main, 0.08), color: 'primary.main', display: 'grid', placeItems: 'center', typography: 'subtitle2' }}>{index + 1}</Box><Box><Typography variant="subtitle1" sx={{ mb: 0.5 }}>{title}</Typography><Typography variant="body2" color="text.secondary">{description}</Typography></Box></Stack>)}</Stack></Grid></Grid>
      </Container></Box>
      <Container component="section" id="process" maxWidth="lg" sx={sectionSx}><Typography variant="h3" component="h2" sx={{ mb: 5 }}>{t("合作流程")}</Typography><Stepper alternativeLabel sx={{ display: { xs: 'none', md: 'flex' } }}>{[t("沟通需求"), t("确认方案与报价"), t("配置与交付"), t("使用支持")].map(label => <Step key={label} active><StepLabel>{label}</StepLabel></Step>)}</Stepper><Stack spacing={2} sx={{ display: { md: 'none' } }}>{[t("沟通需求"), t("确认方案与报价"), t("配置与交付"), t("使用支持")].map((label, i) => <Stack key={label} direction="row" spacing={2} alignItems="center"><Label>{i + 1}</Label><Typography variant="body2">{label}</Typography></Stack>)}</Stack></Container>
      <Divider />
      <Container component="section" id="faq" maxWidth="md" sx={sectionSx}><Typography variant="h3" component="h2" textAlign="center" sx={{ mb: 5 }}>{t("常见问题")}</Typography>{questions.map(([question, answer]) => <Accordion key={question} disableGutters elevation={0} sx={{ borderBottom: 1, borderColor: 'divider', '&:before': { display: 'none' }, '&.Mui-expanded': { bgcolor: 'background.default', borderRadius: 1 } }}><AccordionSummary expandIcon={<Iconify icon="eva:arrow-ios-downward-fill"/>} sx={{ minHeight: 72 }}><Typography variant="subtitle1" component="h3">{question}</Typography></AccordionSummary><AccordionDetails><Typography color="text.secondary" variant="body2" sx={{ lineHeight: 1.9 }}>{answer}</Typography></AccordionDetails></Accordion>)}</Container>
      <Box component="section" id="contact" sx={{ ...sectionSx, bgcolor: 'background.default' }}><Container maxWidth="lg"><Grid container spacing={{ xs: 4, md: 10 }}><Grid item xs={12} md={5}><Typography variant="h3" component="h2" sx={{ mb: 2 }}>{t("咨询服务方案")}</Typography><Typography color="text.secondary" sx={{ lineHeight: 1.8 }}>{t("整理你的业务需求、使用规模和预期时间，便于确认服务范围。")}</Typography></Grid><Grid item xs={12} md={7}><Card component="form" ref={formRef} onInvalid={(event) => { const field = event.target as HTMLInputElement; field.setCustomValidity(field.validity.valueMissing ? t('请填写此字段') : t('请输入有效的邮箱地址')); }} onInput={(event) => { (event.target as HTMLInputElement).setCustomValidity?.(''); }} onSubmit={submitInquiry} sx={{ p: { xs: 3, md: 4 } }}><Stack component="fieldset" disabled={sending} spacing={3} sx={{ border: 0, p: 0, m: 0, minWidth: 0 }}><Box aria-hidden="true" sx={{ display: 'none' }}><input name="website" tabIndex={-1} autoComplete="off" /></Box><Typography variant="h6" component="h3">{t("服务需求")}</Typography><Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}><TextField required fullWidth label={t("姓名")} name="name" autoComplete="name" inputProps={{ maxLength: 80 }}/><TextField required fullWidth label={t("工作邮箱")} name="email" type="email" autoComplete="email" inputProps={{ maxLength: 180 }}/></Stack><TextField select label={t("意向服务")} value={interest} onChange={event => { setInterest(Number(event.target.value)); setSaved(false); }}>{[...services.map(item => item.title), t("组合方案")].map((item, index) => <MenuItem key={index} value={index}>{item}</MenuItem>)}</TextField><TextField required multiline minRows={3} label={t("需求描述")} name="description" inputProps={{ maxLength: 3000 }} placeholder={t("请说明使用场景、人数或用量，以及计划开始的时间。")}/><Box><Button type="submit" disabled={sending} variant="contained" size="large" endIcon={<ForwardIcon />}>{locale === 'zh' ? (sending ? '提交中…' : '提交留言') : (sending ? 'Submitting…' : 'Send inquiry')}</Button></Box><Typography variant="caption" color="text.secondary">{locale === 'zh' ? '提交后，您的姓名、邮箱和需求将发送至 info@moventra.me，用于回复本次咨询。详情见' : 'Your name, email and requirements will be sent to info@moventra.me to respond to this inquiry. See our '}<Link href="/privacy-policy">{locale === 'zh' ? '隐私政策' : 'Privacy Policy'}</Link>。</Typography>{sendError && <Alert severity="error">{locale === 'zh' ? '暂时无法确认提交，请稍后再试，或直接发送邮件至 info@moventra.me。您填写的内容已保留。' : 'We could not confirm submission. Please try again later or email info@moventra.me directly. Your input has been kept.'}</Alert>}{saved && <Alert severity="success">{locale === 'zh' ? '留言已提交。我们会通过您填写的邮箱回复。' : 'Inquiry submitted. We will reply to the email address you provided.'}</Alert>}</Stack></Card></Grid></Grid></Container></Box>
    </Box>
    <Container component="footer" maxWidth="lg" sx={{ pt: 7, pb: 3 }}><Grid container spacing={4} sx={{ mb: 6 }}><Grid item xs={12} md={6}><BrandLogo width={170}/><Typography variant="body2" color="text.secondary" sx={{ mt: 2, maxWidth: 280 }}>{t("广告营销、AI 订阅与云服务。")}</Typography>
      <Stack component="address" spacing={1.5} sx={{ mt: 2.5, maxWidth: 320, fontStyle: 'normal' }}>
        <Stack direction="row" spacing={1.25} alignItems="flex-start">
          <Iconify icon="solar:map-point-linear" width={18} sx={{ mt: 0.4, flexShrink: 0, color: 'text.secondary' }}/>
          <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.7 }}>{companyDetails.principalAndMailingAddress}</Typography>
        </Stack>
        <Stack direction="row" spacing={1.25} alignItems="center">
          <Iconify icon="solar:letter-linear" width={18} sx={{ flexShrink: 0, color: 'text.secondary' }}/>
          <Link href={`mailto:${companyDetails.contactEmail}`} variant="body2" color="text.secondary" underline="hover">{companyDetails.contactEmail}</Link>
        </Stack>
      </Stack></Grid><Grid item xs={6} md={3}><Stack spacing={1.5}><Typography variant="subtitle2">{t("服务")}</Typography>{services.map(item => <Link key={item.title} component="button" onClick={() => choose(item.title)} variant="body2" color="text.secondary" sx={{ textAlign: 'left' }}>{item.title}</Link>)}</Stack></Grid><Grid item xs={6} md={3}><Stack spacing={1.5}>{[[t("常见问题"), '#faq']].map(([label, href]) => <Link key={href} href={href} variant="body2" color="text.secondary">{label}</Link>)}</Stack></Grid></Grid><Divider /><LegalLinks /></Container>
  </Box></PublicTheme>;
}
