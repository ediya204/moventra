export const isSlashDemoMode = import.meta.env.VITE_DATA_MODE === 'slash-demo';
export const isDemoMode = import.meta.env.VITE_DATA_MODE === 'demo' || isSlashDemoMode;
export const dataSourceLabel = isSlashDemoMode ? 'Slash Demo / 模拟数据' : isDemoMode ? '本地 Demo 脱敏快照' : '线上只读 API';
