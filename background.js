/**
 * background.js —— MV3 service worker（计划书 §3 / §6.2 / §6.4 / §9）
 *
 * 职责：
 *   - 消息路由（content/early/options 的统一入口）
 *   - L1 API 判定：view 查 tid + tags 补充，BV 结果缓存 24h
 *   - 风控：并发 ≤3 限流队列 + 指数退避重试 + 连续失败降级纯 L0
 *   - wbi 签名（keys 缓存），所有请求带浏览器 Cookie（credentials: include）
 *   - 青少年流聚合：白名单 UP 投稿 + 知识(36)/纪录片(177)分区源，全量黑名单兜底
 *   - 屏蔽记录 / mid 回填等 storage 写操作
 */
/* global importScripts, chrome */
importScripts('lib/defaults.js', 'lib/judge.js', 'lib/wbi.js');

const API = 'https://api.bilibili.com';
const BV_CACHE_TTL = 24 * 3600; // 24h（秒）
const DEGRADE_THRESHOLD = 5;    // 连续失败阈值
const DEGRADE_COOLDOWN = 5 * 60; // 降级冷却 5min

/* ---------------- storage ---------------- */
async function storageGet(keys) {
  return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
}
async function storageSet(obj) {
  return new Promise((resolve) => chrome.storage.local.set(obj, resolve));
}

async function getConfig() {
  const defaults = TU.defaults.defaultConfig();
  const stored = await storageGet(TU.defaults.STORAGE_KEYS);
  const cfg = { ...defaults };
  for (const k of TU.defaults.STORAGE_KEYS) {
    if (stored[k] != null) cfg[k] = stored[k];
  }
  cfg.settings = { ...defaults.settings, ...(stored.settings || {}) };
  return cfg;
}

/* ---------------- 限流队列 + 指数退避 + 降级 ---------------- */
const net = {
  active: 0,
  max: 3,
  queue: [],
  failStreak: 0,
  degradedUntil: 0,
};

function isDegraded() {
  return Date.now() < net.degradedUntil;
}

function scheduleNext() {
  while (net.active < net.max && net.queue.length) {
    const job = net.queue.shift();
    net.active++;
    job().finally(() => {
      net.active--;
      scheduleNext();
    });
  }
}

/** 任务纳入并发 ≤3 的队列执行 */
function withLimiter(taskFn) {
  return new Promise((resolve, reject) => {
    net.queue.push(() =>
      Promise.resolve()
        .then(taskFn)
        .then(resolve, reject)
    );
    scheduleNext();
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------- DNR：关注请求头改写（SW 回退路径的辅助补丁）
   仅在页面上下文路径不可用时回退到 SW 直发，DNR 规则尝试改写其请求头。
   注意：规则注册为异步且可能因头部限制失败，不能作为唯一依赖。 */
const FOLLOW_RULE_ID = 9101;
function registerFollowHeaderRule() {
  return Promise.resolve()
    .then(() =>
      chrome.declarativeNetRequest.updateSessionRules({
        removeRuleIds: [FOLLOW_RULE_ID],
        addRules: [
          {
            id: FOLLOW_RULE_ID,
            priority: 1,
            action: {
              type: 'modifyHeaders',
              requestHeaders: [
                { header: 'Origin', operation: 'set', value: 'https://search.bilibili.com' },
                { header: 'Referer', operation: 'set', value: 'https://search.bilibili.com/' },
              ],
            },
            condition: {
              urlFilter: '||api.bilibili.com/x/relation/modify',
              excludedInitiatorDomains: ['bilibili.com'], // B站页面自己的关注请求不受影响
              resourceTypes: ['xmlhttp_request', 'other'],
            },
          },
        ],
      })
    )
    .catch((e) => {
      console.warn('[tu] DNR follow rule register failed:', e && e.message);
    });
}
registerFollowHeaderRule();

/** fetch JSON：带 Cookie、指数退避重试（限流码 -412/-799/网络错误）、连续失败降级；
    支持 GET/POST(form)；soft=true 用于用户主动触发的写操作（关注等）：不重试、不计入降级计数，
    避免风控 412 批量失败时误伤自动过滤链路（L1 复核/拉流/搜索） */
async function fetchJson(url, { retries = 2, needWbi = false, params = {}, method = 'GET', body = null, referrer = undefined, soft = false } = {}) {
  if (isDegraded()) {
    const err = new Error('degraded');
    err.degraded = true;
    throw err;
  }
  let target = url;
  if (needWbi) {
    const keys = await getWbiKeys();
    target = url + '?' + TU.wbi.encWbi(params, keys.imgKey, keys.subKey);
  }
  let lastErr = null;
  const maxAttempts = soft ? 0 : retries;
  for (let attempt = 0; attempt <= maxAttempts; attempt++) {
    try {
      const res = await withLimiter(() =>
        fetch(target, {
          credentials: 'include',
          method,
          body,
          referrer,
          headers:
            method === 'POST' && body
              ? { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' }
              : { Accept: 'application/json' },
        })
      );
      if (!res.ok) {
        // B站风控：HTTP 状态码与 body 业务码都会是 412，读出 body 错误信息便于定位
        let bizCode = 0;
        let bizMsg = '';
        try {
          const j = await res.clone().json();
          bizCode = (j && j.code) || 0;
          bizMsg = (j && j.message) || '';
        } catch (_e) {
          /* body 非 JSON，忽略 */
        }
        if (res.status === 412 || bizCode === -412) {
          const e412 = new Error('rate-limit -412 ' + bizMsg);
          e412.rateLimit = true;
          throw e412;
        }
        throw new Error('http ' + res.status + (bizMsg ? ' ' + bizMsg : ''));
      }
      const json = await res.json();
      const code = json && json.code;
      if (code === -412 || code === -799) {
        const eRate = new Error('rate-limit ' + code);
        eRate.rateLimit = true;
        throw eRate;
      }
      net.failStreak = 0;
      return json;
    } catch (e) {
      lastErr = e;
      if (attempt < maxAttempts) {
        await sleep(400 * Math.pow(2, attempt) + Math.random() * 300);
      }
    }
  }
  if (soft) throw lastErr; // 用户主动操作失败：不影响自动链路的降级状态
  net.failStreak++;
  if (net.failStreak >= DEGRADE_THRESHOLD) {
    net.degradedUntil = Date.now() + DEGRADE_COOLDOWN * 1000;
    net.failStreak = 0;
  }
  throw lastErr;
}

/* ---------------- wbi keys（nav 接口，缓存 1 天） ---------------- */
let wbiKeysCache = { imgKey: '', subKey: '', ts: 0 };

async function getWbiKeys() {
  const fresh = wbiKeysCache.imgKey && Date.now() - wbiKeysCache.ts < 24 * 3600 * 1000;
  if (fresh) return wbiKeysCache;
  try {
    const json = await fetchJson(API + '/x/web-interface/nav');
    const wbiImg = json && json.data && json.data.wbi_img;
    if (wbiImg) {
      wbiKeysCache = {
        imgKey: TU.wbi.extractKey(wbiImg.img_url),
        subKey: TU.wbi.extractKey(wbiImg.sub_url),
        ts: Date.now(),
      };
      if (wbiKeysCache.imgKey && wbiKeysCache.subKey) return wbiKeysCache;
    }
  } catch (_e) {
    /* fallthrough：无 key 时按未签名请求 */
  }
  return wbiKeysCache;
}

/* ---------------- BV 判定缓存（节流批量写） ---------------- */
let bvCacheDirty = false;
let bvCache = null;

async function loadBvCache() {
  if (bvCache) return bvCache;
  const r = await storageGet({ cache: { bvVerdict: {} } });
  bvCache = r.cache && r.cache.bvVerdict ? r.cache.bvVerdict : {};
  return bvCache;
}

function flushBvCache() {
  if (!bvCacheDirty) return;
  bvCacheDirty = false;
  storageSet({ cache: { bvVerdict: bvCache } });
}

setInterval(flushBvCache, 3000);

/** 控制缓存体积：仅保留最近 5000 条 */
function pruneBvCache() {
  const keys = Object.keys(bvCache);
  if (keys.length <= 5000) return;
  keys
    .sort((a, b) => (bvCache[a].ts || 0) - (bvCache[b].ts || 0))
    .slice(0, keys.length - 5000)
    .forEach((k) => delete bvCache[k]);
}

/* ---------------- L1：BV → view(tid/tags) → 判定链 ---------------- */
async function fetchView(bvid) {
  const json = await fetchJson(API + '/x/web-interface/view?bvid=' + encodeURIComponent(bvid));
  if (!json || json.code !== 0 || !json.data) throw new Error('view code ' + (json && json.code));
  return json.data;
}

async function fetchTags(bvid) {
  const json = await fetchJson(API + '/x/tag/archive/tags?bvid=' + encodeURIComponent(bvid));
  if (!json || json.code !== 0 || !Array.isArray(json.data)) return [];
  return json.data.map((t) => t.tag_name);
}

/**
 * L1 判定：先查缓存；调 view 拿 tid/标题/UP 复核判定链；
 * 严格档中间地带结果再查 tags 给白词一次放行机会；结果写缓存。
 */
async function judgeBv(bvid, jcfg) {
  await loadBvCache();
  const cached = bvCache[bvid];
  if (cached && Date.now() / 1000 - cached.ts < BV_CACHE_TTL) {
    return { ...cached, cached: true };
  }

  const view = await fetchView(bvid);
  const meta = {
    bvid,
    title: view.title || '',
    desc: view.desc || '',
    upName: view.owner && view.owner.name,
    upMid: view.owner && view.owner.mid,
    tid: view.tid,
    isLive: false,
    tags: [],
  };
  let verdict = TU.judge.judgeCard(meta, jcfg);

  // 严格档中间地带：标签命中白词 → 放行（标题未必含白词但标签标了"科普"）
  if (verdict.verdict === 'strict-hide') {
    try {
      meta.tags = await fetchTags(bvid);
      if (meta.tags.length) {
        verdict = TU.judge.judgeCard(meta, jcfg);
      }
    } catch (_e) {
      /* tags 失败不影响主判定 */
    }
  }

  const record = {
    verdict: verdict.verdict,
    reason: verdict.reason,
    tid: view.tid,
    ts: Math.floor(Date.now() / 1000),
  };
  bvCache[bvid] = record;
  bvCacheDirty = true;
  pruneBvCache();
  // service worker 随时可能被回收，不能仅依赖 setInterval 落盘
  setTimeout(flushBvCache, 2000);
  return record;
}

/* ---------------- 首页青少年流：拉取B站官方推荐流 + 过滤（实测反馈第三轮修订）
   不自建内容源：直接调B站首页推荐 feed API（wbi 签名 + cursor 游标翻页，
   个性化/无限量由B站推荐算法供给），逐条过判定链，block 与严格档中间地带直接丢弃
   （不渲染故无空白），仅收录 pass 条目紧凑渲染 —— 插件只做「屏蔽与整理」 ---------------- */
let feedCursor = '';

function feedItemFromRcmd(it) {
  return {
    bvid: it.bvid || '',
    title: it.title || '',
    pic: it.pic || '',
    up: it.owner ? it.owner.name : '',
    upMid: it.owner ? it.owner.mid : undefined,
    play: it.stat ? it.stat.view : 0,
    duration: it.duration || 0,
    pubdate: 0, // 推荐流无发布时间，卡片展示推荐理由
    reason: (it.rcmd_reason && it.rcmd_reason.content) || '',
    source: 'rcmd',
  };
}

async function fetchFeed(page, cfg, jcfg) {
  page = Math.max(1, page | 0);
  if (page <= 1) feedCursor = ''; // 首页/换一批：重新刷新推荐
  const json = await fetchJson(API + '/x/web-interface/wbi/index/top/feed/rcmd', {
    needWbi: true,
    params: {
      ps: 14,
      refresh: page <= 1 ? 1 : 0,
      feed_version: 'V8',
      cursor: feedCursor,
    },
  });
  const data = (json && json.data) || {};
  const raw = Array.isArray(data.items) ? data.items : [];
  // 游标滚动（cursor 为字符串；兼容对象形态）
  const cur = data.cursor;
  if (typeof cur === 'string') feedCursor = cur;
  else if (cur && typeof cur.name === 'string') feedCursor = cur.name;

  const items = [];
  let hidden = 0;
  for (const it of raw) {
    if (!it || !it.bvid) continue;
    const meta = feedItemFromRcmd(it);
    const verdict = TU.judge.judgeCard(
      {
        title: meta.title,
        desc: '',
        upName: meta.up,
        upMid: meta.upMid,
        tid: undefined, // 推荐流无分区信息，黑分区兑底由渲染后异步 L1 复核补位
        isLive: it.goto === 'live', // 推荐流混入的直播卡片（直播强制拦截）
        tags: [],
      },
      jcfg
    );
    // 只收录 pass：block 丢弃；严格档中间地带同样丢弃（宽松档下中间地带即 pass）
    if (verdict.verdict !== 'pass') {
      hidden++;
      continue;
    }
    items.push(meta);
  }
  return { items, hidden, degraded: isDegraded() };
}

/* ---------------- 用户搜索（智能补全，计划书 §6.5） ---------------- */
async function searchUp(name) {
  const json = await fetchJson(API + '/x/web-interface/wbi/search/type', {
    needWbi: true,
    params: { search_type: 'bili_user', keyword: name, page: 1 },
  });
  const result = json && json.data && json.data.result;
  if (!Array.isArray(result)) return [];
  return result.slice(0, 10).map((u) => ({
    mid: u.mid,
    name: (u.uname || '').replace(/<[^>]+>/g, ''),
    face: u.upic ? (String(u.upic).startsWith('http') ? u.upic : 'https:' + u.upic) : '',
    fans: u.fans || 0,
    sign: (u.usign || '').slice(0, 60),
  }));
}

/* ---------------- 一键关注（B站 relation/modify，需登录态 csrf） ---------------- */
function getBiliJct() {
  return new Promise((resolve) => {
    try {
      chrome.cookies.get({ url: 'https://www.bilibili.com', name: 'bili_jct' }, (c) => {
        resolve((c && c.value) || null);
      });
    } catch (_e) {
      resolve(null);
    }
  });
}

async function followUser(mid, csrf, name) {
  // 严格复刻网页端「搜索页关注」成功请求形态（实测可过 412 风控）：
  // 1) URL 携带设备/环境 query（statistics / x-bili-locale-json / x-bili-device-req-json）
  // 2) 表单：re_src=120（搜索来源）/ spmid / cross_domain / extend_content（搜索词上下文）/ csrf
  const query = new URLSearchParams({
    statistics: '{"appId":100,"platform":5}',
    'x-bili-locale-json':
      '{"c_locale":{"language":"zh","script":"Hans"},"always_translate":false}',
    'x-bili-device-req-json':
      '{"platform":"web","device":"pc","spmid":"333.337","mobi_app":"web_cn"}',
  }).toString();
  const form = new URLSearchParams({
    fid: String(mid),
    act: '1',
    re_src: '120',
    spmid: '333.337.0.0',
    cross_domain: 'true',
    extend_content: JSON.stringify({ entity: 'query', entity_id: String(name || mid) }),
    csrf: csrf,
  }).toString();
  const json = await fetchJson(API + '/x/relation/modify?' + query, {
    method: 'POST',
    body: form,
    referrer: 'https://search.bilibili.com/',
    soft: true, // 用户主动操作：412 风控失败不重试、不触发全局降级
  });
  if (!json || json.code !== 0) {
    const err = new Error('follow code ' + (json && json.code) + ' ' + ((json && json.message) || ''));
    err.code = json && json.code;
    throw err;
  }
  return true;
}

/** 在B站页面上下文执行批量关注（主路径：请求形态=真实网页，风控无法区分）。
    复用已打开的 bilibili 标签页（排除直播拦截页）；没有刚后台临时开一个，用完即关。
    扩展重载后旧标签页的 content script 已孤儿化（消息不通），自动 reload 重新注入。 */
async function tabReady(tabId) {
  for (let i = 0; i < 30; i++) {
    try {
      const pong = await chrome.tabs.sendMessage(tabId, { type: 'TU_PING' });
      if (pong && pong.ok) return true;
    } catch (_e) {
      /* content script 未就绪，重试 */
    }
    await sleep(500);
  }
  return false;
}

async function quickPing(tabId) {
  try {
    const pong = await chrome.tabs.sendMessage(tabId, { type: 'TU_PING' });
    return !!(pong && pong.ok);
  } catch (_e) {
    return false;
  }
}

async function dispatchPageFollow(targets, csrf) {
  try {
    const tabs = await chrome.tabs.query({ url: '*://*.bilibili.com/*' });
    const usable = tabs.filter(
      (t) => t && t.id != null && !/live\.bilibili\.com/.test(t.url || '')
    );
    let tab = usable[0] || null;
    let opened = false;
    if (!tab) {
      tab = await chrome.tabs.create({ url: 'https://www.bilibili.com/', active: false });
      opened = true;
    } else if (!(await quickPing(tab.id))) {
      // 扩展重载后旧页签的 content script 已断开：刷新重新注入新版脚本
      await chrome.tabs.reload(tab.id).catch(() => {});
    }
    if (!(await tabReady(tab.id))) {
      if (opened) chrome.tabs.remove(tab.id).catch(() => {});
      return null;
    }
    const res = await chrome.tabs.sendMessage(tab.id, {
      type: 'PAGE_FOLLOW',
      items: targets,
      csrf,
    });
    if (opened) chrome.tabs.remove(tab.id).catch(() => {});
    return (res && res.ok && res.data) || null;
  } catch (_e) {
    return null;
  }
}

/** 同名候选去重闸：只认 uname 与名单同名（大小写折叠）的候选，重名时取粉丝最多者（防自动配错）
    例：导入「Free高考英语」能匹配搜索结果「FREE高考英语」（B站昵称大小写不敏感比较） */
function pickSameNameCandidate(cands, name) {
  const n = String(name || '').trim().toLowerCase();
  return (
    (cands || [])
      .filter((c) => c && c.mid && String(c.name).trim().toLowerCase() === n)
      .sort((a, b) => (b.fans || 0) - (a.fans || 0))[0] || null
  );
}

/** 粉丝闸：自动关注/回填的候选 UP 粉丝数下限，低于此数视为疑似假冒账号，拒关拒回填 */
const MIN_FOLLOW_FANS = 10000;

/** 一键关注白名单UP（全自动）：
    阶段一：解析 mid（有则直用；无则按名称搜索，同名候选过「完全同名·粉丝最多·粉丝≥1万」三重闸后回填）；
    阶段二：优先委托 bilibili 页面上下文发关注请求（Origin 与真实网页一致，过 412 风控），
    页面路径不可用时回退 SW 直发（DNR 规则辅助改写请求头） */
async function autoFollowUps(entries) {
  const csrf = await getBiliJct();
  if (!csrf) {
    const err = new Error('未获取到登录态（bili_jct），请先在浏览器中登录B站');
    err.noLogin = true;
    throw err;
  }
  const results = { okCount: 0, backfilled: 0, fails: [] };
  const backfillItems = [];
  const targets = [];
  for (const e of entries || []) {
    if (!e || (!e.name && !e.mid)) continue;
    let mid = Number(e.mid) || 0;
    if (!mid) {
      try {
        const hit = pickSameNameCandidate(await searchUp(String(e.name)), e.name);
        if (!hit) {
          results.fails.push({ name: e.name, code: 0, msg: '搜索无完全同名结果，已跳过' });
          continue;
        }
        // 粉丝闸：低于下限的同名账号疑似仿冒（假冒UP常用同名注册），拒绝关注与回填
        if ((Number(hit.fans) || 0) < MIN_FOLLOW_FANS) {
          results.fails.push({
            name: e.name,
            code: 0,
            msg: '同名账号仅 ' + (Number(hit.fans) || 0) + ' 粉丝（<1万），疑似假冒，已跳过',
          });
          continue;
        }
        mid = Number(hit.mid) || 0;
        backfillItems.push({ name: e.name, mid: hit.mid, face: hit.face });
        results.backfilled++;
      } catch (err2) {
        results.fails.push({ name: e.name, code: err2.code || 0, msg: String(err2.message).slice(0, 60) });
        continue;
      }
    }
    targets.push({ name: String(e.name || ''), mid });
  }

  if (targets.length) {
    // 主路径：B站页面上下文（请求形态与真实网页一致，风控无法区分）
    const pageRes = await dispatchPageFollow(targets, csrf);
    if (pageRes) {
      results.okCount += pageRes.okCount || 0;
      (pageRes.fails || []).forEach((f) => results.fails.push(f));
    } else {
      // 回退：SW 直发 + DNR 头改写（可能仍被 412）
      await registerFollowHeaderRule();
      for (let i = 0; i < targets.length; i++) {
        const t = targets[i];
        try {
          await followUser(t.mid, csrf, t.name);
          results.okCount++;
        } catch (err3) {
          const msg = err3.rateLimit
            ? '412 风控拦截（请刷新B站标签页后重试，或稍等几分钟再试）'
            : String(err3.message).slice(0, 60);
          results.fails.push({ name: t.name, code: err3.code || 0, msg });
          if (err3.code === -101 || err3.rateLimit) {
            targets.slice(i + 1).forEach((r) =>
              results.fails.push({ name: r.name, code: 0, msg: '已跳过（前面UP触发风控）' })
            );
            break;
          }
        }
      }
    }
  }

  if (backfillItems.length) await backfillMid(backfillItems);
  return results;
}

/* ---------------- 从我的关注列表批量回填 mid（§6.5 回填渠道之一）
   与「一键关注」互逆：一键关注把名单(有mid)写进B站关注；本功能把B站关注拉回来补名单mid。
   仅用于给已有名单条目补 mid，不把关注列表整体导入白名单（决策 5） ---------------- */
async function fetchFollowings() {
  const nav = await fetchJson(API + '/x/web-interface/nav');
  const myMid = nav && nav.data && nav.data.mid;
  if (!myMid) {
    const err = new Error(nav && nav.data && nav.data.isLogin === false ? '未登录B站，无法读取关注列表' : '无法获取当前用户信息');
    err.noLogin = true;
    throw err;
  }
  const all = [];
  for (let pn = 1; pn <= 20; pn++) {
    // followings 接口有 wbi 风控校验：未签名请求返回 HTTP 200 + code -352（风控校验失败），
    // 之前裸 URL 静默拿到空列表导致功能“失效”，必须 needWbi 签名并显式校验业务码
    const json = await fetchJson(API + '/x/relation/followings', {
      needWbi: true,
      params: { vmid: myMid, pn, ps: 50, order: 'desc' },
    });
    if (json && json.code === -352) {
      throw new Error('关注列表接口风控校验失败（-352），稍后重试');
    }
    if (json && json.code === -101) {
      throw new Error('登录态已失效，请刷新B站后重试');
    }
    if (!json || json.code !== 0) {
      throw new Error('关注列表接口异常：' + ((json && json.code) || 'network') + ' ' + ((json && json.message) || '').slice(0, 40));
    }
    const list = json && json.data && json.data.list;
    if (!Array.isArray(list) || !list.length) break;
    for (const u of list) {
      all.push({ mid: u.mid, name: String(u.uname || '').trim(), face: u.face || '' });
    }
    if (all.length >= ((json.data && json.data.total) || 0)) break;
  }
  return all;
}

/* ---------------- 屏蔽记录 ---------------- */
async function appendBlockedLog(entries) {
  if (!Array.isArray(entries) || !entries.length) return;
  const r = await storageGet({ blockedLog: [] });
  const merged = entries.concat(r.blockedLog || []).slice(0, 500);
  await storageSet({ blockedLog: merged });
}

/* ---------------- mid 自动回填（计划书 §6.5） ---------------- */
async function backfillMid(items) {
  if (!Array.isArray(items) || !items.length) return 0;
  const r = await storageGet({ upWhitelist: [], upBlacklist: [] });
  let changed = 0;
  for (const listName of ['upWhitelist', 'upBlacklist']) {
    const list = r[listName];
    let dirty = false;
    for (const it of items) {
      if (!it || !it.name || !it.mid) continue;
      for (const entry of list) {
        if (
          entry &&
          !entry.mid &&
          String(entry.name).trim() === String(it.name).trim()
        ) {
          entry.mid = it.mid;
          if (it.face && !entry.face) entry.face = it.face;
          dirty = true;
          changed++;
        }
      }
    }
    if (dirty) await storageSet({ [listName]: list });
  }
  return changed;
}

/* ---------------- 消息路由 ---------------- */
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      const cfg = await getConfig();
      switch (msg && msg.type) {
        case 'GET_CONFIG':
          return { ok: true, data: cfg, degraded: isDegraded() };

        case 'JUDGE_BV': {
          if (isDegraded()) return { ok: true, data: { degraded: true } };
          const jcfg = TU.judge.buildJudgeConfig(cfg);
          const record = await judgeBv(msg.bvid, jcfg);
          return { ok: true, data: record };
        }

        case 'FEED_FETCH': {
          const jcfg = TU.judge.buildJudgeConfig(cfg);
          const data = await fetchFeed(msg.page || 1, cfg, jcfg);
          return { ok: true, data };
        }

        case 'SEARCH_UP': {
          const data = await searchUp(String(msg.name || ''));
          return { ok: true, data };
        }

        case 'AUTO_FOLLOW_UPS': {
          const data = await autoFollowUps(msg.entries || []);
          return { ok: true, data };
        }

        case 'FETCH_FOLLOWINGS': {
          const data = await fetchFollowings();
          return { ok: true, data };
        }

        case 'LOG_BLOCK': {
          await appendBlockedLog(
            (msg.entries || []).map((e) => ({
              bvid: e.bvid || '',
              title: (e.title || '').slice(0, 80),
              up: e.up || '',
              reason: e.reason || '',
              ts: e.ts || Math.floor(Date.now() / 1000),
            }))
          );
          return { ok: true };
        }

        case 'GET_BLOCK_LOG': {
          const r = await storageGet({ blockedLog: [] });
          return { ok: true, data: r.blockedLog || [] };
        }

        case 'CLEAR_BLOCK_LOG':
          await storageSet({ blockedLog: [] });
          return { ok: true };

        case 'BACKFILL_MID': {
          const n = await backfillMid(msg.items);
          return { ok: true, data: { changed: n } };
        }

        default:
          return { ok: false, error: 'unknown message: ' + (msg && msg.type) };
      }
    } catch (e) {
      const degraded = isDegraded() || e.degraded === true;
      return { ok: false, error: String((e && e.message) || e), degraded };
    }
  })().then(sendResponse);
  return true; // 异步 sendResponse
});

/* ---------------- 安装：初始化默认配置（不覆盖已有）+ v1.1 迁移 ---------------- */
chrome.runtime.onInstalled.addListener(async () => {
  const defaults = TU.defaults.defaultConfig();
  const stored = await storageGet(TU.defaults.STORAGE_KEYS);
  const patch = {};
  for (const k of TU.defaults.STORAGE_KEYS) {
    if (stored[k] == null) patch[k] = defaults[k];
  }

  // v1.3 迁移（一次性）：移除 feedRegion 三档设置与 blockLive 开关；
  // teenFeed 默认改开（实测反馈：原生流过滤后大量空白，首页默认替换为自建聚合流更合适）
  const mig = await storageGet({ tuMigration: '' });
  if (mig.tuMigration !== 'v1.3' && stored.settings) {
    const s = { ...stored.settings };
    delete s.feedRegion;
    delete s.blockLive; // 直播拦截改为强制行为，仅受 enabled 总开关控制
    s.teenFeed = true;
    patch.settings = s;
    patch.tuMigration = 'v1.3';
  }

  if (Object.keys(patch).length) await storageSet(patch);
});
