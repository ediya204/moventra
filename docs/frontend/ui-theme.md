# 界面主题与组件约定

客户端和运营后台共用 `src/theme.ts` 中的 MUI 主题。

- 主色：微软蓝 `#0078D4`，深色 `#005A9E`，浅色背景 `#EFF6FC`。
- 蓝色用于主操作、链接、导航选中态、标签页、复选框和键盘焦点。成功、警告、错误继续使用语义状态色。
- 保留 Public Sans 字体，通过 MUI Typography variant 控制字号和字重。
- 优先复用现有 PageHeader、FiltersCard、DataTableCard、StatusChip 等组件；业务表格需要自定义列或路由交互时使用 MUI Table、TablePagination、TableSortLabel。
- 导航使用 ListItemButton，内容面板使用 Paper variant="outlined" 或 Card，表单使用 TextField、Select、Checkbox，分栏使用 Tabs。
- 颜色使用 primary.main、primary.dark、text.secondary、divider 等主题 token；避免在页面写固定品牌色。
- 通用圆角、边框、表头、悬停、焦点和表单样式在主题 components 中维护；页面 sx 仅补充布局和业务需要的样式。

当前项目已有 MUI 与 Minimals 风格公共组件，没有引入新的 UI 库或商业模板。

## 组件选型优先级

用户指定的组件目录：https://minimals.cc/components 。后续页面优先采用该目录展示的组件与交互模式，并统一使用本项目微软蓝主题。

1. 优先复用仓库中已有的公共组件。
2. 使用已安装的 MUI / MUI X Community 组件完成表格、筛选、分页、标签页、表单和反馈。
3. 按业务需要引入 Minimals Extra 对应组件或依赖，例如表单向导、上传、图表和 Snackbar；避免一次性引入整个目录。

官网展示目录不代表当前仓库已包含全部组件源码。Minimals 自定义组件接入时需先确认本地源码和依赖；缺少源码时，优先使用 MUI 实现相同交互，并如实标明来源。

## 工作台与资金中心图表

- 使用已安装的 ApexCharts + react-apexcharts，按需加载，并由 MUI 主题提供配色和字体。
- 消费与退款趋势来自 `state.entries`，仅统计已完成 USD 消费及退款，按整数分累加；失败交易、卡片充值与 USDT 记录不混入。
- 7 / 30 天窗口截止于当前演示记录的最新日期，日历日期保持来源值；无记录日按 0 显示，界面明确该范围不等于完整账单。
- USD 组成包含账户可用、卡片余额、子账户独立余额、账户冻结 / 预占、卡片转回在途。USDT 仅包含可用与冻结 / 预占。待入账充值不计入，币种之间不汇总。
- 卡片状态环图按张数统计。环图下方列示金额 / 张数与百分比，趋势图提供可展开的数据表。无有效数据时显示空状态。
