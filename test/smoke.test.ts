import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { apply } from '../src/index.ts';
import * as plugin from '../src/index.ts';

// 单测不起本机回环服务（会真的占端口，也会拖住进程）。
process.env['DSH_ELYSIA_DISABLE_LOCAL_API'] = '1';

/** 一份完整的默认配置（schema 桩不做填充，测试里显式给全）。 */
function baseConfig() {
  return {
    enabled: true,
    persona: '',
    modelProvider: '',
    modelName: '',
    maxReplyChars: 120,
    memoryEnabled: true,
    moodEnabled: true,
    proactiveEnabled: true,
    quietStartHour: 23,
    quietEndHour: 8,
    proactiveMinGapMin: 45,
    proactiveDailyMax: 4,
    proactiveChance: 0.55,
    tickMinutes: 1,
    sensitiveWords: [],
  };
}

/** 伪宿主：命令表、effect 收集、可手摇的定时器、固定回复的 llm。 */
function makeHost(reply: string) {
  const commands = new Map<string, { name: string; description: string; handler: (input: { rawInput: string }) => unknown }>();
  const disposers: Array<() => void> = [];
  const routes: Array<{ kind: string; path: string }> = [];
  let tick: (() => void) | null = null;
  const ctx = {
    logger: { info: () => undefined, warn: () => undefined },
    commands: {
      register(spec: { name: string; description: string; handler: (input: { rawInput: string }) => unknown }) {
        commands.set(spec.name, spec);
        return () => commands.delete(spec.name);
      },
    },
    webServer: {
      register(spec: { kind: string; path: string }) {
        routes.push({ kind: spec.kind, path: spec.path });
        return () => undefined;
      },
    },
    effect(setup: () => unknown) {
      const disposer = setup();
      if (typeof disposer === 'function') disposers.push(disposer as () => void);
    },
    setInterval(handler: () => void) {
      tick = handler;
      return () => {
        tick = null;
      };
    },
    agentDefaultModel: { currentSelection: () => ({ provider: 'stub', model: 'stub-model' }) },
    llm: {
      async *stream() {
        yield { type: 'text', text: reply };
      },
    },
  };
  return { ctx, commands, disposers, routes, getTick: () => tick };
}

function withHome(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-elysia-home-'));
  process.env.DSH_HOME = dir;
  return run(dir).finally(() => {
    delete process.env.DSH_HOME;
    rmSync(dir, { recursive: true, force: true });
  });
}

test('导出契约：四件套齐全，且没有 default（有 default 会让 inject 丢失）', () => {
  assert.equal(plugin.name, 'elysia');
  assert.deepEqual(plugin.inject, ['agentDefaultModel', 'llm', 'commands']);
  assert.equal(typeof plugin.apply, 'function');
  assert.ok(plugin.Config);
  assert.equal('default' in plugin, false);
});

test('装配：八个命令 + 一个定时器，全部通过 effect 登记', async () => {
  await withHome(async () => {
    const host = makeHost('在呢 ♪');
    apply(host.ctx, baseConfig());
    assert.equal(host.commands.size, 8);
    assert.deepEqual(
      [...host.commands.keys()].sort(),
      [
        'elysia',
        'elysia-forget',
        'elysia-inbox',
        'elysia-memory',
        'elysia-mood',
        'elysia-remind',
        'elysia-reminders',
        'elysia-say',
      ],
    );
    assert.equal(host.disposers.length, 9);
    assert.equal(typeof host.getTick(), 'function');

    const added = (await host.commands.get('elysia-remind')!.handler({ rawInput: '30m 喝水' })) as { kind: string; text: string };
    assert.equal(added.kind, 'success');
    const listed = (await host.commands.get('elysia-reminders')!.handler({ rawInput: '' })) as { kind: string; text: string };
    assert.equal(listed.kind, 'success');
    assert.match(listed.text, /喝水/);
  });
});

test('对话：剥情绪标签、过门禁、落记忆与心情', async () => {
  await withHome(async (dir) => {
    const host = makeHost('被记住啦，主人 ♪ [emotion:happy]');
    apply(host.ctx, baseConfig());
    const result = (await host.commands.get('elysia')!.handler({ rawInput: '我叫小明，今天好累' })) as {
      kind: string;
      text: string;
    };
    assert.equal(result.kind, 'success');
    assert.equal(result.text, '被记住啦，主人 ♪');

    const file = join(dir, 'dsh-elysia', 'state.json');
    assert.equal(existsSync(file), true);
    const saved = JSON.parse(readFileSync(file, 'utf8')) as { value: { memory: { turns: unknown[]; facts: Array<{ text: string }> }; mood: { mood: number; dims: Record<string, number> } } };
    assert.equal(saved.value.memory.turns.length, 2);
    assert.equal(saved.value.memory.facts[0]?.text, '主人叫小明');
    assert.equal(saved.value.mood.dims.happy, 4);
    assert.ok(saved.value.mood.mood > 70 && saved.value.mood.mood < 71);
  });
});

test('记忆命令：总览与召回各说人话', async () => {
  await withHome(async () => {
    const host = makeHost('记住啦 ♪');
    apply(host.ctx, baseConfig());
    await host.commands.get('elysia')!.handler({ rawInput: '我叫小明' });
    const overview = (await host.commands.get('elysia-memory')!.handler({ rawInput: '' })) as { text: string };
    assert.match(overview.text, /1 条画像/);
    const queried = (await host.commands.get('elysia-memory')!.handler({ rawInput: '你还记得我叫什么吗' })) as { text: string };
    assert.match(queried.text, /主人叫小明/);
  });
});

test('主动开口：手动触发能说，且进收件箱与计数', async () => {
  await withHome(async () => {
    const host = makeHost('忽然想起你 ♪');
    apply(host.ctx, { ...baseConfig(), quietStartHour: 0, quietEndHour: 0, proactiveChance: 1 });
    const said = (await host.commands.get('elysia-say')!.handler({ rawInput: '' })) as { kind: string; text: string };
    assert.equal(said.kind, 'success');
    assert.equal(said.text, '忽然想起你 ♪');
    const inbox = (await host.commands.get('elysia-inbox')!.handler({ rawInput: '' })) as { text: string };
    assert.match(inbox.text, /忽然想起你 ♪/);
    const mood = (await host.commands.get('elysia-mood')!.handler({ rawInput: '' })) as { text: string };
    assert.match(mood.text, /今天已主动开口 1 次/);
  });
});

test('清空记忆要二次确认', async () => {
  await withHome(async () => {
    const host = makeHost('记住啦 ♪');
    apply(host.ctx, baseConfig());
    await host.commands.get('elysia')!.handler({ rawInput: '我叫小明' });
    const refused = (await host.commands.get('elysia-forget')!.handler({ rawInput: '' })) as { kind: string };
    assert.equal(refused.kind, 'error');
    const cleared = (await host.commands.get('elysia-forget')!.handler({ rawInput: 'confirm' })) as { kind: string };
    assert.equal(cleared.kind, 'success');
    const overview = (await host.commands.get('elysia-memory')!.handler({ rawInput: '' })) as { text: string };
    assert.match(overview.text, /0 条画像/);
  });
});
