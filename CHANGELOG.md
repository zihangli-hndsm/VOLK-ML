# Changelog

## 2026-09-01 — Local-first Cloud development bootstrap

- Added an optional `src/services/volkCloud/` client with `VITE_VOLK_API_URL`, a default local endpoint, and non-blocking `available`/`unavailable` health capability states.
- Added a disposable Python standard-library backend fixture at `dev/backend/server.py` with the `/health` contract and allowlisted local CORS origins, plus Windows-compatible `dev:backend` and `dev:all` commands.
- Added a development-only bilingual status indicator; backend absence leaves Explore, World, Experiment, and deterministic Evidence local and usable.
- Added the machine-readable boundary contract, operational local-development guide, environment example, focused health/runtime-independence checks, and GitHub Pages-safe configuration.
- Acceptance: real local `/health` integration, `npm run check:volk-cloud`, `npm run check`, `npm run build`, and `git diff --check` passed. No credentials or provider secrets were added.
- Follow-up: replace the disposable fixture with the separate private `VOLK-Cloud` repository when that backend exists; do not add production backend logic here.

## 2026-08-27 — Explore lifecycle and semantic-truth hardening

- Replaced historical sample-event presentation with an active-lineage projection: “Same World · New sample” now requires a current duplicate baseline, exactly one observation-process change, unchanged model conditions, and a sampling event belonging to the active experiment.
- Unified the first MLP lesson and example around one deterministic, balanced, four-quadrant clean XOR source; retained label noise as the explicitly named `xor-mlp-robustness` source and regenerated the 32-row example.
- Added explicit persistent/ephemeral Explore workspace ownership, bounded Build forks, disposal on close, safe Agent routing cleanup, strict mismatch handling, and explicit recovery before reopening an intended recipe.
- Updated Explore/playground/teaching architecture notes and focused acceptance checks for sampling truth, XOR contracts, lifecycle disposal, and recovery safety.
- Acceptance: focused checks, `npm run check`, and example generation checks passed; build and diff validation follow.

## 2026-08-27 — PR #131 final acceptance grounding fix

- Corrected LUMI interpretation grounding to use only Test Design outcome Evidence, fixed the Phase 14 `challenges` vocabulary, and kept execution-only Evidence from triggering interpretation.
- Preserved learner authorship by disabling discrimination-plan creation until every grouped Hypothesis has an explicit prediction, and added stable IDs to learner Hypothesis revisions for truthful Inquiry Episode references.
- Added exact planner-matrix, revision-identity, Learning Path DAG, and learner-authorship regression coverage with matching architecture notes.
- Acceptance: required focused checks, `npm run check`, `npm run build`, and `git diff --check` passed.

## 2026-08-27 — PR #131 acceptance hardening

- Corrected Phase 13–17 semantics: concrete prediction completeness, child-to-parent revision edges, explicit counterfactual lifecycle and Test Design association, factual Evidence-only observation links, separate Inquiry Trail and coherent Inquiry Episodes, and an ungated eight-node Learning Path DAG.
- Tightened LUMI planner suggestions to existing hypotheses, executed outcomes, authoritative comparison results, and challenged interpretations while keeping every handoff suggestion-only.
- Updated bilingual UI projections, focused acceptance checks, and exploration architecture documentation.
- Acceptance: all Phase 13–17 focused checks, `npm run check`, `npm run build`, and `git diff --check` passed.

## 2026-08-27 — Phase 17 bounded LUMI exploration planner

- Added deterministic, bounded LUMI suggestions across observe, predict, design-test, compare-hypotheses, hold-constant, inspect-evidence, interpret, revise, counterfactual, and explore-concept surfaces.
- Kept suggestions projection-only and routed acceptance to existing presentation surfaces without creating records, dispatching runtime actions, executing tests, or inferring conclusions.
- Added bilingual responsive planner UI and focused authority/determinism checks.

## 2026-08-27 — Phase 16 inquiry trail and learning path

- Added bounded Inquiry Episodes as a notebook projection over existing semantic events and learner records.
- Added the exact eight-topic Learning Path with available/explored/explicitly illuminated session states and no required order or mastery semantics.
- Added bilingual responsive Inquiry Trail and Learning Path surfaces with focused projection and boundary checks.

## 2026-08-27 — Phase 15 counterfactual exploration

- Added bounded learner-owned “What if…?” questions with baseline Experiment and condition-fingerprint provenance, explicit stale guards, and neutral map relations.
- Added explicit conversion into the existing detached Test Design flow without execution, result fabrication, causal claims, or new runtime authority.
- Added bilingual responsive counterfactual UI, Concept Map projection, and focused boundary checks.

## 2026-08-27 — Phase 14 learner interpretation

- Added bounded learner-owned interpretations over stable Evidence instances, optional existing Test Designs, and explicit judgment choices without changing runtime truth.
- Added separate Hypothesis revision lineage that preserves the parent identity and projects neutral `interpreted_in`, `informs_revision`, and `revised_from` relations into Journey and Concept Map.
- Added bilingual responsive interpretation/revision UI and focused boundary checks for historical Evidence references, no automatic status mutation, and no causal/proof semantics.

## 2026-08-26 — Phase 13 competing hypotheses

- Added learner-created competing Hypothesis groups and Discrimination Plans that reuse existing Test Designs.
- Added factual prediction divergence, overlap, and insufficient-prediction states without selecting a winner or changing Hypothesis status.
- Connected the plans to the Concept Map with neutral `predicted_by` and `tested_by` relations, plus bilingual responsive UI and focused boundary checks.

## 2026-08-26 — PR #130 acceptance hardening

- Separated execution-window Evidence occurrences from selected outcome Evidence; only direct `evidenceRefs` provenance can create an outcome reference.
- Reused canonical comparison factor grouping so multiple raw paths do not falsely become a confounded test, and added stale condition-fingerprint rejection coverage.
- Cleaned Test Designer held-constant options and semantic labels without changing the Phase 12 authority boundaries.

## 2026-08-26 — Phase 12 learner Test Design

- Added a bounded, session-local learner Test Design surface for selecting one supported intervention, held-constant factors, observable outcomes, and a prediction without changing runtime state on save.
- Added explicit detached preflight and execution through duplicate → intervene → run → compare, with factual single-factor, confounded, observational, and insufficient comparison labels and stable Evidence instance references.
- Gated sample comparison until a valid baseline exists, added bilingual UI copy, focused 22-assertion coverage, and documented the Test Design/runtime/assistant boundaries.

## 2026-08-26 — Explore learning surface repair

- Restored a learner-facing Linear Regression `Sample again` path that keeps the World fixed, creates a new Dataset, and exposes an optional A/B comparison grounded in the existing observation-process semantics.
- Restored a compact deterministic XOR teaching World for MLP and connected Representation and Mechanism depths to the live network graph and real loss history, including honest empty and stale-state behavior.
- Added bilingual surface copy, responsive regression coverage, and architecture documentation for the repaired Explore learning surface.
- Acceptance: `npm run check`, `npm run build`, browser walkthrough at desktop, 390px, and 1024px widths, and `git diff --check` passed.
- Known limitation: the existing MLP Training Microscope remains a reduced view; this batch exposes real loss history without introducing a second parameter/gradient evidence contract.

## 2026-08-26 — World–Data inquiry loop

- Made the World → observation process → finite Dataset distinction explicit through bounded session/Agent projections for World identity, sampling provenance, deterministic sample IDs, and dataset fingerprints.
- Added the public `RESAMPLE_WORLD` operation and localized “Sample again” World Builder action; resampling preserves generated World identity, emits `observation.sampled`, and never masquerades as a causal World intervention.
- Extended comparison semantics for observation-process changes, same-Dataset/different-model checks, learner prediction metadata, and LUMI Journey Predict/Revise projection without adding reasoning or mastery authority.
- Added a bounded “same finite Data, different possible Worlds” exploration prompt, progressive World/Data semantic badges, bilingual UI copy, and focused World–Data inquiry regression coverage.
- Updated the Design Bible and exploration roadmap. Acceptance: focused World–Data, Composer, Agent, hypothesis, Journey, and UI checks; full `npm run check`; `npm run build`; `git diff --check`.

## 2026-08-24 — LUMI visual identity integration

- Replaced the abstract inline LUMI rendering with four dedicated firefly-inspired Navy/Cyan vector assets for idle, observe, guide, and illuminate presentation states; the semantic mode/presence API and learning logic remain unchanged.
- Added lightweight CSS-only float, focus, Orange intervention pulse, and explicit active-to-illuminated confirmation motion with reduced-motion behavior; concept cards now expose subtle frontier/focus/illuminated visual states.
- Connected transient intervention presentation to meaningful World/model control changes, added the localized accessibility label, extended the LUMI regression check, and documented the visual asset/state contract in the playground and exploration architecture docs.
- Acceptance: focused LUMI check, playground render smoke, full `npm run check`, `npm run build`, `git diff --check`, and manual desktop/390×844 browser checks passed. Final illustrated art remains replaceable through the same four asset paths.

## 2026-08-21 — Phase 10.1 Curiosity Loop foundation

- Added a bounded deterministic Curiosity State projection over Semantic Events, Learner Inquiry candidates, and current observation identities.
- Added four localized curiosity-gap contracts with inspectable reflection references and existing capability directions; Curiosity does not infer confusion or causality and does not create runtime operations.
- Exposed the same Curiosity projection through normal Host snapshots and Agent inspection, with a provider-safe projection that excludes raw World and observation payloads.
- Added focused deterministic curiosity checks and architecture documentation; Goal 2 concept matching, Concept Cards, adaptive curriculum, and background AI remain deferred.

## 2026-08-21 — Phase 10.1 acceptance hardening

- Made the curiosity registry authoritative for gap, concept, question, direction, action, and capability fields; forged or oversized caller state is rejected.
- Added deterministic priority and current-comparison-pair checks, plus capability filtering that preserves truthful reflections without exposing unavailable actions.
- Tightened the provider projection and prompt contract to omit internal event/observation/Experiment identifiers and raw evidence while preserving bounded curiosity context.

## 2026-08-23 — OpenAI Responses exploration schema compatibility

- Fixed strict JSON Schema compatibility for exploration guidance by adding explicit primitive types to all constant-constrained shape, density, region, noise, patch, and pedagogical experiment fields.
- Added recursive regression coverage for constant schema nodes used by the OpenAI Responses request path.
- Acceptance: `node scripts/check-openai-responses.mjs`, full `npm run check`, `npm run build`, and `git diff --check` passed; no runtime or persisted-data behavior changed.

## 2026-08-18 — Contextual Tune

- Added bounded, model-owned control presentation metadata separating semantic domain from learner-facing importance and role.
- Tune now foregrounds descriptor-selected primary controls, keeps secondary/advanced controls behind an accessible More controls disclosure, and preserves the complete Inspector inventory.
- Added localized primary-control hints and deterministic Changed/Held constant markers from existing comparison factor state.
- Added Contextual Tune behavioral checks for KNN, Linear Regression, legacy controls, accessibility, responsive safety, and runtime-safe presentation.

## 2026-08-18 — Layered Exploration UI

- Added an explicit Play/Tune/Inspect presentation hierarchy without changing World, Experiment, comparison, evidence, or Agent runtime semantics.
- Grouped model controls in a semantic Tune surface while keeping full World tools and the complete model Inspector reachable through existing paths.
- Standardized responsive depth/Inspector drawers to an approximately 300px desktop/tablet width and retained the Compact bottom-sheet behavior.
- Added focused layered UI checks for control reachability, Agent result hierarchy, responsive presentation, and reduced-motion architecture.

## 2026-08-18 — World Composer v1 final acceptance

- Corrected crescent inner-arc direction and continuity, and made arc-density checks use normalized geometric path length (`s`) rather than raw curve parameters.
- Added the bounded KNN World `validateWorld`/`applyWorld` path with authoritative train/test membership and task-aware classification accuracy observables; MLP World mutation remains deferred.
- Narrowed world-design compatibility clarification to structured adapter/task compatibility failures; stale, resource, validation, and unexpected errors now retain their own error semantics.

## 2026-08-14 - Phase 7 Big-Idea exploration entrances

- Added a deterministic BigIdeaEntrance v1 registry for Finding Patterns, Noise and Robustness, Generalization, Distribution Shift, and Model Capacity.
- Added atomic concept-first initialization over ordinary World, model, Experiment Workspace, Run, Compare, Evidence, Guided Explore, and Thread semantics, with Agent inspection provenance and no AI requirement.
- Added localized, keyboard-accessible entrance cards and a non-blocking starter question with explicit optional Thread creation and restart.
- Added Distribution Shift manual Test-support acceptance coverage, immediate-divergence coverage, real MLP hidden-unit evidence, architecture documentation, and integrated registry/runtime checks into `npm run check`.
- Acceptance fix: canonicalized effective entrance seeds across session creation and entrance-owned World regeneration, and strengthened registry validation for model compatibility, setup controls, World transactions, affordances, and malformed declarations.

## 2026-08-18 — World Composer exact-path and path-density acceptance fixes

- Rebased the existing World Composer acceptance branch onto the merged PR #99 main ancestry and retained the semantic fixes without a duplicate parallel ancestor.
- Scenario fidelity now compares exact normalized recipe paths for edits, including group, split, property, and component identity; whole-recipe creation remains an explicit exception.
- World.task now follows the current materialized realization rather than a dirty desired recipe, and detached preflight rejects incompatible attached models atomically.
- Moon materialization is a validated intersecting-circle crescent with real inner/outer arcs; ellipse outlines, spirals, and moons apply density over deterministic geometric arc length.
- Provider numeric schema fragments, local patch validation, and canonical ScenarioSpec recipe paths now share strict bounds and cannot trust fabricated fidelity declarations.
- Acceptance: World Composer, Exploration Agent, OpenAI Responses, World Builder, full `npm run check`, production build, and `git diff --check` pass; no browser or GitHub Actions claim is made.

## 2026-08-13 - Phase 5 Exploration Agent learner mode

- Added a capability-grounded ScenarioSpec v1 proposal pipeline with deterministic intent fallback, change/hold/observe validation, fidelity reporting, and stale-proposal rejection.
- Added explicit Agent execution over existing Duplicate, World transaction, Run, Compare, Repeat, and evidence semantics with agent provenance and evidence focus.
- Added a learner-facing Explore with Agent panel while preserving advanced Teaching Script tooling behind an explicit section.
- Added deterministic Phase 5 core and host regression coverage for preview-only proposals, controlled outlier/test-shift experiments, unsupported capabilities, hidden confounds, resources, and manual/view staleness.
- Acceptance fix: proposal fidelity now comes from detached preflight, accepted scenarios commit atomically, generator parameters are typed, two-distributions changes both registered input families, and line-move uses recoverable World history or clarifies.
- Learner interpretation can use the existing configured AI provider for high-level intent with a bounded local fallback; AI output never contains execution authority.

## 2026-08-13 - Phase 4 acceptance fixes

- Corrected train/test coverage fractions for overlap, containment, disjoint, and point ranges.
- Bound Repeat evidence to a canonical semantic condition fingerprint and filtered stale evidence at the runtime evidence boundary.
- Exposed the shared recipes, Things to Try, affordance IDs, and recipe observable references through Agent inspection.

## 2026-08-13 — Phase 4 Manual & Guided Exploration UX

- Added shared raw/derived observable derivation, deterministic evidence-only observation detectors, and Agent inspection parity.
- Added bounded deterministic Repeat for generated Worlds with per-trial and aggregate evidence while preserving the active Experiment.
- Added quiet Things to Try, open recipes, semantic affordance highlighting, dismissible notices, and localized evidence surfaces.
- Added Phase 3 generator edge-state regression coverage and integrated Phase 4 checks into `npm run check`.

## 2026-08-13 — Finalize browser playback failure semantics

- Preserved existing timeline fields when model adapters return partial patches, keeping playback speed valid after training starts.
- Added a shared failure-safe browser scheduler that stops on rejected dispatches and surfaces the action, teaching step, operation, and reason while preserving the last valid semantic state.
- Added focused timeline, reduced-motion, scheduler integration, and browser acceptance coverage; updated playground architecture notes.

## 2026-08-13 — Data Lab playback regression and classification safeguards

- Linear Regression teaching playback now samples the adapter-declared training timeline across reveal steps, and the shared scheduler advances both script and model-only playback through finite semantic actions.
- Classification projections no longer enable unlabeled point creation or fabricate a label; the Data Lab explains that a new classification observation requires an explicit label.
- Acceptance: exploration, render smoke, examples sync, production build, and browser playback checks passed.

更新日志只追加、不修改：每个已验收的开发周期在文件末尾新增一条记录；已有条目一律不改写、不删除（如需更正，以新条目形式补充说明）。

## 2026-08-05 — Canvas UX fixes

- 新组件现在添加到画布当前视野的中央，而不是固定坐标；平移/缩放后添加同样生效。
- 新增“多选”模式开关：平板/触屏用户可点选多个组件后再“组合”；桌面端 Shift/Ctrl/Meta + 点击多选保持不变，Backspace 批量删除不受影响。
- 出错时只标红可定位的出错组件：校验/运行时错误按契约给出的节点定位；缺数据集、无边等图级错误不再把全部组件标红，只显示错误信息。
- 修复仓库内 7 处换行/断词损坏（`scripts/check-core.mjs`、`src/core/project.js`、`src/main.jsx`），恢复 `npm run check`、数据对话框“使用”按钮和两处样式。
- 删除误提交的 `tmp_branch_marker.txt`；统一 `src/core/compiler.js` 与 `docs/architecture/compiler-ir.md` 的换行为 LF。
- 检查脚本兼容 Windows（`python3`/`python` 回退）；`browserExecutionContract.js` 为可归因的校验失败补充具体节点归属。
- 验收：`npm run check`、`npm run build`、`git diff --check` 全部通过；Chrome 浏览器实测 15/15 通过。

## 2026-08-17 — World Composer semantic acceptance fixes

- Hardened recipe-level fidelity: normalized recipe paths now map to explicit semantic domains, whole-recipe creation is explicit, and accidental shape/sampling/noise/split changes become partial fidelity.
- Added strict, bounded WorldRecipe patch validation with split-specific train/test transforms, deterministic density domains, interior polygon triangulation, self-intersection rejection, and no silent numeric coercion or clamping.
- Preserved scoped deterministic materialization and legacy generator compatibility; expanded Agent-facing recipe summaries without raw observations and added focused schema, geometry, density, provenance, split, fidelity, and lifecycle regressions.

## 2026-08-05 — 教学增强：画布适配、示例数据集、教学示例与路线图

- 修复首屏画布错位：样式异步加载会让 React Flow 用错误的容器尺寸适配；现在通过 ResizeObserver + 手动视口计算做“稳定重适配”，首次加载与加载示例后图形都完整落在画布内。
- 示例数据集提升到界面：数据对话框新增 6 个内置数据集（考试成绩、花卉品种、鸢尾花、红酒品质、能源负荷、垃圾邮件），带中英文文案。

- 新增 8 个教学示例项目（`examples/`）：房价预测、鸢尾花 KNN 分类、垃圾邮件 MLP 分类可在浏览器运行；能源负荷（自定义损失 + AdamW）、糖尿病风险（残差 MLP）、猫狗 CNN、电影推荐（Embedding）、情感分析（LSTM）可导出 PyTorch/TensorFlow 代码。
- 新增“示例”画廊：顶部导航可打开，卡片展示任务、组件覆盖与可运行/导出徽标，一键加载到画布。
- 新增 `docs/roadmap.md`：列出向量搜索、LLM 聊天机器人、AI Agent 规划等未实现任务与基础设施规划，README 增加入口。
- `npm run check` 新增示例验证：8 个示例逐个加载校验、可运行示例真实执行、可导出示例的双框架代码经 Python 语法校验。
- 验收：`npm run check`、`npm run build`、`git diff --check` 全部通过；浏览器实测 9/9 通过。

## 2026-08-18 — Contextual Tune acceptance correction

- Changed/Held Tune markers now use real runtime comparison control evidence: only exact controls present on both sides can be marked, preventing factor-level or derived-output false positives.
- Centralized bounded control-presentation validation in the playground registry, including supported importance/role metadata and the three-primary-control limit; legacy controls remain reachable through the fallback.
- Acceptance: focused Contextual Tune, layered UI, responsive, and Playground render checks; full `npm run check`; production build; and `git diff --check` pass.

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

## 2026-08-08 — Finalize Agent Semantic Contracts（PR D.2）

- Operation trace 语义与真实运行时对齐：`scriptOperations` 新增 `enablesTrace`（由后续 STEP/reveal/playback 产生的事件），`alwaysProducesTrace`/`mayProduceTrace` 严格表示「调用该操作时直接产生」的事件；KNN `tracePredict` 只直接产生 query.received/knn.distancesComputed，neighbor/vote/prediction 移入 enablesTrace；KNN `moveQuery` 在已 reveal 状态下可立即产生 neighbor/vote/prediction（mayProduceTrace）；LR `traceFit` 的 prediction.updated/residuals.computed 移入 enablesTrace，loss/gradient/parameters 按发散/早停路径诚实归入 may。
- 运行时 trace delta 契约测试：捕获操作前 traces → 调用操作 → delta 必须 ⊆ always∪may；每个 always 事件必须实际观测到；代表性状态覆盖 LR 正常/发散、KNN 未 reveal/已 reveal 的 moveQuery。
- inspectContext 暴露 `controlSchemas`：来自 Playground descriptor 的 key/type/min/max/step/options（保留当前 `controls`）；一致性测试：每个当前 control 有 schema、schema key 都是真实 control、controlSchemas 与 descriptor deepEqual。
- 组合类型契约补全：`typeContracts.js` 对 line2d（start/end point2d、weight/bias 有限）、ranges2d、axes2d、decisionRegion、voteState、trainingState、projection、normalization、formula、observation、metrics 做结构校验；负例（空 line、空 axes、malformed cells、非对象 counts）被拒绝。
- validator 清理：`maxDecisionResolution` 资源校验仅作用于 `decision-region` primitive（不再误伤未来带 resolution 属性的图元），并拒绝非正整数/小数 resolution（`SCRIPT_TOO_COMPLEX`）；dry run 的 resolved 校验同样要求正整数。
- 文档：`agent-canvas-api.md` 与 `playgrounds.md` 更新 PR D.2 语义。
- 验收：`npm run check`、`npm run check:compiler`、`npm run build`（680 modules）、`git diff --check` 全部通过；PR A–D.1 全部回归保持。

## 2026-08-08 — Final Runtime Contract Closure（PR D.3）

- resolved 资源校验精确化：移除 `Number(...) || 48` 的 truthiness 兜底——`0`/`-1`/`2.5`/`NaN`/超上限的 resolved resolution 不再静默变成 48；仅当 resolution 确实缺失（undefined）时才用 renderer 默认 48。
- 逐步骤资源校验：dry run 新增共享 `validateResolvedResources`，在 initial、每个重放步骤、final 快照的 materialize 后执行（先于 primitive 契约校验，保证 resolution 错误统一为 `SCRIPT_TOO_COMPLEX`）；中间步骤超限、后续步骤回落的脚本也会失败。
- 共享规则：`isValidDecisionResolution`（正整数且 ≤ max）同时供静态 validator 与 dry run 使用；`RESOURCE_LIMITS` 增加 `defaultDecisionResolution: 48`。
- 初始 controls 强制校验：`createRuntimeSession` 在 session/runtime 边界对每个外部传入的初始 control 用 Playground descriptor 校验（未知 key / 低于 min / 高于 max / 非法 select 选项 → `INVALID_PLAYGROUND_CONTROL`），`open({ controls })` 不再绕过 `validateControlValue`。
- 契约一致性：新增不变式测试——adapter 默认初始 controls 与有效 override 后的每个 live control 都符合其 controlSchema；LR/KNN 各跑一遍。
- LR `learningRate` 描述符 max 由 1 提升到 5（有依据：标准化 z-score 数据下 lr>1 才是演示“学习率过高”教学场景的必要条件），因此 D.2 的发散测试不再依赖越界 control；`learningRate: 6` 等越界值在公开路径被拒绝。
- 文档：`agent-canvas-api.md` 与 `playgrounds.md` 更新 PR D.3 语义。
- 验收：`npm run check`、`npm run check:compiler`、`npm run build`（680 modules）、`git diff --check` 全部通过；PR A–D.2 全部回归保持。

## 2026-08-08 — TeachingPlan + Deterministic Composer（PR E.1）

- 新增中间 TeachingPlan 层：目标教学链路变为 `goal → inspectContext → Teaching Planner → TeachingPlan → Composer → Visualization Script → validateScript → dryRunScript → load`；TeachingPlan v1 是 JSON-safe、模型无关的教学意图描述（`explain-process` / `compare-control` / `what-if` / `diagnose`）。
- 确定性 Planner（`src/core/playground/agent/teachingPlanner.js`）只消费 `inspectContext()`：比较值与 what-if 值一律对照 `controlSchemas`（min/max/options）校验，未声明控件或越界值返回稳定错误 `TEACHING_CONTROL_INVALID` / `TEACHING_VALUE_OUT_OF_RANGE` / `TEACHING_GOAL_UNSUPPORTED` / `TEACHING_PLAN_INVALID`；结构化 goal 对象作为未来 LLM Planner 必须遵守的确定性契约。
- 确定性 Composer（`src/core/playground/agent/teachingComposer.js`）从 PR D 的 primitive schema（`compatibleBindings`）与 adapter 的 `scriptOperations` 发现图元与绑定，无任何模型特判渲染分支；`setup` 步骤按 `controlSchemas` 过滤控件（KNN 不会收到 LR 专属控件，反之亦然）。
- 新增 capture 语义：`capture` / `restoreCapture` 成为一等 script step 操作，capture 保存 JSON-safe 的 controls/modelState/dataState/语义 scene；比较型脚本（如 k=1 vs k=15）执行「capture baseline → 跑 k=1 → capture left → restore baseline → 跑 k=15 → capture right」，恢复不破坏 `sessionBaseline` / `scriptBaseline`，同 seed 重放完全确定；新增错误码 `SCRIPT_CAPTURE_MISSING`。
- Agent 新增 `canvas.playground.plan(goal)` 与 `canvas.playground.composeScript(plan)`（additive，`apiVersion` 保持 1）；compose 产物先过 validator + 严格 dry run 才返回，由调用方 `loadScript()` 加载；`TEACHING_*` 错误与 `SCRIPT_CAPTURE_MISSING` 经 Agent 归一化透传。
- 本地化：`playground.comparison.*`、`playground.whatIf.*`、`playground.process.*` 新增中英文键。
- 测试（check-core 新增 PR E.1 块）：TeachingPlan JSON-safe/校验往返、空 goal 与未知 goal 类型拒绝、未声明控件拒绝、比较值越界拒绝、Planner 仅使用已声明控件（LR 收到 k=... 目标回落 explain-process）、Composer 仅使用已声明 primitive/兼容绑定/操作、capture 确定性重放、baseline 恢复与双 baseline 不被污染、composed script 过 validator + 严格 dry run（零 warning）、Agent plan→compose→load→replay 端到端、错误码透传、LR/KNN 现有 presets 不变。
- 文档：`agent-canvas-api.md` 新增 `plan()` / `composeScript()` 与 `TEACHING_*` 错误码；`playgrounds.md` 新增 PR E.1 小节与验收路径。
- 验收：`npm run check`（含 render smoke 与 examples check）、`npm run check:compiler`、`npm run build`（683 modules）、`git diff --check` 全部通过；PR A–D.3 全部回归保持。已知限制：capture 不绑定 `$capture.*` 表达式（留待需要时再定义）；文本目标仅支持 k=... / 学习率关键词，更广的自然语言理解留给未来 LLM Planner。

## 2026-08-08 — TeachingPlan 成为可执行中间表示（PR E.1.1）

- TeachingPlan.phases 类型化并语义化：`observe / set-control / run / reveal / capture / restore / summarize` 七个 phase kind；Composer 改为逐 phase 编译，不再从 `goal.type` 重新生成教学序列；测试证明删除/重排 phase 会改变生成脚本、相同 phases 不同 goal.type 生成完全相同的脚本。
- 文本解析与 schema 规划分离：新增 `src/core/playground/agent/teachingGoalParser.js`（`parseTeachingGoalText` → 结构化 goal 候选，仅做词汇识别，不做模型决策）；planner 只消费 `inspectContext()` —— 控件存在性/取值来自 `controlSchemas`、run objective 来自控件描述符的声明式 `runObjective`、操作按 `intent`（`predict`/`fit`）从 `context.model.operations` 选择、reveal 次数来自操作的 `playback.revealCountControl`。显式请求不可用控件（LR + `k=1 和 k=15`、KNN + 学习率）返回 `TEACHING_CONTROL_INVALID`，不再静默降级为 explain-process。
- 比较语义修正：`compare-control` 采用 v1 二元契约（恰好 2 个值，`[1,5,15]` 与单值 compare 均拒绝）；不再默认补 `15`。KNN k=1 vs k=15 的左右 capture 现在都是「已完成证据」——按 k 执行 reveal 播放，capture 含真实 voting/prediction（`revealed=k`、邻居数=k），而非 `revealed=0` 空壳。
- Composer 去模板化：删除 `base=[...]` / `knn=[...]` 分组与 `tracePredict/traceFit/showNeighborOrder/showDecisionRegions/showResiduals/showBestFit` 硬编码假设；primitive 可物化性由 `compatibleBindings` 判定，stage/side 排布来自新增的声明式 `placement` 元数据，可见性条件来自 `whenControl` 元数据（`visualization/schemas.js` 为唯一来源），操作选择按 `intent`，reveal 来自 phase count。
- 上下文前置校验：新增 `validatePlanAgainstContext`（playgroundId 匹配、控件/证据字段/run objective 存在性），跨 playground 或 stale plan 在组合前即失败（`TEACHING_PLAN_INVALID` / `TEACHING_CONTROL_INVALID`）。
- capture 分支隔离：capture 现在同时保存 controls/modelState/dataState/timeline/trace 检查点/完整 semantic 快照（scene+metrics+observation+formula）；restore 恢复 timeline 并按 traceCount 截断 traces，保证「fresh baseline → branch B」与「branch A → restore → branch B」的语义状态完全一致；`sessionBaseline`/`scriptBaseline`/`scriptState` 永不被 restore 触碰。
- 不宣传未实现能力：`diagnose` 从 `TEACHING_GOAL_TYPES` 移除，结构化与文本（诊断/diagnose）请求均返回 `TEACHING_GOAL_UNSUPPORTED`。
- 交叉矩阵测试：LR compare weight、LR compare learningRate、KNN what-if k、双模型 explain-process 全部走通用链路并通过 validator + 严格 dry run；测试还覆盖 parser 单元、cardinality 负例、跨 playground/stale plan、phase 驱动、intent 解析、placement 元数据与 completed-capture 断言。
- 文档：`agent-canvas-api.md` 与 `playgrounds.md` 更新 PR E.1.1 语义（typed phases、parser 分层、泛型 composer、capture 隔离、diagnose 拒绝）。
- 验收：`npm run check`（含 render smoke 与 examples check）、`npm run check:compiler`、`npm run build`、`git diff --check` 全部通过；PR A–E.1 全部回归保持。已知限制：`diagnose` 语义留待后续；what-if 的文本别名仅覆盖「学习率太高/发散」等关键词，显式 `key=value` 语法是通用入口。

## 2026-08-08 — TeachingPlan 契约收口（PR E.1.2）

- 展开前资源上限：新增 `estimateCompiledStepCost(plan)`（observe/set-control/run/capture/restore/summarize=1，reveal=count，不实例化步骤）；`validatePlanAgainstContext` 在 `compilePhases()` 之前按 `context.resourceLimits.maxSteps` 校验「原始 phase 数量」与「估算编译步数」，超预算返回 `TEACHING_PLAN_INVALID`（reason: resource limit）。测试覆盖 count=maxSteps 诚实通过、>maxSteps 拒绝、10^9 reveal 不展开直接拒绝、大量小 phase 超预算拒绝、正常 KNN/LR plan 通过。
- 不可信输入重校验：新增共享 Teaching 级控件校验器 `validateTeachingControlValue`（Planner 目标校验与 TeachingPlan 上下文校验共用），绝不静默强转——数值控件要求真实有限数字且在 [min,max] 内、布尔控件要求真实 boolean、select 控件必须是已声明选项；未声明选项的 select（如 KNN xFeature/yFeature）判为「不可安全规划」并拒绝。负例（k=999、learningRate=-1、boolean="yes"、distanceMetric="manhattan"、xFeature="does-not-exist"）全部在 TeachingPlan/上下文校验阶段失败，不等到 dry run。
- 恢复 primitive 可见性语义：`reference-line.whenControl='showBestFit'`、`residual-lines.whenControl='showResiduals'`（与 `decision-region.whenControl='showDecisionRegions'` 一致）写入 schema；Composer 仍只使用声明式 `whenControl`。测试经真实 Primitive Materializer 验证 composed LR 脚本的 residual-lines/reference-line 随 showResiduals/showBestFit 物化/隐藏，并比对 preset 条件语义与 schema 元数据一致。
- Planner 真正只依赖 inspectContext：`teachingPlanner.js` 移除 `visualization/schemas.js` 导入，`evidenceForContext()` 直接读 `context.primitives` 的 placement/compatibleBindings；测试用 structuredClone 的序列化 context 证明规划与组合仍可用，并静态断言 planner 不再导入内部 primitive registry。
- capture id 内部化：比较型 plan 的 captureId 固定为 `baseline/left/right`（不再 `String(value)`），用户/控件值只保留在 `plan.goal.values`、summarize params 与 captured controls 中；字符串/select 值（如 `"baseline"`）不可能覆盖实验基线。测试用 select 值 `['baseline','left']` 的合成 fixture 证明 capture step id 不与用户值碰撞。
- runObjective 视为真实契约：控件声明 `runObjective` 但 context 中找不到匹配 `intent` 的操作时，plan 直接失败（`TEACHING_PLAN_INVALID`，reason: unresolvable run objective），不再静默退化为仅 set-control；未声明 runObjective 的控件仍可走即时 set-control 证据。测试覆盖删除全部 predict intent 操作后的 stale context。
- plan() 前置校验：确定性 Planner 返回前执行与 Composer 相同的 context/资源校验，`plan()` 成功即保证结构有效、控件值有效、objective 可解析、且不会超出 maxSteps；`composeScript()` 仍会重校验（外部 plan 不可信）。测试覆盖「值合法但展开后超预算」的 compare（k=1 vs k=500）在 plan() 阶段即被拒绝。
- 文档：`playgrounds.md` 与 `agent-canvas-api.md` 更新 PR E.1.2 语义；append-only `CHANGELOG.md` 新增本条。
- 验收：`npm run check`（含 render smoke 与 examples check）、`npm run check:compiler`、`npm run build`、`git diff --check` 全部通过；PR A–E.1.1 全部回归保持（phase 驱动、intent 查找、二元比较、KNN 完成态证据、capture 分支隔离、跨 playground 拒绝、LR compare weight/learningRate、KNN what-if k、双模型 explain-process、既有 presets）。

## 2026-08-08 — Goal Taxonomy + Goal Fidelity（PR E.2）

- 有界教学目标分类：新增 `src/core/playground/agent/teachingTaxonomy.js`，定义 9 个教学 objective（`introduce` / `compare` / `explain_prediction` / `show_training` / `show_error` / `show_parameter_effect` / `show_generalization` / `show_feature_effect` / `show_failure_case`）；`getSupportedTeachingObjectives(context)` 完全按能力/模式推导（predict intent + neighbor/vote 证据 → explain_prediction；fit intent + training 证据 → show_training / show_failure_case；存在可规划控件 → compare / show_parameter_effect；任意 playground → introduce），无任何 KNN/LR 目标映射表；`inspectContext().teaching` 同时暴露完整分类与当前上下文支持集。
- 目标归一化与向后兼容：E.1 的 goal family（compare-control / what-if / explain-process）保持不变，新增语义 `objective` 字段（如 `{ type: 'compare-control', objective: 'compare', control: 'k', values }`、`{ type: 'explain-process', objective: 'explain_prediction' }`）；Composer 不依赖自然语言措辞。不支持的目标显式拒绝（`TEACHING_GOAL_UNSUPPORTED`），不再静默降级为 explain-process——例如 LR 上的 explain_prediction、KNN 上的 show_failure_case、任何上下文中的 show_generalization / show_feature_effect。
- Goal Requirement / Fidelity Contract：`teachingFidelity.js` 把归一化目标转成显式机器可读需求（控件赋值、操作 intent 最低次数、reveal 次数、capture id、语义证据路径、运行时 trace 事件）；`evaluateGoalFidelity({ plan, script, context, execution })` 返回 `{ valid, checks, missing }`。静态 fidelity 检查 setControl 值、intent 调用次数、reveal/capture 编译、证据 primitive 绑定；运行时 fidelity 通过 `replayScriptForFidelity` 在 detached clone 上确定性重放，验证「操作被调用」之外的「教学结果已产出」——capture 必须存在且携带非空语义证据（如 `metrics.predictedLabel` 非空、`training.lossHistory` 非空），要求的 trace 事件（`prediction.emitted` / `training.completed` / `loss.measured`）必须真实产生。
- `composeScript()` 强制 fidelity：validate TeachingPlan → compose → validate Script → 严格 dry run → goal fidelity，成功返回 `{ mode: 'composed', plan, script, fidelity, dryRun }`；fidelity 失败抛稳定错误 `TEACHING_GOAL_FIDELITY_FAILED`（含 structured missing），不再仅因技术性合法就返回「成功」脚本。
- 验收案例：① compare k=1 vs k=15 的 fidelity 证明 set k=1 / set k=15 / 双分支 predict / 双分支 completed capture，负例（删 k=15 赋值、删第二次 predict、删第二次 reveal、删 right capture）保持语法合法但 fidelity 失败；② 学习率过高由 planner 推导 `learningRate > baseline` 且落在 controlSchemas 内，脚本证明 fit 调用、训练播放、loss 证据与参数移动证据（`training.parameterHistory` 非空），仅开 residual 可视化的脚本 fidelity 失败；③ explain KNN prediction 归一化为 `explain_prediction`，经 context 声明的 predict 操作与语义字段证明 query/邻居排序/reveal/投票/预测标签；泛型 evaluator 与 taxonomy 均无 `knn-classification`/`linear-regression` 模型特判（源码级断言）。
- 测试（check-core 新增 PR E.2 块）：taxonomy 暴露与支持集推导、objective 归一化、不支持目标拒绝、三大验收案例正反例、composeScript fidelity 失败路径、无模型特判源码断言；PR A–E.1.2 全部回归保持（parser 候选与 learning-rate 拒绝断言按新增 objective 语义更新）。
- 文档：`playgrounds.md` 与 `agent-canvas-api.md` 更新 PR E.2 语义；append-only `CHANGELOG.md` 新增本条。
- 验收：`npm run check`（含 render smoke 与 examples check）、`npm run check:compiler`、`npm run build`、`git diff --check` 全部通过。已知限制：`show_error` / `show_generalization` / `show_feature_effect` 在 E.2 中保持不支持并显式拒绝；`$capture.*` 绑定与 DSL v2 比较渲染仍未引入。

## 2026-08-08 — Make Goal Fidelity Outcome-Truthful（PR E.2.1）

- `show_failure_case` 必须证明真实失败：fidelity 需求新增 trace payload 谓词（如 `{ trace: 'training.completed', where: { stoppedReason: ['learning-rate-too-high', 'diverged'] } }`，JSON-safe 且泛型）；`training.completed` 存在但无 `stoppedReason` 或报告正常完成 → fidelity 失败（「训练发生了」≠「失败发生了」）。变异 fixture：正常成功训练（有 loss、有 parameter history、无 stoppedReason）在 `evaluateGoalFidelity` 中失败并报告缺失谓词。
- 文本解析器移除数值策略：`学习率太高 / learning rate too high / diverges` 只输出语义探针 `{ type: 'what-if', objective: 'show_failure_case', control: 'learningRate', direction: 'increase' }`，不再输出 `value: 2`；数值完全由 Planner 依据「当前 controls + controlSchemas + objective + direction」推导（高探针 > 当前 baseline 且 ≤ schema.max）。测试覆盖 baseline 0.05→>0.05、1.5→>1.5、3→>3、5→拒绝（无更高合法值），同一语义文本在不同状态下产生不同数值 plan；不支持的方向（decrease）显式拒绝。
- 证据分类：`evidence` 拆分为 `visualEvidence` / `runtimeEvidence` / `traceEvidence` 三类。visualEvidence 只按 Script 声明中具体的 `primitive.props` 绑定判定（`$model.training.lossHistory` 必须真的被某个 primitive 绑定，仅 schema `compatibleBindings` 可绑定不算）；runtimeEvidence 检查重放语义状态（`metrics.predictedLabel`、`training.parameterHistory`）；traceEvidence 检查事件出现与 payload 谓词。不再把每个 runtime-only 字段误当成需要有可视化 primitive，也不再仅因字段存在于模型状态就宣称被可视化。
- 参数移动 fidelity 修正：不再假装 `loss-curve` 可视化 `training.parameterHistory`；参数移动通过真实 runtime/trace 证据验证（`training.parameterHistory` 非空与 `gradient.computed` trace），与模型实际发射行为一致（lr 过高时适配器发出 loss.measured + gradient.computed + training.completed{stoppedReason}，不发 parameters.updated）。未新增 ParameterTrajectory primitive。
- 教学能力声明可扩展：model adapter 新增声明式 `teachingCapabilities`（如 KNN `explain_prediction{operationIntent:'predict', visualEvidence, runtimeEvidence, traceEvidence}`；LR `show_training` / `show_failure_case`，后者包含失败信号谓词），经 `inspectContext()` 暴露（`teaching.capabilities` / `teachingCapabilities`）。`getSupportedTeachingObjectives(context)` 只按「已声明能力 + operationIntent 可解析」推导——`fit + training 字段` 不再单独暗示 show_failure_case，`predict intent` 不再单独暗示可解释预测；taxonomy 不再硬编码 `neighbors`/`voting` 等 KNN 字段名（源码级断言）。未来 MLP 可声明 logits/probabilities/predictedLabel 而不改泛型 evaluator。
- 强化变异测试：① 正常完成训练（无 stoppedReason）→ fidelity 失败；② 相同类型 primitive 把绑定从必需证据路径改成另一条 schema 兼容路径（LR `$model.line` → `$model.bestFitLine`）→ `visual:line` 失败（专门防只查 compatibleBindings）；③ 移除非可视化 primitive 不影响 runtime-only 证据（KNN explain 移除 metric-card 仍 valid；同一字段若被声明为 visualEvidence 则失败）；④ 移除 loss-curve 使 `visual:training.lossHistory` 失败但 `runtimeEvidence:final:training.parameterHistory` 仍通过——证据类别不混淆。
- 回归保持：E.2 全部行为（有界 taxonomy、归一化 objective、inspectContext teaching 支持、mode:'composed'、静态+运行时 fidelity、compare k=1 vs k=15、completed captures、KNN explain prediction、不支持目标拒绝、TEACHING_GOAL_FIDELITY_FAILED、E.1 契约/资源防护、既有 presets）全部保持；仅 parser 候选断言与 evidence 命名按新语义更新。
- 文档：`playgrounds.md` 与 `agent-canvas-api.md` 更新 PR E.2.1 语义；append-only `CHANGELOG.md` 新增本条。
- 验收：`npm run check`（含 render smoke 与 examples check）、`npm run check:compiler`、`npm run build`、`git diff --check` 全部通过。已知限制：show_failure_case 的 loss/gradient trace 以当前确定性探针（有限值域 learning-rate-too-high）为真；`diverged` 路径由谓词接受但 loss/gradient 事件不会在非有限分支发出。

## 2026-08-08 — Align Failure Teaching Capability with Runtime Evidence（PR E 收口）

- 契约对齐：`show_failure_case` 的失败谓词从 `stoppedReason: ['learning-rate-too-high', 'diverged']` 收窄为 `['learning-rate-too-high']`，与运行时实际可检查的证据一致——该分支会发出 `loss.measured` + `gradient.computed` 并保留 `training.parameterHistory`；早期非有限 `diverged` 分支不会发出这两个事件，因此不再被当前教学能力宣称支持（保留 `loss.measured` / `gradient.computed` / `training.parameterHistory` / `training.lossHistory` 作为必需证据）。
- 语义精确定义：`show_failure_case = 演示可检查的 learning-rate-too-high 停止机制（loss 与 gradient 证据存在）`；原始的 `stoppedReason: 'diverged'` 仍是合法运行时行为，但保留给未来的教学能力契约，不在此刻宣称可教学。
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
- 2026-08-09 — PR G.2.1: Presentation Mode now consumes one coherent motion frame for Stage, annotation, and formula teaching content; centralized easing is executed truthfully, reduced motion settles immediately, and intermediate teaching frames settle back to exact semantic props.
- 2026-08-10 — Agent usability iteration: added an ephemeral browser-side LLM goal interpreter with bounded context, typed TeachingGoal validation, one repair attempt, local-parser fallback, playground-specific Agent examples, and centralized human deletion confirmation. API credentials remain memory-only and are excluded from project/autosave/export paths.
- 2026-08-10 — Encoding audit: repaired remaining mojibake in the Agent panel and compiler documentation, and documented UTF-8/connector transport validation in `AGENTS.md`.

## 2026-08-11 - Phase 0 Exploration Semantic Foundation

- Added versioned, JSON-safe `World` and `Experiment` contracts for finite 2D sample observations, stable IDs, train/test membership, provenance, seed policy, duplication, restore, serialization, and semantic comparison.
- Added model-independent World operations and mutation boundaries, then synchronized the same semantic state from the existing unified Playground runtime into runtime snapshots and Agent `inspectContext()` without creating a second reducer.
- Declared model/learning/evaluation/view control domains for LR, KNN, and MLP; preserved script capture/restore semantic state and current project persistence/version behavior.
- Updated `docs/architecture/exploration-semantics.md`, `docs/architecture/playgrounds.md`, and made the JSX smoke entry cross-platform on Windows.
- Validation: `npm run check`, `npm run check:compiler`, `npm run build`, and `git diff --check` passed. KNN/LR/MLP render smoke and 12 example checks passed.
- Deferred: full 2D drawing workspace, learner-facing Experiment Bar, compare UI, persistent experiment history, generators, and undo UI remain Phase 1/2/3 scope.

## 2026-08-12 - Integrate Scenario Infrastructure into Exploration Roadmap

- Made `docs/exploration-roadmap.md` the explicit single source of truth and selectively integrated the Scenario Engine supplement without creating a parallel backlog or expanding the Phase 1 Workspace scope.
- Strengthened the roadmap with World State/Rules/Observation Process/Intervention boundaries, a conceptual ScenarioSpec and `change`/`hold` constraints, first-class raw and derived observables, branch-capable Experiment lineage, grouped semantic actions, composable generators, bounded Repeat, and a future sweep extension point.
- Grounded Agent exploration in registered capability discovery and exact/partial/approximate Scenario Fidelity, then mapped the infrastructure dependencies into Phases 0-5, later infrastructure, architectural guidance, deterministic validation, and a long-term capability test.
- Marked `docs/exploration-infrastructure-supplement.md` as integrated design rationale; the roadmap governs any future conflict or phase decision.
- Validation: `npm run check` passed outside the workspace sandbox after the sandbox blocked esbuild parent-directory access; core/exploration checks, KNN/LR/MLP render smoke, and 12 example checks passed. Integration-term coverage, local Markdown links, UTF-8/command-envelope scans, and `git diff --check` passed. `npm run build` was omitted because this change is documentation-only and touches no executable code.
- Deferred: no Scenario Engine runtime, constraint editor, sweep UI, or other Phase 1+ executable work was started.

## 2026-08-12 - Phase 1.1 World Transaction Foundation

- Added canonical, model-independent World transactions with atomic multi-operation validation, deterministic IDs, lightweight semantic action records, exact inverse operations, bounded grouped Undo/Redo history, and explicit human/Agent/system actors.
- Added a pure deterministic Brush/Spray gesture materializer with bounded path input, per-gesture point output, total World observations, and transaction operation count; the same normalized gesture and seed reproduce identical observations and IDs.
- Extended the unified Playground runtime with `APPLY_WORLD_TRANSACTION`, `UNDO_WORLD_ACTION`, `REDO_WORLD_ACTION`, and non-semantic `SET_WORKSPACE_VIEW`; script baselines and captures now preserve World history, source state, transaction counters, and view state without creating a second reducer.
- Added the optional model-adapter `applyWorld()` boundary and implemented it for Linear Regression. Explicit train observations alone control fitting/training, test observations produce `testMse` without changing fitted parameters, and legacy unspecified Worlds retain all-data behavior. KNN/MLP World editing remains unsupported and is reported through capabilities.
- Added Phase 1.1 contract coverage for transaction atomicity and resource limits, exact inverse ordering/values, deterministic gestures, Agent/manual parity, grouped history, Undo/Redo, adapter rejection rollback, train/test isolation, view fingerprint isolation, and Script reset history isolation; documented the contracts in `exploration-semantics.md` and `playgrounds.md`.
- Validation: `npm run check`, `npm run check:compiler`, `npm run build`, UTF-8/command-envelope scan, and `git diff --check` passed. KNN/LR/MLP render smoke and 12 example checks passed. The build retained its existing large-chunk warning.
- Deferred: no Point/Brush/Spray React UI, selection/touch interaction, classification World editing, Experiment Bar, generator, Scenario Engine, or persistence change is included; these remain Phase 1.2+ work.

## 2026-08-12 - Phase 1 2D Data Workspace MVP

- Restored the registered `linear-trend` teaching dataset as the default Linear Regression source; fallback points are used only when the teaching dataset is unavailable, and acceptance coverage now derives split counts from the actual initial World size.
- Added a capability-driven generic `DataWorkspace` learner surface with Point, Brush, Spray, Select/Move, Erase, Train/Test authoring layers, precise coordinate entry, Fit view, and visible runtime Undo/Redo.
- Routed all Workspace edits through registered World operations and one completed-pointer transaction boundary. Brush/Spray reuse the bounded deterministic gesture materializer; grouped erase uses `REMOVE_POINTS`; pointer cancellation and resource-limit failures do not partially mutate the World.
- Added non-color-only Train/Test visualization, subset-aware residual rendering, explicit Train MSE/Test MSE labels, conservative bounds preservation, and semantic view-only visibility/Fit view handling.
- Added learner-surface render coverage, unsupported-adapter capability coverage, default teaching-data regression coverage, operation-registry metadata clarification, and Phase 1 architecture documentation.
- Validation: `npm run check`, `npm run check:compiler`, `npm run build`, `git diff --check`, changed-line UTF-8/command-envelope scan, desktop pointer acceptance, and 768×1024 tablet-sized pointer acceptance passed. The build retains the existing large-chunk warning.
- Deferred: Experiment Bar, A/B Compare, generators, Guided Explore, Agent Explore redesign, Scenario Engine, persistence changes, and editable KNN/MLP Worlds.

## 2026-08-12 - Canonical World Operations and Split Semantics

- Added an authoritative, model-independent registry for public World operations and derived human/Agent capability inspection from its metadata; internal restore operations remain system-only Undo details.
- Routed legacy Linear Regression point edits, direct public operations, and Agent requests through one atomic World transaction path with grouped history, exact inverse operations, and inspectable actor/provenance metadata.
- Defined the first explicit train/test assignment to normalize every remaining `unspecified` observation to `train`; later additions follow the explicit split, invalid splits roll back atomically, and Linear Regression synchronizes only from the accepted canonical World.
- Kept Experiment comparison factors orthogonal: observation values and existence belong to `world`, membership belongs only to `trainTest`, and Workspace view state remains non-semantic.
- Added focused coverage for the default 11-point LR flow, 9/2 split normalization, test-only movement and MSE behavior, membership-only comparison, exact Undo/Redo, legacy/canonical equivalence, Agent parity, registry discovery, extension boundaries, and KNN/LR/MLP render smoke.
- Updated `docs/architecture/exploration-semantics.md` and `docs/architecture/playgrounds.md`. No React drawing workspace, Scenario Engine, classification World editing, persistence schema, or model-specific exploration branch was added.
- Validation: `npm run check`, `npm run check:compiler`, `npm run build`, changed-line UTF-8/command-envelope scan, and `git diff --check` passed. The build retained its existing large-chunk warning.

## 2026-08-12 - Experiment Lab and Data Lab vertical slice

- Added one shared Experiment Lab shell with peer Data Lab and Model Lab tabs, plus separate model-oriented and Data Lab-oriented entry points; tab switching preserves the same World, Experiment, runtime, and model session.
- Split learning lifecycle semantics: `RUN` and `RESET_LEARNING` operate on the current edited World, while `RESTORE_ORIGINAL_DATA` is the explicit destructive baseline restore.
- Extended Brush density so deterministic path-following Brush gestures produce more observations as density increases; Spray keeps its local-cloud interpretation.
- Preserved full numeric feature maps in regression Worlds, added projection-only scatter/distribution views, named-feature projected editing, and registry-backed Shift, Scale, and deterministic Add Noise interventions with all/train/test/selected scopes and grouped Undo.
- Updated exploration architecture documentation and regression coverage for lifecycle preservation, multi-feature semantics, feature interventions, projection isolation, and Brush density.
- Validation: `npm run check`, `npm run build`, `node scripts/check-exploration.mjs`, render smoke, and `git diff --check` passed. The build retains the existing large-chunk warning.
- Deferred: Experiment Bar/A-B Compare, generators, Scenario Engine, Guided Explore, Agent Explore redesign, Repeat/sweeps, Training Microscope, and broader model editing.

## 2026-08-13 - Data Lab semantic independence and projection correctness

- Added a model-optional `data-lab` session and registry-backed compatible model selector; attaching a model preserves the canonical World and its edits.
- Centralized named-feature projection semantics for scatter, distribution, hit testing, erase, selection, axes, and fit bounds; multi-feature projections disable new-row tools when hidden values would be fabricated.
- Hardened World feature operations against unknown and non-numeric feature values, preserved full regression feature maps, and kept unrelated feature interventions independent from a selected Linear Regression fit.
- Renamed the ambiguous timeline reset to `Restart explanation`; visualization restart, script seek, and playback reset preserve current World observations and history, while `RESTORE_ORIGINAL_DATA` remains the explicit destructive action.
- Added train/test-distinguished distribution rendering, localized Data Lab/model-empty/restart copy, semantic regression coverage, model-attachment coverage, and browser acceptance for model-optional entry and attachment.
- Validation: `node scripts/check-core.mjs`, `node scripts/check-exploration.mjs`, `node scripts/check-playground-render.mjs`, `node scripts/generate-examples.mjs --check`, `npm run build`, and `git diff --check` passed. The build retains the existing large-chunk warning.

## 2026-08-13 - Data Lab attached-model playback recovery

- Fixed Data Lab model attachment playback so model-specific script actions, including `traceFit`/`START_TRAINING`, are validated against the attached model descriptor instead of the outer Data Lab descriptor.
- Captured the attached model's initialized controls and semantic state as the explanation script baseline, so Restart explanation preserves learning-rate/training-step controls and can recover cleanly.
- Added regression coverage for attached-model script training/reveal progress and documented the split between Data Lab World-action validation and attached-model action validation.
- Validation: focused playback regression, core/exploration/render checks, `node scripts/generate-examples.mjs --check`, browser acceptance, `npm.cmd run build`, and `git diff --check` passed. The build retains the existing large-chunk warning.

## 2026-08-13 - Phase 2 Experiment Bar acceptance fixes

- Duplicate now captures one coherent current runtime state for the branch's World, source, model/data state, Experiment baseline, and script baseline.
- A/B switching normalizes comparison roles to prevent self-comparison, and compatible 2D Worlds share a union comparison view frame without changing semantic Experiment state.
- Workspace and Agent lineage summaries now derive from canonical `experiment.lineage`; the Experiment Bar labels its control undo separately from Data Lab World Undo and exposes Reset experiment.
- Added reset/restart, result freshness, role switching, self-comparison, shared-bounds, lineage, Agent parity, and KNN regression coverage. Validation: full `npm.cmd run check`, `npm.cmd run build`, `git diff --check`, and clean-tab browser acceptance passed.

## 2026-08-13 - Phase 2 experiment bar and A/B comparison

- Added runtime-backed Experiment Bar controls for duplicate, switch, repeat, reset, and grouped experiment undo, with stable lineage and baseline identity.
- Added semantic A/B comparison for World, train/test assignment, model, learning, evaluation, and randomness factors; learned Linear Regression weight/bias are treated as results rather than configuration.
- Added comparison clarity and result-difference summaries, Agent operation parity, Linear Regression coverage, KNN compatibility checks, and runtime-only experiment workspace documentation.
- Validation: full `npm.cmd run check`, focused experiment runtime checks, browser A/B/undo acceptance, `npm.cmd run build`, and `git diff --check` passed.
## 2026-08-13 - Phase 3 World Builder generators

- Added a bounded deterministic World Builder for Uniform, Gaussian-like, and Two-cluster inputs with explicit linear relation, additive noise, outlier provenance, seed, and train/test generator configuration.
- Added registered SET_WORLD_GENERATOR, SET_GENERATOR_PARAMETER, SET_GENERATOR_SEED, REGENERATE_WORLD, and FREEZE_AS_SAMPLES operations with shared UI/Agent parity, grouped World history, model-result invalidation, and generated/manual provenance semantics.
- Added generated-vs-sample UI badges, parameter controls, regenerate/freeze actions, nested World-generator comparison details, serialization coverage, deterministic generation checks, and browser-safe sample limits.

## 2026-08-13 - Phase 3 Final acceptance fixes

- Made the World seed authoritative across runtime session, World, Experiment, desired generator seed, and regenerated realization; reset/duplicate paths restore the same seed contract.
- Separated desired generator specification from the current realization, added honest configured/dirty/clean/modified UI states, and preserved generation provenance through manual edits and freeze.
- Canonicalized generator parameters under train/test splits, completed visible distribution-specific Test controls, strengthened A/B comparison and shared-frame regression coverage, and expanded deterministic checks for all input generators.

## 2026-08-15 - UI-2.5 top-level Explore / Build surface split

- Corrected the actual application entry so new sessions open to a localized, question-first Explore home with the five registered Big Idea entrances and a compact direct-playground fallback.
- Added an explicit presentation-only Explore / Build switch. Explore does not mount the builder canvas or builder chrome; Build restores the existing ReactFlow builder and groups its secondary actions behind an ordinary disclosure.
- Preserved one shared Workspace/runtime across surface switching, including project identity and builder state; added focused contract coverage for default Explore, builder isolation, Build restoration, shared-state identity, and localized Big Idea content.

## 2026-08-15 - UI-2.5 mobile menu and language affordance fixes

- Constrained the Build More disclosure to the viewport and allowed long localized action labels to wrap on narrow screens.
- Separated the global AI and language icons into distinct accessible visual badges so the Language settings action is not visually fused with adjacent text.
- Validation: focused UI checks, full `npm.cmd run check`, `npm.cmd run build`, `git diff --check`, and wide browser smoke passed; a compact browser viewport was unavailable in this environment.

## 2026-08-15 - UI-3 phenomenon-first L0

- Added a capability-driven Phenomenon surface that combines editable 2D World gestures with the existing runtime model-response primitives in one canvas.
- Reduced the initial Playground hierarchy to question, phenomenon, Move/Draw/Erase, Undo, and a compact Experiment identity; full World tools remain reachable through the compatibility path.
- Preserved shared World transactions, primitive rendering, Big Idea questions, Experiment semantics, responsive presentation, and fail-open semantic telemetry; deferred UI-4 through UI-7 and Phase 9.

## 2026-08-17 - World Composer / Generative World Grammar

- Added a versioned, JSON-safe WorldRecipe grammar with bounded geometry primitives, stable group identities, transforms, train/test sampling, position/label/local noise, outliers, deterministic scoped substreams, and compiled rings/moons/XOR/checkerboard presets.
- Added deterministic recipe materialization into ordinary finite World observations with generation provenance, explicit desired-vs-realized lifecycle, recipe patch operations, atomic Undo/Redo, Repeat support, and legacy generator compatibility.
- Added recipe-aware comparison details and ScenarioSpec fidelity, bounded Agent world-design proposals with explicit preflight/execution, local preset fallback, unsupported-adapter clarification, localized recipe summaries, architecture documentation, and integrated World Composer checks.
- Acceptance: focused World Composer checks, full `npm run check`, `npm run build -- --configLoader runner`, and `git diff --check` passed. Default Vite config loading and localhost browser access remain restricted by this managed environment.

## 2026-08-18 — Agent Pedagogical Experiment Design

- Added a bounded `ExplorationDesign` layer for class overlap, train/test support shift, observation noise, and outlier sensitivity; deterministic planning compiles these goals into existing WorldRecipe, ScenarioSpec, comparison, fidelity, and explicit execution semantics.
- Added a learner-facing “Let’s test this” proposal with Change / Keep fixed / Watch, optional prediction recording through existing Exploration Thread entries, runtime-grounded outcome evidence, and at most two capability-preflighted follow-up questions.
- Added strict AI structured design validation with local fallback, task-aware accuracy/MSE observables, focused regression coverage, and documentation; World Composer v1 remains closed and MLP World mutation remains deferred.

## 2026-08-18 — Pedagogical experiment semantic acceptance fixes

- Added a deterministic pedagogical-intervention verifier grounded in realized observations: class overlap must reduce measured cross-class distance, support shift must increase test-outside-train coverage while preserving Train, and noise/outlier proposals cannot be zero-change or based on dirty baselines.
- Tightened grounded evidence and compatibility behavior, preserving ordinary validation/resource errors, and recorded predictions before successful experiment commits followed by experiment and observation Thread entries.
- Validation: focused pedagogical experiment checks, related runtime/render regressions, `npm run check`, `npm run build`, and `git diff --check` passed; browser validation was not run in this environment.

## 2026-08-18 — Pedagogical experiment semantic naming and hold cleanup

- Renamed the bounded class intervention to `class-separation`; overlap-language requests may still route to it, but learner copy now truthfully describes moving classes closer rather than measuring geometric overlap.
- Made exact structural fidelity a pedagogical proposal and commit requirement, corrected Agent Thread provenance to prediction=`human`, experiment/observation=`agent`, and strengthened finite Train/Test/non-selected-group realization holds.
- Validation: focused pedagogical, Agent, Thread, World Composer, UI, OpenAI Responses, and render checks passed; `npm run check`, `npm run build`, and `git diff --check` passed. Browser validation was not run and no GitHub Actions run is claimed.

## 2026-08-18 — Pedagogical observation authority and grounding acceptance fix

- Moved canonical Thread pedagogical observations behind deterministic runtime reconstruction of the current baseline, active realization, comparison, verification, and evidence; caller/Agent-supplied observation payloads are ignored and stored facts are strictly bounded.
- Kept Observation/Evidence visible while showing optional AI interpretation separately, added explicit fact-grounding/no-causality provider instructions, narrowed class-separation fallback language, and made grounded outcome deltas affect next-question selection.
- Acceptance: focused pedagogical observation, Agent, Thread, World Composer, OpenAI Responses, render, full `npm run check`, and `git diff --check` passed; browser/provider and GitHub Actions status are reported separately.

## 2026-08-18 — Evidence-grounded observation loop

- Added a deterministic `PedagogicalObservation` projection for class separation, support shift, noise, and outlier experiments, with factual before/after evidence and no causal claims.
- Grounded observations now enter the existing Exploration Thread after the human prediction and agent experiment entries; the result surface presents Observation, Evidence, and up to two capability-preflighted next questions.
- Added bounded observation context for optional Agent interpretation, class-separation local language including Chinese phrasing, protected prediction capture, focused loop regressions, and architecture documentation. Browser validation was not run and no GitHub Actions run is claimed.

## 2026-08-19 — Contextual Quick Control

- Added a deterministic Play-level quick-control selector over the accepted descriptor metadata: scenario/experiment context and exact comparison evidence can surface at most one eligible control, while ambiguous or World-only contexts stay empty.
- Reused `PlaygroundControlField` and canonical `SET_CONTROL` semantics in a compact responsive Play card; Tune and Play continue reading the same runtime snapshot without AI recommendations or duplicated state.
- Added focused eligibility, ambiguity, comparison, World-only, runtime, responsive-contract, and no-provider checks; browser validation remains environment-dependent.

## 2026-08-19 — Contextual Quick Control acceptance correction

- Made active World-only pedagogical context take priority over stale model comparison/default presentation, while preserving explicit registered `SET_CONTROL` scenario variables.
- Added a real KNN duplicate/change/compare regression proving the quick control disappears only for the World-only presentation context and returns when that context ends; browser validation remains unavailable in this environment.

## 2026-08-19 — Grounded Concept Cards

- Added a bounded localized concept catalog and deterministic concept-signal projection for exact, verified experiments: controlled comparison, held constant, distribution shift, observation noise, outliers, and class separation.
- Successful pedagogical execution now returns canonical concept metadata, the existing Thread observation path derives the same metadata at the Host boundary, and the Agent result presents at most one new compact Concept Card without AI-authored IDs or causal claims.
- Added no-AI runtime/render regressions for intervention priority, exact-fidelity gating, forged-ID rejection, session exposure, and compact-safe presentation; browser validation remains environment-dependent.

## 2026-08-19 — Concept & Inquiry Engine Goal 1: Semantic Event Foundation

- Added a bounded local-session semantic event stream for completed experiment duplication, registered control changes, World interventions, comparisons, repeats, and deterministic Observation Detector notices.
- Recorded event drafts only after successful runtime commits, with JSON-safe Experiment/factor/operation/evidence references; raw pointer paths, coordinates, observations, mutation objects, prompts, and DOM state are excluded. Continuous gestures remain one completed World event.
- Exposed the same event snapshot to ordinary Playground consumers and detached Agent inspection, retained no project/cloud/telemetry state, and documented the injected local-store seam for later layered persistence.
- Acceptance: focused semantic-event, core, Experiment, Agent, Thread, World Builder, Concept Card, render, full `npm run check`, `npm run build`, and `git diff --check` passed. Browser validation and GitHub Actions were not run for this change; Goal 2 concept matching remains deferred.

## 2026-08-19 — Semantic Event Foundation truthfulness correction

- Made semantic-event actor provenance explicit: trusted UI actions are `human`, Agent execution is `agent`, and omitted/internal Host, preset, script, or runtime work is `system` without changing established runtime Undo defaults.
- Unified control-event eligibility with Experiment comparison semantics, excluding view-only and derived model controls; World events now retain bounded train/test, input, noise, outlier, relation, sample-count, seed, and lifecycle factor references without learner data.
- Replaced session-wide observation suppression with active-state transition tracking so persistent detector output is quiet, insignificant evidence changes do not spam events, and a cleared observation can truthfully re-enter later.
- Validation: `node scripts/check-semantic-events.mjs` and full `npm run check` passed. `npm run build` is blocked in this managed sandbox because esbuild cannot read the parent directory while loading Vite config; `git diff --check` passed. Goal 2 remains deferred.

## 2026-08-19 — Semantic Event World Undo/Redo truthfulness correction

- Preserved canonical World-factor identity through Undo and Redo by deriving a bounded projection from each history entry's forward operations when that entry is created; reversal events now use that projection instead of their control-flow wrapper action.
- Added regressions for noise, Test input, first-action Train/Test point Undo/Redo, provenance, and the absence of raw history/transaction data in the semantic log.
- Validation: `node scripts/check-semantic-events.mjs`, `npm run check`, `npm run build`, and `git diff --check` passed; Goal 2 remains deferred.

## 2026-08-19 — Learner Inquiry Engine Goal 2

- Added a bounded deterministic Learner Inquiry projection over Semantic Events, active comparison facts, Observation Detector notices, Repeat evidence, and explicit Exploration Thread predictions.
- Added a six-concept declarative inquiry registry for controlled and mixed comparisons, distribution shift, generalization, repeat variation, and counterfactual reasoning patterns; every candidate retains bounded event/observation provenance and uses no causal language or AI.
- Exposed the same local-session inquiry projection in normal Playground snapshots and Host inspection, with focused regressions for evidence gates, false positives, deterministic output, and no-provider operation.
- Acceptance hardening: evidence-gated candidates now require the matching detector notice to remain active and, for comparisons, to reference the current Experiment pair; stale historical notices cannot surface a current concept.

## 2026-08-19 — Learner Inquiry Engine Goal 3

- Added a quiet, dismissible Play-surface Concept Card driven only by Goal 2 deterministic inquiry candidates; it names the observed pattern, explains why it appeared with bounded event evidence, and links only to the existing Evidence depth.
- Added bounded session exposure and evidence-cycle deduplication so one clean experiment presents at most one card and repeated minor actions cannot create a card stream.
- Preserved manual/no-AI exploration and all runtime semantics; Goal 4 suggestions and any AI interpretation remain deferred.

## 2026-08-20 — Learner Inquiry Engine Goal 4

- Added a bounded deterministic `InquirySuggestion` projection that turns direct distribution-shift/generalization inquiry evidence into at most two non-causal follow-up tests: an inspectable Test-support World intervention and, only when a model descriptor explicitly declares a capacity role, a registered capacity-control comparison.
- Reused the existing `compare-control` TeachingGoal path for executable model-control suggestions; planning, composition, strict dry run, goal fidelity, and Script Runtime execution remain explicit and unchanged. World suggestions stay manual when they do not belong in the TeachingGoal taxonomy.
- Added focused capability, hold/evidence, no-mutation, forged-candidate, TeachingGoal pipeline, and runtime checks. Goal 5 AI interpretation remains deferred.

## 2026-08-20 — Learner Inquiry Engine Goal 5

- Added an optional, event-triggered pedagogical AI guidance seam over existing deterministic inquiry candidates and prevalidated suggestions. It can only choose ignore, a current concept, a validated suggestion, or an available depth; it cannot author facts, concepts, operations, or execution.
- Added local-session cooldown and interruption-budget policy, bounded provider-safe semantic context, strict structured response validation, and deterministic fallback for disabled, unavailable, malformed, or rejected provider responses.
- Preserved the existing TeachingGoal/script/fidelity path and manual no-provider experience; the default policy remains quiet. Goal 6 causal concept-pack work remains deferred.

## 2026-08-20 — Learner Inquiry Engine Goal 6

- Added a bounded deterministic causal/scientific inquiry projection over existing facts: observed pattern, learner-stated hypothesis, registered intervention, controlled or mixed comparison, counterfactual reasoning, and repeat variation.
- Kept ordinary detector/metric evidence distinct from association and causal conclusions; mixed comparisons now explicitly lead to factor isolation and repeat variation to uncertainty checking.
- Added an inspectable design-only Causal World contract with explicit observable/intervenable/latent variables and mechanism-reveal policy, without a second World state machine, raw observations, Agent-only operations, or executable mechanism. A live Causal World remains a later capability.

## 2026-08-20 — Learner Inquiry Engine Goal 7

- Added a bounded local-session inquiry trajectory projection for completed exploration process: first meaningful manipulation, second Experiment, Duplicate/Compare/one-factor/Repeat use, concept/depth/suggestion outcomes, later independent human exploration, and Thread question/prediction follow-up counts.
- Added a strict presentation-event boundary used by the quiet Concept Card and conceptual-depth surface; recording is presentation-only and cannot mutate World, Experiment, comparison, Agent, or Thread runtime semantics.
- Preserved vendor-independent/no-provider operation and excluded learner text, raw World data, Experiment IDs, suggestion/card content, model results, project persistence, and cloud telemetry. The projection is evaluation context, not learner scoring or a click-optimization target.

## 2026-08-20 — Goal 2–7 inquiry stability boundaries

- Unified fine-grained comparison projections: exact normalized paths remain the fidelity boundary while canonical property-level factor paths drive controlled-comparison recognition and trajectory rates.
- Preserved trusted actor provenance in learner inquiry; only explicit human events count as learner behavior, while agent/system events remain bounded runtime facts.
- Made Host inquiry suggestions reachable from the same presented inquiry snapshot, secured concept/suggestion presentation events, reset inquiry session state on Playground restart/entry, and retained bounded monotonic evaluation aggregates after event-window eviction.
- Bound Causal Inquiry support to the current comparison/event relationship and shared grounded concept metadata across inquiry and Concept Card pipelines; no Goal 8 or Phase 9 work was added.

## 2026-08-20 — Phase 9A cross-domain contracts and Image slice

- Added bounded domain contracts and static probes for tabular, image, sequence, retrieval, and RAG surfaces while preserving the legacy tabular World default and existing Experiment/runtime semantics.
- Added JSON-safe image/token/attention/ranked-list primitive contracts and domain-native stage rendering without putting model math in the UI.
- Added a deterministic Image classification playground with explicit Train/Test membership, a fixed local convolution feature step plus prototype head, shared accuracy observables, truthful traces, and a compact Phenomenon surface.
- Kept sequence execution, retrieval/RAG, async execution, and Agent planning as later Phase 9 vertical slices; no Phase 9 domain expansion or World Composer v2 was included.

## 2026-08-20 — Phase 9 domain vertical slices

- Added deterministic Sequence/attention, Retrieval ranking, and grounded-retrieval playground slices using the same finite World, Experiment, trace, observable, primitive, and Host inspection contracts.
- Added bounded token-sequence, attention-matrix, and ranked-list surfaces with explicit domain/coordinate-space metadata and no remote inference or unrestricted generation.
- Extended the Agent inspection projection with normalized domain and coordinate-space capability context; execution authority remains in the existing runtime boundaries.

## 2026-08-20 — Phase 9 cross-domain completion hardening

- Replaced local retrieval token overlap with deterministic bounded hashing embeddings and cosine ranking; added an extractive grounded-answer primitive with source IDs for RAG.
- Made Sequence attention content-dependent and temperature-controlled, and made Image/CNN prototype training produce bounded deterministic updates and history.
- Added provider-safe domain context projection, bounded cross-domain Agent navigation/control proposals, exact-fidelity preflight coverage, unsupported-intervention clarification, and a cancellable adapter-neutral execution runner seam.
- Preserved the shared World/Experiment/ScenarioSpec/runtime authority boundary; no remote inference, arbitrary code, raw domain payloads, or World Composer expansion was introduced.

## 2026-08-21 — Phase 10A embedded learning assistant

- Added the answer-only Ask VOLK surface with bounded structured answers, optional learner-reviewed experiment questions, and no runtime execution authority.
- Added session-local bounded learner annotations with stable semantic anchors and localized understood/unclear/ask-about-this actions.
- Added data-driven provider/model presets, native OpenAI/compatible transport-aware defaults, staged connection probing, redacted diagnostics, and focused reliability checks.
- Kept provider context free of secrets, raw observations, coordinates, imported rows, and executable operations; adaptive curriculum, long-term learner modeling, and new domains remain deferred.

## 2026-08-21 — Phase 10A acceptance hardening

- Applied model-aware provider request profiles through the shared gateway and connection probe; Gemini presets now omit unsupported temperature/top-p/top-k fields while custom and compatible providers retain their existing contracts.
- Added Host-owned stable learning-message identities, reusable bounded annotations for Concept/Evidence/Agent-answer surfaces, semantic “What VOLK knows” context disclosure, and evidence-preserving Ask/interpretation presentation.
- Added reusable redacted diagnostics and bounded request tracing. Exact configured API keys, prompts, raw provider responses, and hidden reasoning never enter diagnostics or copied text.
- Added focused regressions for Gemini request shape, stable answer identity, exact-key redaction, provider lifecycle traces, and bounded learning-assistant context.

## 2026-08-24 — Exploration workspace usability fixes

- Added atomic two-dimensional binary-classification World synchronization for MLP, including canonical `x`/`y` recipe features, train-fitted normalization, stable controls/seeds, and reset training evidence.
- Added the model-owned `TRAINING_STEP` path and independent Training Microscope stepping capability; LR and MLP now initialize and advance exactly one model step while Visualization Scripts retain their own timeline.
- Rebuilt Distribution Shift as a deterministic KNN Rings World with test-only translation, two-dimensional geometry, and an accepted Train/Test accuracy gap.
- Unified Agent exploration around one shared input with Ask VOLK, Design experiment, and Generate World modes; Rings, Moons, XOR, and Checkerboard presets remain provider-free proposals requiring explicit execution.
- Added readable 1/2/5 axis ticks, centered zoom, Fit, and equal-unit controls over one shared coordinate frame; camera scale remains session-only and is excluded from Experiment/Undo capture.
- Acceptance: focused exploration, World Composer, Training Microscope, Big Idea, Agent UI, responsive geometry and render checks; full `npm run check`; production build; desktop/narrow-screen English/Chinese browser walkthrough; and `git diff --check` passed.

## 2026-08-24 — LUMI semantic learning UI

- Added centralized semantic UI tokens and a controlled LUMI companion with ambient, contextual, observation, guidance, intervention, and illumination states.
- Added grounded Concept Card states (`unexplored`, `active`, `illuminated`) with an explicit session-only learner confirmation for illumination; no model accuracy heuristic or persistence was introduced.
- Applied Cyan to factual Evidence, Orange to Experiment interventions, and Purple/Green to concept exploration states while preserving existing World, Experiment, Agent, and evidence authority boundaries.
- Added LUMI guidance presentation over existing observations, inquiry candidates, and guided recipes, with localized English/Chinese copy, keyboard-safe entry points, reduced-motion behavior, responsive narrow-screen handling, and architecture documentation updates.
- Acceptance: focused LUMI semantic checks, full `npm run check`, production `npm run build`, desktop and 390px narrow-screen browser walkthrough, and `git diff --check` passed.

## 2026-08-24 — LUMI exploration interaction

- Added presentation-only `LumiTarget` bindings for existing Evidence, Concept, and Experiment objects, including cyan evidence focus, evidence-to-concept connection, purple exploration mode, and explicit learner illumination staging.
- Added a transient orange intervention pulse that highlights the changed experiment control without executing actions, inferring causality, creating evidence, or changing Agent authority.
- Added the Distribution Shift Observe → Intervene → Understand showcase rail, localized interaction copy, reduced-motion styling, and focused target/boundary regressions.
- Updated Playground and Exploration Semantics architecture notes; World, Experiment, Evidence, Agent, and persistence contracts remain unchanged.
- Acceptance: focused LUMI interaction checks, full `npm run check`, production `npm run build`, Distribution Shift browser walkthrough, and `git diff --check` passed.

## 2026-08-24 — LUMI exploration journey timeline

- Added a bounded, session-local Journey projection over existing human semantic events: Observe, Intervene, Connect, and explicit learner-confirmed Illuminate markers.
- Added the responsive LUMI Journey Timeline with current-target guidance, concept frontier presentation, compact narrow-screen disclosure, and reduced-motion support.
- Kept Journey presentation separate from World, Experiment, Evidence, Agent authority, persistence, project fingerprints, and Undo/Redo; `clearJourney()` resets the temporary session projection.
- Added bilingual Journey copy, architecture documentation, and focused projection/boundary regressions for chronology, evidence-to-concept connection, illumination, clearing, and frontier state.
- Acceptance: focused LUMI journey and interaction checks, full `npm run check`, production `npm run build`, Distribution Shift observation/Evidence and 390px layout walkthrough, and `git diff --check` passed.

## 2026-08-24 — Concept Graph & Causal Exploration Map

- Added a bounded Concept Map projection over the existing Inquiry registry, Journey path, connected Evidence, active concept, and explicit session illumination state.
- Added selectable Journey and frontier concepts that focus the map, highlight the existing path and related neighbors, show connected Evidence, and mark the active experiment relation without dispatching runtime actions.
- Preserved the semantic color contract: purple frontier, cyan current attention, green learner-confirmed illumination, orange experiment relation, and navy structure; no automatic `caused_by`, mastery, concept discovery, Agent planning, or persistence was introduced.
- Added bilingual responsive/reduced-motion UI, Distribution Shift concept aliasing for the existing `train-test-distribution-shift` → `generalization` relationship, architecture documentation, and focused graph boundary checks.
- Acceptance: focused Concept Graph and LUMI Journey checks, full `npm run check`, production `npm run build`, Distribution Shift desktop/concept-selection and 390px browser walkthrough with no console errors, and `git diff --check` passed.

## 2026-08-24 — LUMI GitHub Pages asset packaging correction

- Corrected LUMI SVG references to use literal Vite asset URLs with a non-browser fallback, so GitHub Pages' relative `base: './'` build rewrites and inlines all four visuals instead of traversing from the generated JavaScript path at runtime.
- Added a focused regression asserting the four literal asset references and the GitHub Pages deployment base; no LUMI state or presentation semantics changed.
- Acceptance: focused LUMI semantic checks, full `npm run check`, production `npm run build` with four inlined SVG resources, and `git diff --check` passed.
## 2026-08-25 — Phase 11 learner hypothesis layer

- Added a bounded, session-local learner Hypothesis model with explicit creation, testing, Evidence binding, and learner-marked status actions; it does not mutate World, Experiment, Evidence lifecycle, Undo/Redo, persistence, or Agent authority.
- Extended Concept Map with neutral Concept → Hypothesis → Evidence projection and a responsive Hypothesis Card surface; purple remains possibility, cyan Evidence, orange active testing, and green remains reserved for explicit Concept illumination.
- Added a LUMI Evidence–Concept prompt that opens a learner-authored composer; LUMI never creates hypotheses, generates causal arrows, assigns confidence, or claims truth.
- Added bilingual copy, responsive styling, architecture documentation, and focused hypothesis boundary checks.
- Acceptance: focused Hypothesis checks, full `npm run check`, production `npm run build`, and `git diff --check` passed.
## 2026-08-25 — Concept Graph truth-boundary hardening

- Corrected Concept Map relation presentation: `related` and `observed_with` now use symmetric connectors, while `prerequisite` and future explicit `caused_by` relations remain directional.
- Removed local `selectedConceptId` from graph membership derivation; stale or absent selections now normalize to `null` after semantic membership is known and cannot create ghost nodes or expand the graph.
- Added centralized relation-direction metadata, focused regressions for undirected/directed presentation and stale selection, plus updated Concept Graph architecture notes.
- Acceptance: focused Concept Graph checks, full `npm run check`, production `npm run build`, and `git diff --check` passed.

## 2026-08-25 — Phase 11B Evidence provenance and Hypothesis binding hardening

- Added bounded session-local Evidence instance provenance with stable IDs, Experiment references, condition fingerprints, semantic sequence, timestamps, and bounded snapshots; detector reason codes remain repeatable categories rather than historical identities.
- Replaced implicit current-observation attachment with an explicit Evidence Picker; Hypotheses accept only stable instance IDs, preserve learner-authored status, and show missing historical references as unavailable.
- Updated Concept Map and LUMI to resolve historical Evidence instances without rewriting references or adding runtime/Agent authority; added bilingual picker copy, narrow-screen styling, architecture notes, and focused provenance regressions.
- Acceptance: focused semantic, Hypothesis, LUMI, and provenance checks, full `npm run check`, production `npm run build`, and `git diff --check` passed.

## 2026-08-25 — PR #127 acceptance correction: condition-aware Evidence deduplication

- Updated production Observation occurrence identity to include the existing canonical session condition fingerprint, preserving same-condition deduplication while creating a new historical Evidence instance for the same detector under a changed condition.
- Extended the provenance regression through `deriveSemanticEventDrafts()` to cover same-condition repeats, condition changes, detector disappearance/reappearance, and historical Hypothesis binding; raw Evidence values remain excluded from dedupe identity.
- Updated the Exploration Semantics architecture note; World, Experiment, Hypothesis status, Evidence Picker, LUMI, Agent, persistence, and causal-graph boundaries remain unchanged.
- Acceptance: focused semantic/provenance/Hypothesis/Concept Graph checks, full `npm run check`, production `npm run build`, and `git diff --check` passed.

## 2026-08-27 — Workspace isolation and Explore environment integrity

- Separated active Build and Explore ownership: built-in Explore recipes now use independent session hosts and no longer read or rebase from the active Build dataset/model; closing the Explore dialog preserves the session and its inquiry history.
- Added bounded Explore environment identity and compatibility recovery, plus an explicit capability-gated “Explore this setup” fork for supported tabular Build configurations; unsupported configurations remain clearly rejected.
- Fixed relationship-aware LUMI revision suggestions and added stable revision IDs to Inquiry Trail references.
- Updated bilingual UI copy, Build/Explore architecture documentation, and focused workspace-isolation regressions.
- Acceptance: workspace-isolation and relevant inquiry regressions, full `npm run check`, production `npm run build`, and `git diff --check` passed.
