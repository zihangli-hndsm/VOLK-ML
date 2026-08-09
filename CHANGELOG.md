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
- Baseline/reset/seek P0 修复：session 保存 `basel…10206 tokens truncated…查的 learning-rate-too-high 停止机制（loss 与 gradient 证据存在）`；原始的 `stoppedReason: 'diverged'` 仍是合法运行时行为，但保留给未来的教学能力契约，不在此刻宣称可教学。
- 测试：谓词期望更新为 `['learning-rate-too-high']`；保留真实运行正例与「正常成功训练」负例；新增显式负例——`training.completed{stoppedReason:'diverged'}` 且无 `loss.measured`/`gradient.computed` → `show_failure_case` fidelity = false（记录缺失谓词与缺失 loss/gradient 证据）。未新增泛型 OR/条件 trace 需求机制。
- 文档：`playgrounds.md` 与 `agent-canvas-api.md` 更新为「show_failure_case 当前仅面向 learning-rate-too-high 停止机制」；本条目按 append-only 规则对 E.2.1 条目的 `diverged` 表述作出更正说明。
- 验收：`npm run check`（含 render smoke 与 examples check）、`npm run check:compiler`、`npm run build`、`git diff --check` 全部通过；E.2.1 全部行为回归保持（方向探针、state/schema 推导数值、visual/runtime/trace 证据分离、具体 primitive 绑定 fidelity、adapter 声明 teachingCapabilities、正常成功拒绝、KNN explain_prediction、compare fidelity、mode:'composed'、E.1 安全/资源契约、既有 presets）。合并后 PR E = FINAL PASS，进入 PR F。

## 2026-08-09 — Toolkit 扩展 + MLP Playground（PR F.1）

- 新增 4 个模型无关 primitive（typed props + placement + compatibleBindings + SSR smoke + 空 props 优雅降级）：
  - `parameter-trajectory`（stage）：绘制 `{step, value}` 参数轨迹，绑定 `$model.training.parameterTrajectory`（LR 与 MLP scene 均新增派生字段）；
  - `network-graph`（stage）：分层网络图（`networkNode`/`networkEdge`），绑定 `$model.network.nodes/edges`；
  - `matrix-grid`（stage）：权重矩阵网格（`matrixCell`），绑定 `$model.matrix.rows/columns/cells`；
  - `histogram`（side）：直方图（`histogramBin`），绑定 `$model.histogram.bins`。
- 新增纯数学模块 `src/core/playground/model/mlpMath.js`：种子化 XOR 数据、种子化参数初始化（权重 [-1,1] 保证全批量梯度可学习）、tanh 隐层 + sigmoid 输出 + 二元交叉熵全批量反向传播、与 LR 一致的诚实失败语义（`learning-rate-too-high` / `diverged`）。
- 新增 `mlp` adapter 与 `mlp-classification` playground：semantic schema（scatterPoints/axes/decisionRegions/training(lossHistory, parameterHistory, parameterTrajectory)/network/matrix/histogram/metrics/observation）、操作 `traceFit`（intent fit，reveal=trainingSteps）与 `tracePredict`（intent predict，隐层单元 reveal=hiddenUnits）、MLP trace 事件与 payload schema、声明式 teachingCapabilities（`show_training` + `explain_prediction`）；`show_failure_case` 在 MLP 上诚实不可用（`TEACHING_GOAL_UNSUPPORTED`）。
- `mlp.intro` preset：训练 → 逐轮揭示 loss/参数轨迹 → 揭示查询点隐层激活；确定性重放、严格 dry run、20 个 render smoke 快照全部通过。
- 统一层零模型分支：`playgroundRuntime.js` / `primitiveMaterializer.js` / `teachingComposer.js` / `teachingFidelity.js` / `PlaygroundStage.jsx` / `rendererRegistry.jsx` 均无 `mlp` 特判（源码级契约测试）；泛型 goal→plan→compose→fidelity 管线原样服务 MLP 的 `explain_prediction`、`show_training`、compare hiddenUnits、what-if learningRate。
- MLP 数学确定性：同 seed + 控件 → 100% 学会 XOR（lr 0.5 / 50 步），极端学习率（20）触发诚实 `learning-rate-too-high` 停止。
- 测试（check-core 新增 PR F.1 块）：MLP 注册与支持集推导、preset 校验/严格 dry run/确定性重放、trace payload 校验、Agent plan→compose→fidelity（explain/show_training/compare/what-if）、不支持目标拒绝、无模型分支源码断言、新 primitive 类型契约、XOR 学习与失败停止；D.1 的 semanticSchema↔compatibleBindings 契约循环纳入 MLP 上下文。
- 文档：`playgrounds.md` 与 `agent-canvas-api.md` 更新 PR F.1 语义；append-only `CHANGELOG.md` 新增本条。
- 验收：`npm run check`（含 render smoke 12 KNN + 8 LR + 20 MLP 与 examples check）、`npm run check:compiler`、`npm run build`、`git diff --check` 全部通过；PR A–E 全部回归保持。已知限制：MLP playground 暂通过 Agent 打开（`agent.open({ playgroundId: 'mlp-classification' })`），UI 入口（Ask Agent / script preview / 导出导入 / reviseScript）留待 PR F.2；workspace dataset 输入仍为确定性 XOR 示例。

## 2026-08-09 — Make MLP Playback Semantically Time-Consistent（PR F.1.1）

- 核心不变量：任意 MLP 回放步骤上，timeline / 激活参数 / loss / 网络图 / 矩阵 / 直方图 / 准确率 / 决策区域 / 预测行为全部描述同一个参数状态，UI 不再混用不同训练轮次的证据。
- `trainMlp()` 的 history 每步携带 JSON-safe 完整 `params` 快照：正常完成 `history[last].params === result.params`；`learning-rate-too-high` 采用与 LR 一致的显式策略——有限且损失上升的更新被记录并被采纳为停止前的最终可见参数（`parameters.updated` 只描述模型真正采纳的状态）；非有限 `diverged` 路径保留最后有限参数。
- 训练回放真实化：`START_TRAINING` 在 step 0 保持基线参数；`STEP`/`SEEK` 同时更新 `modelState.params`、`training.currentStep`、`timeline.step`（同一轨迹）；SEEK(0) 恢复基线。决策区域随激活参数刷新，初始随机网格不再与训练后的网络并存（测试：final cells == `computeMlpDecisionRegions(final params)`，且不等于初始网格）。
- 预测解释不提前泄题：输入节点立即可见，隐层节点仅在 reveal 后可见，输出节点在全部隐层揭示前保持 `null`（`metrics.predictedLabel` 同样隐藏）；教学序列真实为 input → hidden activations → output。逐层测试覆盖 revealed=0/1/final。
- `prediction.emitted` 模型中立：payload schema 增加可选 `hiddenUnits`；KNN 发 `{label, k}`，MLP 发 `{label, hiddenUnits}`（测试断言 MLP 不使用 k、KNN 不使用 hiddenUnits）。
- MLP 源契约与 F.1 能力一致：`validateSource` 明确要求确定性二维 `x1`/`x2` 示例表示，不兼容特征名以 `INVALID_PLAYGROUND_SOURCE` 拒绝（workspace dataset 特征映射留待后续）。
- `mlp.intro` 训练/预测边界诚实：preset 在训练前显式配置 `trainingSteps = 12`，并在预测前恰好揭示这 12 个训练步（测试按 preset 推导 reveal 数，不硬编码）。
- 测试（check-core 新增 PR F.1.1 块）：训练时间线（step0=baseline、stepN=history[N-1].params、final=history.last、早期≠最终）、SEEK(N) ≡ STEP×N 语义等价、决策区域跟随激活参数、预测 reveal 序列、trace 语义（hiddenUnits vs k）、源契约拒绝、preset 边界推导；F.1 全部测试（确定性重放、fidelity、primitive 存在性等）保持。
- 文档：`playgrounds.md` 更新 PR F.1.1 语义；append-only `CHANGELOG.md` 新增本条。
- 验收：`npm run check`（含 render smoke 12 KNN + 8 LR + MLP 与 examples check）、`npm run check:compiler`、`npm run build`、`git diff --check` 全部通过；PR A–F.1 全部回归保持。合并后 PR F.1 = FINAL PASS，进入 PR F.2（Agent UI / script preview / JSON 导入导出 / reviseScript / workspace dataset）。

## 2026-08-09 — Agent Playground UI + Script Tooling（PR F.2）

- Agent 面板（`src/components/playground/PlaygroundAgentPanel.jsx`）：用户输入教学请求 → `agent.plan` → `agent.composeScript` → 预览，未运行前不加载任何脚本；预览含 Overview / Teaching Plan / Visualization Script / Fidelity 四个标签（原始 JSON 只读、无任何可执行内容），Run 按钮才通过既有 Script Runtime 加载并播放。预览展示 goal/objective/phases/改动控件/操作/快照/图元/步数与保真度证据（按 controls/operations/visual/runtime/trace 分组勾选）。
- 脚本工具：Copy JSON（精确声明）、Download JSON（`volk-ml-playground-script.json`）、Load JSON（导入必须过 `validateScript` → 模型/playground 兼容 → 严格 dry run 才能替换活动脚本；失败展示稳定 `SCRIPT_*` 错误码 + 人读信息）。
- 脚本来源追踪：host 快照新增 `provenance`（`preset/generated/composed/revised/imported`），UI 明确区分「预设 / Agent 合成 / 导入脚本」；Agent 合成保留 `mode: 'composed'` 与保真度状态。
- `reviseScript`（`src/core/playground/agent/scriptRevision.js`，Agent API `reviseScript({ plan, script, request })`）：有界修订词汇 `shorten / remove_visual / keep_visuals / focus_result / change_comparison_values`；每次修订都过 validate → 严格 dry run → goal fidelity，破坏教学目标（如删除必需可视化证据、只保留 loss+轨迹却缺 line/metrics/formula）以 `TEACHING_GOAL_FIDELITY_FAILED` 拒绝，绝不静默产出误导脚本；无自由文本任意变更。
- Playground 选择器：头部新增注册表驱动的下拉（`listPlaygrounds()`），KNN / 线性回归 / MLP 均从正常 UI 打开，无硬编码模型页面；新注册 playground 自动可发现。
- `mlp.intro` 自包含：训练前显式配置 `hiddenUnits = 3`（与 `trainingSteps = 12`），用户先改 hiddenUnits 再 RUN_SCENARIO 也不会让 intro 不完整（回归测试：hiddenUnits=6 → 场景运行后恢复 3 且发出 `prediction.emitted`）。
- 测试（check-core 新增 PR F.2 块）：五条 composition→preview→run 链路（KNN explain_prediction、LR show_training/show_failure_case、MLP explain_prediction/show_training）、脚本工具（copy/download 序列化、合法加载、malformed/wrong-model/bad-binding 拒绝）、修订（shorten(3) 通过、keep_visuals 通过、移除必需证据拒绝、change_comparison_values 重规划、未知修订类型拒绝）、scenario 稳健性、provenance 全路径、Agent 面板不导入模型数学的源码断言。
- 文档：`playgrounds.md` 与 `agent-canvas-api.md` 更新 PR F.2 语义；append-only `CHANGELOG.md` 新增本条。
- 验收：`npm run check`（含 render smoke 与 examples check）、`npm run check:compiler`、`npm run build`（696 modules）、`git diff --check` 全部通过；PR A–F.1.1 全部回归保持。已知限制：MLP workspace dataset 输入按方案延后到 F.3（F.2 保持 F.1 的干净 adapter 架构）；粘贴/导入超大脚本仍受既有资源限制约束。

## 2026-08-09 — Complete Agent Revision and Preview State UX（PR F.2.1）

- Agent 面板补齐修订 UI（不引入任意自然语言改写）：`shorten`（最大步数输入）、`focus_result`、`keep_visuals` / `remove_visual`（选项来自 `preview.script.primitives`，非硬编码模型列表）、`change_comparison_values`（仅 compare-control 计划显示，接受恰好两个取值，交给既有 Planner 做 schema/范围校验）。
- 修订只替换预览、不触碰运行态：`reviseScript` 成功后 `preview` 变为 `revised`（mode/plan/script/fidelity/dryRun），用户必须显式按 Run 才以 `provenance='revised'` 加载；严格保持 revise → inspect → explicit execution。
- 修订失败保留旧有效预览：`TEACHING_GOAL_FIDELITY_FAILED` / `TEACHING_PLAN_INVALID` 等错误单独展示（revisionError），Run 仍指向旧有效预览；绝不把不可用脚本替换进预览。
- 预览与运行态双徽章：新增纯状态 helper `src/components/playground/agentPreviewState.js`（`previewProvenance` / `previewRunnable` / `previewFidelityStatus` / `compositionPreview` / `revisionPreview` / `importedPreview` / `revisionErrorPreview`），UI 同时展示「Preview: composed/revised/imported」与「Active: snapshot.provenance」，不再复用单个 `snapshot.provenance` 徽章。
- 导入即预览：导入脚本通过 validate → 兼容 → 严格 dry run 后先进入 imported 预览（无 TeachingPlan，显示「结构校验通过 / 严格试运行通过 / 目标保真度不适用」），用户按 Run 才加载；运行资格按类型区分——composed/revised 必须 fidelity 通过，imported 只需校验+dry run+模型兼容，绝不再出现「预览 A、徽章 imported、运行态 B」的错位。
- 测试（check-core 新增 PR F.2.1 块）：纯 helper 的 provenance/runnable/fidelity-status 断言 + 概念状态机转移（compose 后 active 仍 preset、Run 后 active=composed、revise 后 preview=revised 而 active 仍 composed、Run revised 后 active=revised、import B 后 preview=imported B 而 active 不变、失败修订保留旧预览）；F.2 后端修订引擎未改动。
- 文档：`playgrounds.md` 更新 PR F.2.1 状态机语义；append-only `CHANGELOG.md` 新增本条。
- 验收：`npm run check`（含 render smoke 与 examples check）、`npm run check:compiler`、`npm run build`、`git diff --check` 全部通过；PR A–F.2 全部回归保持。合并后 PR F.2 = FINAL PASS，进入 F.3。

## 2026-08-09 — MLP Workspace Dataset Integration（PR F.3）

- MLP adapter 特征名无关化：样本为按 `featureColumns` 顺序的完整特征向量（`inputSize = featureColumns.length`），二元标签采用确定性排序映射（如 `['setosa','versicolor']` → 0/1）存入模型状态；`mlpAdapter.js` 不再包含任何 `x1`/`x2` 或标签字面量（源码级断言）。
- 兼容 workspace 数据集（二元分类、≥2 个 numeric 特征）经 `resolveSource` 与共享数据集层接入：分层 train/test 划分、训练集 z-score 归一化、显式 `xFeature`/`yFeature` 选择（选项来自 `scene.featureOptions` 动态填充）、2D 投影把隐藏特征固定在归一化均值 0（与 KNN 一致）。多分类数据集以 `INVALID_PLAYGROUND_SOURCE` 显式拒绝；回归/特征不足的数据集回退到确定性 XOR 示例。
- `computeMlpDecisionRegions` 泛型化（featureColumns + xFeature/yFeature + normalization，隐藏特征固定为归一化均值 0）；默认参数保持 XOR 行为逐字节兼容（F.1.1 测试直接通过），workspace 视图在归一化空间计算网格。
- XOR 示例路径不变：全量训练（无划分）、恒等归一化（视图==原始特征）、x1/x2 轴——F.1/F.1.1 全部测试保持绿色；scene 新增 `featureOptions` / `projection` / `ranges` 支撑 2D 视图与查询滑块。
- 测试（check-core 新增 PR F.3 块）：workspace 数据集端到端（32/8 划分、真实归一化、稳定标签映射、loss/测试准确率、归一化视图决策区域、explain_prediction fidelity）、XOR 回归（无划分、恒等归一化、默认 compute 兼容）、多分类拒绝、adapter 无硬编码列名源码断言。
- 文档：`playgrounds.md` 更新 PR F.3 语义；append-only `CHANGELOG.md` 新增本条。
- 验收：`npm run check`（含 render smoke 与 examples check）、`npm run check:compiler`、`npm run build`、`git diff --check` 全部通过；PR A–F.2.1 全部回归保持。

## 2026-08-09 — Preserve Workspace Label and Feature Semantics in MLP（PR F.3.1）

- 外部预测标签空间统一为数据集原始二元标签：`predictMlp(params, x, labels = ['a','b'])` 返回 `classIndex` + 解码后的 `label`（默认保持 XOR a/b）；adapter 在所有位置（训练/测试准确率、`metrics.predictedLabel`、`prediction.emitted`、预测 observation、决策区域 cells）统一传入 `modelState.labelMapping.labels`。唯一二元决策（probability < 0.5 → class 0）与唯一标签映射，不再六处各自实现。
- `computeMlpDecisionRegions` 增加可选 `labels` 契约（workspace 传 `labelMapping.labels`），默认仍为 XOR a/b（逐字节兼容）。
- workspace 输入经既有 Dataset Adapter 语义解析：声明式 `featureColumns` 为权威（与有效 numeric 列求交、排除 target 列），无关 numeric 列（id/timestamp/metadata 等）不再自动进入模型；分类目标先归一化为稳定语义字符串（0 → "0"、true → "true"）再进二元映射——数值型二元目标不再静默回退到 XOR。>2 类仍以 `INVALID_PLAYGROUND_SOURCE` 拒绝。
- 测试（check-core 新增 PR F.3.1 块）：setosa/versicolor 高分离 fixture 训练/test 准确率 > 0.8、完整预测 reveal 后 `predictedLabel` 与 `prediction.emitted.payload.label` 均 ∈ 原始标签且 ≠ a/b、决策区域 cells 全部 ∈ 原始标签（语义断言 + 带 labels 的 helper 相等断言）、数值 0/1 目标 → workspace 源 + `{'0':0,'1':1}` 映射、featureColumns 权威（id/unused_numeric 排除、inputSize=2）、XOR 默认 predictMlp/决策区域仍为 a/b。
- 文档：`playgrounds.md` 更新 PR F.3.1 语义；append-only `CHANGELOG.md` 新增本条。
- 验收：`npm run check`（含 render smoke 与 examples check）、`npm run check:compiler`、`npm run build`、`git diff --check` 全部通过；PR A–F.3 全部回归保持。

## 2026-08-08 — Reverse Right Panel Width Slider Direction

- 修复右参数面板宽度滑块的方向反馈问题：右面板锚定在视口右侧，其宽度滑块改为反转视觉方向（向左拖 = 更宽，向右拖 = 更窄），消除「滑块左移 → 面板变窄 → 左边缘右移 → 滑块远离指针 → 快速 snap 到最小值」的 moving-control 问题。
- 实现采用显式反转展示值（确定性、跨浏览器一致）：提取 `RIGHT_PANEL_MIN/RIGHT_PANEL_MAX`（与 `LEFT_PANEL_MIN/LEFT_PANEL_MAX` 一并提取），滑块 `value = RIGHT_PANEL_MIN + RIGHT_PANEL_MAX - rightWidth`，`onChange` 反解回真实宽度写入 `rightWidth`；新增 `aria-valuetext={`${rightWidth}px`}` 让可访问性暴露真实宽度。宽度显示仍为真实 `rightWidth`px（260px–640px），已保存/导入的 `workspace.rightWidth` 无需迁移。
- divider 拖拽语义保持不变（`next = initial + (side === 'left' ? delta : -delta)`：右面板向左拖变宽、向右拖变窄）；左侧组件库宽度滑块保持不变（左=窄、右=宽）。
- 测试：check-core 新增源码级断言——右面板滑块反转 + aria-valuetext 真实宽度、左面板滑块与 divider 语义原样。
- 验收：`npm run check`（含 render smoke 与 examples check）、`npm run check:compiler`、`npm run build`、`git diff --check` 全部通过；PR A–E 全部回归保持。
## 2026-08-09 — Presentation / Recording Mode (PR G.1)

- Added a local Presentation Mode entry from the Playground toolbar with a clean responsive 16:9 teaching stage, minimal Restart / Play-Pause / Exit controls, Space/R/Escape keyboard handling, and optional script-declared annotation/formula content.
- Kept presentation state outside the Visualization Script and reused the existing `SCRIPT_*` runtime actions; added deterministic restart/replay and KNN/LR/MLP rendering coverage plus a no-model-branches source assertion.
- Updated `docs/architecture/playgrounds.md` and localized UI strings in `src/locales/ui.js`.
- Acceptance: `npm run check`, `npm run check:compiler`, `npm run build`, and `git diff --check` passed. G.2 is intentionally not started.
- 2026-08-09 — PR G.1.1: Presentation Mode now observes its available content area and fits the teaching stage to the limiting width or height while preserving 16:9; annotation/formula content is reserved before sizing the stage.
- 2026-08-09 — PR G.2: added a model-independent primitive motion layer with centralized duration policy, script-step clamping, stable semantic identity matching, enter/exit opacity, numeric interpolation, progressive history/trajectory paths, and reduced-motion support. Runtime semantics remain unchanged.
