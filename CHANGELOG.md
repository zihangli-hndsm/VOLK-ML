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

## 2026-08-07 — Unified Visualization Playground（PR B）

- Linear Regression 与 KNN 不再各自实现 session reducer：新增统一 runtime `src/core/playground/playgroundRuntime.js`，UI、Canvas Agent 与可视化脚本都通过同一个 `dispatchRuntimeAction()` 派发 JSON action；旧 `src/core/playgrounds/linearRegression.js` / `knn.js` 降级为纯元数据描述符（含 `adapterId`），`session.js` 保留为兼容薄封装，注册表/Agent/既有契约测试不变。
- 新增 Model Adapter 层（`src/core/playground/model/modelRegistry.js` + `linearRegressionAdapter.js` / `knnAdapter.js`）：统一 `initialize / applyModelAction / deriveScene / buildPrimitives` 契约与 capabilities；KNN 的 fit trace 保持 lazy-learning 语义（split → normalization → 保存样本 → ready），复用 `knnMath` 与 runtime 同一套 split/fit；适配器不 import React。
- 新增语义 trace（`trace/traceTypes.js` / `traceBuilder.js`）：LR 与 KNN 各定义一组 JSON-safe、确定性的 trace 事件（id/step/timestamp 来自会话内计数器，不用墙钟），同一 script + seed + data 重放得到完全相同的 trace。
- 新增 Visualization Script DSL 与执行器：`scriptSchema.js`（白名单绑定 `$controls/$model/$data/$trace/$metrics` + mean/min/max/extent/formatNumber/take/filterByEvent 变换）、`scriptValidator.js`（SCRIPT_UNKNOWN_MODEL / SCRIPT_UNKNOWN_PRIMITIVE / SCRIPT_UNSUPPORTED_OPERATION / SCRIPT_INVALID_BINDING / SCRIPT_UNKNOWN_TRACE_EVENT / SCRIPT_TOO_COMPLEX，拒绝可执行字符串与未知字段）、`scriptRuntime.js`（step → 同一套 playground action，seek/reset 通过重放实现）。
- 新增 JSON preset（`presets/linearRegressionIntro.js`、`presets/knnIntro.js` + `visualization/presetRegistry.js`）：linear-regression.intuition / knn.intro 可直接 serialize → deserialize → replay。
- 新增统一 UI（`src/components/playground/`）：UnifiedPlaygroundDialog、PlaygroundToolbar（Model/Dataset/Preset/Agent）、PlaygroundStage（只认识 primitives）、PlaygroundInspector、PlaygroundTimeline 与 11 个 primitive renderer（scatter/regression-line/reference-line/residual-lines/decision-region/neighbor-links/query-point/vote-bars/loss-curve/formula/annotation/metric-card）；删除旧模型专用视图（KnnView/LinearRegressionView/viewRegistry 等），renderer 不 import 模型数学。
- 新增数据集适配层 `src/core/playground/data/datasetAdapter.js`（inspectDataset/createSplit/buildSlice/featureStats/sampleRows，二维切片统一走 `buildSlice({ fixedFeatureStrategy: 'mean' })`）。
- 验收：`npm run check`（新增：单 reducer 断言、适配器不 import React、renderer 不 import 模型数学、preset 校验与 JSON-safe、LR/KNN preset 完整重放且 trace 逐位一致、validator 拒绝 9 类非法脚本）、`npm run check:compiler`、`npm run build`（666 modules）、`git diff --check` 全部通过。已知限制：交互式浏览器实测未在本轮执行（会话内无浏览器自动化工具），可启动本地实例人工复核；Agent API 未新增 `loadPreset/generateScript`（属 PR C）。

## 2026-08-08 — Script-Driven Playground Runtime（PR B follow-up）

- Visualization Script 成为可视化运行时的一等公民：删除 Model Adapter 的 `buildPrimitives()`，新增 Primitive Materializer（`src/core/playground/visualization/primitiveMaterializer.js`），`script.primitives` 成为可视化组成的唯一 source of truth——同一模型状态、不同 script 得到不同 primitives（测试覆盖）。
- Preset primitive 声明升级为真实 binding props（`$model.*` / `$data.*` / `$controls.*` / `$trace` / `$metrics.*`），支持递归解析与白名单变换（mean/min/max/extent/formatNumber/take/filterByEvent）；修复 `mean($data.values)` 这类 transform 绑定被误当字面量的问题。
- Script 拥有 layout：validator 校验 layout.stage/side 引用的 primitive 必须存在（`SCRIPT_UNKNOWN_PRIMITIVE_REFERENCE`）且不重复；show/hide/highlight/annotate 作用于 script primitive，未声明的图元即使 SET_VISUAL 也不会凭空出现。
- 播放统一走 Script Runtime：描述符 `scenarios` 改为 `{ id, titleKey, presetId }` 引用；`runScenario()` 与 UI preset 播放都执行同一 preset（同一 action、同一 trace）；UI 删除 LR→START_TRAINING / KNN→START_NEIGHBOR_REVEAL 等模型特判，静态测试禁止 UI 目录出现模型名与训练 action。
- Baseline/reset/seek P0 修复：session 保存 `baseline { controls, source, seed }`，普通 RESET 与 script reset/seek/replay 都回到 baseline；新增 replay invariance 测试（fresh first-N == full-run-then-seek-N == full-run-then-reset-then-N，比较 controls/scene/metrics/traces/visualState/primitives/scriptState）。
- 时间线拆分：新增 `scriptState { status, step, totalSteps }`，script step 与 model training/reveal step 不再混用同一 slider；`$data.*` 绑定真实可用（`playgroundHost` 传入 workspace dataset，runtime 用 `inspectDataset` 生成 `dataState`）。
- DSL 语义闭环：`consume`/`update` 从 schema/validator/文档移除（PR C 再引入）；`wait` 保留并实现（只推进 script state 与 UI 计时，Node 重放不 sleep）；validator 接受的每个 operation 都有 runtime 语义（parity 测试覆盖 invoke/setControl/show/hide/highlight/reveal/reset/annotate/wait）。
- KNN `tracePredict` 单独执行即产生 `query.received` 与 `knn.distancesComputed` 并初始化 reveal 状态（不再依赖后续 STEP 补上）；script runtime driver 契约改为 `dispatch/getState/getAdapterId/resetToBaseline/subscribe`，operation 翻译移到 adapter `scriptOperations`（加新模型不改 script runtime）。
- 验收：`npm run check`（新增 replay invariance、组合控制、binding/transform、layout 完整性、tracePredict、operation parity、runScenario==preset 路径、UI 无模型特判静态扫描）、`npm run check:compiler`、`npm run build`（672 modules）、`git diff --check` 全部通过。已知限制：交互式浏览器实测未在本轮执行；`consume/update` 已删除待 PR C 实现。

## 2026-08-08 — Playground Script Runtime Final（PR B final follow-up）

- P0 渲染修复：Linear Regression 语义状态输出完整 `bestFitLine { weight, bias, start, end }`，reference-line renderer 不再因缺少端点崩溃；新增 primitive contract smoke（所有 line primitive 端点 finite、scatter/neighbor-links/loss-curve 数组契约）覆盖 LR/KNN 打开即校验。
- Script 可见性：primitive 支持 `when` 条件（LR residual-lines 绑 `$controls.showResiduals`、reference-line 绑 `$controls.showBestFit`、KNN decision-region 绑 `$controls.showDecisionRegions`）；materializer 在 when=false 时不生成图元，显示判断完全留在 Script 层（保留“不同 script → 不同 primitives”的组合测试）。
- highlight 真实视觉语义：materializer 给目标 primitive 打 `props.highlighted=true`，Line/Scatter/Neighbor renderer 消费（加粗/琥珀描边）；annotate 改为 generic `visualState.overrides`，annotation primitive 的 `props.observation` 真正变化（测试断言 primitive props 而非仅 visualState）。
- `$data` 与真实 source 一致：新增 `buildDataState({ source, workspaceDataset })`，workspace 源保留完整 workspace 上下文，teaching/fallback 源由 normalized source 重建（LR rows==scatterPoints、task=regression；KNN rows/features 来自 workspace）；三种场景（fallback / 不兼容 workspace / 兼容 workspace）均有测试。
- `SCRIPT_LOAD` 增加模型匹配校验：`script.model.adapter !== session.adapterId` 抛 `SCRIPT_MODEL_MISMATCH`（双向测试）。
- Script mode capabilities 独立于模型 timeline：加载 script 时 canSeek/canStep/canPlay 取自 `scriptState`（LR 初始 0/7 也可 seek，即使 training.totalSteps=0）；完成后 canStep=false、canPlay=true（可重播）。
- `SCRIPT_PLAY` 对已完成 script 自动从头重播（step→0、status→playing），随后 STEP 正常推进。
- Binding/transform 安全：validator 的 `collectBindings`/`isAllowedBinding` 识别 transform 语法（`mean($data.values)` 合法、`unknownTransform(...)` 拒绝）；transform 类型不匹配返回稳定 `SCRIPT_BINDING_TYPE_MISMATCH`；移除不可调用的 `filterByEvent`。
- 验收：`npm run check`（新增 visibility 序列、primitive contract smoke、highlight/annotate props、$data parity、SCRIPT_MODEL_MISMATCH、script capabilities/restart、binding validator/type-safety）、`npm run check:compiler`、`npm run build`（672 modules）、`git diff --check` 全部通过；LR/KNN parity、PR A、PR B 全部回归保持。已知限制：`consume/update` 与多参数 transform 待 PR C/DSL v2。

## 2026-08-08 — Playground Interface Cleanup（PR B interface cleanup follow-up）

- Agent/UI 播放同路径：`playgroundHost` 的 `play/step/seek/reset` 在存在 active Visualization Script 时自动路由到 `SCRIPT_PLAY/PAUSE/STEP/SEEK/RESET`，无 script 时回落到模型 timeline（`STEP` 等）；Canvas Agent 与 UI 控制完全相同的 timeline，新增跨层 parity 测试（agent.step→script step 1、seek(3)==直接 SCRIPT_SEEK(3) deepEqual、reset 回 baseline、completed 后 play 从头重播、无 script 时 step 走模型 reveal）。
- Script validator 可观测语义闭环：`show/hide/highlight` 必须引用已声明 primitive，否则 `SCRIPT_UNKNOWN_PRIMITIVE_REFERENCE`（details 含 stepId/operation/primitiveId）；`annotate` 必须恰好声明一个 annotation primitive（`SCRIPT_ANNOTATION_TARGET_MISSING` / `SCRIPT_ANNOTATION_TARGET_AMBIGUOUS`）；不再允许 validator 通过但 runtime silent no-op。
- `$data` classification fallback 完整性：KNN teaching/fallback 的 `$data.rows` 现在包含 `label` target 列、schema 声明 `label` 列；`$data.targetColumn` 保证在每一行真实存在（含唯一 label 集合与模型源一致的测试）。
- Script 错误码统一与透传：新增 `src/core/playground/visualization/scriptErrors.js`（`SCRIPT_ERROR_CODES` 单一来源），validator/bindings/primitives/runtime 共用；Agent 错误归一化同时接受 `PLAYGROUND_ERROR_CODES` 与 `SCRIPT_ERROR_CODES`，script contract 错误不再被包装成 `OPERATION_FAILED`（测试：runtime SCRIPT_MODEL_MISMATCH → agent SCRIPT_MODEL_MISMATCH）。
- 语言偏好修复：`applyProject` 新增 `languagePolicy`（默认 `'project'` 保持现有 Import/Restore/Agent loadProject 语义；`'preserve-current'` 忽略 project.language）；**仅内置 Examples** 加载使用 `preserve-current`，普通 Import/Restore 按原逻辑恢复项目语言；纯函数 `resolveLanguagePreference`（`src/core/languagePolicy.js`）单测覆盖 en-only/zh-only/bilingual/显式 import 四类场景，并静态断言 Examples 路径传 `preserve-current`、Import 路径保持默认。不改变 PROJECT_VERSION/schema。
- 验收：`npm run check`（新增 Agent parity、validator target、$data target、error passthrough、language policy 测试）、`npm run check:compiler`、`npm run build`（672 modules）、`git diff --check` 全部通过；PR A/PR B 全部回归保持。

## 2026-08-08 — P0 Playground Renderer Crash Fix

- 根因：KNN 第一次 reveal 后 `voting.counts` 非空，Inspector 渲染 side 布局中的 VoteBarRenderer 时未传 `colorByLabel`，`colorByLabel[label]` 抛 TypeError；Playground 无 Error Boundary → React 子树崩溃 → 整页白屏且无法返回。
- 共享视觉编码：新增 `src/components/playground/visualEncoding.js`（`LABEL_COLORS` + `buildLabelColorMap`），Stage 与 Inspector 都从 scatter primitive 构建同一确定性映射；同一 label 在 Scatter / Neighbor / VoteBar / DecisionRegion 颜色完全一致（颜色只属于 UI 层，不进 Adapter/Script）。
- Inspector 修复：side renderer 现在统一接收 `colorByLabel`；VoteBarRenderer 增加防御（`colorByLabel?.[label] ?? '#94a3b8'`、`voting`/`counts` 缺失守卫）；renderer audit 为 Scatter/Neighbor/DecisionRegion/Metric/Line/Residual/QueryPoint 补齐可选上下文缺失时的降级处理。
- Error Boundary：新增 `PlaygroundErrorBoundary.jsx` 包住 Playground（Stage/Inspector/Timeline/renderer），崩溃时显示 fallback 面板（Reset Playground / Close Playground），Close 不依赖坏 snapshot、始终可用；`key={playgroundId}` 避免旧错误污染新 Playground；reset 失败时保留 fallback。
- React SSR render smoke：新增 `scripts/playground-render-smoke.jsx` + `scripts/check-playground-render.mjs`（esbuild 打包 + `renderToStaticMarkup`），纳入 `npm run check`；KNN 12 个快照（0→11 步）与 LR 8 个快照（0→7 步）逐步渲染 Stage+Inspector 无异常，明确断言首个非空投票快照（revealed=1、counts 非空）可渲染；VoteBarRenderer 在有/无 colorByLabel、空/畸形 props 下均不抛。
- 错误码收尾：`INVALID_SCRIPT` 加入 `SCRIPT_ERROR_CODES`，Agent 对畸形 `SCRIPT_LOAD` 返回 `INVALID_SCRIPT`（不再被包装成 OPERATION_FAILED）。
- 验收：`npm run check`（含 render smoke）、`npm run check:compiler`、`npm run build`（674 modules）、`git diff --check` 全部通过；PR A/PR B/语言偏好全部回归保持。已知限制：Error Boundary 的运行时捕获与 Close/Reset 的浏览器端实测需人工复核（SSR 不触发 boundary；生产代码与静态断言已覆盖），可启动本地实例验证。

## 2026-08-08 — Agent Generated Visualization Scripts（PR C）

- 新增 Agent Script 操作（`canvas.playground`，apiVersion 保持 1，additive）：`getCapabilities`（models/capabilities/operations、presets、primitives）、`listPresets`、`loadPreset({ presetId, parameters })`、`loadScript`、`validateScript`（非抛错结果对象）、`getScript`、`exportScript`、`dryRunScript`、`generateScript({ goal, constraints })`。
- Dry run（`src/core/playground/agent/dryRun.js`）：结构校验 → 模型兼容检查 → 绑定解析（对当前快照）→ 在 detached session clone 上真实重放每一步 → 估算（steps/primitive updates/decision grid cost）；live session 永不改动，任何一步抛错即 invalid。
- 预设优先生成（`src/core/playground/agent/scriptGenerator.js`）：exact preset → parameterized preset（目标关键词匹配控制参数，如 `k=1`→k=1、学习率→showResiduals/showBestFit）→ 从可视化 toolkit 生成最小合法脚本；不接真实 LLM，外部 generator（未来 LLM adapter）可通过 `createPlaygroundHost({ scriptGenerator })` 注入，输出同样经过 validator + dry run。
- Fallback（C7）：生成脚本校验/干跑失败时自动回退到最接近的 preset（`fallback: true`）并加载；`loadPreset` 找不到 preset 抛 `PLAYGROUND_PRESET_NOT_FOUND`。
- 清理：validator 注释移除已删除的 `SCRIPT_UNKNOWN_TRACE_EVENT` 残留；`INVALID_SCRIPT` 已在 `SCRIPT_ERROR_CODES` 中（随 P0 PR 加入），Agent 对畸形 `SCRIPT_LOAD` 稳定返回 `INVALID_SCRIPT`。
- 测试（check-core）：capabilities/listPresets、loadPreset 参数、validateScript 结果对象、loadScript/getScript/exportScript 往返、generateScript 三种模式（preset/parameterized/generated）、注入失败 generator 的 fallback、replay-breaking 脚本的干跑失败 fallback、mock generator 成功路径、dryRunScript 估算。
- 文档：`agent-canvas-api.md` 新增 Script operations 小节与错误码，`playgrounds.md` 新增 PR C 小节。
- 验收：`npm run check`、`npm run check:compiler`、`npm run build`（676 modules）、`git diff --check` 全部通过；PR A/PR B/语言偏好/P0 全部回归保持。

## 2026-08-08 — Agent Context and Semantic Contracts（PR D）

- 新增 `canvas.playground.inspectContext()`：完整机器可读世界模型——playground(id/adapter/task)、model(capabilities + operation schemas + semantic schema)、data(features/target/rowCount/statistics/projection)、controls、traces + trace payload schemas、primitives schemas、bindings、resourceLimits、currentState；答案全部来自 schema，不是硬编码 prompt。
- Model Adapter 契约升级：新增 `semanticSchema`（字段必须存在于 `deriveScene` 语义状态，contract test 校验）；`scriptOperations` 改为类型化 operation schema（`args` + `producesTrace`，`producesTrace ⊆ TRACE_EVENTS`），翻译器独立为 `scriptOperationActions`；新增 `TRACE_PAYLOAD_SCHEMAS`（每个 trace 事件声明 payload 字段类型）。
- 新增 `visualization/schemas.js`：13 个 primitive 的类型化 props 契约 + 兼容绑定（`compatibleBindings`），成为 validator 上下文、inspectContext、严格 dry run 与测试的单一来源；新增 `validatePrimitiveContract`（required prop 缺失/类型不匹配 → `SCRIPT_PRIMITIVE_CONTRACT_VIOLATION`）。
- 强化 dry run：required primitive prop 的 binding 解析为 undefined → `SCRIPT_BINDING_UNRESOLVED`（不再只是 warning）；每个 script step 在 detached clone 上重放后执行 derive→materialize→contract 校验；`decisionGridCost` 基于 resolved props（如 resolution 12 → 144）。
- 动态脚本基线：`SCRIPT_LOAD` 捕获 `scriptBaseline`（当前 controls/modelState/dataState/source/seed）；`SCRIPT_RESET`/`SCRIPT_SEEK`/replay 回 scriptBaseline，普通 `RESET` 始终回打开时的 `sessionBaseline`（两种 reset 语义分离，测试覆盖）。
- 新增错误码：`SCRIPT_BINDING_UNRESOLVED`、`SCRIPT_PRIMITIVE_CONTRACT_VIOLATION`（并入 `SCRIPT_ERROR_CODES`，Agent 透传）。
- 测试（check-core）：semantic schema↔语义状态一致性、operation schema（args/producesTrace/translator）、primitive schema 全覆盖 + preset 绑定兼容、trace payload 覆盖、inspectContext 十类字段、scriptBaseline vs sessionBaseline、严格 dry run（unresolved binding / resolved grid cost）。
- 文档：`agent-canvas-api.md` 与 `playgrounds.md` 新增 PR D 小节。
- 验收：`npm run check`、`npm run check:compiler`、`npm run build`（678 modules）、`git diff --check` 全部通过；PR A/PR B/语言偏好/P0/PR C 全部回归保持。

## 2026-08-08 — Close PR D Semantic Contract Gaps（PR D.1）

- 深度 primitive 类型校验：新增 `visualization/typeContracts.js`，`array<point2d>`/`array<neighbor>`/`array<decisionCell>`/`array<number>` 等校验元素形状（不再只查 `Array.isArray`）；`validatePrimitiveContract` 接入深度校验；负例测试（`points: [123, "invalid"]`、缺 pointId 的 neighbor）被稳定拒绝。
- semanticSchema ↔ compatibleBindings 一致性：`compatibleBindings` 规范化为规范语义路径（移除 `$model.points`/`$model.residuals`/`$model.query` 残留别名）；契约测试双向校验——每个 `$model.*` 路径的首段存在于某 adapter 的 semanticSchema，且完整路径在运行时语义状态中可解析（含嵌套路径 `decisionRegions.cells`、`training.lossHistory`）。
- scriptBaseline trace 一致性：`SCRIPT_LOAD` 捕获 baseline 时同时保存 `traces`，`SCRIPT_RESET` 一起恢复 controls/modelState/dataState/source/seed/traces；测试覆盖「编辑 KNN 训练点后 SCRIPT_LOAD → 执行 → SCRIPT_RESET」语义状态与 trace 描述同一 baseline；普通 `RESET` 仍回 sessionBaseline，deterministic replay 不破坏。
- 资源限制强制：validator 对 decision-region 使用 `props.resolution`（不再用过期嵌套路径），字面量超 `maxDecisionResolution` 抛 `SCRIPT_TOO_COMPLEX`；dry run 对 resolved resolution 同样强制（注入 `$data.resolutionValue=1000` 的测试）；dry run 估算扩展为 `stepCount/primitiveCount/decisionGridCells/pointCount/traceEvents`（不虚构 cost 公式）。
- 可选绑定警告恢复：required binding 未解析仍 `SCRIPT_BINDING_UNRESOLVED`；optional binding 未解析 → valid + 去重 warning（正反测试）。
- Operation schema 增强：`scriptOperations` 改为 `{ args, effects, alwaysProducesTrace, mayProduceTrace }`（诚实区分确定/条件性 trace，如 KNN moveQuery 在已 reveal 时可能额外产生 neighbor/vote/prediction 事件）；`scriptOperationActions` 保持不变；inspectContext/getCapabilities 暴露完整 operation schema。
- Trace payload schema 显式 required/optional：`TRACE_PAYLOAD_SCHEMAS` 每个事件拆分 required/optional；新增 `validateTracePayload`，在契约测试中对 LR/KNN 场景发出的每条 trace 事件做 payload 校验（按实际 emit 行为校准，如 `parameters.updated` 的 step 为可选、`data.loaded` 区分回归/分类字段）。
- inspectContext 跨源一致性测试：semanticFields==semanticSchema keys、operations==scriptOperations、traces/traceSchemas==TRACE_EVENTS、resourceLimits==RESOURCE_LIMITS、primitives==listPrimitiveSchemas、getCapabilities.operationSchemas==adapter.scriptOperations。
- 新增错误码：`SCRIPT_TRACE_PAYLOAD_INVALID`（并入 `SCRIPT_ERROR_CODES`）。
- 文档：`agent-canvas-api.md` 与 `playgrounds.md` 更新 PR D.1 语义。
- 验收：`npm run check`、`npm run check:compiler`、`npm run build`（679 modules）、`git diff --check` 全部通过；PR A/PR B/语言偏好/P0/PR C/PR D 全部回归保持。
