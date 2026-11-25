/**
 * 单个 JSON 存档：原子写 + 版本号。
 *
 * 为什么不用现成库：这份状态只有一份、几十 KB，引一个依赖换来的是每次升级都要跟着升级。
 * 唯一需要守住的纪律是**不写半成品**：先写 `.tmp` 再 rename，断电时最坏只丢这一次写入。
 * @module dsh-elysia/src/store
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
/**
 * 建一个 JSON 存档。
 *
 * 读失败一律回空壳而不是抛：损坏的存档不该让整个插件起不来，
 * 用户丢的是记忆，不是整个陪伴。
 */
export function createJsonStore(options) {
    const { file, version, create, migrate } = options;
    function read() {
        if (!existsSync(file))
            return create();
        try {
            const raw = JSON.parse(readFileSync(file, 'utf8'));
            if (!raw || typeof raw !== 'object')
                return create();
            const envelope = raw;
            if (typeof envelope.version !== 'number' || !('value' in envelope))
                return create();
            if (envelope.version === version)
                return envelope.value;
            const migrated = migrate?.(envelope.value, envelope.version);
            return migrated ?? create();
        }
        catch {
            return create();
        }
    }
    function write(value) {
        mkdirSync(dirname(file), { recursive: true });
        const payload = { version, value };
        const temp = file + '.tmp';
        writeFileSync(temp, JSON.stringify(payload), 'utf8');
        renameSync(temp, file);
    }
    return { path: file, read, write };
}
