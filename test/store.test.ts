import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createJsonStore } from '../src/store.ts';

interface Sample {
  count: number;
  text: string;
}

function withTempDir(run: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-elysia-'));
  try {
    run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('写进去再读出来是同一份', () => {
  withTempDir((dir) => {
    const file = join(dir, 'nested', 'state.json');
    const store = createJsonStore<Sample>({ file, version: 1, create: () => ({ count: 0, text: '' }) });
    assert.deepEqual(store.read(), { count: 0, text: '' });
    store.write({ count: 7, text: '爱莉希雅' });
    assert.deepEqual(store.read(), { count: 7, text: '爱莉希雅' });
    assert.equal(existsSync(file + '.tmp'), false);
  });
});

test('损坏的存档回空壳，不抛异常', () => {
  withTempDir((dir) => {
    const file = join(dir, 'state.json');
    const store = createJsonStore<Sample>({ file, version: 1, create: () => ({ count: 0, text: '空' }) });
    store.write({ count: 3, text: '正常' });
    // 直接覆写成半截 JSON，模拟断电
    writeFileSync(file, '{"version":1,"value":{"count":3', 'utf8');
    assert.deepEqual(store.read(), { count: 0, text: '空' });
  });
});

test('版本不一致时走 migrate，迁移失败则回空壳', () => {
  withTempDir((dir) => {
    const file = join(dir, 'state.json');
    const old = createJsonStore<Sample>({ file, version: 0, create: () => ({ count: 0, text: '' }) });
    old.write({ count: 5, text: '旧档' });

    const migrated = createJsonStore<Sample>({
      file,
      version: 2,
      create: () => ({ count: 0, text: '' }),
      migrate: (raw) => ({ count: (raw as Sample).count * 2, text: (raw as Sample).text + '（迁移）' }),
    });
    assert.deepEqual(migrated.read(), { count: 10, text: '旧档（迁移）' });

    const refuses = createJsonStore<Sample>({ file, version: 9, create: () => ({ count: -1, text: '新空壳' }) });
    assert.deepEqual(refuses.read(), { count: -1, text: '新空壳' });
  });
});
