/**
 * Firestore-backed document store. Same interface as the memory store.
 * The Firestore client is imported lazily so tests and local runs do not need
 * Google credentials. On Cloud Run, credentials come from the service account.
 */
export async function createFirestoreStore({ projectId, databaseId } = {}) {
  const { Firestore } = await import('@google-cloud/firestore');
  const db = new Firestore({
    ...(projectId ? { projectId } : {}),
    ...(databaseId ? { databaseId } : {}),
    ignoreUndefinedProperties: true,
  });

  const collection = (path) => {
    const ref = db.collection(path);
    return {
      async get(id) {
        const snap = await ref.doc(id).get();
        return snap.exists ? { ...snap.data(), id: snap.id } : null;
      },
      async create(id, doc) {
        try {
          await ref.doc(id).create({ ...doc, id });
        } catch (err) {
          // gRPC code 6 = ALREADY_EXISTS
          if (err.code === 6) err.code = 'ALREADY_EXISTS';
          throw err;
        }
        return { ...doc, id };
      },
      async set(id, doc) {
        await ref.doc(id).set({ ...doc, id });
        return { ...doc, id };
      },
      async update(id, patch) {
        try {
          await ref.doc(id).update(patch);
        } catch (err) {
          // gRPC code 5 = NOT_FOUND
          if (err.code === 5) err.code = 'NOT_FOUND';
          throw err;
        }
        const snap = await ref.doc(id).get();
        return { ...snap.data(), id };
      },
      async delete(id) {
        await ref.doc(id).delete();
      },
      async list({ where = [], orderBy, limit } = {}) {
        let q = ref;
        for (const [field, op, value] of where) q = q.where(field, op, value);
        if (orderBy) q = q.orderBy(orderBy.field, orderBy.direction ?? 'asc');
        if (limit) q = q.limit(limit);
        const snap = await q.get();
        return snap.docs.map((d) => ({ ...d.data(), id: d.id }));
      },
    };
  };

  return { kind: 'firestore', collection };
}
