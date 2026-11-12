/**
 * lib/judge.js
 * 核心判定链（纯函数，计划书 §4）。DOM 层与 API 层共用，保证全站规则一致。
 *
 * 判定顺序（黑名单兑底 > 白名单放行 > 档位处理中间地带）：
 *   1. 直播卡片      → block（全站禁直播为强制行为，无开关）
 *   2. 黑词（标题/简介/标签/UP名）/黑UP/黑tid → block（白名单 UP 命中黑词同样拦截）
 *   3. 白UP/白词/白tid → pass
 *   4. 中间地带       → strictMode ? strict-hide : pass
 *
 * verdict: 'pass' | 'block' | 'strict-hide'
 */
(function () {
  'use strict';
  const TU = (globalThis.TU = globalThis.TU || {});

  /**
   * 编译关键词条目：
   *   - 形如 /.../ 或 /.../flags 的条目按正则处理（无效正则降级为纯文本）
   *   - 其余按纯文本 includes 匹配
   * @returns {Array<{raw: string, re?: RegExp}>} 编译后的词表
   */
  function compileKeywords(words) {
    const list = Array.isArray(words) ? words : [];
    return list
      .map((w) => {
        const raw = String(w == null ? '' : w).trim();
        if (!raw) return null;
        const m = /^\/(.+)\/([imsu]*)$/.exec(raw);
        if (m) {
          try {
            // 默认追加 i（大小写不敏感）；已显式声明则不重复，避免非法 flags
            const flags = m[2].includes('i') ? m[2] : m[2] + 'i';
            return { raw, re: new RegExp(m[1], flags) };
          } catch (_e) {
            /* 无效正则降级为文本匹配 */
          }
        }
        return { raw };
      })
      .filter(Boolean);
  }

  /** 词表中是否有条目命中文本 */
  function hitKeyword(compiled, text) {
    if (!text) return null;
    for (const kw of compiled) {
      if (kw.re ? kw.re.test(text) : text.includes(kw.raw)) return kw.raw;
    }
    return null;
  }

  /**
   * UP 名单匹配（计划书 §4 要点 3）：
   *   - meta.upMid 存在且条目有 mid → mid 精确匹配优先
   *   - 无 mid 条目按名称全等匹配（trim 后 ===，不做包含匹配）
   * @returns 命中的条目或 null
   */
  function matchUp(list, upName, upMid) {
    if (!Array.isArray(list)) return null;
    const name = (upName || '').trim();
    if (upMid != null) {
      for (const e of list) {
        if (e && e.mid != null && Number(e.mid) === Number(upMid)) return e;
      }
    }
    if (name) {
      for (const e of list) {
        if (e && !e.mid && String(e.name || '').trim() === name) return e;
      }
    }
    return null;
  }

  function normTid(tid) {
    const n = Number(tid);
    return Number.isFinite(n) ? n : null;
  }

  /**
   * 判定一张卡片。
   * @param {object} meta 卡片元数据
   *   { title, desc, upName, upMid, tid, tags: string[], isLive: boolean, bvid }
   * @param {object} jcfg buildJudgeConfig 编译后的配置
   * @returns {{ verdict: 'pass'|'block'|'strict-hide', reason: string }}
   */
  function judgeCard(meta, jcfg) {
    const m = meta || {};
    // 0. 直播（全站禁直播为强制行为，仅受插件总开关控制）
    if (m.isLive) {
      return { verdict: 'block', reason: 'live' };
    }
    // 黑词匹配范围含 UP 名称：UP 名带黑词（如「王者解说君」）但标题干净的卡片同样拦截
    const text = [m.title || '', m.desc || '', m.upName || '', (m.tags || []).join(' ')].join('\n');

    // 1. 黑名单兜底
    const blackWord = hitKeyword(jcfg.blackKeywords, text);
    if (blackWord) return { verdict: 'block', reason: 'black-word:' + blackWord };
    if (matchUp(jcfg.upBlacklist, m.upName, m.upMid)) {
      return { verdict: 'block', reason: 'black-up:' + (m.upName || m.upMid) };
    }
    const tid = normTid(m.tid);
    if (tid != null && jcfg.tidBlacklist.includes(tid)) {
      return { verdict: 'block', reason: 'black-tid:' + tid };
    }

    // 2. 白名单放行
    if (matchUp(jcfg.upWhitelist, m.upName, m.upMid)) {
      return { verdict: 'pass', reason: 'white-up' };
    }
    const whiteWord = hitKeyword(jcfg.whiteKeywords, text);
    if (whiteWord) return { verdict: 'pass', reason: 'white-word:' + whiteWord };
    if (tid != null && jcfg.tidWhitelist.includes(tid)) {
      return { verdict: 'pass', reason: 'white-tid:' + tid };
    }

    // 3. 中间地带按档位处理
    if (jcfg.settings.strictMode) {
      return { verdict: 'strict-hide', reason: 'strict' };
    }
    return { verdict: 'pass', reason: 'loose' };
  }

  /**
   * 把原始 storage 配置编译为判定用配置（预编译正则，避免逐卡重复编译）。
   * @param {object} cfg storage 原始配置（TU.defaults.defaultConfig() 形状）
   */
  function buildJudgeConfig(cfg) {
    const c = cfg || {};
    const settings = { ...TU.defaults.DEFAULT_SETTINGS, ...(c.settings || {}) };
    return {
      settings,
      blackKeywords: compileKeywords(c.keywordsBlacklist),
      whiteKeywords: compileKeywords(c.keywordsWhitelist),
      upWhitelist: c.upWhitelist || [],
      upBlacklist: c.upBlacklist || [],
      tidBlacklist: (c.tidBlacklist || []).map(normTid).filter((n) => n != null),
      tidWhitelist: (c.tidWhitelist || []).map(normTid).filter((n) => n != null),
    };
  }

  TU.judge = { compileKeywords, hitKeyword, matchUp, judgeCard, buildJudgeConfig, normTid };
})();
