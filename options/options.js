/**
 * options/options.js —— 词库 / UP 名单（批量导入·回填标记·智能补全）/ 分区 / 屏蔽记录
 * （计划书 §6.5 / §6.6）
 */
(function () {
  'use strict';
  const TU = globalThis.TU || {};
  const D = TU.defaults || {};
  const $ = (id) => document.getElementById(id);

  /* ---------------- 通用 ---------------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }
  function fmtTime(ts) {
    const d = new Date((ts || 0) * 1000);
    const p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' +
      p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }
  function fmtReason(reason) {
    if (!reason) return '';
    if (reason === 'live') return '直播';
    if (reason === 'strict') return '严格档未命中白名单';
    if (reason.startsWith('black-word:')) return '黑词「' + reason.slice(11) + '」';
    if (reason.startsWith('black-up')) return '黑名单UP';
    if (reason.startsWith('black-tid')) {
      const tid = reason.split(':')[1];
      return '黑名单分区 ' + tid + (D.TID_NAMES && D.TID_NAMES[tid] ? '·' + D.TID_NAMES[tid] : '');
    }
    return reason;
  }
  function get(keys) {
    return new Promise((r) => chrome.storage.local.get(keys, r));
  }
  function set(obj) {
    return new Promise((r) => chrome.storage.local.set(obj, r));
  }
  function send(msg) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(msg, (res) => resolve(res || { ok: false }));
    });
  }
  let toastTimer = null;
  function toast(text) {
    const el = $('toast');
    el.textContent = text;
    el.classList.remove('hidden');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add('hidden'), 2200);
  }
  /** UP 名称分隔符解析：换行 / 逗号(全半角) / 顿号 / 分号(全半角) / Tab（不支持空格） */
  function parseNames(text) {
    const out = [];
    const seen = new Set();
    String(text || '')
      .split(/[\r\n,，、;；\t]+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .forEach((n) => {
        if (!seen.has(n)) { seen.add(n); out.push(n); }
      });
    return out;
  }

  /* ---------------- Tab 切换 ---------------- */
  document.querySelectorAll('.tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b === btn));
      document.querySelectorAll('.panel').forEach((p) => p.classList.toggle('active', p.id === 'tab-' + btn.dataset.tab));
      if (btn.dataset.tab === 'records') loadLog();
    });
  });

  /* ================= 关键词库 ================= */
  const KW = { black: 'keywordsBlacklist', white: 'keywordsWhitelist' };

  async function renderKw(kind) {
    const key = KW[kind];
    const r = await get({ [key]: [] });
    const ul = $(kind === 'black' ? 'kwBlackList' : 'kwWhiteList');
    const list = r[key] || [];
    ul.innerHTML = list.length
      ? list.map((w, i) => '<li><span>' + esc(w) + '</span><button class="kw-del" data-kind="' + kind + '" data-i="' + i + '">删除</button></li>').join('')
      : '<li style="justify-content:center;color:#9499a0">（空）</li>';
  }

  async function addKw(kind, word) {
    word = String(word || '').trim();
    if (!word) return;
    const key = KW[kind];
    const r = await get({ [key]: [] });
    const list = r[key] || [];
    if (list.includes(word)) { toast('已存在：' + word); return; }
    list.push(word);
    await set({ [key]: list });
    renderKw(kind);
  }

  async function delKw(kind, i) {
    const key = KW[kind];
    const r = await get({ [key]: [] });
    const list = r[key] || [];
    list.splice(i, 1);
    await set({ [key]: list });
    renderKw(kind);
  }

  async function restoreKw(kind) {
    const key = KW[kind];
    const defaults = kind === 'black' ? D.KEYWORDS_BLACKLIST : D.KEYWORDS_WHITELIST;
    await set({ [key]: (defaults || []).slice() });
    renderKw(kind);
    toast('已恢复默认词库');
  }

  async function exportKw(kind) {
    const key = KW[kind];
    const r = await get({ [key]: [] });
    // 黑名单导出用逗号分隔（导入 parseNames 原生支持逗号，可无损导回）；白名单保持换行
    const comma = kind === 'black';
    try {
      await navigator.clipboard.writeText((r[key] || []).join(comma ? ',' : '\n'));
      toast(comma ? '已复制到剪贴板（逗号分隔），可粘贴保存' : '已复制到剪贴板，可粘贴到文本保存');
    } catch (_e) {
      toast('剪贴板不可用，请手动复制');
    }
  }

  async function importKw(kind) {
    let text = '';
    try {
      text = await navigator.clipboard.readText();
    } catch (_e) {
      toast('读取剪贴板失败，请粘贴到批量框');
      return;
    }
    const names = parseNames(text);
    if (!names.length) { toast('剪贴板无有效内容'); return; }
    const key = KW[kind];
    const r = await get({ [key]: [] });
    const list = r[key] || [];
    let added = 0;
    names.forEach((n) => {
      if (!list.includes(n)) { list.push(n); added++; }
    });
    await set({ [key]: list });
    renderKw(kind);
    toast('导入 ' + added + ' 条（重复 ' + (names.length - added) + ' 条跳过）');
  }

  $('kwBlackInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { addKw('black', e.target.value); e.target.value = ''; }
  });
  $('kwWhiteInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { addKw('white', e.target.value); e.target.value = ''; }
  });
  document.addEventListener('click', (e) => {
    const btn = e.target.closest && e.target.closest('.kw-del');
    if (btn) delKw(btn.dataset.kind, Number(btn.dataset.i));
  });
  $('kwBlackImport').addEventListener('click', () => importKw('black'));
  $('kwWhiteImport').addEventListener('click', () => importKw('white'));
  $('kwBlackExport').addEventListener('click', () => exportKw('black'));
  $('kwWhiteExport').addEventListener('click', () => exportKw('white'));
  $('kwBlackRestore').addEventListener('click', () => restoreKw('black'));
  $('kwWhiteRestore').addEventListener('click', () => restoreKw('white'));

  /* ================= UP 名单 ================= */
  let curList = 'upWhitelist';
  let parsedNames = []; // 解析预览结果

  function otherList() {
    return curList === 'upWhitelist' ? 'upBlacklist' : 'upWhitelist';
  }

  async function renderUps() {
    const r = await get({ upWhitelist: [], upBlacklist: [] });
    const filter = ($('upFilter').value || '').trim();
    const list = (r[curList] || []).filter((e) => !filter || (e.name || '').includes(filter));
    $('whiteCount').textContent = (r.upWhitelist || []).length;
    $('blackCount').textContent = (r.upBlacklist || []).length;

    const tb = $('upTableBody');
    tb.innerHTML = list.length
      ? list.map((e, i) => {
        const idx = (r[curList] || []).indexOf(e);
        const face = e.face
          ? '<img class="face" referrerpolicy="no-referrer" src="' + esc(e.face) + '" alt="">'
          : '<img class="face ph" src="" alt="">';
        const mode = e.mid
          ? '<span class="tag ok">mid 精确 · ' + esc(e.mid) + '</span>'
          : '<span class="tag warn">名称匹配 · 待回填</span>';
        return '<tr>' +
          '<td class="w-check"><input type="checkbox" class="up-row-check" data-i="' + idx + '"></td>' +
          '<td class="w-face">' + face + '</td>' +
          '<td>' + esc(e.name) + '</td>' +
          '<td class="w-mode">' + mode + '</td>' +
          '<td class="w-op"><button class="up-op-del" data-i="' + idx + '">删除</button></td>' +
          '</tr>';
      }).join('')
      : '<tr class="empty-row"><td colspan="5">（空）</td></tr>';
    refreshFollowBtn();
  }

  /* 勾选联动：白名单 tab 下勾选了条目时，「一键关注」切换为「关注勾选（只关注选中的）」 */
  function refreshFollowBtn() {
    const btn = $('upFollowAll');
    if (!btn || btn.disabled) return;
    const n =
      curList === 'upWhitelist'
        ? document.querySelectorAll('.up-row-check:checked').length
        : 0;
    btn.textContent = n > 0 ? '关注勾选（' + n + ' 个）' : '一键关注白名单UP';
  }

  document.addEventListener('change', (e) => {
    if (
      e.target.classList &&
      (e.target.classList.contains('up-row-check') || e.target.id === 'upCheckAll')
    ) {
      refreshFollowBtn();
    }
  });

  document.querySelectorAll('.up-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.up-tab').forEach((b) => b.classList.toggle('active', b === btn));
      curList = btn.dataset.list;
      renderUps();
    });
  });
  $('upFilter').addEventListener('input', renderUps);

  document.addEventListener('click', (e) => {
    const btn = e.target.closest && e.target.closest('.up-op-del');
    if (!btn) return;
    (async () => {
      const r = await get({ [curList]: [] });
      r[curList].splice(Number(btn.dataset.i), 1);
      await set({ [curList]: r[curList] });
      renderUps();
    })();
  });

  $('upCheckAll').addEventListener('change', (e) => {
    document.querySelectorAll('.up-row-check').forEach((c) => { c.checked = e.target.checked; });
    refreshFollowBtn();
  });

  $('upBatchDelete').addEventListener('click', async () => {
    const checked = [...document.querySelectorAll('.up-row-check:checked')].map((c) => Number(c.dataset.i));
    if (!checked.length) { toast('请先勾选要删除的条目'); return; }
    const r = await get({ [curList]: [] });
    r[curList] = r[curList].filter((_, i) => !checked.includes(i));
    await set({ [curList]: r[curList] });
    $('upCheckAll').checked = false;
    renderUps();
    toast('已删除 ' + checked.length + ' 条');
  });

  /* 一键删除无 mid（待回填）条目：名称匹配不可靠，难回填时直接清理；作用于当前名单 */
  $('upDeleteNoMid').addEventListener('click', async () => {
    const r = await get({ [curList]: [] });
    const list = r[curList] || [];
    const noMid = list.filter((e) => e && !e.mid);
    if (!noMid.length) {
      toast('当前名单没有无 mid 的条目');
      return;
    }
    const sample = noMid.slice(0, 3).map((e) => e.name).join('、');
    if (!window.confirm(
      '删除' + (curList === 'upWhitelist' ? '白' : '黑') + '名单中 ' + noMid.length +
        ' 个无 mid 条目（' + sample + (noMid.length > 3 ? ' 等' : '') + '）？\n删除后仅靠名称匹配的过滤随之失效，不可恢复。'
    )) {
      return;
    }
    await set({ [curList]: list.filter((e) => e && e.mid) });
    renderUps();
    toast('已删除 ' + noMid.length + ' 个无 mid 条目');
  });

  /* ---------- 批量导入：粘贴 → 解析预览 → 确认入库 ---------- */
  $('upParseBtn').addEventListener('click', async () => {
    const names = parseNames($('upPasteArea').value);
    if (!names.length) { toast('未解析到有效名称'); return; }
    const r = await get({ upWhitelist: [], upBlacklist: [] });
    const curNames = new Set((r[curList] || []).map((e) => String(e.name).trim()));
    const otherNames = new Set((r[otherList()] || []).map((e) => String(e.name).trim()));
    parsedNames = names;

    $('upPreview').innerHTML = names.map((n) => {
      let tag;
      if (curNames.has(n)) tag = '<span class="tag warn">已在当前名单</span>';
      else if (otherNames.has(n)) tag = '<span class="tag err">冲突：在' + (curList === 'upWhitelist' ? '黑' : '白') + '名单</span>';
      else tag = '<span class="tag ok">新增</span>';
      return '<div class="preview-item"><span>' + esc(n) + '</span>' + tag + '</div>';
    }).join('');
    $('upParseInfo').textContent = '共 ' + names.length + ' 个名称（已去空行/去重）';
    $('upPreview').classList.remove('hidden');
    $('upConfirmRow').classList.remove('hidden');
  });

  $('upConfirmBtn').addEventListener('click', async () => {
    if (!parsedNames.length) return;
    const r = await get({ [curList]: [] });
    const list = r[curList] || [];
    const existing = new Set(list.map((e) => String(e.name).trim()));
    let added = 0;
    parsedNames.forEach((n) => {
      if (!existing.has(n)) { list.push(D.makeUpEntry(n)); added++; }
    });
    await set({ [curList]: list });
    $('upPreview').classList.add('hidden');
    $('upConfirmRow').classList.add('hidden');
    $('upPasteArea').value = '';
    $('upParseInfo').textContent = '';
    parsedNames = [];
    renderUps();
    toast('入库 ' + added + ' 条（待自动回填 mid）');
  });

  $('upCancelBtn').addEventListener('click', () => {
    $('upPreview').classList.add('hidden');
    $('upConfirmRow').classList.add('hidden');
    parsedNames = [];
    $('upParseInfo').textContent = '';
  });

  /* ---------- 从我的关注同步名单（与「一键关注」互补）：
     拉取B站关注列表 → ①名单中同名无 mid 条目回填；②名单里还没有的关注UP直接带 mid 新增进白名单
     （家长在B站自己关注的都是筛过的真实账号，无需粉丝闸；黑名单不同步，避免语义混淆） ---------- */
  $('upBackfillFollowings').addEventListener('click', async () => {
    const btn = $('upBackfillFollowings');
    if (btn.disabled) return;
    const r = await get({ upWhitelist: [], upBlacklist: [] });
    const pending = [...(r.upWhitelist || []), ...(r.upBlacklist || [])].filter(
      (e) => e && !e.mid
    );
    btn.disabled = true;
    btn.textContent = '拉取关注列表…';
    const res = await send({ type: 'FETCH_FOLLOWINGS' });
    btn.disabled = false;
    btn.textContent = '从我的关注同步名单';
    if (!res || !res.ok) {
      toast((res && res.error) || '拉取关注列表失败');
      return;
    }
    const follows = res.data || [];
    if (!follows.length) {
      toast('你的B站关注列表为空，先在B站关注UP后再同步');
      return;
    }
    const nameMap = new Map(follows.map((u) => [String(u.name || '').trim().toLowerCase(), u]));
    // ① 回填：名单中同名（大小写折叠）无 mid 条目补 mid
    const items = [];
    for (const e of pending) {
      const hit = nameMap.get(String(e.name || '').trim().toLowerCase());
      if (hit) items.push({ name: e.name, mid: hit.mid, face: hit.face || '' });
    }
    // ② 新增：名单里还没有的关注 UP 直接带 mid 入白名单（mid/名称均不重复）
    const wl = r.upWhitelist || [];
    const existingNames = new Set(
      [...wl, ...(r.upBlacklist || [])].map((e) => String(e.name || '').trim().toLowerCase())
    );
    const existingMids = new Set(wl.map((e) => e && e.mid).filter(Boolean));
    const additions = follows.filter(
      (u) =>
        u &&
        u.mid &&
        !existingMids.has(u.mid) &&
        !existingNames.has(String(u.name || '').trim().toLowerCase())
    );
    let added = 0;
    if (additions.length) {
      const sample = additions.slice(0, 3).map((u) => u.name).join('、');
      if (
        window.confirm(
          '将 ' + additions.length + ' 个已关注UP加入白名单（' + sample + (additions.length > 3 ? ' 等' : '') + '）？\n' +
            '你在B站关注的UP会直接以「mid 精确」方式入库。'
        )
      ) {
        additions.forEach((u) => wl.push(D.makeUpEntry(u.name, u.mid, u.face)));
        await set({ upWhitelist: wl });
        added = additions.length;
      }
    }
    if (!items.length && !added) {
      toast(
        '关注列表（' + follows.length + ' 人）与名单已同步，无需要回填或新增的UP'
      );
      return;
    }
    if (items.length) await send({ type: 'BACKFILL_MID', items });
    await renderUps();
    toast(
      (items.length ? '已回填 ' + items.length + ' 个mid' : '') +
        (added ? (items.length ? '，' : '') + '新增白名单 ' + added + ' 个' : '')
    );
  });

  /* ---------- 一键关注白名单UP（全自动：无 mid 自动按名称搜索回填后关注）
     白名单 tab 下勾选了条目 → 只关注勾选的；否则关注全部白名单 ---------- */
  $('upFollowAll').addEventListener('click', async () => {
    const btn = $('upFollowAll');
    if (btn.disabled) return;
    const r = await get({ upWhitelist: [] });
    const all = r.upWhitelist || [];
    let list = null;
    if (curList === 'upWhitelist') {
      const checkedIdx = [...document.querySelectorAll('.up-row-check:checked')].map((c) =>
        Number(c.dataset.i)
      );
      if (checkedIdx.length) {
        list = checkedIdx.map((i) => all[i]).filter((e) => e && (e.mid || e.name));
      }
    }
    const checkedMode = !!list;
    if (!list) list = all.filter((e) => e && (e.mid || e.name));
    if (!list.length) {
      toast(checkedMode ? '勾选的条目无效' : '白名单为空，请先导入UP');
      return;
    }
    btn.disabled = true;
    btn.textContent = '关注中…（' + list.length + ' 个）';
    const res = await send({
      type: 'AUTO_FOLLOW_UPS',
      entries: list.map((e) => ({ name: e.name, mid: e.mid || 0 })),
    });
    btn.disabled = false;
    refreshFollowBtn();
    if (!res || !res.ok) {
      toast((res && res.error) || '关注失败，请稍后重试');
      return;
    }
    const d = res.data || { okCount: 0, backfilled: 0, fails: [] };
    let msg = '已关注 ' + d.okCount + ' 个UP' + (checkedMode ? '（勾选范围）' : '');
    if (d.backfilled) msg += '（按名称自动匹配回填 mid ' + d.backfilled + ' 个）';
    if (d.fails && d.fails.length) {
      msg += '，未成功 ' + d.fails.length + ' 个（' + (d.fails[0].name || '') +
        '：' + (d.fails[0].msg || 'code ' + d.fails[0].code) + '）';
    }
    toast(msg);
    if (d.backfilled) await renderUps(); // 表格中「待回填」同步变「mid 精确」
  });

  /* ---------- 导出名单 ---------- */
  $('upExport').addEventListener('click', async () => {
    const r = await get({ [curList]: [] });
    const text = (r[curList] || []).map((e) => e.name).join('\n');
    try {
      await navigator.clipboard.writeText(text);
      toast('已复制 ' + (r[curList] || []).length + ' 个名称到剪贴板');
    } catch (_e) {
      toast('剪贴板不可用');
    }
  });

  /* ---------- 智能补全（B站用户搜索 → 勾选入库） ---------- */
  $('upSearchBtn').addEventListener('click', () => {
    $('upSearchBox').classList.toggle('hidden');
  });

  async function doSearchUp() {
    const name = ($('upSearchInput').value || '').trim();
    if (!name) return;
    $('upSearchResult').innerHTML = '<div class="preview-item hint">搜索中…</div>';
    const res = await send({ type: 'SEARCH_UP', name });
    if (!res || !res.ok || !res.data || !res.data.length) {
      $('upSearchResult').innerHTML = '<div class="preview-item hint">未找到用户（需登录B站，或接口限流，稍后再试）</div>';
      return;
    }
    $('upSearchResult').innerHTML = res.data.map((u) =>
      '<div class="preview-item">' +
      '<input type="checkbox" class="search-check" data-mid="' + esc(u.mid) + '" data-name="' + esc(u.name) + '" data-face="' + esc(u.face) + '">' +
      '<img referrerpolicy="no-referrer" src="' + esc(u.face) + '" alt="">' +
      '<span>' + esc(u.name) + '</span>' +
      '<span class="hint">粉丝 ' + (Number(u.fans) || 0) + ' · ' + esc(u.sign || '') + '</span>' +
      '</div>'
    ).join('');
    $('upSearchConfirmRow').classList.remove('hidden');
  }

  $('upSearchGo').addEventListener('click', doSearchUp);
  $('upSearchInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doSearchUp();
  });

  $('upSearchConfirm').addEventListener('click', async () => {
    const checked = [...document.querySelectorAll('.search-check:checked')];
    if (!checked.length) { toast('请先勾选用户'); return; }
    const r = await get({ [curList]: [] });
    const list = r[curList] || [];
    let added = 0;
    checked.forEach((c) => {
      const mid = Number(c.dataset.mid);
      if (!list.some((e) => (mid && e.mid == mid) || e.name === c.dataset.name)) {
        list.push(D.makeUpEntry(c.dataset.name, mid, c.dataset.face));
        added++;
      }
    });
    await set({ [curList]: list });
    $('upSearchResult').innerHTML = '';
    $('upSearchConfirmRow').classList.add('hidden');
    renderUps();
    toast('入库 ' + added + ' 个 UP（mid 精确匹配）');
  });

  /* ================= 屏蔽记录 ================= */
  async function loadLog() {
    const res = await send({ type: 'GET_BLOCK_LOG' });
    const list = (res.ok && res.data) || [];
    $('logTableBody').innerHTML = list.length
      ? list.slice(0, 500).map((e) =>
        '<tr><td title="' + esc(e.title) + '">' + esc(e.title || e.bvid || '(无标题)') + '</td>' +
        '<td class="w-up">' + esc(e.up || '') + '</td>' +
        '<td class="w-reason">' + esc(fmtReason(e.reason)) + '</td>' +
        '<td class="w-time">' + fmtTime(e.ts) + '</td></tr>'
      ).join('')
      : '<tr class="empty-row"><td colspan="4">暂无屏蔽记录</td></tr>';
  }
  $('clearLog').addEventListener('click', async () => {
    await send({ type: 'CLEAR_BLOCK_LOG' });
    loadLog();
    toast('已清空屏蔽记录');
  });

  /* ---------------- 初始化 ---------------- */
  renderKw('black');
  renderKw('white');
  renderUps();
  loadLog();
})();
