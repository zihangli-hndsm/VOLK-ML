const patterns = Object.freeze([
  { id: 'more-data', match: /more data|more samples|increase (?:the )?(?:some )?(?:same[- ]distribution )?(?:train(?:ing)? )?(?:samples?|data)|larger (?:train(?:ing)? )?set|更多(?:同分布)?(?:训练)?(?:数据|样本)|增加(?:一些)?(?:同分布)?(?:训练)?(?:数据|样本)/i, summary: 'Increase same-distribution training data while holding the generating process fixed.' },
  { id: 'outliers', match: /outlier|anomal|异常点|离群点/i, summary: 'Test sensitivity to bounded outliers.' },
  { id: 'test-shift', match: /test.{0,30}(different|distribution|shift|support|range)|distribution.{0,30}test|测试.{0,20}(不同|分布|范围)|分布.{0,20}测试/i, summary: 'Test the model where training data has less support.' },
  { id: 'two-distributions', match: /two.{0,20}distribution|different distributions|两个分布|两种分布/i, summary: 'Compare two supported input distributions.' },
  { id: 'harder-noise', match: /harder|difficult|noise|noisier|更难|噪声|嘈杂/i, summary: 'Make observations harder by increasing noise while holding the model fixed.' },
  { id: 'line-move', match: /why.{0,20}(line|slope|move)|line.{0,20}move|直线.{0,20}(移动|变化)|斜率.{0,20}(变|动)/i, summary: 'Compare the current fit with a controlled version without the changed point.' },
]);

export function interpretExplorationRequest(request) {
  const text = String(request ?? '').trim();
  if (!text) return { intent: null, summary: '', ambiguity: 'empty request' };
  const match = patterns.find((candidate) => candidate.match.test(text));
  if (match) return { intent: match.id, summary: match.summary, ambiguity: null };
  if (/distribution|分布/i.test(text)) {
    return {
      intent: null,
      summary: '',
      ambiguity: 'distribution-change-kind',
      choices: [
        { id: 'test-shift', label: 'Move where test x-values appear' },
        { id: 'harder-noise', label: 'Increase observation noise' },
        { id: 'two-distributions', label: 'Compare two input distributions' },
      ],
    };
  }
  return { intent: null, summary: '', ambiguity: 'unsupported-request' };
}
