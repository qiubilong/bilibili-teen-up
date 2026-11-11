/**
 * early.js —— document_start 抢跑层（计划书 §6.1 / M2 / M4）
 *
 * 职责：
 *   1. 直播整站拦截：live.bilibili.com 任意路径 → 同步白幕遮挡 → 确认配置后渲染拦截提示页
 *   2. 防闪现：同步注入 CSS 把候选视频卡片 visibility:hidden（保留布局防跳动），
 *      由 content.js 精确判定后加 .tu-pass 放行 / .tu-blocked 移除
 *   3. 全站直播/游戏导航入口、直播 tab 的早期隐藏
 *
 * 配置为异步读取：先按"默认开启"抢跑（宁可先藏后放，不可先闪后藏），
 * 读取 settings 后如 enabled=false 立即撤下全部早期隐藏。
 */
(function () {
  'use strict';
  const TU = (globalThis.TU = globalThis.TU || {});
  const host = location.hostname;

  /* ---------------- 通用工具 ---------------- */
  function addStyle(id, css) {
    const el = document.createElement('style');
    el.id = id;
    el.textContent = css;
    (document.head || document.documentElement).appendChild(el);
    return el;
  }

  function readSettings() {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get({ settings: null }, (r) => {
          resolve(r && r.settings ? r.settings : null);
        });
      } catch (_e) {
        resolve(null);
      }
    });
  }

  /* ---------------- 1. 直播整站拦截（强制行为，无开关）
     覆盖：live.bilibili.com 全域 + www 域下的直播分区页 /v/living ---------------- */
  const isLiveSite =
    host === 'live.bilibili.com' ||
    (host === 'www.bilibili.com' && location.pathname.startsWith('/v/living'));
  if (isLiveSite) {
    // 同步白幕：页面任何内容渲染前先挡住
    addStyle(
      'tu-live-veil',
      'html{visibility:hidden!important;background:#fff!important}'
    );

    readSettings().then((settings) => {
      const s = settings || TU.defaults.DEFAULT_SETTINGS;
      if (!s.enabled) {
        // 插件总开关关闭：撤下白幕恢复访问（直播拦截仅受总开关控制）
        document.getElementById('tu-live-veil')?.remove();
        return;
      }
      renderLiveBlockPage();
    });
    return; // 直播站点不再需要其余逻辑
  }

  function renderLiveBlockPage() {
    const icon = chrome.runtime.getURL('icons/icon128.png');
    const html =
      '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<title>直播已禁用 · 青少年模式</title><style>' +
      'body{margin:0;font-family:system-ui,-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;' +
      'background:linear-gradient(135deg,#fb7299 0%,#00a1d6 100%);min-height:100vh;display:flex;' +
      'align-items:center;justify-content:center}' +
      '.card{background:#fff;border-radius:16px;padding:48px 56px;max-width:420px;text-align:center;' +
      'box-shadow:0 20px 60px rgba(0,0,0,.25)}' +
      'img{width:72px;height:72px;border-radius:14px}' +
      'h1{font-size:20px;margin:18px 0 8px;color:#18191c}' +
      'p{font-size:14px;color:#61666d;line-height:1.8;margin:0 0 22px}' +
      'a.home{display:inline-block;padding:10px 32px;border-radius:8px;background:#00a1d6;' +
      'color:#fff;text-decoration:none;font-size:14px}' +
      'a.home:hover{background:#00b5e5}' +
      '</style></head><body><div class="card">' +
      '<img src="' + icon + '" alt="">' +
      '<h1>青少年模式已禁用直播</h1>' +
      '<p>直播内容不适合青少年浏览，已被 bilibili-teen-up 插件拦截。<br>' +
      '直播拦截为插件强制行为，如需临时访问请关闭插件总开关。</p>' +
      '<a class="home" href="https://www.bilibili.com" rel="noopener">返回B站首页</a>' +
      '</div></body></html>';
    try {
      document.open();
      document.write(html);
      document.close();
    } catch (_e) {
      // document.write 失败兜底：替换根元素
      document.documentElement.innerHTML = html
        .replace(/^[\s\S]*<body>/, '')
        .replace(/<\/body>[\s\S]*$/, '');
      document.title = '直播已禁用 · 青少年模式';
    }
  }

  /* ---------------- 2. 防闪现：候选卡片先隐藏 ---------------- */
  // 多备选选择器集中配置（计划书 §10：B站改版风险对策）
  const CARD_SELECTORS = [
    '.bili-video-card',            // 首页新版/搜索页通用卡片
    '.feed-card',                  // 首页 feed 卡片（旧）
    '.video-list-item',            // 搜索页结果项
    '.video-card',                 // 通用卡片（分区页/播放页右侧）
    '.video-page-card',            // 播放页右侧推荐（新版）
    '.video-page-card-small',      // 播放页右侧推荐（旧版）
    '.rank-list .rank-item',       // 排行榜条目
    '.bili-dyn-list-item',         // 动态页卡片
    '.history-list .video-card',   // 历史记录卡片
    '[data-tu-card]',              // 兜底：content 打标的卡片
  ].join(',');

  const EARLY_HIDE_CSS = [
    // 候选卡片：先藏，等待 content.js 判定放行（.tu-pass）或移除（.tu-blocked）
    CARD_SELECTORS.split(',').map((s) => s.trim() + ':not(.tu-pass):not(.tu-reveal)').join(',') + '{visibility:hidden!important}',
    // 直播/游戏导航入口与直播 tab（配合 content.js 的文本级 tab 隐藏）
    'a[href*="//live.bilibili.com"],a[href^="https://live.bilibili.com"]{display:none!important}',
    'a[href*="game.bilibili.com"],a[href*="//game.bilibili.com"]{display:none!important}',
    // 热搜榜/搜索联想词容器先隐藏条目，content.js 精确放行（容器加 .tu-pass）
    '.trending-search:not(.tu-pass),.header-search-suggest:not(.tu-pass),.search-suggest:not(.tu-pass),.suggest-wrap:not(.tu-pass){visibility:hidden!important}',
    '[data-tu-hot-item]:not(.tu-pass){display:none!important}',
  ].join('\n');

  const earlyStyle = addStyle('tu-early-hide', EARLY_HIDE_CSS);

  readSettings().then((settings) => {
    const s = settings || TU.defaults.DEFAULT_SETTINGS;
    if (!s.enabled) {
      earlyStyle.remove();
      document.documentElement.classList.add('tu-disabled');
    }
  });

  TU.early = {
    CARD_SELECTORS,
    disableEarlyHide() {
      earlyStyle?.remove();
    },
  };
})();
