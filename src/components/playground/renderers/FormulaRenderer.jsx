const motionOpacityFor = (props) => (
  props.motionProgress === undefined || props.motionOpacity !== 1
    ? props.motionOpacity ?? 1
    : 0.72 + Math.abs(props.motionProgress - 0.5) * 0.56
);

export default function FormulaRenderer({ props, t }) {
  const { formula } = props;
  if (!formula) return null;
  if (formula.key === 'playground.formula.linear') {
    return <p className="font-mono text-sm font-bold text-sky-300" style={{ opacity: motionOpacityFor(props) }}>
      y = <span className={formula.highlight === 'weight' ? 'text-amber-300' : ''}>{formula.params.weight}</span> · x {formula.params.operator} <span className={formula.highlight === 'bias' ? 'text-amber-300' : ''}>{formula.params.bias}</span>
    </p>;
  }
  return <p className="font-mono text-sm font-bold text-sky-300" style={{ opacity: motionOpacityFor(props) }}>{t(formula.key, formula.params)}</p>;
}
