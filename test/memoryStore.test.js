import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryStore } from '../src/store/memoryStore.js';

test('create, get, update with dotted paths, delete', async () => {
  const c = createMemoryStore().collection('things');
  await c.create('a', { n: 1, nested: { x: 1 } });
  await assert.rejects(c.create('a', {}), (e) => e.code === 'ALREADY_EXISTS');
  const updated = await c.update('a', { 'nested.y': 2, n: 5 });
  assert.deepEqual(updated, { id: 'a', n: 5, nested: { x: 1, y: 2 } });
  await assert.rejects(c.update('missing', {}), (e) => e.code === 'NOT_FOUND');
  await c.delete('a');
  assert.equal(await c.get('a'), null);
});

test('returned documents are copies', async () => {
  const c = createMemoryStore().collection('things');
  await c.create('a', { list: [1] });
  const doc = await c.get('a');
  doc.list.push(2);
  assert.deepEqual((await c.get('a')).list, [1]);
});

test('list supports where, orderBy and limit', async () => {
  const c = createMemoryStore().collection('things');
  for (const [id, n, s] of [
    ['a', 3, 'x'],
    ['b', 1, 'y'],
    ['c', 2, 'x'],
  ])
    await c.create(id, { n, s });
  const xs = await c.list({
    where: [['s', '==', 'x']],
    orderBy: { field: 'n', direction: 'desc' },
  });
  assert.deepEqual(
    xs.map((d) => d.id),
    ['a', 'c'],
  );
  assert.equal((await c.list({ orderBy: { field: 'n' }, limit: 1 }))[0].id, 'b');
  assert.deepEqual((await c.list({ where: [['n', '<', 3]] })).map((d) => d.id).sort(), ['b', 'c']);
});
