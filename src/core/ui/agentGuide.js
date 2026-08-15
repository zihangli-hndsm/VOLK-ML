import { CONCEPTUAL_DEPTHS } from './uiArchitecture.js';

export const AGENT_GUIDANCE_OUTCOMES = Object.freeze({
  OPEN_DEPTH: 'open-depth',
  EXPERIMENT_PROPOSAL: 'experiment-proposal',
  EXPLANATION: 'explanation',
  CLARIFICATION: 'clarification',
});

const depthPatterns = Object.freeze([
  { depth: CONCEPTUAL_DEPTHS.EVIDENCE, match: /what changed|what happened|show evidence|发生了什么|哪里变了|证据/i },
  { depth: CONCEPTUAL_DEPTHS.MECHANISM, match: /how does it learn|how did.*(learn|change)|why did.*(change|move)|how does it decide|如何学习|怎么学|为什么.*(变化|移动)|如何判断/i },
  { depth: CONCEPTUAL_DEPTHS.REPRESENTATION, match: /inspect|control|parameter|learning rate|model settings|检查模型|控制|参数|学习率|模型设置/i },
]);

const proposalPattern = /what happens if|try|increase|decrease|add|move|change|noise|outlier|distribution|test data|如果|尝试|增加|减少|添加|移动|改变|噪声|异常|分布|测试数据/i;

export function classifyAgentGuideRequest({ request, capabilities = {}, snapshot = {} } = {}) {
  const text = String(request ?? '').trim();
  if (!text) return { kind: AGENT_GUIDANCE_OUTCOMES.CLARIFICATION, reason: 'empty-request' };

  const depth = depthPatterns.find((candidate) => candidate.match.test(text));
  if (depth && capabilities[depth.depth] !== false) {
    return { kind: AGENT_GUIDANCE_OUTCOMES.OPEN_DEPTH, depth: depth.depth };
  }

  if (proposalPattern.test(text) && snapshot.model) {
    return { kind: AGENT_GUIDANCE_OUTCOMES.EXPERIMENT_PROPOSAL };
  }

  if (snapshot.experimentWorkspace?.comparison?.enabled && /compare|comparison|clarity|比较|对照|清晰/i.test(text)) {
    return { kind: AGENT_GUIDANCE_OUTCOMES.EXPLANATION, topic: 'comparison' };
  }

  return { kind: AGENT_GUIDANCE_OUTCOMES.CLARIFICATION, reason: 'unsupported-request' };
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
