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

## 2026-08-06 — 教学示例与数据匹配度改造

- 示例体系分为 Concept / Applied / Architecture Sketch 三种角色，画廊显示角色徽标，架构示意示例明确标注“仅展示架构与代码导出”。
- 新增确定性教学数据模块 `src/core/teachingDatasets.js`（seeded PRNG、特征先生成后采样标签、数据集 ID 唯一）；示例专用数据不再写在生成脚本中。
- 新增/重做示例：Linear Trend（概念）、KNN Neighborhood 双月数据（概念）、XOR MLP（概念，线性边界无法解决）、Spam（10 特征交互、单特征不可解）、Energy（非线性 U 型曲线 + Tanh MLP，线性基线差距 ≥0.12）、Peak Demand Custom Loss（导出）、Diabetes（350+ 行、先特征后标签）、Iris（versicolor/virginica 重叠）；CNN 更名“28×28 灰度形状分类”、Movie 更名“用户与物品嵌入架构”、LSTM 末端改为 Sigmoid 并全部标注限制。
- 新增 `src/core/exampleQuality.js` 纯函数质量检查（类别分布、单特征泄漏、二维线性分隔、R²、输入形状、标签后置变更禁令、Dense 间非线性）。
- 生成器支持 `--check` 模式（内存生成、质量检查、与仓库 JSON 比对、不写文件）；固定 `savedAt` 保证确定性；失败输出 示例/字段/实际值/期望值。
- `package.json` 新增 `generate:examples` 与 `check:examples`，`check` 同时执行核心检查与示例检查。
- 新增 `docs/teaching-examples.md`，重写 `examples/README.md`，更新 `overview.md` 与本地化。
- 验收：`npm run generate:examples`、`npm run check`、`npm run check:compiler`、`npm run build`、`git diff --check` 全部通过；再次生成无新 diff；浏览器画廊实测 4/4 通过。
## 2026-08-06 — 可扩展 Playground 框架与 Agent 化（v1）

- 新增通用 Playground 框架：注册表（`src/core/playgrounds/registry.js`）、统一会话 reducer（`session.js`）、语义快照与引导场景；UI 与页面内 Agent 使用同一套 JSON action。
- 新增 Linear Regression Playground v2：权重/偏置/学习率/训练步数控制、残差与最优拟合参考、梯度下降时间线、点编辑（添加/拖动/双击删除）、intro 场景；复用了既有 sampling/MSE/最小二乘数学并新增梯度与训练历史纯函数。
- 新增 KNN Classification Playground：二维特征投影、查询点、按距离逐邻居揭示、投票与平票裁决、决策区域网格（48×48、缓存、与查询点拖动解耦）、归一化开关、intro 场景。
- 抽取共享 KNN 数学 `src/core/knnMath.js`，browser runtime 与 Playground 共用同一套归一化/距离/排序/投票/预测逻辑（平方欧氏距离、tie-break 语义保持不变）。
- Tutorial 集成改为注册表查询（`playgroundsFor`），删除 `manifest.op === 'linear_regression'` 硬编码分支；旧 `LinearRegressionPlayground.jsx` 已删除。
- 新增可选 `canvas.playground` Agent namespace（v1）：list/open/getState/dispatch/play/pause/step/seek/reset/runScenario/refreshSource/close/subscribe，含 source 快照与 stale 标记、完整错误码、JSON-safe details；Canvas API 版本保持 1。
- 新增 `docs/architecture/playgrounds.md`，更新 `overview.md` 与 `agent-canvas-api.md`。
- 验收：`npm run check`（新增 registry/session/数学/Agent 契约断言）、`npm run build`、`git diff --check` 全部通过；浏览器端到端实测 12/12 通过。

## 2026-08-06 — Playground 验收修复（P0/P1/P2）

- **P0 线性回归**：Playground 训练改为与 runtime 共用标准化实现（`src/core/linearRegressionMath.js`），对 x/y 做 z-score 后在标准化空间做梯度下降、再转回原始坐标；每步检查有限值，损失连续两次上升即暂停并提示“学习率过高”。大规模数据（房价尺度）20 步 loss 从 4467 降至 562，不再发散。
- **P0 KNN**：抽取共享 `fitKnn()`（分层 train/test 划分、仅训练集计算归一化、k 截断），browser runtime 与 Playground 使用同一实现；Playground 邻居只来自训练集、无测试泄漏，展示训练/测试行数与测试准确率，并讲述“划分→归一化→保存样本→查邻居→评估”过程。
- **P1 KNN 场景**：intro 场景开启邻居顺序与决策区域；视图新增投票条可视化（每类票数条、预测标签箭头、平票提示），画布随播放逐步变化。
- **P1 KNN 编辑**：视图始终在原始坐标绘制与编辑（不再切换归一化坐标），消除标准化视图编辑回写错误数据的问题；归一化开关改为“what-if 对照”（运行时始终归一化，关闭时显示未归一化邻居变化）。
- **P1 数据打通**：Playground 无工作区数据时默认使用 `teachingDatasets.js` 的 Linear Trend 与 KNN Neighborhood（两月形）数据，替代硬编码簇。
- **P2 确定性**：新增/移动点使用会话内递增计数器生成稳定 ID，移除 `Date.now()`，相同 action 脚本得到相同快照。
- 验收：`npm run check`（新增标准化不发散、KNN 无泄漏、确定性 ID 断言）、`npm run build`、`git diff --check` 全部通过；浏览器端到端 15/15 通过。

## 2026-08-07 — Playground 状态一致性修复（PR A）

- 线性回归 Playground 改为与真实 runtime 共用同一套标准化训练器（`src/core/linearRegressionMath.js` 的 `createLinearRegressionTrainer` / `stepLinearRegressionTrainer`）：训练在 z-score 标准化空间进行，参数每一步转回原始坐标显示，常见数据量纲（如房价 50–210 面积）下固定学习率不再发散；`gradient_descent_node` runtime 同步改为调用同一 trainer，两端 trace 不再漂移。
- “Train” 现在从画面上当前显示的 weight/bias 开始，而不是重置为 (0,0)；同时修复了通过 controls 预置参数时 `modelState` 未同步的问题。loss 连续增长或参数非有限时训练自动停止，观察区明确显示“学习率过高/训练发散”。
- KNN Playground 改为确定性分层 train/test split：fit 只用训练集（归一化、邻居、决策区域、准确率全部来自同一 fit），测试集不再泄漏进邻居；编辑训练点是 what-if 操作，保留原 test split，`refitKnnFromSplit()` 完整重建归一化/训练样本并重算 test accuracy；测试点不可拖动且以空心圆显示。
- 修改 `k` 后 test accuracy 与决策区域随同一 fit 重算；`k` 自动受训练集大小约束。
- 多维数据新增二维切片投影：隐藏特征固定为训练集均值（归一化视图为 z-score 0），UI 显示“二维切片 / 其他特征固定为训练集均值”并可展开查看固定特征值；workspace 分类数据集保留全部数值特征供投影（不再截断为两个）。
- 指标拆分 `runtimeAccuracy`（runtime fit 的测试准确率）与 `currentViewAccuracy`（当前切片/归一化视图的 what-if 准确率）；normalize 控件改名为“运行时归一化视图”，关闭时明确标注“不归一化对比”为假设结果。KNN 视图编辑点时会先把显示坐标逆变换回原始坐标，标准化视图下拖动不再写坏数据。
- 新增点使用会话内稳定 ID（替代 `Date.now()`），相同 seed 与 action 序列可完全重放；`refreshSource()` 保留原 seed 与 split。
- 合并 main 时与 PR #34（Playground 验收修复）协调：保留其教学数据默认源（Linear Trend / KNN Neighborhood 双月数据）、KNN 邻居投票条可视化、intro 场景开启邻居顺序与决策区域、intro 观察文案带 train/test 行数；重复的数学实现统一为 PR A 的 `createLinearRegressionTrainer` / `refitKnnFromSplit` 版本。
- 新增 `scripts/check-core.mjs` 验收断言：大规模回归数据不发散、训练从当前参数开始、runtime 与 Playground 逐参数一致、学习率过高停止与提示、RESET 后重放确定性；KNN 仅用训练集拟合、test accuracy 与 k 一致、编辑后归一化更新、归一化/原始两种视图均使用新点、隐藏特征用训练均值、切片 query 与完整向量预测一致、KNN 编辑重放确定性。
- 仓库卫生：新增 `.gitattributes`（JSON 统一 LF，保证 Windows 下示例生成器逐字节校验稳定）并把 `dist/` 加入 `.gitignore`（构建产物不再污染工作区）。
- 更新 `docs/architecture/playgrounds.md`（共享 LR 训练器、KNN split/refit/投影语义）。
- 验收：`npm run check`、`npm run check:compiler`、`npm run build`、`git diff --check` 全部通过；KNN intro 场景完整播放（train 32 / test 8，k=5，runtimeAccuracy=currentViewAccuracy）。已知限制：交互式浏览器实测未在本轮执行（会话内无浏览器自动化工具），可启动本地实例人工复核。

## 2026-08-07 — KNN runtime/playground fit parity（PR A follow-up）

- 关闭 KNN 的最后一个跨层一致性漏洞：browser runtime 与 Playground 之前各自实现 train/test split（runtime 固定 seed 2026、Playground 默认 seed 1），导致 Playground 的 `runtimeAccuracy` 不一定是真实 runtime 的 accuracy。
- 数据划分统一到 `src/core/knnMath.js` 单一实现：共享 `deterministicShuffle(samples, seed)`、`stratifiedSplit(samples, trainRatio, seed)`、`fitKnn({ samples, k, trainRatio, seed })`，并导出 `DEFAULT_KNN_SEED = 2026`；无显式 seed 时 runtime 与 Playground 都使用 2026（Playground session 提供 seed 时优先使用）。
- `browserRuntime` 的 `knn_node` 改为调用共享 `fitKnn()`，删除本地 `deterministicShuffle` / `stratifiedSplit`；`train_test_split_node` 与 MLP 打乱也复用共享 shuffle，行为不变。
- Playground 初始化改为把 source points 转成统一 sample 格式 `{ id, x, y }` 后调用同一个 `fitKnn()`，train/test/normalization/k/accuracy 全部来自该 fit；编辑训练点后的 `refitKnnFromSplit()` 与 `fitKnn()` 共享 `fitKnnTrainingSet()`（归一化、训练样本构造、k 截断、accuracy 计算不再复制算法）。
- `trainRatio` 语义：`source.trainRatio` 由 `playgroundHost` 保存（workspace 用 `dataset.trainRatio ?? 0.8`，教学数据用 `teaching.trainRatio ?? 0.8`），`validateSource` 校验后 Playground 使用；不再隐藏硬编码 0.8。
- `computeTestAccuracy()` 同时兼容 `sample.label`/`sample.y` 与 `sample.features`/`sample.x` 两种表示。
- 新增真实 runtime 构造的跨层验收测试（`scripts/check-core.mjs`）：对同一 80 行/3 特征/2 类数据集，遍历 k ∈ {1, 5, 20} × trainRatio ∈ {0.6, 0.75, 0.8}，执行真实 `executeBrowserGraph`（tabular → knn_node → evaluate_classification）与 Playground 会话，断言 train/test split IDs、normalization（1e-12）、clamped k、accuracy（1e-12）与 3 个查询点预测全部一致。
- 验收：`npm run check`、`npm run check:compiler`、`npm run build`、`git diff --check` 全部通过。parity 证据（k=5、ratio=0.75、seed=2026）：train/test IDs equal=true；normalization means runtime=[0.125767,-0.081867,0.047533] = playground；stds runtime=[2.074934,2.070424,0.610702] = playground；runtime accuracy=1 = playground runtimeAccuracy=1；q1 [0,0]=a/a、q2 [1.8,-1.8]=a/a、q3 [-2,-1.2]=a/a。
