import { CONCEPTUAL_DEPTHS } from './uiArchitecture.js';
import { isExplorationIntent } from '../exploration/explorationIntents.js';
import { getWorldRecipePreset } from '../exploration/worldRecipePresets.js';
import { createPedagogicalExperimentDesign, PEDAGOGICAL_EXPERIMENT_GOALS } from '../exploration/pedagogicalExperiment.js';

export const AGENT_GUIDANCE_OUTCOMES = Object.freeze({
  OPEN_DEPTH: 'open-depth',
  EXPERIMENT_PROPOSAL: 'experiment-proposal',
  WORLD_DESIGN_PROPOSAL: 'world-design-proposal',
  EXPLANATION: 'explanation',
  CLARIFICATION: 'clarification',
});

const NAVIGATION_RE = /where can i|how do i|show me|open .*settings|model settings|inspect|control|parameter|learning rate|noise|在哪里.*(改|调|设置)|怎么.*(改|调|设置)|模型设置|检查模型|控制|参数|学习率|噪声/i;
const EXPERIMENT_RE = /what happens (if|when)|what if|try (a|an|the)?\s*|could we see whether|move .*class.*closer|less separated|increase|decrease|lower|raise|larger|smaller|make .* (more|less)|add .*noise|add .*outlier|如果.*(增加|减少|提高|降低|靠近|接近)|尝试|增加|减少|提高|降低|添加|靠近|接近|噪声|异常点/i;
const COMPARISON_RE = /clean comparison|what caused|comparison|compare|clarity|干净.*比较|什么导致|比较|对照|清晰/i;
const CLASS_SEPARATION_RE = /overlap|classes?\s+(?:move|are)\s+closer|move .*class.*closer|bring .*class.*closer|reduce class separation|less separated|toward the other class|重叠|类别.*(靠近|接近)|类.*(靠近|接近)|减小类别间距|类别间距.*变小/i;

function has(snapshot, key) {
  return snapshot?.[key] !== undefined && snapshot?.[key] !== null;
}

function proposalIntent(text) {
  if (/hidden\s*units|hidden layer|network width|隐藏层|隐层|隐藏单元/i.test(text)
    && /compare|比较|对比|区别|和|与/i.test(text)) return 'hidden-units-compare';
  if (/learning\s*rate|learning-rate|学习率/i.test(text)) {
    return /lower|decrease|smaller|slower|减少|降低|变小/i.test(text)
      ? 'learning-rate-decrease'
      : 'learning-rate-increase';
  }
  if (/noise|噪声/i.test(text)) return 'harder-noise';
  if (/outlier|anomal|异常点|离群点/i.test(text)) return 'outliers';
  if (/test|distribution|support|range|测试|分布|范围/i.test(text)) return 'test-shift';
  if (/line|slope|point|直线|斜率|点/i.test(text)) return 'line-move';
  return null;
}

function localPedagogicalDesign(text, snapshot) {
  const task = snapshot?.world?.task ?? snapshot?.experiment?.world?.task;
  if (CLASS_SEPARATION_RE.test(text) && task === 'classification') {
    return createPedagogicalExperimentDesign(PEDAGOGICAL_EXPERIMENT_GOALS.CLASS_SEPARATION);
  }
  if (/training never saw|test.*outside|test.*unseen|support shift|训练.*没见过|测试.*训练.*范围|测试.*分布/i.test(text)) {
    return createPedagogicalExperimentDesign(PEDAGOGICAL_EXPERIMENT_GOALS.TRAIN_TEST_SUPPORT_SHIFT);
  }
  if (/does more noise|noise always hurt|more noise always|增加噪声.*影响|噪声.*影响|噪声.*变大/i.test(text)) {
    return createPedagogicalExperimentDesign(PEDAGOGICAL_EXPERIMENT_GOALS.OBSERVATION_NOISE);
  }
  if (/outlier sensitivity|add outliers|outliers|异常点|离群点/i.test(text)
    && /what happens|what if|why|does|增加|添加|敏感/i.test(text)) {
    return createPedagogicalExperimentDesign(PEDAGOGICAL_EXPERIMENT_GOALS.OUTLIER_SENSITIVITY);
  }
  return null;
}

function semanticTopic(text) {
  if (/slope|斜率/i.test(text)) return 'slope';
  if (/bias|intercept|截距|偏置/i.test(text)) return 'bias';
  if (/training step|step|训练步|步骤/i.test(text)) return 'training-step';
  if (/test error|test mse|测试误差|测试损失/i.test(text)) return 'test-error';
  if (/repeat|stability|stable|variance|重复|稳定|波动/i.test(text)) return 'repeat-stability';
  if (/hidden\s*units|hidden layer|network width|wider hidden|model capacity|隐藏层|隐层|隐藏单元|模型容量/i.test(text)) return 'model-capacity';
  if (/learning\s*rate|learning-rate|学习率/i.test(text)) return 'learning-rate';
  return null;
}

function localWorldDesign(text) {
  const preset = /ring|circle|圆环|圆形/i.test(text)
    ? 'rings'
    : /moon|moons|月牙|半月/i.test(text)
      ? 'moons'
      : /xor|异或/i.test(text)
        ? 'xor'
        : /checker|棋盘/i.test(text)
          ? 'checkerboard'
          : null;
  if (!preset) return null;
  return { mode: 'create', recipe: getWorldRecipePreset(preset), patch: null };
}

function domainRepresentationDepth(snapshot = {}) {
  if (snapshot.domain === 'sequence') return CONCEPTUAL_DEPTHS.MECHANISM;
  if (['image', 'retrieval', 'rag'].includes(snapshot.domain)) return CONCEPTUAL_DEPTHS.REPRESENTATION;
  return null;
}

function supportsLocalDomainControl(text, domain) {
  if (domain === 'image') return /training\s*steps?|steps?|训练步|训练轮/i.test(text);
  if (domain === 'sequence') return /attention|temperature|training\s*steps?|steps?|注意力|温度|训练步/i.test(text);
  if (domain === 'retrieval' || domain === 'rag') {
    return /top\s*-?\s*k|rank|embedding|dimension|size|检索数|嵌入|向量|维度/i.test(text);
  }
  return false;
}

export function classifyAgentGuideRequest({ request, capabilities = {}, snapshot = {} } = {}) {
  const text = String(request ?? '').trim();
  if (!text) return { kind: AGENT_GUIDANCE_OUTCOMES.CLARIFICATION, reason: 'empty-request' };

  // Speech act wins over the noun that follows it. “Where can I change X?”
  // is navigation; “What happens if I change X?” is an experiment.
  const isExperiment = (EXPERIMENT_RE.test(text)
    || /why does .*overlap|does .*noise .*hurt|what happens when .*test|how sensitive .*outlier|为什么.*重叠|噪声.*影响|测试.*没见过/i.test(text))
    && !/^where can i|^how do i|^show me where|^在哪里|^怎么/i.test(text);
  const pedagogicalDesign = isExperiment ? localPedagogicalDesign(text, snapshot) : null;
  if (pedagogicalDesign && has(snapshot, 'model')) {
    return { kind: AGENT_GUIDANCE_OUTCOMES.EXPERIMENT_PROPOSAL, design: pedagogicalDesign, source: 'local' };
  }
  const intent = isExperiment ? proposalIntent(text) : null;
  if (isExperiment && ['image', 'sequence', 'retrieval', 'rag'].includes(snapshot.domain)) {
    if (!supportsLocalDomainControl(text, snapshot.domain)) {
      return { kind: AGENT_GUIDANCE_OUTCOMES.CLARIFICATION, reason: 'unsupported-domain-experiment', useAi: true };
    }
    return { kind: AGENT_GUIDANCE_OUTCOMES.EXPERIMENT_PROPOSAL, intent: 'domain-control', source: 'local' };
  }
  if (intent && has(snapshot, 'model')) {
    return { kind: AGENT_GUIDANCE_OUTCOMES.EXPERIMENT_PROPOSAL, intent };
  }

  if (NAVIGATION_RE.test(text)) {
    if (/noise|outlier|异常|噪声/i.test(text)) {
      return { kind: AGENT_GUIDANCE_OUTCOMES.CLARIFICATION, reason: 'world-control', target: 'world-tools' };
    }
    const domainDepth = domainRepresentationDepth(snapshot);
    if (domainDepth && capabilities[domainDepth] !== false) {
      return { kind: AGENT_GUIDANCE_OUTCOMES.OPEN_DEPTH, depth: domainDepth };
    }
    if (capabilities[CONCEPTUAL_DEPTHS.REPRESENTATION] !== false) {
      return { kind: AGENT_GUIDANCE_OUTCOMES.OPEN_DEPTH, depth: CONCEPTUAL_DEPTHS.REPRESENTATION };
    }
  }

  if (/what changed|what happened|show evidence|发生了什么|哪里变了|证据/i.test(text)
    && capabilities[CONCEPTUAL_DEPTHS.EVIDENCE] !== false) {
    return { kind: AGENT_GUIDANCE_OUTCOMES.OPEN_DEPTH, depth: CONCEPTUAL_DEPTHS.EVIDENCE };
  }
  if (/how does it learn|how did.*(learn|change)|why did.*(change|move)|how does it decide|如何学习|怎么学|为什么.*(变化|移动)|如何判断/i.test(text)
    && capabilities[CONCEPTUAL_DEPTHS.MECHANISM] !== false) {
    return { kind: AGENT_GUIDANCE_OUTCOMES.OPEN_DEPTH, depth: CONCEPTUAL_DEPTHS.MECHANISM };
  }

  const topic = semanticTopic(text);
  if (topic) return { kind: AGENT_GUIDANCE_OUTCOMES.EXPLANATION, topic };
  if (snapshot.experimentWorkspace?.comparison?.enabled && COMPARISON_RE.test(text)) {
    return { kind: AGENT_GUIDANCE_OUTCOMES.EXPLANATION, topic: 'comparison' };
  }

  if (isExperiment) return { kind: AGENT_GUIDANCE_OUTCOMES.CLARIFICATION, reason: 'unsupported-experiment', useAi: true };
  const localDesign = localWorldDesign(text);
  if (localDesign) return { kind: AGENT_GUIDANCE_OUTCOMES.WORLD_DESIGN_PROPOSAL, worldDesign: localDesign, requestedHolds: [], source: 'local' };
  if (/create|design|dataset|world|shape|ring|spiral|triangle|v-shaped|数据集|世界|创建|设计|三角形|螺旋|圆环/i.test(text)) {
    return { kind: AGENT_GUIDANCE_OUTCOMES.CLARIFICATION, reason: 'world-design-needs-ai', useAi: true };
  }
  return { kind: AGENT_GUIDANCE_OUTCOMES.CLARIFICATION, reason: 'unsupported-request', useAi: true };
}

export function routeAgentAiInterpretation({ interpretation, request, snapshot = {}, capabilities = {} } = {}) {
  if (interpretation?.kind === AGENT_GUIDANCE_OUTCOMES.EXPLANATION) {
    return {
      kind: AGENT_GUIDANCE_OUTCOMES.EXPLANATION,
      topic: interpretation.topic,
      explanation: interpretation.explanation ?? null,
      source: 'ai',
      request,
    };
  }
  if (interpretation?.kind === 'navigation') {
    if (capabilities[interpretation.depth] === false) return { kind: AGENT_GUIDANCE_OUTCOMES.CLARIFICATION, reason: 'depth-unavailable', source: 'ai', request };
    return { kind: AGENT_GUIDANCE_OUTCOMES.OPEN_DEPTH, depth: interpretation.depth, source: 'ai', request };
  }
  if (interpretation?.kind === AGENT_GUIDANCE_OUTCOMES.CLARIFICATION) {
    return { kind: AGENT_GUIDANCE_OUTCOMES.CLARIFICATION, reason: interpretation.reason || 'unsupported-request', source: 'ai', request };
  }
  if (interpretation?.kind === 'experiment' && interpretation.design) {
    if (!snapshot.model) return { kind: AGENT_GUIDANCE_OUTCOMES.CLARIFICATION, reason: 'model-unavailable', source: 'ai', request };
    return { kind: AGENT_GUIDANCE_OUTCOMES.EXPERIMENT_PROPOSAL, design: interpretation.design, source: 'ai', request };
  }
  if (interpretation?.kind === 'world-design') {
    if (capabilities.worldComposer === false) return { kind: AGENT_GUIDANCE_OUTCOMES.CLARIFICATION, reason: 'world-composer-unavailable', source: 'ai', request };
    return {
      kind: AGENT_GUIDANCE_OUTCOMES.WORLD_DESIGN_PROPOSAL,
      worldDesign: interpretation.design,
      requestedHolds: interpretation.requestedHolds ?? [],
      source: 'ai',
      request,
    };
  }
  const intent = interpretation?.intent;
  if (!isExplorationIntent(intent)) return null;
  if (!snapshot.model) return { kind: AGENT_GUIDANCE_OUTCOMES.CLARIFICATION, reason: 'model-unavailable' };
  return { kind: AGENT_GUIDANCE_OUTCOMES.EXPERIMENT_PROPOSAL, intent, source: 'ai', request };
}

export function deriveAgentSemanticExplanation(topic, snapshot = {}) {
  const supported = new Set(['slope', 'bias', 'training-step', 'test-error', 'repeat-stability', 'comparison', 'model-capacity', 'learning-rate']);
  if (!supported.has(topic)) return { topic, available: false };
  if (topic === 'comparison' && !snapshot.experimentWorkspace?.comparison?.enabled) return { topic, available: false };
  return { topic, available: true };
}

export function deriveAgentComparisonExplanation(snapshot = {}) {
  const diff = snapshot.experimentWorkspace?.comparison?.diff;
  if (!diff) return { kind: 'no-comparison', changed: [], unchanged: [] };
  return {
    kind: diff.clarity === 'mixed' ? 'mixed-comparison' : 'comparison',
    changed: [...(diff.changed ?? [])],
    unchanged: [...(diff.unchanged ?? [])],
    clarity: diff.clarity ?? null,
  };
}
