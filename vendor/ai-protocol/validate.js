/* COPY of sites/_shared/ai-protocol/validate.js — edit the source there and run node _shared/sync.mjs */
// A small JSON Schema checker for AI Updates payloads. Source: sites/_shared/ai-protocol/.
//
// It covers the subset the app schemas use, no more: type, const, enum, required,
// properties, additionalProperties, items, minItems/maxItems, minLength/maxLength,
// pattern, minimum/maximum, minProperties, propertyNames, anyOf, and $ref to
// "#/defs/<name>" (resolved against the defs object passed in). An unknown keyword
// is an error in the schema, not silently ignored, so a schema can't quietly check
// less than it says.
//
// Errors are plain sentences with a path, for showing to Tom in a preview:
//   "day: should be a date like 2026-11-14"

const KNOWN = new Set(['type', 'const', 'enum', 'required', 'properties', 'additionalProperties', 'items',
  'minItems', 'maxItems', 'minLength', 'maxLength', 'pattern', 'minimum', 'maximum', 'minProperties',
  'propertyNames', 'anyOf', '$ref', 'description', 'title', 'default', 'examples', 'hint', '$schema', '$id']);

const typeOf = v => (v === null ? 'null' : Array.isArray(v) ? 'array'
  : typeof v === 'number' ? (Number.isInteger(v) ? 'integer' : 'number') : typeof v);

const matchesType = (v, t) => {
  const actual = typeOf(v);
  return actual === t || (t === 'number' && actual === 'integer');
};

const show = v => {
  const s = JSON.stringify(v);
  return s === undefined ? String(v) : s.length > 40 ? s.slice(0, 37) + '…' : s;
};

/**
 * Check a value against a schema.
 * @param {any} value
 * @param {object} schema
 * @param {{defs?: object, path?: string}} [opts]
 * @returns {string[]} errors; empty when the value is valid
 */
export function validate(value, schema, opts = {}) {
  const errors = [];
  walk(value, schema, opts.path ?? '', opts.defs ?? {}, errors);
  return errors;
}

function walk(v, s, path, defs, errors) {
  const at = path || 'the action';
  const say = msg => errors.push(`${at}: ${msg}`);
  if (s === true || s === undefined) return;
  if (s === false) return say('isn’t allowed here');
  for (const k of Object.keys(s)) if (!KNOWN.has(k)) throw new Error(`Schema keyword "${k}" isn’t supported (at ${at})`);

  if (s.$ref) {
    const m = /^#\/defs\/(.+)$/.exec(s.$ref);
    if (!m || !(m[1] in defs)) throw new Error(`Schema $ref "${s.$ref}" not found (at ${at})`);
    return walk(v, defs[m[1]], path, defs, errors);
  }

  if (s.anyOf) {
    // Valid if any branch is. Otherwise report the closest branch's errors, which say more
    // than "doesn't match" (unless the schema gives its own hint).
    // The node's other keywords still apply when a branch matches.
    let best = null, matched = false;
    for (const sub of s.anyOf) {
      const e = []; walk(v, sub, path, defs, e);
      if (!e.length) { matched = true; break; }
      if (!best || e.length < best.length) best = e;
    }
    if (!matched) {
      if (s.hint || !best) say(s.hint ?? 'doesn’t match any of the allowed forms');
      else errors.push(...best);
      return;
    }
  }

  if (s.type !== undefined) {
    const types = Array.isArray(s.type) ? s.type : [s.type];
    if (!types.some(t => matchesType(v, t))) {
      return say(s.hint ?? `should be ${types.map(t => (t === 'integer' ? 'a whole number' : t === 'array' ? 'a list' : t === 'object' ? 'an object' : t === 'null' ? 'null' : `a ${t}`)).join(' or ')}, not ${show(v)}`);
    }
  }
  if ('const' in s && v !== s.const) return say(`should be ${show(s.const)}`);
  if (s.enum && !s.enum.some(e => e === v)) return say(`should be one of ${s.enum.map(show).join(', ')}, not ${show(v)}`);

  const t = typeOf(v);
  if (t === 'string') {
    if (s.minLength !== undefined && v.length < s.minLength) say(s.minLength === 1 ? 'shouldn’t be empty' : `should be at least ${s.minLength} characters`);
    if (s.maxLength !== undefined && v.length > s.maxLength) say(`should be at most ${s.maxLength} characters`);
    if (s.pattern && !new RegExp(s.pattern).test(v)) say(s.hint ?? `doesn’t look right (${show(v)})`);
  }
  if (t === 'number' || t === 'integer') {
    if (s.minimum !== undefined && v < s.minimum) say(`should be at least ${s.minimum}`);
    if (s.maximum !== undefined && v > s.maximum) say(`should be at most ${s.maximum}`);
  }
  if (t === 'array') {
    if (s.minItems !== undefined && v.length < s.minItems) say(s.minItems === 1 ? 'shouldn’t be an empty list' : `should have at least ${s.minItems} items`);
    if (s.maxItems !== undefined && v.length > s.maxItems) say(`should have at most ${s.maxItems} items`);
    if (s.items) v.forEach((item, i) => walk(item, s.items, `${path}[${i}]`, defs, errors));
  }
  if (t === 'object') {
    const keys = Object.keys(v);
    const join = k => (path ? `${path}.${k}` : k);
    for (const k of s.required ?? []) if (!(k in v) || v[k] === undefined) errors.push(`${join(k)}: is missing`);
    if (s.minProperties !== undefined && keys.length < s.minProperties) say(`should have at least ${s.minProperties} entr${s.minProperties === 1 ? 'y' : 'ies'}`);
    if (s.propertyNames) for (const k of keys) {
      const e = []; walk(k, s.propertyNames, join(k), defs, e);
      if (e.length) errors.push(`${join(k)}: isn’t a valid name`);
    }
    const props = s.properties ?? {};
    for (const k of keys) {
      if (k in props) walk(v[k], props[k], join(k), defs, errors);
      else if (s.additionalProperties === false) errors.push(`${join(k)}: isn’t a field this accepts`);
      else if (s.additionalProperties && typeof s.additionalProperties === 'object') walk(v[k], s.additionalProperties, join(k), defs, errors);
    }
  }
}
