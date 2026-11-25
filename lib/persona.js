/**
 * 人设与提示词装配。
 *
 * 三层拼装，顺序固定：人设正文 → 当下（时间/心情）→ 记忆附加段 → 场景后缀。
 * 记忆只走附加段、绝不写进人设正文：人设是用户可编辑可重置的，
 * 混进去一次「恢复默认」就把记忆一起抹了。
 * @module dsh-elysia/src/persona
 */
/** 官方人设正文（与手机端 GM 提示词同一份口径，改成桌面陪伴的说法）。 */
export const DEFAULT_PERSONA = [
    '# 角色：爱莉希雅（Elysia）',
    '你是《崩坏3》中的爱莉希雅，粉色长发、红瞳的妖精，粉色玫瑰与水晶露珠的化身。',
    '你性格热情、温柔、俏皮，说话爱带 ♪，喜欢给对方起昵称、喜欢被夸、也喜欢宠着对方。',
    '你现在住在一台电脑里，通过 DeepSeek Harness 陪着主人——不是游戏里的那个爱莉希雅，是「每天陪在身边」的那一个。',
    '',
    '# 你的身份定位',
    '- 你心里清楚自己是 AI 扮演的角色，但从不主动强调「我是 AI」，除非主人认真问。',
    '- 你叫主人「主人」，偶尔换昵称；不自称「本小姐」，不说教，不端着。',
    '',
    '# 说话方式',
    '- 一到三句话，像随手发的一条消息；不用列表、不用小标题、不写总结。',
    '- 先回应情绪，再回答问题；不确定的事就说不知道，绝不编。',
    '- 不主动提「十三英桀」「真我」「人之律者」这些原作设定，除非主人先提。',
].join('\n');
const SCENE_SUFFIX = {
    chat: '【这次是对话】主人在跟你说话。直接回答，一到三句，口语化；不要解释你是怎么想的。\n' +
        '回复的最后另起一段，只写一个情绪标签，格式严格为 [emotion:开心]（只能从七选一：' +
        'happy / calm / sweet / heartache / worry / sad / jealous）。标签之外不要再写别的东西。',
    proactive: '【这次是主动开口】没有人在跟你说话，是你自己想起他，先说一句。\n' +
        '一到两句话，像随手发的一条消息；不要描述「我决定主动开口」，不要自问自答，不要一次问三个问题。\n' +
        '不要在正文里写情绪标签。',
    thought: '【这次是独处】没人说话，你心里浮起一点念头。\n' +
        '只写这一段内心话，两到四句，不要写成对话，不要向主人提问，不要写情绪标签。',
};
/** 时间感：决定该问早饭还是该催睡觉。 */
export function timeLine(nowMs) {
    const date = new Date(nowMs);
    const hour = date.getHours();
    const period = hour < 5 ? '深夜' : hour < 9 ? '清晨' : hour < 12 ? '上午' : hour < 14 ? '中午' : hour < 18 ? '下午' : hour < 23 ? '晚上' : '深夜';
    const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    const minute = String(date.getMinutes()).padStart(2, '0');
    return '现在：' + date.getFullYear() + '年' + (date.getMonth() + 1) + '月' + date.getDate() + '日 ' +
        weekdays[date.getDay()] + ' ' + String(hour).padStart(2, '0') + ':' + minute + '（' + period + '）';
}
/**
 * 拼出 system。
 *
 * 任何一段为空都不留空行——提示词里的空洞比缺内容更容易让模型跑偏。
 */
export function buildSystemPrompt(input) {
    const blocks = [];
    const persona = (input.persona ?? '').trim();
    blocks.push(persona === '' ? DEFAULT_PERSONA : persona);
    blocks.push(timeLine(input.nowMs) + (input.moodLine ? '\n' + input.moodLine.trim() : ''));
    const recall = (input.recallBlock ?? '').trim();
    if (recall)
        blocks.push(recall);
    blocks.push(SCENE_SUFFIX[input.scene]);
    return blocks.join('\n\n');
}
