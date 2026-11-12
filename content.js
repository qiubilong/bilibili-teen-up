/**
 * content.js —— DOM 过滤引擎（document_end 注入，计划书 §3 / §5 / §6）
 *
 * 与 early.js 配合：early 先隐藏候选卡片 → 本脚本 L0 判定链放行/拦截 →
 * L1 API 复核（黑 tid 兜底 / 严格档中间地带白名单放行）。
 * 覆盖：首页流替换、搜索、播放页守卫、分区/热门/动态卡片、空间横幅、
 *       热搜与联想词、直播 tab、UP 一键拉黑、mid 自动回填。
 */
(function () {
  'use strict';
  const TU = globalThis.TU || {};
  if (!TU.judge || !TU.defaults) {
    // lib 未注入（异常场景）：立即撤下 early 隐藏，绝不能把页面藏死
    const el = document.getElementById('tu-early-hide');
    if (el) el.remove();
    return;
  }

  const HOST = location.hostname;
  const PATH = location.pathname;

  /* ---------------- 页面类型 ---------------- */
  const page = {
    home: HOST === 'www.bilibili.com' && (PATH === '/' || PATH === '' || PATH.startsWith('/index.html')),
    video: /\/video\/(BV[a-zA-Z0-9]+)/.exec(PATH),
    bangumi: HOST === 'www.bilibili.com' && PATH.startsWith('/bangumi'),
    search: HOST === 'search.bilibili.com',
    popular: HOST === 'popular.bilibili.com',
    space: HOST === 'space.bilibili.com',
    dynamic: HOST === 't.bilibili.com',
  };

  /* ---------------- 状态 ---------------- */
  let cfg = null;
  let jcfg = null;
  let enabled = true;
  let degraded = false; // API 连续失败降级：退化为纯 L0
  let lastSettingsSig = '';

  /* ---------------- 消息 ---------------- */
  function send(msg) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(msg, (res) => resolve(res || { ok: false, error: 'no response' }));
      } catch (e) {
        resolve({ ok: false, error: String(e) });
      }
    });
  }

  /* ---------------- 工具 ---------------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }
  function showBanner(html, tone) {
    let el = document.getElementById('tu-banner');
    if (!el) {
      el = document.createElement('div');
      el.id = 'tu-banner';
      (document.body || document.documentElement).prepend(el);
    }
    el.className = 'tu-banner tu-' + (tone || 'warn');
    el.innerHTML = html;
    return el;
  }

  /* ---------------- 选择器集中配置（多备选，计划书 §10） ---------------- */
  const TITLE_SELS = [
    '.bili-video-card__info--tit', '.bili-video-card__info--tit a', '.video-name',
    '.title', '.video-card__content .title', 'a[title]', '.card-box .title', '.info a',
  ];
  const DESC_SELS = ['.bili-video-card__info--desc', '.desc', '.intro'];
  const UP_SELS = ['.bili-video-card__info--author', '.up-name', '.author', '.name'];
  const CARD_SELS = [
    '.bili-video-card', '.feed-card', '.video-list-item', '.video-card',
    '.video-page-card', '.video-page-card-small', '.rank-list .rank-item',
    '.bili-dyn-list-item', '.history-list .video-card', '[data-tu-card]',
  ];
  /** 结构兜底向上查找的卡片容器（计划书 §10） */
  const CARD_CLOSEST = [
    '.bili-video-card', '.feed-card', '.video-list-item', '.video-card',
    '.video-page-card', '.video-page-card-small', '.rank-item',
    '.bili-dyn-list-item', 'li',
  ];
  /** 这些区域里的 BV 链接不做结构兜底（避免误藏评论区/播放器标题） */
  const SKIP_CLOSEST = '.reply-item, .comment-container, #viewbox_report, .player-box';

  function pickText(card, sels, attr) {
    for (const s of sels) {
      let el = null;
      try { el = card.querySelector(s); } catch (_e) { /* 选择器失效跳过 */ }
      if (!el) continue;
      const t = attr && el.getAttribute ? el.getAttribute(attr) : el.textContent;
      if (t && t.trim()) return t.trim();
    }
    return '';
  }

  const BV_RE = /\/video\/(BV[a-zA-Z0-9]+)/;
  const LIVE_RE = /live\.bilibili\.com/;
  const SPACE_RE = /space\.bilibili\.com\/(\d+)/;

  /** 提取卡片元数据（title/desc/upName/upMid/bvid/isLive） */
  function extractMeta(card) {
    const meta = {
      title: pickText(card, TITLE_SELS) || pickText(card, TITLE_SELS, 'title'),
      desc: pickText(card, DESC_SELS),
      upName: '',
      upMid: null,
      bvid: '',
      isLive: false,
      tags: [],
    };
    // UP 名：优先取 UP 链接文本，其次任意 UP 名选择器
    const upLink = card.querySelector('a[href*="space.bilibili.com/"]');
    if (upLink) {
      meta.upName = (upLink.textContent || '').trim();
      const m = SPACE_RE.exec(upLink.getAttribute('href') || '');
      if (m) meta.upMid = Number(m[1]);
    }
    if (!meta.upName) meta.upName = pickText(card, UP_SELS);

    // 视频链接 / 直播标记
    const link = card.querySelector('a[href*="/video/BV"], a[href*="live.bilibili.com"], a[href*="/v/living"]');
    const href = link ? link.getAttribute('href') || '' : '';
    const bv = BV_RE.exec(href);
    if (bv) meta.bvid = bv[1];
    if (LIVE_RE.test(href) || href.includes('/v/living')) meta.isLive = true;
    if (!meta.bvid) {
      // 卡片自身可能就是 a
      const selfBv = BV_RE.exec(card.matches('a[href]') ? card.getAttribute('href') || '' : '');
      if (selfBv) meta.bvid = selfBv[1];
    }
    return meta;
  }

  /* ---------------- 屏蔽日志（节流批量上报） ---------------- */
  const logQueue = [];
  function logBlock(meta, reason) {
    const entry = {
      bvid: meta.bvid || '',
      title: (meta.title || '').slice(0, 80),
      up: meta.upName || '',
      reason,
      ts: Math.floor(Date.now() / 1000),
    };
    const dup = logQueue.some((e) => e.bvid === entry.bvid && e.reason === entry.reason && e.title === entry.title);
    if (!dup) logQueue.push(entry);
  }
  async function flushLog() {
    if (!logQueue.length) return;
    const entries = logQueue.splice(0, 50);
    await send({ type: 'LOG_BLOCK', entries });
  }

  /* ---------------- 卡片处置：被拦卡片用知识卡遮罩覆盖 ----------------
     保留原生布局（无空白），遮罩上实时展示小学英语单词/成语/小知识，
     把屏蔽位变成学习位；L1 放行时移除遮罩；遮罩卡不可点击跳转 */
  let knowledgeOffset = Math.floor(Math.random() * 1000);
  let knowledgeSeq = 0;

  /** 随机取一条知识内容：返回 [主题class, 卡内html]（随机起点+递增取模，一屏内不重复）
      主题对应 content.css 三套清淡温柔配色：天蓝·英语 / 蜜桃粉·成语 / 薄荷绿·知识 */
  function knowledgeCardHtml() {
    const pool = (TU.defaults && TU.defaults.KNOWLEDGE_CARDS) || [];
    if (!pool.length) return ['ts-know', '<div class="ts-fact">休息一下</div>'];
    const c = pool[(knowledgeOffset + knowledgeSeq++) % pool.length];
    if (c.type === 'word') {
      return [
        'ts-word',
        '<div class="ts-mark">英语</div>' +
          '<div class="ts-main">' + esc(c.word) + '</div>' +
          '<div class="ts-phon">' + esc(c.phon || '') + '</div>' +
          '<div class="ts-zh">' + esc(c.zh || '') + '</div>',
      ];
    }
    if (c.type === 'idiom') {
      return [
        'ts-idiom',
        '<div class="ts-mark">成语</div>' +
          '<div class="ts-main">' + esc(c.text) + '</div>' +
          '<div class="ts-zh">' + esc(c.mean || '') + '</div>',
      ];
    }
    return [
      'ts-know',
      '<div class="ts-mark">知识</div>' +
        '<div class="ts-fact">' + esc(c.text || '') + '</div>',
    ];
  }

  function revealCard(card) {
    card.classList.add('tu-pass');
    card.classList.remove('tu-blocked', 'tu-shielded');
    const shield = card.querySelector(':scope > .tu-shield');
    if (shield) shield.remove();
  }
  function hideCard(card) {
    card.classList.remove('tu-pass');
    if (card.querySelector(':scope > .tu-shield')) return; // 已有遮罩（避免重复注入/换内容）
    card.classList.add('tu-shielded');
    // 遮罩 inset:0 需要定位包含块：仅 static 卡片补 relative；
    // 本身 absolute 的旧版瀑布流卡片保持原定位（改 relative 会摧毁其 top/left 布局，遮罩错位半张）
    if (getComputedStyle(card).position === 'static') card.style.position = 'relative';
    const el = document.createElement('div');
    const pair = knowledgeCardHtml();
    el.className = 'tu-shield ' + pair[0];
    el.innerHTML = pair[1];
    card.appendChild(el);
    // 矮条卡（排行榜/右侧推荐位）竖排溢出：渲染后测高，切换横向紧凑布局
    requestAnimationFrame(() => {
      if (card.isConnected && card.offsetHeight < 150) el.classList.add('ts-mini');
    });
  }

  /* ---------------- L1：API 复核（黑 tid 兜底 / 严格档放行） ---------------- */
  const bvPending = new Set();
  function reviewByApi(card, meta) {
    if (!meta.bvid || degraded || bvPending.has(meta.bvid)) return;
    bvPending.add(meta.bvid);
    send({ type: 'JUDGE_BV', bvid: meta.bvid }).then((res) => {
      bvPending.delete(meta.bvid);
      if (!res || !res.ok) {
        if (res && (res.degraded || /degraded/.test(res.error || ''))) degraded = true;
        return; // API 失败维持 L0 结果
      }
      const d = res.data || {};
      if (d.degraded) { degraded = true; return; }
      if (!card.isConnected) return;
      if (d.verdict === 'block') {
        // 黑名单兜底（如黑 tid：标题无黑词但视频在游戏区）
        if (card.dataset.tuState !== 'blocked') {
          hideCard(card);
          card.dataset.tuState = 'blocked';
          logBlock(meta, d.reason || 'api-block');
        }
      } else if (d.verdict === 'pass' && card.dataset.tuState === 'strict') {
        // 严格档中间地带 → L1 白名单命中（tid/标签）放行
        revealCard(card);
        card.dataset.tuState = 'pass';
      }
      // 宽松档下 L1 strict-hide 维持显示（宽松=黑名单模式）
    });
  }

  /* ---------------- UP 一键拉黑（计划书 §6.6） ---------------- */
  function ensureBanBtn(card, meta) {
    if (card.querySelector(':scope > .tu-ban-btn')) return;
    if (!meta.upName && !meta.upMid) return;
    card.classList.add('tu-card-host');
    card.dataset.tuUpName = meta.upName || '';
    if (meta.upMid) card.dataset.tuUpMid = String(meta.upMid);
    const btn = document.createElement('div');
    btn.className = 'tu-ban-btn';
    btn.title = '拉黑该UP：' + (meta.upName || meta.upMid);
    btn.textContent = '🚫';
    card.appendChild(btn);
  }

  async function banUp(name, mid) {
    const key = mid ? 'mid:' + mid : 'name:' + name;
    if (banUp.done && banUp.done.has(key)) return;
    (banUp.done = banUp.done || new Set()).add(key);
    const st = await new Promise((r) => chrome.storage.local.get({ upBlacklist: [] }, r));
    if (st.upBlacklist.some((e) => (mid && e.mid == mid) || (!mid && String(e.name).trim() === name))) return;
    st.upBlacklist.push(TU.defaults.makeUpEntry(name, mid));
    await chrome.storage.local.set({ upBlacklist: st.upBlacklist });
    // 立即隐藏该 UP 的全部卡片（不等 onChanged 重扫）
    document.querySelectorAll('.tu-card-host').forEach((c) => {
      const n = (c.dataset.tuUpName || '').trim();
      const m = c.dataset.tuUpMid ? Number(c.dataset.tuUpMid) : null;
      if ((mid && m === Number(mid)) || (!mid && n === name)) {
        hideCard(c);
        c.dataset.tuState = 'blocked';
      }
    });
    showBanner('已拉黑 UP：' + esc(name || mid), 'ok');
  }

  document.addEventListener(
    'click',
    (e) => {
      const btn = e.target && e.target.closest && e.target.closest('.tu-ban-btn');
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      const host = btn.closest('.tu-card-host');
      banUp(host ? host.dataset.tuUpName || '' : '', host && host.dataset.tuUpMid ? Number(host.dataset.tuUpMid) : undefined);
    },
    true
  );

  // 拦截卡不可点击跳转：CSS pointer-events 已断链链接，此处捕获兑底
  // （含站点在容器上委托的自定义导航，含遮罩自身的点击）
  document.addEventListener(
    'click',
    (e) => {
      if (e.target && e.target.closest && e.target.closest('.tu-shielded')) {
        e.preventDefault();
        e.stopPropagation();
      }
    },
    true
  );

  /* ---------------- mid 自动回填（计划书 §6.5） ---------------- */
  const backfillBuffer = new Map(); // name → {name, mid}
  function collectBackfill(meta) {
    if (!meta.upName || !meta.upMid) return;
    const name = meta.upName.trim();
    for (const list of [cfg.upWhitelist, cfg.upBlacklist]) {
      for (const entry of list) {
        if (entry && !entry.mid && String(entry.name).trim() === name) {
          backfillBuffer.set(name, { name, mid: meta.upMid });
          return;
        }
      }
    }
  }
  async function flushBackfill() {
    if (!backfillBuffer.size) return;
    const items = [...backfillBuffer.values()];
    backfillBuffer.clear();
    await send({ type: 'BACKFILL_MID', items });
  }

  /* ---------------- 卡片主处理 ---------------- */
  function processCard(card) {
    if (!card || !card.isConnected || !card.querySelector) return;
    const meta = extractMeta(card);
    const sig = meta.title + '|' + meta.upName + '|' + meta.bvid;
    if (card.dataset.tuState && card.dataset.tuSig === sig) return; // 已处理且内容未变（Vue 复用防御）
    card.dataset.tuSig = sig;

    if (!meta.title && !meta.upName && !meta.bvid && !meta.isLive) {
      // 无任何可判定信息（页面结构未知组件）：放行，避免误藏非卡片区域
      card.dataset.tuState = 'pass';
      revealCard(card);
      return;
    }

    ensureBanBtn(card, meta);
    collectBackfill(meta);

    const v = TU.judge.judgeCard(meta, jcfg);
    if (v.verdict === 'pass') {
      card.dataset.tuState = 'pass';
      revealCard(card);
      reviewByApi(card, meta); // 黑 tid 兜底复核（标题无黑词但分区违规）
    } else if (v.verdict === 'block') {
      card.dataset.tuState = 'blocked';
      hideCard(card);
      logBlock(meta, v.reason);
    } else {
      // strict-hide：严格档中间地带隐藏，等待 L1 白名单放行机会
      card.dataset.tuState = 'strict';
      hideCard(card);
      logBlock(meta, v.reason);
      reviewByApi(card, meta);
    }
  }

  /* ---------------- 扫描循环（MutationObserver + 兜底轮询） ---------------- */
  function findCards() {
    const set = new Set(document.querySelectorAll(CARD_SELS.join(',')));
    // 结构兜底：BV/直播链接向上找卡片容器（计划书 §10）
    document
      .querySelectorAll('a[href*="/video/BV"], a[href*="//live.bilibili.com"], a[href*="/v/living"]')
      .forEach((a) => {
        if (a.closest(SKIP_CLOSEST)) return;
        const card = a.closest(CARD_CLOSEST.join(',')) || a.parentElement;
        if (card && card !== document.body && card !== document.documentElement) {
          card.setAttribute('data-tu-card', '');
          set.add(card);
        }
      });
    return set;
  }

  let scanTimer = null;
  function scheduleScan() {
    if (scanTimer) return;
    scanTimer = setTimeout(() => {
      scanTimer = null;
      scan();
    }, 200);
  }

  function scan() {
    if (!enabled || !jcfg) return;
    try {
      findCards().forEach(processCard);
      hotFilter();
      hideLiveTabs();
      searchGuard();
      spaceBanner();
    } catch (e) {
      // 单次扫描异常不影响后续轮询
    }
  }

  /* ---------------- 热搜榜 / 搜索联想词过滤（计划书 §5） ---------------- */
  const HOT_BOX_SELS = ['.trending-search', '.header-search-suggest', '.search-suggest', '.suggest-wrap', '.header-search-suggest-wrap'];
  function hotFilter() {
    for (const sel of HOT_BOX_SELS) {
      document.querySelectorAll(sel).forEach((box) => {
        if (box.dataset.tuHotDone) return;
        // 等联想词渲染出来再判定：容器有条目才处理
        const items = box.querySelectorAll('li, a, .trending-item, .suggest-item');
        if (!items.length) return;
        let blocked = 0;
        items.forEach((item) => {
          const text = (item.textContent || '').trim();
          if (!text) return;
          if (TU.judge.hitKeyword(jcfg.blackKeywords, text)) {
            item.setAttribute('data-tu-hot-item', '');
            blocked++;
          }
        });
        // 联想词是动态刷新的：已处理过且有条目的容器标记完成，不再重复处理
        box.dataset.tuHotDone = '1';
        box.classList.add('tu-pass'); // 放行容器（条目级已由 data-tu-hot-item 隐藏）
      });
    }
  }

  /* ---------------- 直播 tab / 游戏入口隐藏（文本级） ---------------- */
  const LIVE_TAB_TEXT = new Set(['直播', '直播推荐', '游戏中心', '直播广场']);
  function hideLiveTabs() {
    document.querySelectorAll('a[href*="/v/living"], .tab-item, .feed-tab, .zone-title a, nav a').forEach((el) => {
      const t = (el.textContent || '').trim();
      if (t && t.length <= 6 && LIVE_TAB_TEXT.has(t)) {
        el.style.display = 'none';
        el.setAttribute('data-tu-live-tab', '');
      }
    });
  }

  /* ---------------- 搜索页守卫：搜索词命中黑词 → 拦截提示（结果卡片照常过滤） ---------------- */
  let searchGuardDone = false;
  function searchGuard() {
    if (!page.search || searchGuardDone) return;
    const kw = new URLSearchParams(location.search).get('keyword') || '';
    if (!kw) return;
    const hit = TU.judge.hitKeyword(jcfg.blackKeywords, kw);
    if (hit) {
      showBanner('搜索词「' + esc(kw) + '」命中黑名单关键词「' + esc(hit) + '」，相关内容已被青少年模式过滤', 'warn');
      searchGuardDone = true;
    }
  }

  /* ---------------- 空间页：黑名单 UP 顶部横幅 ---------------- */
  let spaceBannerDone = false;
  function spaceBanner() {
    if (!page.space || spaceBannerDone || !cfg) return;
    const m = /^(\d+)/.exec(PATH);
    if (!m) return;
    const hit = TU.judge.matchUp(cfg.upBlacklist, '', Number(m[1]));
    if (hit) {
      showBanner('该 UP 主「' + esc(hit.name) + '」已在黑名单中，内容不适合青少年浏览', 'danger');
      spaceBannerDone = true;
    }
  }

  /* ---------------- 播放页守卫（计划书 §6.2）
     同步审标题（黑词即拦）→ 异步 API 审 tid/tags；
     严格档：中间地带也拦（等 L1 白名单命中再解除）；宽松档：只拦 block。
     番剧页（bangumi）不拦截（计划书 §6.4）。 ---------------- */
  const playerGuard = {
    bvid: null,
    l0Done: false,
    l1Sent: false,
    guarding: false,
    pauseTimer: null,
  };

  function guardShow(reason) {
    if (playerGuard.guarding) return;
    playerGuard.guarding = true;
    const el = document.createElement('div');
    el.id = 'tu-player-guard';
    el.innerHTML =
      '<div class="tu-guard-card">' +
      '<img class="tu-guard-logo" src="' + chrome.runtime.getURL('icons/icon128.png') + '" alt="">' +
      '<h1>该内容已被青少年模式拦截</h1>' +
      '<p class="tu-guard-reason">命中规则：' + esc(reason) + '</p>' +
      '<p class="tu-guard-tip">本视频未通过白名单判定，如认为有误可请家长在插件配置中调整词库</p>' +
      '<button class="tu-guard-home">返回首页</button>' +
      '</div>';
    document.documentElement.appendChild(el);
    if (document.body) document.body.style.overflow = 'hidden';
    playerGuard.pauseTimer = setInterval(() => {
      document.querySelectorAll('video').forEach((v) => {
        try { v.pause(); } catch (_e) { /* ignore */ }
      });
    }, 1000);
    el.querySelector('.tu-guard-home').addEventListener('click', () => {
      location.href = 'https://www.bilibili.com/';
    });
  }

  function guardDismiss() {
    if (!playerGuard.guarding) return;
    playerGuard.guarding = false;
    if (playerGuard.pauseTimer) clearInterval(playerGuard.pauseTimer);
    const el = document.getElementById('tu-player-guard');
    if (el) el.remove();
    if (document.body) document.body.style.overflow = '';
  }

  function playerGuardTick() {
    if (!page.video || page.bangumi || !enabled || !jcfg) return;
    if (playerGuard.bvid !== page.video[1]) {
      // SPA 切换视频：重置守卫状态
      playerGuard.bvid = page.video[1];
      playerGuard.l0Done = false;
      playerGuard.l1Sent = false;
      guardDismiss();
    }
    const bvid = playerGuard.bvid;

    // L0：标题同步审（标题元素可能尚未渲染，等下一轮 tick）
    if (!playerGuard.l0Done) {
      const title =
        pickText(document, ['#viewbox_report h1', 'h1.video-title', '.video-info-title h1', '.video-title']) ||
        document.title.replace(/_哔哩哔哩.*$/, '');
      if (title) {
        const meta = {
          title,
          desc: '',
          upName: pickText(document, ['.up-name', '.up-detail a', '.video-info-detail a']),
          tags: [],
          isLive: false,
        };
        const v = TU.judge.judgeCard(meta, jcfg);
        playerGuard.l0Done = true;
        if (v.verdict === 'block') {
          guardShow(v.reason);
        }
      }
    }

    // L1：API 复核（一次）
    if (!playerGuard.l1Sent && !degraded) {
      playerGuard.l1Sent = true;
      send({ type: 'JUDGE_BV', bvid }).then((res) => {
        if (playerGuard.bvid !== bvid) return; // 已切视频
        if (!res || !res.ok) {
          if (res && (res.degraded || /degraded/.test(res.error || ''))) degraded = true;
          return; // L1 失败维持 L0 结果
        }
        const d = res.data || {};
        if (d.degraded) { degraded = true; return; }
        if (d.verdict === 'block') {
          guardShow(d.reason || '黑名单');
        } else if (d.verdict === 'pass') {
          guardDismiss();
        } else if (d.verdict === 'strict-hide') {
          // 严格档中间地带拦截；宽松档显示
          if (jcfg.settings.strictMode) {
            if (playerGuard.l0Done) guardShow('严格档：未命中白名单');
          } else {
            guardDismiss();
          }
        }
      });
    }
  }

  /* ---------------- 配置加载与热更新 ---------------- */
  async function loadConfig() {
    const res = await send({ type: 'GET_CONFIG' });
    if (!res || !res.ok) throw new Error('config unavailable');
    cfg = res.data;
    if (res.degraded) degraded = true;
    jcfg = TU.judge.buildJudgeConfig(cfg);
    enabled = !!cfg.settings.enabled;
  }

  function rescanAll() {
    document.querySelectorAll('[data-tu-state]').forEach((c) => {
      delete c.dataset.tuState;
      c.classList.remove('tu-pass', 'tu-blocked', 'tu-shielded');
      const shield = c.querySelector(':scope > .tu-shield'); // 名单变化后重新判定：先摘遮罩
      if (shield) shield.remove();
    });
    scan();
  }

  let listsReloadTimer = null;
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !enabled) return;
    if (changes.settings) {
      const sig = JSON.stringify(changes.settings.newValue || {});
      if (sig !== lastSettingsSig) location.reload(); // 设置变化：重载页面最可靠
    } else if (
      changes.keywordsBlacklist || changes.keywordsWhitelist || changes.upWhitelist ||
      changes.upBlacklist || changes.tidBlacklist || changes.tidWhitelist
    ) {
      // 名单/词库变化：重载配置并全量重扫（含 mid 回填写库触发，成本低）
      if (listsReloadTimer) clearTimeout(listsReloadTimer);
      listsReloadTimer = setTimeout(async () => {
        listsReloadTimer = null;
        try {
          await loadConfig();
          rescanAll();
        } catch (_e) { /* ignore */ }
      }, 1000);
    }
  });

  /* ---------------- 异常兑底：绝不能把页面藏死 ---------------- */
  function revealAll() {
    const el = document.getElementById('tu-early-hide');
    if (el) el.remove();
    document
      .querySelectorAll('.trending-search, .header-search-suggest, .search-suggest, .suggest-wrap, .header-search-suggest-wrap')
      .forEach((b) => b.classList.add('tu-pass'));
    document.querySelectorAll('[data-tu-hot-item]').forEach((i) => i.classList.add('tu-pass'));
  }

  /* ---------------- 页面上下文批量关注（background 委托，412 风控兑底）
     SW 直发的关注请求 Origin=chrome-extension:// 会被B站风控 412 拒绝；
     content script 在 bilibili 页面里 fetch，Origin/Referer/Sec-Fetch 与真实网页一致 */
  function readBiliJct() {
    const m = /(?:^|;\s*)bili_jct=([^;]+)/.exec(document.cookie || '');
    return m ? decodeURIComponent(m[1]) : '';
  }

  async function pageFollow(items, csrfFallback) {
    const csrf = readBiliJct() || csrfFallback || '';
    const query =
      'statistics=' + encodeURIComponent('{"appId":100,"platform":5}') +
      '&x-bili-locale-json=' +
      encodeURIComponent('{"c_locale":{"language":"zh","script":"Hans"},"always_translate":false}') +
      '&x-bili-device-req-json=' +
      encodeURIComponent('{"platform":"web","device":"pc","spmid":"333.337","mobi_app":"web_cn"}');
    const out = { okCount: 0, fails: [] };
    for (const it of items || []) {
      if (!it || !it.mid) continue;
      const body = new URLSearchParams({
        fid: String(it.mid),
        act: '1',
        re_src: '120',
        spmid: '333.337.0.0',
        cross_domain: 'true',
        extend_content: JSON.stringify({ entity: 'query', entity_id: String(it.name || it.mid) }),
        csrf,
      }).toString();
      try {
        const res = await fetch('https://api.bilibili.com/x/relation/modify?' + query, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body,
        });
        const json = await res.json().catch(() => null);
        if (json && json.code === 0) {
          out.okCount++;
        } else {
          out.fails.push({
            name: it.name || '',
            code: (json && json.code) || 0,
            msg: String((json && json.message) || 'http ' + res.status).slice(0, 60),
          });
        }
        if (json && json.code === -101) break; // 未登录，后续必败
      } catch (e) {
        out.fails.push({ name: it.name || '', code: 0, msg: String(e.message || e).slice(0, 60) });
      }
      await new Promise((r) => setTimeout(r, 350)); // 模拟真实点击间隔，防频控
    }
    return out;
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg && msg.type === 'TU_PING') {
      sendResponse({ ok: true });
      return false;
    }
    if (msg && msg.type === 'PAGE_FOLLOW') {
      pageFollow(msg.items || [], msg.csrf || '').then((out) => sendResponse({ ok: true, data: out }));
      return true; // 异步 sendResponse
    }
    return false;
  });

  /* ---------------- 主流程 ---------------- */
  async function main() {
    await loadConfig();
    lastSettingsSig = JSON.stringify(cfg.settings);
    if (!enabled) {
      // 总开关关闭：撤下所有早期隐藏（重新开启时 onChanged 触发 reload）
      if (TU.early && TU.early.disableEarlyHide) TU.early.disableEarlyHide();
      revealAll();
      return;
    }

    scan(); // 首轮（document_end 立即精确放行，缩短 early 隐藏时间）

    const mo = new MutationObserver(scheduleScan);
    mo.observe(document.documentElement, { childList: true, subtree: true });
    setInterval(scan, 3000);          // 兑底轮询（防 SPA/observer 失效）
    setInterval(flushBackfill, 3000); // mid 回填批量上报
    setInterval(flushLog, 5000);      // 屏蔽日志批量上报
    if (page.video && !page.bangumi) {
      setInterval(playerGuardTick, 600); // 播放页守卫轮询
    }
  }

  main().catch(() => revealAll());
})();
