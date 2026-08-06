# Changelog

更新日志只追加、不修改：每个已验收的开发周期在文件末尾新增一条记录；已有条目一律不改写、不删除（如需更正，以新条目形式补充说明）。

## 2026-08-05 — Canvas UX fixes

- 新组件现在添加到画布当前视野的中央，而不是固定坐标；平移/缩放后添加同样生效。
- 新增“多选”模式开关：平板/触屏用户可点选多个组件后再“组合”；桌面端 Shift/Ctrl/Meta + 点击多选保持不变，Backspace 批量删除不受影响。
- 出错时只标红可定位的出错组件：校验/运行时错误按契约给出的节点定位；缺数据集、无边等图级错误不再把全部组件标红，只显示错误信息。
- 修复仓库内 7 处换行/断词损坏（`scripts/check-core.mjs`、`src/core/project.js`、`src/main.jsx`），恢复 `npm run check`、数据对话框“使用”按钮和两处样式。
- 删除误提交的 `tmp_branch_marker.txt`；统一 `src/core/compiler.js` 与 `docs/architecture/compiler-ir.md` 的换行为 LF。
- 检查脚本兼容 Windows（`python3`/`python` 回退）；`browserExecutionContract.js` 为可归因的校验失败补充具体节点归属。
- 验收：`npm run check`、`npm run build`、`git diff --check` 全部通过；Chrome 浏览器实测 15/15 通过。

## 2026-08-05 — 教学增强：画布适配、示例数据集、教学示例与路线图

- 修复首屏画布错位：样式异步加载会让 React Flow 用错误的容器尺寸适配；现在通过 ResizeObserver + 手动视口计算做“稳定重适配”，首次加载与加载示例后图形都完整落在画布内。
- 示例数据集提升到界面：数据对话框新增 6 个内置数据集（考试成绩、花卉品种、鸢尾花、红酒品质、能源负荷、垃圾邮件），带中英文文案。
- 新增 8 个教学示例项目（`examples/`）：房价预测、鸢尾花 KNN 分类、垃圾邮件 MLP 分类可在浏览器运行；能源负荷（自定义损失 + AdamW）、糖尿病风险（残差 MLP）、猫狗 CNN、电影推荐（Embedding）、情感分析（LSTM）可导出 PyTorch/TensorFlow 代码。
- 新增“示例”画廊：顶部导航可打开，卡片展示任务、组件覆盖与可运行/导出徽标，一键加载到画布。
- 新增 `docs/roadmap.md`：列出向量搜索、LLM 聊天机器人、AI Agent 规划等未实现任务与基础设施规划，README 增加入口。
- `npm run check` 新增示例验证：8 个示例逐个加载校验、可运行示例真实执行、可导出示例的双框架代码经 Python 语法校验。
- 验收：`npm run check`、`npm run build`、`git diff --check` 全部通过；浏览器实测 9/9 通过。

## 2026-08-05 — 示例项目布局优化

- 重新排布 8 个教学示例的画布布局：训练器示例采用分层排布（模型链在上、数据 → 训练器在中、损失/优化器在下、评估/预测右侧分叉）；线性回归与 KNN 采用直线链 + 分叉；电影推荐示例改为双嵌入分支汇入拼接头。
- 按真实渲染尺寸（宽 416px、最高 520px）校准节点间距，浏览器实测 8 个示例节点零重叠、连线正交不交叉。
- 验收：`npm run check`、`npm run build`、`git diff --check` 全部通过；浏览器实测 8/8 通过。

## 2026-08-05 — 示例数据合理性修复

- 用符合业务语义的数学模型重写示例数据：垃圾邮件数据集的 `word_count`（50-259）与 `link_count`（0-7）改为非负整数，且两类样本在词数与链接数上真实可分；能源负荷数据集的湿度改为 35-90%、温度 -5~32.5°C，负荷按“制冷/制热 U 型曲线”建模，不再出现负数或越界值。
- 示例生成器新增数据合理性断言（数值列必须有限），并输出可运行示例的指标（准确率 / R²）作为验收证据。
- 验收：`npm run check`、`npm run build`、`git diff --check` 全部通过；spam 示例准确率 1.0、房价回归 R² 0.998。

## 2026-08-06 — 可扩展 Playground 框架与 Agent 化（v1）

- 新增通用 Playground 框架：注册表（`src/core/playgrounds/registry.js`）、统一会话 reducer（`session.js`）、语义快照与引导场景；UI 与页面内 Agent 使用同一套 JSON action。
- 新增 Linear Regression Playground v2：权重/偏置/学习率/训练步数控制、残差与最优拟合参考、梯度下降时间线、点编辑（添加/拖动/双击删除）、intro 场景；复用了既有 sampling/MSE/最小二乘数学并新增梯度与训练历史纯函数。
- 新增 KNN Classification Playground：二维特征投影、查询点、按距离逐邻居揭示、投票与平票裁决、决策区域网格（48×48、缓存、与查询点拖动解耦）、归一化开关、intro 场景。
- 抽取共享 KNN 数学 `src/core/knnMath.js`，browser runtime 与 Playground 共用同一套归一化/距离/排序/投票/预测逻辑（平方欧氏距离、tie-break 语义保持不变）。
- Tutorial 集成改为注册表查询（`playgroundsFor`），删除 `manifest.op === 'linear_regression'` 硬编码分支；旧 `LinearRegressionPlayground.jsx` 已删除。
- 新增可选 `canvas.playground` Agent namespace（v1）：list/open/getState/dispatch/play/pause/step/seek/reset/runScenario/refreshSource/close/subscribe，含 source 快照与 stale 标记、完整错误码、JSON-safe details；Canvas API 版本保持 1。
- 新增 `docs/architecture/playgrounds.md`，更新 `overview.md` 与 `agent-canvas-api.md`。
- 验收：`npm run check`（新增 registry/session/数学/Agent 契约断言）、`npm run build`、`git diff --check` 全部通过；浏览器端到端实测 12/12 通过。
