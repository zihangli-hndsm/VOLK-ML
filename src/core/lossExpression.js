const functions = Object.freeze({
  mean: 1,
  sum: 1,
  abs: 1,
  square: 1,
  sqrt: 1,
  log: 1,
  exp: 1,
  clip: 3,
});

export class LossExpressionError extends Error {
  constructor(code, token = '') {
    super(code);
    this.name = 'LossExpressionError';
    this.code = code;
    this.token = token;
  }
}

function tokenize(source) {
  const tokens = [];
  let rest = String(source ?? '');
  while (rest.length) {
    const whitespace = rest.match(/^\s+/);
    if (whitespace) {
      rest = rest.slice(whitespace[0].length);
      continue;
    }
    const number = rest.match(/^(?:(?:\d+(?:\.\d*)?)|(?:\.\d+))(?:[eE][+-]?\d+)?/);
    if (number) {
      tokens.push({ type: 'number', value: number[0] });
      rest = rest.slice(number[0].length);
      continue;
    }
    const identifier = rest.match(/^[A-Za-z_][A-Za-z0-9_]*/);
    if (identifier) {
      tokens.push({ type: 'identifier', value: identifier[0] });
      rest = rest.slice(identifier[0].length);
      continue;
    }
    const operator = rest.startsWith('**') ? '**' : rest[0];
    if (['+', '-', '*', '/', '**', '(', ')', ','].includes(operator)) {
      tokens.push({ type: operator, value: operator });
      rest = rest.slice(operator.length);
      continue;
    }
    throw new LossExpressionError('unexpected', rest[0]);
  }
  tokens.push({ type: 'eof', value: '' });
  return tokens;
}

export function parseLossExpression(source) {
  if (!String(source ?? '').trim()) throw new LossExpressionError('empty');
  const tokens = tokenize(source);
  let cursor = 0;
  const peek = () => tokens[cursor];
  const consume = (type) => {
    const token = peek();
    if (token.type !== type) throw new LossExpressionError('unexpected', token.value);
    cursor += 1;
    return token;
  };

  const primary = () => {
    const token = peek();
    if (token.type === 'number') {
      cursor += 1;
      return { type: 'number', value: token.value };
    }
    if (token.type === '(') {
      cursor += 1;
      const value = expression();
      consume(')');
      return value;
    }
    if (token.type !== 'identifier') throw new LossExpressionError('unexpected', token.value);
    cursor += 1;
    if (peek().type !== '(') {
      if (!['prediction', 'target'].includes(token.value)) throw new LossExpressionError('identifier', token.value);
      return { type: 'variable', name: token.value };
    }
    if (!functions[token.value]) throw new LossExpressionError('function', token.value);
    cursor += 1;
    const args = [];
    if (peek().type !== ')') {
      args.push(expression());
      while (peek().type === ',') {
        cursor += 1;
        args.push(expression());
      }
    }
    consume(')');
    if (args.length !== functions[token.value]) throw new LossExpressionError('arguments', token.value);
    return { type: 'call', name: token.value, args };
  };

  const power = () => {
    const left = primary();
    if (peek().type !== '**') return left;
    cursor += 1;
    return { type: 'binary', operator: '**', left, right: unary() };
  };
  const unary = () => {
    if (peek().type === '+' || peek().type === '-') {
      const operator = tokens[cursor++].type;
      return { type: 'unary', operator, value: unary() };
    }
    return power();
  };
  const product = () => {
    let value = unary();
    while (peek().type === '*' || peek().type === '/') {
      const operator = tokens[cursor++].type;
      value = { type: 'binary', operator, left: value, right: unary() };
    }
    return value;
  };
  const expression = () => {
    let value = product();
    while (peek().type === '+' || peek().type === '-') {
      const operator = tokens[cursor++].type;
      value = { type: 'binary', operator, left: value, right: product() };
    }
    return value;
  };

  const ast = expression();
  if (peek().type !== 'eof') throw new LossExpressionError('unexpected', peek().value);
  return ast;
}

function compileNode(node, framework) {
  if (node.type === 'number') return node.value;
  if (node.type === 'variable') return node.name;
  if (node.type === 'unary') return `(${node.operator}${compileNode(node.value, framework)})`;
  if (node.type === 'binary') return `(${compileNode(node.left, framework)} ${node.operator} ${compileNode(node.right, framework)})`;
  const args = node.args.map((argument) => compileNode(argument, framework));
  const names = framework === 'pytorch' ? {
    mean: 'torch.mean', sum: 'torch.sum', abs: 'torch.abs', square: 'torch.square',
    sqrt: 'torch.sqrt', log: 'torch.log', exp: 'torch.exp',
  } : {
    mean: 'tf.reduce_mean', sum: 'tf.reduce_sum', abs: 'tf.abs', square: 'tf.square',
    sqrt: 'tf.sqrt', log: 'tf.math.log', exp: 'tf.exp',
  };
  if (node.name === 'clip') {
    return framework === 'pytorch'
      ? `torch.clamp(${args[0]}, min=${args[1]}, max=${args[2]})`
      : `tf.clip_by_value(${args[0]}, ${args[1]}, ${args[2]})`;
  }
  return `${names[node.name]}(${args.join(', ')})`;
}

export function compileLossExpression(source, framework) {
  if (!['pytorch', 'tensorflow'].includes(framework)) throw new Error(`Unsupported framework: ${framework}`);
  return compileNode(parseLossExpression(source), framework);
}

export const lossExpressionFunctions = Object.freeze(Object.keys(functions));
