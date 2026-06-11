// expr.js - safe arithmetic expression evaluator + seeded variable sampler
// for parameterized question stems (stems.js). No eval(): a small
// recursive-descent parser over numbers, variables, arithmetic, comparisons
// and a whitelist of math functions.
//
// Grammar (loosest binding first):
//   comparison := additive (('=='|'!='|'<='|'>='|'<'|'>') additive)?
//   additive   := multiplicative (('+'|'-') multiplicative)*
//   multiplicative := unary (('*'|'/'|'%') unary)*
//   unary      := '-' unary | power
//   power      := primary ('^' unary)?            (right-assoc)
//   primary    := NUMBER | NAME ('(' args ')')? | '(' comparison ')'

const FUNCS = {
  abs: Math.abs, sqrt: Math.sqrt, round: Math.round, floor: Math.floor,
  ceil: Math.ceil, min: Math.min, max: Math.max, pow: Math.pow,
  log: Math.log, exp: Math.exp, sin: Math.sin, cos: Math.cos, tan: Math.tan,
}

const TOKEN_RE = /\s*(\d+\.?\d*|[A-Za-z_][A-Za-z0-9_]*|==|!=|<=|>=|[-+*/%^(),<>])/y

function tokenize(src) {
  const tokens = []
  TOKEN_RE.lastIndex = 0
  let pos = 0
  while (pos < src.length) {
    TOKEN_RE.lastIndex = pos
    const m = TOKEN_RE.exec(src)
    if (!m) {
      if (/^\s*$/.test(src.slice(pos))) break
      throw new Error(`bad token at "${src.slice(pos, pos + 10)}"`)
    }
    tokens.push(m[1])
    pos = TOKEN_RE.lastIndex
  }
  return tokens
}

export function evaluate(src, vars = {}) {
  const tokens = tokenize(String(src))
  let i = 0
  const peek = () => tokens[i]
  const next = () => tokens[i++]
  const expect = (t) => { if (next() !== t) throw new Error(`expected "${t}" in "${src}"`) }

  function comparison() {
    let left = additive()
    const op = peek()
    if (['==', '!=', '<', '<=', '>', '>='].includes(op)) {
      next()
      const right = additive()
      switch (op) {
        case '==': return left === right ? 1 : 0
        case '!=': return left !== right ? 1 : 0
        case '<':  return left <  right ? 1 : 0
        case '<=': return left <= right ? 1 : 0
        case '>':  return left >  right ? 1 : 0
        case '>=': return left >= right ? 1 : 0
      }
    }
    return left
  }
  function additive() {
    let v = multiplicative()
    while (peek() === '+' || peek() === '-') v = next() === '+' ? v + multiplicative() : v - multiplicative()
    return v
  }
  function multiplicative() {
    let v = unary()
    for (;;) {
      const op = peek()
      if (op === '*') { next(); v *= unary() }
      else if (op === '/') { next(); v /= unary() }
      else if (op === '%') { next(); v %= unary() }
      else return v
    }
  }
  function unary() {
    if (peek() === '-') { next(); return -unary() }
    return power()
  }
  function power() {
    const base = primary()
    if (peek() === '^') { next(); return Math.pow(base, unary()) }
    return base
  }
  function primary() {
    const t = next()
    if (t === undefined) throw new Error(`unexpected end of "${src}"`)
    if (t === '(') { const v = comparison(); expect(')'); return v }
    if (/^\d/.test(t)) return Number(t)
    if (/^[A-Za-z_]/.test(t)) {
      if (peek() === '(') {
        const fn = FUNCS[t]
        if (!fn) throw new Error(`unknown function "${t}"`)
        next()
        const args = []
        if (peek() !== ')') { args.push(comparison()); while (peek() === ',') { next(); args.push(comparison()) } }
        expect(')')
        return fn(...args)
      }
      if (!(t in vars)) throw new Error(`unknown variable "${t}"`)
      const v = vars[t]
      if (typeof v !== 'number') throw new Error(`variable "${t}" is not numeric`)
      return v
    }
    throw new Error(`unexpected "${t}" in "${src}"`)
  }

  const result = comparison()
  if (i !== tokens.length) throw new Error(`trailing tokens in "${src}"`)
  if (typeof result !== 'number' || Number.isNaN(result)) throw new Error(`"${src}" did not evaluate to a number`)
  return result
}

// ── Seeded RNG (mulberry32) — variants must be reproducible from a seed ─────

export function makeRng(seed) {
  let a = seed >>> 0
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ── Variable sampling ────────────────────────────────────────────────────────
// variables: [{ name, kind: 'int'|'float'|'choice', min, max, step?, decimals?, options? }]
// constraints: ["a != b", "a % b == 0", ...] — numeric expressions, truthy = satisfied.
// Choice variables resolve to their option's *value* for the stem text; if the
// option is numeric it can participate in expressions/constraints too.

export function sampleVariables(variables, constraints, rng, maxAttempts = 200) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const vars = {}
    for (const v of variables) {
      if (v.kind === 'int') {
        const step = v.step ?? 1
        const n = Math.floor((v.max - v.min) / step)
        vars[v.name] = v.min + step * Math.floor(rng() * (n + 1))
      } else if (v.kind === 'float') {
        const decimals = v.decimals ?? 2
        const raw = v.min + rng() * (v.max - v.min)
        vars[v.name] = Number(raw.toFixed(decimals))
      } else if (v.kind === 'choice') {
        vars[v.name] = v.options[Math.floor(rng() * v.options.length)]
      } else {
        throw new Error(`unknown variable kind "${v.kind}"`)
      }
    }
    const numericVars = {}
    for (const [k, val] of Object.entries(vars)) {
      if (typeof val === 'number') numericVars[k] = val
    }
    let ok = true
    for (const c of constraints) {
      try {
        if (!evaluate(c, numericVars)) { ok = false; break }
      } catch { ok = false; break }
    }
    if (ok) return vars
  }
  return null // unsatisfiable within budget — caller decides
}

export function renderTemplate(text, vars) {
  return String(text).replace(/\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g, (m, name) =>
    name in vars ? String(vars[name]) : m
  )
}
