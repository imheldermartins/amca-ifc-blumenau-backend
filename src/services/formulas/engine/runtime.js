/* Portable, bounded interpreter. No generated code or ambient capabilities. */
  const LIMITS = Object.freeze({ bytes: 8192, nodes: 1024, depth: 64, relation: 250, steps: 100000, text: 65536 });
  const COLORS = Object.freeze(['red', 'pink', 'orange', 'yellow', 'green', 'blue', 'purple', 'grey']);
  const scalar = kind => Object.freeze({ kind });
  const T = Object.freeze({ number: scalar('number'), text: scalar('text'), boolean: scalar('boolean'), null: scalar('null') });
  const list = item => ({ kind: 'list', item });
  const variants = t => t.kind === 'union' ? t.options : [t];
  const typeKey = t => t.kind === 'list' ? `list<${typeKey(t.item)}>` : t.kind === 'chip' ? `chip<${typeKey(t.item)}>` : t.kind === 'pages' ? `pages<${t.databaseId}>` : t.kind === 'union' ? t.options.map(typeKey).sort().join('|') : t.kind;
  const union = (...types) => {
    const options = [...new Map(types.flatMap(variants).map(t => [typeKey(t), t])).values()];
    return options.length === 1 ? options[0] : { kind: 'union', options };
  };
  const unstyledType = t => t.kind === 'chip' ? unstyledType(t.item) : t.kind === 'list' ? list(unstyledType(t.item)) : t.kind === 'union' ? union(...t.options.map(unstyledType)) : t;
  const unstyled = value => value && value.kind === 'markup' ? unstyled(value.value) : Array.isArray(value) ? value.map(unstyled) : value;
  const scalarKinds = ['number', 'text', 'boolean', 'null'];
  class FormulaError extends Error {
    constructor(code, message, node = {}) { super(message); this.name = 'FormulaError'; this.code = code; this.start = node.start ?? 0; this.end = node.end ?? this.start + 1; }
  }
  const fail = (code, message, node) => { throw new FormulaError(code, message, node); };
  const diagnostic = e => ({ code: e.code ?? 'INTERNAL', message: e instanceof FormulaError ? e.message : 'Não foi possível calcular esta expressão.', start: e.start ?? 0, end: e.end ?? 1 });
  const expectType = (type, kinds, node) => {
    if (!variants(type).every(t => kinds.includes(t.kind))) fail('TYPE', `Esperado ${kinds.join(' ou ')}; recebido ${typeKey(type)}.`, node);
    return type;
  };
  const expectList = (type, node) => { expectType(type, ['list'], node); return union(...variants(type).map(t => t.item)); };
  const arity = (args, min, max, node) => { if (args.length < min || args.length > max) fail('ARITY', `Esperado ${min === max ? min : `${min} a ${max}`} argumento(s); recebido ${args.length}.`, node); };
  const number = (value, node) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) fail('NUMBER', value === null ? 'Valor vazio: use coalesce(propriedade, 0).' : 'Esta operação exige um número finito.', node);
    return value;
  };
  const text = (value, node) => { if (typeof value !== 'string') fail('TEXT', 'Esta operação exige texto. Use toText() para converter.', node); return value; };
  const boolean = (value, node) => { if (typeof value !== 'boolean') fail('BOOLEAN', 'A condição exige true ou false.', node); return value; };
  const plainScalar = (value, node) => {
    if (value !== null && !['number', 'string', 'boolean'].includes(typeof value)) fail('SCALAR', 'Use uma projeção ou agregação para obter um valor simples.', node);
    return value;
  };
  const numericList = (value, node) => { if (!Array.isArray(value)) fail('LIST', 'Esperada uma lista.', node); value.forEach(v => number(v, node)); return value; };
  const methods = new Map();
  const operators = new Map();
  const register = (name, spec) => methods.set(name, Object.freeze({ name, strategy: 'eager', ...spec }));
  const signature = (params, result, optional = 0) => (args, api, node) => {
    arity(args, params.length - optional, params.length, node);
    args.forEach((arg, i) => expectType(api.infer(arg), params[i], arg));
    return typeof result === 'function' ? result(args.map(api.infer), node) : result;
  };
  const numericSignature = (count = 1, optional = 0) => signature(Array.from({ length: count }, () => ['number']), T.number, optional);
  const textSignature = (count = 1, result = T.text) => signature(Array.from({ length: count }, () => ['text']), result);
  const listSignature = (allowed, output) => (args, api, node) => {
    arity(args, 1, 1, node);
    const item = expectList(api.infer(args[0]), args[0]);
    expectType(item, allowed, args[0]);
    return typeof output === 'function' ? output(item) : output;
  };
  register('index', {
    group: 'Página', syntax: 'index()', description: 'Posição a partir de 1 entre páginas acessíveis da database, em ordem de ID. Independe da view.', contextual: true,
    infer: signature([], T.number), run: (args, api, node) => api.currentIndex(node),
  });
  register('if', {
    group: 'Lógica', syntax: 'if(condição, então, senão)', description: 'Avalia somente o ramo escolhido.', strategy: 'lazy',
    infer: (args, api, node) => { arity(args, 3, 3, node); expectType(api.infer(args[0]), ['boolean'], args[0]); return union(api.infer(args[1]), api.infer(args[2])); },
    run: (args, api, node) => api.evaluate(args[boolean(api.evaluate(args[0]), node) ? 1 : 2]),
  });
  register('coalesce', {
    group: 'Lógica', syntax: 'coalesce(valor, alternativa)', description: 'Usa a alternativa apenas quando o valor é null.', strategy: 'lazy',
    infer: (args, api, node) => { arity(args, 2, 2, node); const primary = variants(api.infer(args[0])).filter(t => t.kind !== 'null'); return union(...primary, api.infer(args[1])); },
    run: (args, api) => { const value = api.evaluate(args[0]); return value === null ? api.evaluate(args[1]) : value; },
  });
  register('isEmpty', {
    group: 'Lógica', syntax: 'isEmpty(valor)', description: 'Verdadeiro para null, texto vazio ou coleção vazia.',
    infer: (args, api, node) => { arity(args, 1, 1, node); api.infer(args[0]); return T.boolean; },
    run: ([v]) => v === null || v === '' || (Array.isArray(v) && v.length === 0) || (v?.kind === 'pages' && v.ids.length === 0),
  });
  register('toNumber', {
    group: 'Conversão', syntax: 'toNumber(texto)', description: 'Converte texto decimal, com ponto, em número finito.',
    infer: signature([['number', 'text']], T.number),
    run: ([v], api, node) => { if (typeof v === 'number') return number(v, node); if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text(v, node).trim())) fail('CONVERSION', 'Texto numérico inválido; use ponto decimal, sem moeda.', node); return number(Number(v), node); },
  });
  register('toText', {
    group: 'Conversão', syntax: 'toText(valor)', description: 'Converte um valor simples em texto; null vira texto vazio.',
    infer: signature([scalarKinds], T.text), run: ([v], api, node) => String(plainScalar(v, node) ?? ''),
  });
  const numericFns = { abs: Math.abs, floor: Math.floor, ceil: Math.ceil };
  for (const [name, fn] of Object.entries(numericFns)) register(name, { group: 'Números', syntax: `${name}(número)`, description: ({ abs: 'Valor absoluto.', floor: 'Arredonda para baixo.', ceil: 'Arredonda para cima.' })[name], infer: numericSignature(), run: ([v], api, node) => fn(number(v, node)) });
  register('round', {
    group: 'Números', syntax: 'round(número, casas?)', description: 'Arredonda; casas de 0 a 10, padrão 0.', infer: numericSignature(2, 1),
    run: ([v, digits = 0], api, node) => { number(v, node); number(digits, node); if (!Number.isInteger(digits) || digits < 0 || digits > 10) fail('PRECISION', 'Use de 0 a 10 casas decimais.', node); const scale = 10 ** digits; return Math.round(number(v * scale, node)) / scale; },
  });
  const textFns = { lower: s => s.toLowerCase(), upper: s => s.toUpperCase(), trim: s => s.trim() };
  for (const [name, fn] of Object.entries(textFns)) register(name, { group: 'Texto', syntax: `${name}(texto)`, description: ({ lower: 'Letras minúsculas.', upper: 'Letras maiúsculas.', trim: 'Remove espaços das extremidades.' })[name], infer: textSignature(), run: ([v], api, node) => fn(text(v, node)) });
  const searchFns = { contains: (s, q) => s.includes(q), startsWith: (s, q) => s.startsWith(q), endsWith: (s, q) => s.endsWith(q) };
  for (const [name, fn] of Object.entries(searchFns)) register(name, { group: 'Texto', syntax: `${name}(texto, trecho)`, description: 'Compara texto literal, diferenciando maiúsculas.', infer: textSignature(2, T.boolean), run: ([v, q], api, node) => fn(text(v, node), text(q, node)) });
  register('length', { group: 'Texto', syntax: 'length(texto)', description: 'Quantidade de caracteres Unicode.', infer: textSignature(1, T.number), run: ([v], api, node) => [...text(v, node)].length });
  for (const name of ['padStart', 'padEnd']) register(name, {
    group: 'Texto', syntax: `${name}(texto, tamanho, preenchimento?)`,
    description: `Completa ${name === 'padStart' ? 'o início' : 'o final'} até o tamanho em caracteres Unicode; padrão: espaço. Não corta o texto.`,
    infer: signature([['text'], ['number'], ['text']], T.text, 1),
    run: ([v, size, fill = ' '], api, node) => {
      text(v, node); number(size, node); text(fill, node);
      if (!Number.isInteger(size) || size < 0 || size > LIMITS.text) fail('ARGUMENT', `O tamanho deve ser um inteiro de 0 a ${LIMITS.text}.`, node);
      const missing = size - [...v].length;
      if (missing <= 0 || fill === '') return v;
      const characters = [...fill];
      const repeats = Math.floor(missing / characters.length);
      const suffix = characters.slice(0, missing % characters.length).join('');
      const paddingLength = repeats * fill.length + suffix.length;
      if (v.length + paddingLength > LIMITS.text) fail('TEXT_LIMIT', 'Texto grande demais.', node);
      api.spend(paddingLength, node);
      const padding = fill.repeat(repeats) + suffix;
      return name === 'padStart' ? padding + v : v + padding;
    },
  });
  register('replace', { group: 'Texto', syntax: 'replace(texto, trecho, novo)', description: 'Substitui todas as ocorrências literais; não aceita regex.', infer: textSignature(3), run: ([v, q, r], api, node) => { text(v, node); text(q, node); text(r, node); if (q === '') fail('ARGUMENT', 'O trecho a substituir não pode estar vazio.', node); const parts = v.split(q); api.spend(parts.length * r.length, node); return parts.join(r); } });
  for (const name of ['map', 'filter']) register(name, {
    group: 'Relações', syntax: name === 'map' ? 'map(relação, expressão)' : 'filter(relação, condição)', description: name === 'map' ? 'Calcula uma expressão para cada página relacionada.' : 'Seleciona páginas da relação por uma condição.', strategy: 'scoped',
    infer: (args, api, node) => {
      arity(args, 2, 2, node); const collection = api.infer(args[0]); expectType(collection, ['pages'], args[0]);
      const result = api.inScope(collection.databaseId).infer(args[1]);
      if (name === 'filter') { expectType(result, ['boolean'], args[1]); return collection; }
      expectType(result, [...scalarKinds, 'chip'], args[1]); return list(result);
    },
    run: (args, api, node) => {
      const collection = api.evaluate(args[0]); if (collection?.kind !== 'pages') fail('RELATION', 'Use uma propriedade relation ou filter(relação, condição).', node);
      const result = [];
      for (const id of collection.ids) { api.spend(1, node); const value = api.inPage(id).evaluate(args[1]); if (name === 'filter') { if (boolean(value, args[1])) result.push(id); } else result.push(value); }
      return name === 'filter' ? { ...collection, ids: result } : result;
    },
  });
  const aggregates = {
    sum: xs => xs.reduce((a, b) => a + b, 0),
    avg: xs => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null,
    min: xs => xs.length ? Math.min(...xs) : null,
    max: xs => xs.length ? Math.max(...xs) : null,
  };
  for (const [name, fn] of Object.entries(aggregates)) register(name, { group: 'Listas', syntax: `${name}(lista)`, description: ({ sum: 'Soma; lista vazia retorna 0.', avg: 'Média; lista vazia retorna null.', min: 'Menor valor; lista vazia retorna null.', max: 'Maior valor; lista vazia retorna null.' })[name], infer: listSignature(['number'], name === 'sum' ? T.number : union(T.number, T.null)), run: ([v], api, node) => fn(numericList(v, node)) });
  register('count', { group: 'Listas', syntax: 'count(lista)', description: 'Conta itens da lista ou páginas da relação.', infer: signature([['list', 'pages']], T.number), run: ([v], api, node) => { if (Array.isArray(v)) return v.length; if (v?.kind === 'pages') return v.ids.length; fail('LIST', 'Esperada uma coleção.', node); } });
  register('unique', { group: 'Listas', syntax: 'unique(lista)', description: 'Remove valores simples repetidos, preservando a ordem.', infer: listSignature(scalarKinds, list), run: ([v], api, node) => { v.forEach(x => plainScalar(x, node)); return [...new Set(v)]; } });
  register('join', { group: 'Listas', syntax: 'join(lista, separador)', description: 'Une uma lista de textos.', infer: (args, api, node) => { arity(args, 2, 2, node); expectType(expectList(api.infer(args[0]), args[0]), ['text'], args[0]); expectType(api.infer(args[1]), ['text'], args[1]); return T.text; }, run: ([v, sep], api, node) => { v.forEach(x => text(x, node)); text(sep, node); api.spend(sep.length * Math.max(0, v.length - 1), node); return v.join(sep); } });
  register('markup', {
    group: 'Apresentação', syntax: 'markup(valor, cor?)', description: 'Exibe um chip. Cor padrão: grey.',
    infer: (args, api, node) => { arity(args, 1, 2, node); const inner = expectType(api.infer(args[0]), scalarKinds, args[0]); if (args[1]) { expectType(api.infer(args[1]), ['text'], args[1]); if (args[1].kind === 'literal' && !COLORS.includes(args[1].value)) fail('COLOR', `Cores: ${COLORS.join(', ')}.`, args[1]); } return { kind: 'chip', item: inner }; },
    run: ([v, color = 'grey'], api, node) => { plainScalar(v, node); if (!COLORS.includes(color)) fail('COLOR', 'Cor desconhecida.', node); return { kind: 'markup', value: v, color }; },
  });
  const numericOps = { '-': (a, b) => a - b, '*': (a, b) => a * b, '/': (a, b) => a / b, '%': (a, b) => a % b };
  for (const [name, fn] of Object.entries(numericOps)) operators.set(name, { precedence: name === '-' ? 5 : 6, strategy: 'eager', infer: numericSignature(2), run: ([a, b], api, node) => { number(a, node); number(b, node); if ((name === '/' || name === '%') && b === 0) fail('DIV_ZERO', 'Divisão por zero.', node); return fn(a, b); } });
  operators.set('+', {
    precedence: 5, strategy: 'eager',
    infer: (args, api, node) => { const [a, b] = args.map(api.infer); const results = []; for (const x of variants(a)) for (const y of variants(b)) { if (x.kind === 'number' && y.kind === 'number') results.push(T.number); else if ((x.kind === 'text' || y.kind === 'text') && scalarKinds.includes(x.kind) && scalarKinds.includes(y.kind) && x.kind !== 'null' && y.kind !== 'null') results.push(T.text); else fail('TYPE', 'Use dois números para somar, ou texto e valor simples para concatenar.', node); } return union(...results); },
    run: ([a, b], api, node) => { if (typeof a === 'number' && typeof b === 'number') return number(a, node) + number(b, node); plainScalar(a, node); plainScalar(b, node); if (a === null || b === null) fail('EMPTY', 'Valor vazio: use coalesce() antes de concatenar.', node); if (typeof a === 'string' || typeof b === 'string') return String(a) + String(b); fail('TYPE', 'Operação + incompatível.', node); },
  });
  const compareFns = { '==': (a, b) => a === b, '!=': (a, b) => a !== b, '<': (a, b) => a < b, '<=': (a, b) => a <= b, '>': (a, b) => a > b, '>=': (a, b) => a >= b };
  for (const [name, fn] of Object.entries(compareFns)) operators.set(name, {
    precedence: ['==', '!='].includes(name) ? 3 : 4, strategy: 'eager',
    infer: (args, api, node) => { const [a, b] = args.map(api.infer); const eq = ['==', '!='].includes(name); expectType(a, eq ? scalarKinds : ['number', 'text'], args[0]); expectType(b, eq ? scalarKinds : ['number', 'text'], args[1]); if (!eq && typeKey(a) !== typeKey(b)) fail('TYPE', 'Compare números com números ou textos com textos.', node); return T.boolean; },
    run: ([a, b], api, node) => { plainScalar(a, node); plainScalar(b, node); if (!['==', '!='].includes(name) && (a === null || b === null || typeof a !== typeof b)) fail('TYPE', 'Comparação exige valores presentes do mesmo tipo.', node); return fn(a, b); },
  });
  for (const name of ['&&', '||']) operators.set(name, {
    precedence: name === '&&' ? 2 : 1, strategy: 'lazy', infer: signature([['boolean'], ['boolean']], T.boolean),
    run: (args, api, node) => { const left = boolean(api.evaluate(args[0]), node); return name === '&&' ? (left ? boolean(api.evaluate(args[1]), node) : false) : (left ? true : boolean(api.evaluate(args[1]), node)); },
  });
  const unary = new Map([
    ['!', { strategy: 'eager', infer: signature([['boolean']], T.boolean), run: ([v], api, node) => !boolean(v, node) }],
    ['-', { strategy: 'eager', infer: numericSignature(), run: ([v], api, node) => -number(v, node) }],
    ['+', { strategy: 'eager', infer: numericSignature(), run: ([v], api, node) => number(v, node) }],
  ]);

  function tokenize(source, tolerant = false) {
    if (typeof source !== 'string' || new TextEncoder().encode(source).length > LIMITS.bytes) fail('SOURCE_LIMIT', `A expressão deve ter até ${LIMITS.bytes} bytes.`);
    const tokens = []; let offset = 0;
    const add = (kind, value, start, end) => tokens.push({ kind, value, start, end });
    try {
      while (offset < source.length) {
        if (/\s/u.test(source[offset])) { offset++; continue; }
        const start = offset; const char = source[offset]; const rest = source.slice(offset);
        if (char === '"' || char === "'") {
          offset++; let value = ''; let closed = false;
          while (offset < source.length) {
            const c = source[offset++];
            if (c === char) { closed = true; break; }
            if (c === '\n' || c === '\r') fail('STRING', 'Quebra de linha dentro de texto; use \\n.', { start, end: offset });
            if (c !== '\\') { value += c; continue; }
            const escaped = source[offset++]; const escapes = { n: '\n', r: '\r', t: '\t', '\\': '\\', "'": "'", '"': '"' };
            if (escaped === 'u') { const hex = source.slice(offset, offset + 4); if (!/^[\da-f]{4}$/i.test(hex)) fail('STRING', 'Escape Unicode inválido.', { start, end: offset }); value += String.fromCharCode(parseInt(hex, 16)); offset += 4; }
            else if (Object.hasOwn(escapes, escaped)) value += escapes[escaped];
            else fail('STRING', 'Escape de texto inválido.', { start, end: offset });
          }
          if (!closed) fail('STRING', 'Feche as aspas do texto.', { start, end: offset });
          add('string', value, start, offset); continue;
        }
        const ref = /^@(?:root\.)?(?:page\.title|columns\.[0-9A-HJKMNP-TV-Z]{26}|\{[^}\r\n]+\}|[\p{L}_][\p{L}\p{N}_]*)/u.exec(rest);
        if (ref) { offset += ref[0].length; add('reference', ref[0], start, offset); continue; }
        const numeric = /^(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(rest);
        if (numeric) { offset += numeric[0].length; add('number', number(Number(numeric[0]), { start, end: offset }), start, offset); continue; }
        const identifier = /^[A-Za-z_][A-Za-z_0-9]*/.exec(rest);
        if (identifier) { offset += identifier[0].length; add('identifier', identifier[0], start, offset); continue; }
        const operator = /^(==|!=|<=|>=|&&|\|\||[+\-*/%!<>])/.exec(rest);
        if (operator) { offset += operator[0].length; add('operator', operator[0], start, offset); continue; }
        if ('(),.;'.includes(char)) { offset++; add(char, char, start, offset); continue; }
        fail('TOKEN', `Símbolo não permitido: ${char}`, { start, end: start + 1 });
      }
    } catch (error) { if (!tolerant) throw error; }
    tokens.push({ kind: 'eof', value: '', start: offset, end: offset }); return tokens;
  }

  function parse(source) {
    const tokens = tokenize(source); let position = 0; let count = 0;
    const peek = () => tokens[position];
    const take = kind => { const token = tokens[position++]; if (kind && token.kind !== kind) fail('SYNTAX', `Esperado ${kind === ')' ? 'fechar parêntese )' : kind}.`, token); return token; };
    const node = value => { if (++count > LIMITS.nodes) fail('NODE_LIMIT', 'Expressão grande demais.', value); return value; };
    const call = (name, start, initial, depth) => {
      if (!methods.has(name)) fail('FUNCTION', `Função não permitida: ${name}.`, { start, end: peek().start });
      take('('); const args = [...initial];
      if (peek().kind !== ')') {
        args.push(expression(0, depth + 1));
        while (peek().kind === ',') { take(','); args.push(expression(0, depth + 1)); }
      }
      const close = take(')'); return node({ kind: 'call', name, args, start, end: close.end });
    };
    const expression = (minimum = 0, depth = 0) => {
      if (depth > LIMITS.depth) fail('DEPTH_LIMIT', 'Expressão aninhada demais.', peek());
      const token = take(); let left;
      switch (token.kind) {
        case 'number': case 'string': left = node({ kind: 'literal', value: token.value, start: token.start, end: token.end }); break;
        case 'reference': left = node({ kind: 'reference', raw: token.value, start: token.start, end: token.end }); break;
        case 'identifier':
          if (['true', 'false', 'null'].includes(token.value)) { left = node({ kind: 'literal', value: ({ true: true, false: false, null: null })[token.value], start: token.start, end: token.end }); break; }
          left = call(token.value, token.start, [], depth); break;
        case 'operator':
          if (!unary.has(token.value)) fail('SYNTAX', 'Esperada uma expressão.', token);
          { const arg = expression(7, depth + 1); left = node({ kind: 'unary', name: token.value, args: [arg], start: token.start, end: arg.end }); } break;
        case '(':
          left = expression(0, depth + 1); take(')'); break;
        default: fail('SYNTAX', 'Esperado um valor, uma menção ou uma função.', token);
      }
      while (true) {
        if (peek().kind === '.' && 8 >= minimum) { take('.'); const method = take('identifier'); left = call(method.value, left.start, [left], depth); continue; }
        const op = operators.get(peek().value);
        if (peek().kind !== 'operator' || !op || op.precedence < minimum) break;
        const operator = take(); const right = expression(op.precedence + 1, depth + 1);
        left = node({ kind: 'binary', name: operator.value, args: [left, right], start: left.start, end: right.end });
      }
      return left;
    };
    const ast = expression(); if (peek().kind === ';') take(';');
    if (peek().kind !== 'eof') fail('SYNTAX', 'Use somente uma expressão; verifique os parênteses e argumentos.', peek());
    return { ast, tokens, nodes: count };
  }
  const opFor = node => ({ call: methods, unary, binary: operators })[node.kind]?.get(node.name);
  const alias = value => value.replace(/\s+/gu, '_');
  function resolveSymbol(raw, catalog, databaseId, rootDatabaseId, node) {
    const rooted = raw.startsWith('@root.'); const name = raw.slice(rooted ? 6 : 1); const db = rooted ? rootDatabaseId : databaseId;
    if (name === 'page.title') return { id: 'title', name: 'Título da página', type: 'text', databaseId: db, rooted, title: true };
    const id = name.startsWith('columns.') ? name.slice(8) : null; const label = name.startsWith('{') ? name.slice(1, -1) : name;
    const found = catalog.filter(c => c.databaseId === db && (id ? c.id === id : c.name === label || alias(c.name) === label));
    if (found.length !== 1) fail('REFERENCE', found.length ? 'Nome ambíguo: selecione a propriedade pelo menu @.' : `Propriedade não encontrada neste escopo: ${raw}.`, node);
    return { ...found[0], rooted };
  }
  function canonicalize(source, references) {
    let result = source;
    for (const node of [...references].sort((a, b) => b.start - a.start)) {
      const s = node.symbol; const ref = `@${s.rooted ? 'root.' : ''}${s.title ? 'page.title' : `columns.${s.id}`}`;
      result = result.slice(0, node.start) + ref + result.slice(node.end);
    }
    return result;
  }
  function compileInternal(source, catalog, databaseId, rootDatabaseId, stack, cache, budget = { nodes: 0, bytes: 0 }) {
    budget.bytes += new TextEncoder().encode(source).length; if (budget.bytes > LIMITS.bytes * 8) fail("GRAPH_LIMIT", "Cadeia de fórmulas grande demais.");
    const parsed = parse(source); budget.nodes += parsed.nodes; if (budget.nodes > LIMITS.nodes * 8) fail("GRAPH_LIMIT", "Cadeia de fórmulas grande demais."); const references = []; const deps = new Map(); let requiresPageIndex = false;
    const infer = (node, currentDb = databaseId, depth = 0) => {
      if (depth > LIMITS.depth) fail('DEPTH_LIMIT', 'Expressão aninhada demais.', node);
      const api = { infer: child => infer(child, currentDb, depth + 1), inScope: db => ({ infer: child => infer(child, db, depth + 1) }) };
      let result;
      switch (node.kind) {
        case 'literal': result = node.value === null ? T.null : T[({ number: 'number', string: 'text', boolean: 'boolean' })[typeof node.value]]; break;
        case 'reference': {
          const symbol = resolveSymbol(node.raw, catalog, currentDb, rootDatabaseId, node); node.symbol = symbol; references.push(node);
          deps.set(`${symbol.databaseId}:${symbol.id}:${symbol.rooted}`, { columnId: symbol.id, databaseId: symbol.databaseId, scope: symbol.rooted ? 'root' : 'current', name: symbol.name });
          const typeMap = { numeric: T.number, text: T.text, select: T.text, checkbox: T.boolean, extract_as: T.number };
          if (symbol.type === 'relation') { result = { kind: 'pages', databaseId: symbol.targetDatabaseId }; break; }
          if (symbol.type === 'formula') {
            if (stack.includes(symbol.id)) fail('CYCLE', `Referência circular envolvendo ${symbol.name}.`, node);
            if (stack.length >= LIMITS.depth) fail('DEPTH_LIMIT', 'Cadeia de fórmulas grande demais.', node);
            const key = `${symbol.id}:${symbol.source}`;
            if (!cache.has(key)) cache.set(key, compileInternal(symbol.source, catalog, symbol.databaseId, symbol.databaseId, [...stack, symbol.id], cache, budget));
            node.formula = cache.get(key); requiresPageIndex ||= node.formula.requiresPageIndex; result = unstyledType(node.formula.valueType); break;
          }
          result = typeMap[symbol.type]; if (!result) fail('TYPE', `Propriedade ${symbol.type} ainda não tem projeção nesta versão.`, node); break;
        }
        default: { const operation = opFor(node); requiresPageIndex ||= operation.contextual === true; result = operation.infer(node.args, api, node); }
      }
      node.valueType = result; return result;
    };
    const valueType = infer(parsed.ast);
    if (variants(valueType).some(t => t.kind === 'pages')) fail('OUTPUT', 'Projete a relação com map() ou agregue com count().', parsed.ast);
    const compiled = { ok: true, version: 1, ast: parsed.ast, valueType, source, canonicalSource: canonicalize(source, references), dependencies: [...deps.values()], references: references.map(n => ({ start: n.start, end: n.end, symbol: n.symbol, valueType: n.valueType })), nodes: parsed.nodes, databaseId, requiresPageIndex };
    validateConstants(compiled); return compiled;
  }
  function validateConstants(compiled) {
    const pure = node => node.kind === 'literal' || (node.kind !== 'reference' && !opFor(node).contextual && node.args.every(pure));
    const calculate = node => {
      const result = evaluateFormula({...compiled,ast:node}, {pageId:'constant',pages:{constant:{id:'constant',databaseId:compiled.databaseId,values:{}}}});
      if(!result.ok) fail(result.error.code,result.error.message,node);
      return result.value;
    };
    const visit = node => {
      if(node.kind==='reference' || node.kind==='literal')return;
      if(pure(node)){calculate(node);return;}
      const first=node.args[0];
      if(first)visit(first);
      if(['if','coalesce','&&','||'].includes(node.name) && pure(first)) {
        const value=calculate(first);
        if(node.name==='if'){visit(node.args[value?1:2]);return;}
        if(node.name==='coalesce' && value!==null || node.name==='&&' && value===false || node.name==='||' && value===true)return;
      }
      node.args.slice(1).forEach(visit);
    };
    visit(compiled.ast);
  }
  function compileFormula(source, { catalog, databaseId, rootDatabaseId = databaseId, columnId } = {}) {
    try { const compiled = compileInternal(source, catalog ?? [], databaseId, rootDatabaseId, columnId ? [columnId] : [], new Map());
      if (!compiled.references.length && !compiled.requiresPageIndex) { const result = evaluateFormula(compiled, { pageId: 'constant', pages: {constant:{ id:'constant', databaseId, values:{} }} }); if (!result.ok) return {ok:false,diagnostics:[result.error]}; }
      return compiled; }
    catch (error) { return { ok: false, diagnostics: [diagnostic(error)] }; }
  }
  function evaluateFormula(compiled, context, options = {}) {
    if (!compiled?.ok) return { ok: false, error: compiled?.diagnostics?.[0] ?? { code: 'COMPILE', message: 'A expressão ainda não é válida.', start: 0, end: 1 } };
    const budget = { remaining: options.steps ?? LIMITS.steps, used: 0 }; const memo = new Map(); const active = new Set();
    const spend = (cost, node) => { budget.used += cost; budget.remaining -= cost; if (budget.remaining < 0) fail('BUDGET', 'Limite de trabalho excedido.', node); };
    const visible = page => page && !page.deleted && (context.canRead ? context.canRead(page) : page.readable !== false);
    const page = (id, node) => { const p = Object.hasOwn(context.pages, id) ? context.pages[id] : null; if (!visible(p)) fail('ACCESS', 'Página indisponível.', node); return p; };
    const chargeValue = (v, node) => {
      if (typeof v === 'number') number(v, node);
      if (typeof v === 'string') { if (v.length > LIMITS.text) fail('TEXT_LIMIT', 'Texto grande demais.', node); spend(v.length, node); }
      if (Array.isArray(v)) { spend(v.length, node); v.forEach(item => chargeValue(item, node)); }
      if (v?.kind === 'markup') chargeValue(v.value, node);
      return v;
    };
    const readReference = (node, frame, depth) => {
      const s = node.symbol; const current = page(s.rooted ? frame.rootId : frame.pageId, node);
      if (current.databaseId !== s.databaseId) fail('SCOPE', 'Propriedade fora do escopo da página.', node);
      if (s.title) return current.title ?? null;
      if (context.canReadColumn && !context.canReadColumn(current, s)) fail('ACCESS', 'Propriedade indisponível.', node);
      if (s.type === 'formula') {
        const key = `${current.id}:${s.id}`;
        if (active.has(key)) fail('CYCLE', 'Referência circular em execução.', node);
        if (memo.has(key)) return memo.get(key);
        active.add(key);
        try { const value = unstyled(evaluate(node.formula.ast, { pageId: current.id, rootId: current.id }, depth + 1)); memo.set(key, value); return value; }
        finally { active.delete(key); }
      }
      const raw = Object.hasOwn(current.values ?? {}, s.id) ? current.values[s.id] : null;
      if (s.type === 'relation') {
        if (raw === null) return { kind: 'pages', databaseId: s.targetDatabaseId, ids: [] };
        if (!Array.isArray(raw) || raw.some(id => typeof id !== 'string')) fail('RELATION', 'Valor de relação inválido.', node);
        if (raw.length > LIMITS.relation) fail('RELATION_LIMIT', 'A relação excedeu 250 páginas.', node);
        spend(raw.length, node);
        const ids = [...new Set(raw)].filter(id => { const target = Object.hasOwn(context.pages, id) ? context.pages[id] : null; return visible(target) && target.databaseId === s.targetDatabaseId; });
        return { kind: 'pages', databaseId: s.targetDatabaseId, ids };
      }
      if (raw === null) return null;
      if (s.type === 'select') return (s.options ?? []).find(option => option.id === raw)?.value ?? null;
      const validators = { numeric: number, extract_as: number, checkbox: boolean, text };
      return validators[s.type](raw, node);
    };
    const evaluate = (node, frame, depth = 0) => {
      if (depth > LIMITS.depth) fail('DEPTH_LIMIT', 'Limite de profundidade excedido.', node);
      spend(1, node); let value;
      const api = { evaluate: child => evaluate(child, frame, depth + 1), inPage: id => ({ evaluate: child => evaluate(child, { ...frame, pageId: id }, depth + 1) }), spend,
        currentIndex: span => { const index = page(frame.pageId, span).index; if (!Number.isSafeInteger(index) || index < 1) fail('PAGE_INDEX', 'A posição está disponível somente com uma página real.', span); return index; },
      };
      switch (node.kind) {
        case 'literal': value = node.value; break;
        case 'reference': value = readReference(node, frame, depth); break;
        default: { const operation = opFor(node); const args = operation.strategy === 'eager' ? node.args.map(api.evaluate) : node.args; value = operation.run(args, api, node); }
      }
      return chargeValue(value, node);
    };
    try { if (page(context.pageId, compiled.ast).databaseId !== compiled.databaseId) fail('SCOPE', 'Página fora da database da fórmula.', compiled.ast); const value = evaluate(compiled.ast, { pageId: context.pageId, rootId: context.pageId }); return { ok: true, value, valueType: compiled.valueType, steps: budget.used }; }
    catch (error) { return { ok: false, error: diagnostic(error), steps: budget.used }; }
  }
  function displaySource(source, catalog) {
    let result = source;
    for (const token of tokenize(source, true).filter(t => t.kind === 'reference').reverse()) {
      const match = /^@(root\.)?columns\.([0-9A-HJKMNP-TV-Z]{26})$/.exec(token.value); if (!match) continue;
      const column = catalog.find(c => c.id === match[2]); if (!column) continue;
      const label = /^[\p{L}_][\p{L}\p{N}_]*$/u.test(alias(column.name)) ? alias(column.name) : `{${column.name}}`;
      const lookup = label.startsWith('{') ? column.name : label;
      if (!column.name || /[{}\r\n]/.test(column.name) || catalog.filter(c => c.databaseId === column.databaseId && (c.name === lookup || alias(c.name) === lookup)).length !== 1) continue;
      result = result.slice(0, token.start) + `@${match[1] ?? ''}${label}` + result.slice(token.end);
    }
    return result;
  }
  function completionContext(source, caret, { catalog, databaseId }) {
    let tokens;
    try { tokens = tokenize(source.slice(0, caret), true); } catch { return databaseId; }
    const frames = [{ db: databaseId }];
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i]; const parent = frames.at(-1);
      if (token.kind === '(') frames.push({ db: parent.db, name: tokens[i - 1]?.kind === 'identifier' ? tokens[i - 1].value : '', first: token.end, commas: 0 });
      else if (token.kind === ')' && frames.length > 1) frames.pop();
      else if (token.kind === ',' && frames.length > 1) {
        parent.commas++;
        if (parent.commas === 1 && ['map', 'filter'].includes(parent.name)) {
          try {
            const parsed = compileInternal(`${source.slice(parent.first, token.start)}.count()`, catalog, parent.db, databaseId, [], new Map());
            const collection = parsed.ast.args[0].valueType;
            if (collection.kind === 'pages') parent.db = collection.databaseId;
          } catch { /* An incomplete first argument keeps the enclosing scope. */ }
        }
      }
    }
    return frames.at(-1).db;
  }
  export { compileFormula, evaluateFormula, tokenize, displaySource, completionContext, typeKey, LIMITS, COLORS };
export const operations = Object.freeze([...methods.values()].map(({ name, group, syntax, description, strategy }) => ({ name, group, syntax, description, strategy })));
