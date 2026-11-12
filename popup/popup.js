/**
 * popup/popup.js —— 总开关、过滤模式（仅黑名单/严格白名单）、最近屏蔽速览（计划书 §6.6）
 * 注：首页自建拉流已废弃——保留B站原生流，被拦卡片用知识卡遮罩覆盖，无需开关
 */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const TOGGLES = ['enabled'];

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function fmtTime(ts) {
    const d = new Date((ts || 0) * 1000);
    const p = (n) => String(n).padStart(2, '0');
    return p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  function fmtReason(reason) {
    if (!reason) return '';
    if (reason === 'live') return '直播';
    if (reason === 'strict') return '严格档未命中白名单';
    if (reason.startsWith('black-word:')) return '黑词「' + reason.slice(11) + '」';
    if (reason.startsWith('black-up')) return '黑名单UP';
    if (reason.startsWith('black-tid')) return '黑名单分区';
    return reason;
  }

  function send(msg) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(msg, (res) => resolve(res || { ok: false }));
    });
  }

  async function loadSettings() {
    const r = await new Promise((resolve) =>
      chrome.storage.local.get({ settings: {} }, resolve)
    );
    const s = r.settings || {};
    for (const id of TOGGLES) {
      $(id).checked = !!s[id];
    }
    // 「仅过滤黑名单」是 strictMode 的反向呈现（同一底层状态，不另存第二份避免不同步）
    $('blackOnly').checked = s.strictMode === false;
  }

  async function loadBlocked() {
    const res = await send({ type: 'GET_BLOCK_LOG' });
    const list = (res.ok && res.data) || [];
    const ul = $('blockedList');
    if (!list.length) {
      ul.innerHTML = '<li class="empty">暂无记录</li>';
      return;
    }
    ul.innerHTML = list.slice(0, 20).map((e) => (
      '<li>' +
      '<div class="bl-title" title="' + esc(e.title) + '">' + (e.title || e.bvid || '(无标题)') + '</div>' +
      '<div class="bl-meta"><span class="bl-reason">' + esc(fmtReason(e.reason)) + '</span>' +
      '<span>' + esc(e.up || '') + ' · ' + fmtTime(e.ts) + '</span></div>' +
      '</li>'
    )).join('');
  }

  async function writeSetting(patch) {
    const r = await new Promise((resolve) =>
      chrome.storage.local.get({ settings: {} }, resolve)
    );
    const settings = Object.assign(
      { enabled: true, strictMode: true },
      r.settings || {},
      patch
    );
    await new Promise((resolve) =>
      chrome.storage.local.set({ settings }, resolve)
    );
  }

  TOGGLES.forEach((id) => {
    $(id).addEventListener('change', () => writeSetting({ [id]: $(id).checked }));
  });
  $('blackOnly').addEventListener('change', () => {
    writeSetting({ strictMode: !$('blackOnly').checked });
  });

  $('openOptions').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });

  loadSettings();
  loadBlocked();
})();
