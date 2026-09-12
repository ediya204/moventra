import { productionNavigation, isProductionPath } from '../operations/navigation';
import {
  navigationGroups as getNavigationGroups,
  primaryNavigation,
  activeNavigation,
} from "../admin/navigation";
import { BrandLogo } from "../../../../packages/shared/src/components/BrandLogo";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Icon } from "@iconify/react";
import {
  AppBar,
  Avatar,
  Box,
  Chip,
  Container,
  Divider,
  Drawer,
  IconButton,
  InputAdornment,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Stack,
  TextField,
  Toolbar,
  Tooltip,
  Typography,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import {
  Link as RouterLink,
  Outlet,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { useAuth } from "../../../../packages/shared/src/auth/AuthContext";
import {
  dataSourceLabel,
  isDemoMode,
  isSlashDemoMode,
} from "../../../../packages/shared/src/utils/dataMode";

const NAV_WIDTH = 280;

const navigationGroups = getNavigationGroups(isSlashDemoMode);
const allItems = [
  ...primaryNavigation,
  ...navigationGroups.flatMap((g) => g.items),
];

function Brand() {
  return (
    <Stack
      direction="row"
      alignItems="center"
      gap={1.3}
      sx={{ px: 3, height: 80 }}
    >
      <Box>
        <BrandLogo width={190} />
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ display: "block", mt: 0.5 }}
        >
          ADMIN CONSOLE
        </Typography>
      </Box>
    </Stack>
  );
}

function Navigation({ onNavigate, production = false }: { onNavigate?: () => void; production?: boolean }) {
  const navigationGroups = production ? productionNavigation : getNavigationGroups(isSlashDemoMode);
  const primaryItems = production ? primaryNavigation.map(item => item.path === '/approvals' ? { ...item, label: '开户审批', path: '/onboarding' } : item) : primaryNavigation;
  const allItems = [...primaryItems, ...navigationGroups.flatMap(g => g.items)];
  const location = useLocation();
  const livePage = isSlashDemoMode && (["/cards", "/transactions"].includes(location.pathname) || (/^\/cards\/[^/]+$/.test(location.pathname) && new URLSearchParams(location.search).get("source")==="slash")) && new URLSearchParams(location.search).get("source") !== "demo";
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  useEffect(() => {
    const active = activeNavigation(location.pathname, allItems);
    const group = navigationGroups.find((g) =>
      g.items.some((i) => i.path === active),
    );
    if (group) setExpanded((prev) => ({ ...prev, [group.label]: true }));
  }, [location.pathname]);

  const activePath = activeNavigation(location.pathname, allItems);
  const isItemActive = (path: string) => activePath === path;

  return (
    <>
      <Brand />
      <Box sx={{ px: 2 }}>
        <Typography variant="overline" color="text.disabled" sx={{ px: 2 }}>
          管理空间
        </Typography>
        <List sx={{ mt: 1, pb: 0 }}>
          {primaryItems.map((item) => {
            const active = isItemActive(item.path);
            return (
              <ListItemButton
                key={item.path}
                component={RouterLink}
                to={production && !isProductionPath(item.path) ? "#" : item.path}
                disabled={production && !isProductionPath(item.path)}
                aria-disabled={production && !isProductionPath(item.path)}
                title={production && !isProductionPath(item.path) ? "正式服务尚未接入" : undefined}
                selected={active}
                onClick={event => { if (production && !isProductionPath(item.path)) { event.preventDefault(); return; } onNavigate?.(); }}
                sx={{
                  minHeight: 48,
                  mb: 0.5,
                  px: 2,
                  borderRadius: 1.5,
                  color: active ? "primary.dark" : "text.secondary",
                  "&.Mui-selected": {
                    bgcolor: "primary.lighter",
                    color: "primary.darker",
                    "&:hover": { bgcolor: "primary.lighter" },
                  },
                }}
              >
                <ListItemIcon sx={{ minWidth: 38, color: "inherit" }}>
                  <Icon icon={item.icon} width={24} />
                </ListItemIcon>
                <ListItemText
                  primary={production && !isProductionPath(item.path) ? `${item.label} · 未接入` : item.label}
                  primaryTypographyProps={{
                    variant: "body2",
                    fontWeight: active ? 700 : 600,
                  }}
                />
              </ListItemButton>
            );
          })}
        </List>
        <Typography
          variant="overline"
          color="text.disabled"
          sx={{ px: 2, mt: 2, display: "block" }}
        >
          业务与系统
        </Typography>
        <List sx={{ mt: 0.5 }}>
          {navigationGroups.map((group) => {
            const groupActive = group.items.some((item) =>
              isItemActive(item.path),
            );
            const open = expanded[group.label] ?? groupActive;
            return (
              <Box key={group.label} sx={{ mb: 0.5 }}>
                <ListItemButton
                  aria-expanded={open}
                  onClick={() =>
                    setExpanded((value) => ({ ...value, [group.label]: !open }))
                  }
                  sx={{
                    minHeight: 44,
                    px: 2,
                    borderRadius: 1.5,
                    color: groupActive ? "text.primary" : "text.secondary",
                  }}
                >
                  <ListItemIcon
                    sx={{
                      minWidth: 38,
                      color: groupActive ? "primary.main" : "inherit",
                    }}
                  >
                    <Icon icon={group.icon} width={23} />
                  </ListItemIcon>
                  <ListItemText
                    primary={group.label}
                    primaryTypographyProps={{
                      variant: "body2",
                      fontWeight: 700,
                    }}
                  />
                  <Icon
                    icon={
                      open
                        ? "solar:alt-arrow-up-linear"
                        : "solar:alt-arrow-down-linear"
                    }
                    width={18}
                  />
                </ListItemButton>
                {open ? (
                  <List disablePadding>
                    {group.items.map((item) => {
                      const active = isItemActive(item.path);
                      return (
                        <ListItemButton
                          key={item.path}
                          component={RouterLink}
                          to={production && !isProductionPath(item.path) ? "#" : item.path}
                disabled={production && !isProductionPath(item.path)}
                aria-disabled={production && !isProductionPath(item.path)}
                title={production && !isProductionPath(item.path) ? "正式服务尚未接入" : undefined}
                          selected={active}
                          onClick={event => { if (production && !isProductionPath(item.path)) { event.preventDefault(); return; } onNavigate?.(); }}
                          sx={{
                            minHeight: 40,
                            ml: 1.5,
                            pl: 2.2,
                            borderRadius: 1.5,
                            color: active ? "primary.darker" : "text.secondary",
                            "&.Mui-selected": {
                              bgcolor: "primary.lighter",
                              "&:hover": { bgcolor: "primary.lighter" },
                            },
                          }}
                        >
                          <ListItemIcon sx={{ minWidth: 32, color: "inherit" }}>
                            <Icon icon={item.icon} width={19} />
                          </ListItemIcon>
                          <ListItemText
                            primary={production && !isProductionPath(item.path) ? `${item.label} · 未接入` : item.label}
                            primaryTypographyProps={{
                              variant: "body2",
                              fontWeight: active ? 700 : 500,
                            }}
                          />
                        </ListItemButton>
                      );
                    })}
                  </List>
                ) : null}
              </Box>
            );
          })}
        </List>
      </Box>
      <Box sx={{ mt: "auto", p: 2.5 }}>
        <Box sx={{ borderRadius: 2, bgcolor: "grey.100", p: 2 }}>
          <Stack direction="row" alignItems="center" gap={1}>
            <Box sx={{ color: "primary.main", display: "flex" }}>
              <Icon icon="solar:eye-bold-duotone" width={22} />
            </Box>
            <Typography variant="subtitle2">
              {production ? "正式运营环境" : livePage ? "真实渠道 · 本地只读" : isDemoMode ? "隔离演示环境" : "业务只读 · 管理本地"}
            </Typography>
          </Stack>
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ display: "block", mt: 0.8 }}
          >
            {production ? "仅展示已授权的正式数据；未接入功能不开放操作。" : livePage ? "此页显示已导入的 Slash 真实数据，更新状态见页面；其他演示模块独立。" : isDemoMode
              ? "使用独立本地 Demo 数据，不连接线上写接口。"
              : "现有业务读取线上数据；新增管理操作保存到本地 Demo。"}
          </Typography>
        </Box>
        {!production && <Typography
          component="a"
          href="http://localhost:8848/#/welcome"
          target="_blank"
          rel="noreferrer"
          variant="caption"
          color="text.secondary"
          sx={{
            display: "inline-flex",
            alignItems: "center",
            gap: 0.7,
            mt: 2,
            px: 0.5,
          }}
        >
          <Icon icon="solar:arrow-right-up-linear" width={16} />
          前往旧后台处理写操作
        </Typography>}
      </Box>
    </>
  );
}

export function DashboardLayout({ production = false, children }: { production?: boolean; children?: ReactNode }) {
  const liveLocation=useLocation();
  const livePage=isSlashDemoMode && (["/cards","/transactions"].includes(liveLocation.pathname)||(/^\/cards\/[^/]+$/.test(liveLocation.pathname)&&new URLSearchParams(liveLocation.search).get("source")==="slash"))&&new URLSearchParams(liveLocation.search).get("source")!=="demo";
  const theme = useTheme();
  const desktop = useMediaQuery(theme.breakpoints.up("lg"));
  const [mobileOpen, setMobileOpen] = useState(false);
  const [search, setSearch] = useState("");
  const navigate = useNavigate();
  const { profile, user, signOut } = useAuth();

  const initials = useMemo(
    () =>
      String(profile?.nickname || profile?.username || user?.email || "A")
        .slice(0, 2)
        .toUpperCase(),
    [profile],
  );

  const onGlobalSearch = (event: React.FormEvent) => {
    event.preventDefault();
    const keyword = search.trim();
    if (!keyword) return;
    if (production) { navigate(`/transactions?keyword=${encodeURIComponent(keyword.replace(/^(tx|trade):/i, "").trim())}`); return; }
    if (/^(user|用户):/i.test(keyword)) {
      navigate(
        `/user-groups/users?keyword=${encodeURIComponent(keyword.replace(/^(user|用户):/i, "").trim())}`,
      );
    } else if (/^(order|订单):/i.test(keyword)) {
      navigate(
        `/finance/orders?keyword=${encodeURIComponent(keyword.replace(/^(order|订单):/i, "").trim())}`,
      );
    } else if (keyword.includes("@")) {
      navigate(`/user-groups/users?keyword=${encodeURIComponent(keyword)}`);
    } else if (/^(tx|trade):/i.test(keyword)) {
      navigate(
        `/transactions?keyword=${encodeURIComponent(keyword.replace(/^(tx|trade):/i, "").trim())}`,
      );
    } else {
      navigate(`/cards?keyword=${encodeURIComponent(keyword)}`);
    }
  };

  return (
    <Box sx={{ minHeight: "100vh", display: "flex" }}>
      <Box
        component="nav"
        aria-label="主导航"
        sx={{ width: { lg: NAV_WIDTH }, flexShrink: { lg: 0 } }}
      >
        {desktop ? (
          <Drawer
            variant="permanent"
            open
            PaperProps={{
              sx: {
                width: NAV_WIDTH,
                borderRight: "1px solid",
                borderColor: "divider",
                display: "flex",
              },
            }}
          >
            <Navigation production={production} />
          </Drawer>
        ) : (
          <Drawer
            open={mobileOpen}
            onClose={() => setMobileOpen(false)}
            ModalProps={{ keepMounted: true }}
            PaperProps={{ sx: { width: NAV_WIDTH, display: "flex" } }}
          >
            <Navigation production={production} onNavigate={() => setMobileOpen(false)} />
          </Drawer>
        )}
      </Box>

      <Box sx={{ flex: 1, minWidth: 0 }}>
        <AppBar
          elevation={0}
          color="transparent"
          position="sticky"
          sx={{
            bgcolor: "background.default",
            borderBottom: 1,
            borderColor: "divider",
          }}
        >
          <Toolbar sx={{ minHeight: { xs: 72, md: 80 }, px: { xs: 2, md: 4 } }}>
            {!desktop ? (
              <IconButton
                onClick={() => setMobileOpen(true)}
                sx={{ mr: 1 }}
                aria-label="打开导航"
              >
                <Icon icon="solar:hamburger-menu-linear" width={24} />
              </IconButton>
            ) : null}
            <TextField
              component="form"
              onSubmit={onGlobalSearch}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={production ? "搜索商户、卡片尾号或交易 ID" : "邮箱、卡号，tx:交易 / order:订单"}
              aria-label="全局搜索"
              sx={{ width: { xs: "100%", sm: 390 } }}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <Icon icon="solar:magnifer-linear" width={21} />
                  </InputAdornment>
                ),
              }}
            />
            <Box sx={{ flex: 1 }} />
            <Chip
              icon={<Icon icon="solar:eye-bold" width={16} />}
              label={production ? "正式运营数据" : livePage ? "Slash 真实数据 / 本地只读" : dataSourceLabel}
              color="success"
              variant="outlined"
              sx={{ display: { xs: "none", sm: "inline-flex" }, mr: 2 }}
            />
            <Divider orientation="vertical" flexItem sx={{ my: 2, mr: 2 }} />
            <Stack direction="row" alignItems="center" gap={1.2}>
              <Box
                sx={{
                  display: { xs: "none", sm: "block" },
                  textAlign: "right",
                }}
              >
                <Typography variant="subtitle2">
                  {profile?.nickname || profile?.username || user?.email}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  后台访问会话
                </Typography>
              </Box>
              <Tooltip title="退出当前会话">
                <IconButton
                  onClick={signOut}
                  aria-label="退出登录"
                  sx={{ p: 0.5 }}
                >
                  <Avatar
                    sx={{
                      width: 40,
                      height: 40,
                      bgcolor: "primary.main",
                      fontSize: 14,
                    }}
                  >
                    {initials}
                  </Avatar>
                </IconButton>
              </Tooltip>
            </Stack>
          </Toolbar>
        </AppBar>

        <Container
          id="main-content"
          component="main"
          maxWidth="xl"
          sx={{ py: { xs: 3, md: 5 }, px: { xs: 2, sm: 3, md: 4 } }}
        >
          {children ?? <Outlet />}
        </Container>
      </Box>
    </Box>
  );
}
