/** 建店参数。 */
export interface JsonStoreOptions<T> {
    /** 绝对路径。 */
    file: string;
    /** 当前版本；读到不一致时交给 `migrate`。 */
    version: number;
    /** 文件不存在 / 无法解析 / 版本不认识时的空壳。 */
    create: () => T;
    /** 旧版本迁移；返回 undefined 表示放弃旧数据、走 `create()`。 */
    migrate?: (raw: unknown, version: number) => T | undefined;
}
/** 读写句柄。 */
export interface JsonStore<T> {
    path: string;
    read(): T;
    write(value: T): void;
}
/**
 * 建一个 JSON 存档。
 *
 * 读失败一律回空壳而不是抛：损坏的存档不该让整个插件起不来，
 * 用户丢的是记忆，不是整个陪伴。
 */
export declare function createJsonStore<T>(options: JsonStoreOptions<T>): JsonStore<T>;
