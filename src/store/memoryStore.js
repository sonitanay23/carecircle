/**
 * In-memory document store with the same interface as the Firestore store.
 * Used for tests and local development. Values are deep-copied in and out so
 * callers can never mutate stored state by accident.
 */

const OPS = {
  '==': (a, b) => a === b,
  '!=': (a, b) => a !== b,
  '<': (a, b) => a < b,
  '<=': (a, b) => a <= b,
  '>': (a, b) => a > b,
  '>=': (a, b) => a >= b,
  'array-contains': (a, b) => Array.isArray(a) && a.includes(b),
};

const getField = (doc, field) => field.split('.').reduce((v, k) => (v === null || v === undefined ? undefined : v[k]), doc);

export function createMemoryStore() {
  /** @type {Map<string, Map<string, object>>} */
  const data = new Map();
  const bucket = (path) => {
    if (!data.has(path)) data.set(path, new Map());
    return data.get(path);
  };

  const collection = (path) => ({
    async get(id) {
      const doc = bucket(path).get(id);
      return doc ? structuredClone(doc) : null;
    },
    async create(id, doc) {
      const b = bucket(path);
      if (b.has(id)) {
        const err = new Error(`Document ${path}/${id} already exists`);
        err.code = 'ALREADY_EXISTS';
        throw err;
      }
      b.set(id, structuredClone({ ...doc, id }));
      return structuredClone(b.get(id));
    },
    async set(id, doc) {
      bucket(path).set(id, structuredClone({ ...doc, id }));
      return structuredClone(bucket(path).get(id));
    },
    async update(id, patch) {
      const b = bucket(path);
      const current = b.get(id);
      if (!current) {
        const err = new Error(`Document ${path}/${id} not found`);
        err.code = 'NOT_FOUND';
        throw err;
      }
      const next = structuredClone(current);
      // Dotted keys update nested fields, matching Firestore semantics.
      for (const [key, value] of Object.entries(patch)) {
        const parts = key.split('.');
        let target = next;
        for (const part of parts.slice(0, -1)) {
          if (typeof target[part] !== 'object' || target[part] === null) target[part] = {};
          target = target[part];
        }
        target[parts.at(-1)] = structuredClone(value);
      }
      b.set(id, next);
      return structuredClone(next);
    },
    async delete(id) {
      bucket(path).delete(id);
    },
    async list({ where = [], orderBy, limit } = {}) {
      let docs = [...bucket(path).values()];
      for (const [field, op, value] of where) {
        const test = OPS[op];
        if (!test) throw new Error(`Unsupported operator ${op}`);
        docs = docs.filter((d) => test(getField(d, field), value));
      }
      if (orderBy) {
        const dir = orderBy.direction === 'desc' ? -1 : 1;
        docs.sort((a, b) => {
          const x = getField(a, orderBy.field);
          const y = getField(b, orderBy.field);
          return x < y ? -dir : x > y ? dir : 0;
        });
      }
      if (limit) docs = docs.slice(0, limit);
      return docs.map((d) => structuredClone(d));
    },
  });

  return { kind: 'memory', collection };
}
