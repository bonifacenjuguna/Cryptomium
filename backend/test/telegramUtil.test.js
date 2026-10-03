import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safeEdit } from '../src/telegramUtil.js';

function fakeCtx({ throws } = {}) {
  return {
    calls: [],
    async editMessageText(text, extra) {
      this.calls.push([text, extra]);
      if (throws) throw Object.assign(new Error(throws), { description: throws });
    },
  };
}

test('safeEdit returns true when the message actually changes', async () => {
  const ctx = fakeCtx();
  const changed = await safeEdit(ctx, 'hello', { x: 1 });
  assert.equal(changed, true);
  assert.deepEqual(ctx.calls, [['hello', { x: 1 }]]);
});

test('safeEdit swallows "message is not modified" and returns false', async () => {
  const ctx = fakeCtx({ throws: 'Bad Request: message is not modified' });
  const changed = await safeEdit(ctx, 'hello');
  assert.equal(changed, false);
});

test('safeEdit re-throws any other error', async () => {
  const ctx = fakeCtx({ throws: 'Bad Request: message to edit not found' });
  await assert.rejects(safeEdit(ctx, 'hello'), /not found/);
});
