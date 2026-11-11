/**
 * lib/wbi.js
 * B站 wbi 接口签名（纯 JS，计划书 §6.4）：
 *   nav 接口取 img_key/sub_key → mixinKeyEncTab 重排取前 32 → 参数排序编码 + wts → md5 得 w_rid
 * 仅用于需要签名的接口（space 投稿 / 用户搜索 / 热门等），由 background 调用。
 */
(function () {
  'use strict';
  const TU = (globalThis.TU = globalThis.TU || {});

  /* ---------------- MD5（输出小写十六进制） ---------------- */
  function safeAdd(x, y) {
    const lsw = (x & 0xffff) + (y & 0xffff);
    const msw = (x >> 16) + (y >> 16) + (lsw >> 16);
    return (msw << 16) | (lsw & 0xffff);
  }
  function bitRol(num, cnt) {
    return (num << cnt) | (num >>> (32 - cnt));
  }
  function md5cmn(q, a, b, x, s, t) {
    return safeAdd(bitRol(safeAdd(safeAdd(a, q), safeAdd(x, t)), s), b);
  }
  function md5ff(a, b, c, d, x, s, t) {
    return md5cmn((b & c) | (~b & d), a, b, x, s, t);
  }
  function md5gg(a, b, c, d, x, s, t) {
    return md5cmn((b & d) | (c & ~d), a, b, x, s, t);
  }
  function md5hh(a, b, c, d, x, s, t) {
    return md5cmn(b ^ c ^ d, a, b, x, s, t);
  }
  function md5ii(a, b, c, d, x, s, t) {
    return md5cmn(c ^ (b | ~d), a, b, x, s, t);
  }

  function md51(s) {
    const n = s.length;
    const state = [1732584193, -271733879, -1732584194, 271733878];
    let i;
    for (i = 64; i <= s.length; i += 64) {
      md5cycle(state, md5blk(s.substring(i - 64, i)));
    }
    s = s.substring(i - 64);
    const tail = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    for (i = 0; i < s.length; i++) {
      tail[i >> 2] |= s.charCodeAt(i) << ((i % 4) << 3);
    }
    tail[i >> 2] |= 0x80 << ((i % 4) << 3);
    if (i > 55) {
      md5cycle(state, tail);
      for (i = 0; i < 16; i++) tail[i] = 0;
    }
    tail[14] = n * 8;
    md5cycle(state, tail);
    return state;
  }

  function md5cycle(x, k) {
    let a = x[0], b = x[1], c = x[2], d = x[3];
    /* eslint-disable prettier/prettier */
    a = md5ff(a, b, c, d, k[0], 7, -680876936);
    d = md5ff(d, a, b, c, k[1], 12, -389564586);
    c = md5ff(c, d, a, b, k[2], 17, 606105819);
    b = md5ff(b, c, d, a, k[3], 22, -1044525330);
    a = md5ff(a, b, c, d, k[4], 7, -176418897);
    d = md5ff(d, a, b, c, k[5], 12, 1200080426);
    c = md5ff(c, d, a, b, k[6], 17, -1473231341);
    b = md5ff(b, c, d, a, k[7], 22, -45705983);
    a = md5ff(a, b, c, d, k[8], 7, 1770035416);
    d = md5ff(d, a, b, c, k[9], 12, -1958414417);
    c = md5ff(c, d, a, b, k[10], 17, -42063);
    b = md5ff(b, c, d, a, k[11], 22, -1990404162);
    a = md5ff(a, b, c, d, k[12], 7, 1804603682);
    d = md5ff(d, a, b, c, k[13], 12, -40341101);
    c = md5ff(c, d, a, b, k[14], 17, -1502002290);
    b = md5ff(b, c, d, a, k[15], 22, 1236535329);

    a = md5gg(a, b, c, d, k[1], 5, -165796510);
    d = md5gg(d, a, b, c, k[6], 9, -1069501632);
    c = md5gg(c, d, a, b, k[11], 14, 643717713);
    b = md5gg(b, c, d, a, k[0], 20, -373897302);
    a = md5gg(a, b, c, d, k[5], 5, -701558691);
    d = md5gg(d, a, b, c, k[10], 9, 38016083);
    c = md5gg(c, d, a, b, k[15], 14, -660478335);
    b = md5gg(b, c, d, a, k[4], 20, -405537848);
    a = md5gg(a, b, c, d, k[9], 5, 568446438);
    d = md5gg(d, a, b, c, k[14], 9, -1019803690);
    c = md5gg(c, d, a, b, k[3], 14, -187363961);
    b = md5gg(b, c, d, a, k[8], 20, 1163531501);
    a = md5gg(a, b, c, d, k[13], 5, -1444681467);
    d = md5gg(d, a, b, c, k[2], 9, -51403784);
    c = md5gg(c, d, a, b, k[7], 14, 1735328473);
    b = md5gg(b, c, d, a, k[12], 20, -1926607734);

    a = md5hh(a, b, c, d, k[5], 4, -378558);
    d = md5hh(d, a, b, c, k[8], 11, -2022574463);
    c = md5hh(c, d, a, b, k[11], 16, 1839030562);
    b = md5hh(b, c, d, a, k[14], 23, -35309556);
    a = md5hh(a, b, c, d, k[1], 4, -1530992060);
    d = md5hh(d, a, b, c, k[4], 11, 1272893353);
    c = md5hh(c, d, a, b, k[7], 16, -155497632);
    b = md5hh(b, c, d, a, k[10], 23, -1094730640);
    a = md5hh(a, b, c, d, k[13], 4, 681279174);
    d = md5hh(d, a, b, c, k[0], 11, -358537222);
    c = md5hh(c, d, a, b, k[3], 16, -722521979);
    b = md5hh(b, c, d, a, k[6], 23, 76029189);
    a = md5hh(a, b, c, d, k[9], 4, -640364487);
    d = md5hh(d, a, b, c, k[12], 11, -421815835);
    c = md5hh(c, d, a, b, k[15], 16, 530742520);
    b = md5hh(b, c, d, a, k[2], 23, -995338651);

    a = md5ii(a, b, c, d, k[0], 6, -198630844);
    d = md5ii(d, a, b, c, k[7], 10, 1126891415);
    c = md5ii(c, d, a, b, k[14], 15, -1416354905);
    b = md5ii(b, c, d, a, k[5], 21, -57434055);
    a = md5ii(a, b, c, d, k[12], 6, 1700485571);
    d = md5ii(d, a, b, c, k[3], 10, -1894986606);
    c = md5ii(c, d, a, b, k[10], 15, -1051523);
    b = md5ii(b, c, d, a, k[1], 21, -2054922799);
    a = md5ii(a, b, c, d, k[8], 6, 1873313359);
    d = md5ii(d, a, b, c, k[15], 10, -30611744);
    c = md5ii(c, d, a, b, k[6], 15, -1560198380);
    b = md5ii(b, c, d, a, k[13], 21, 1309151649);
    a = md5ii(a, b, c, d, k[4], 6, -145523070);
    d = md5ii(d, a, b, c, k[11], 10, -1120210379);
    c = md5ii(c, d, a, b, k[2], 15, 718787259);
    b = md5ii(b, c, d, a, k[9], 21, -343485551);
    /* eslint-enable prettier/prettier */
    x[0] = safeAdd(a, x[0]);
    x[1] = safeAdd(b, x[1]);
    x[2] = safeAdd(c, x[2]);
    x[3] = safeAdd(d, x[3]);
  }

  function md5blk(s) {
    const md5blks = [];
    for (let i = 0; i < 64; i += 4) {
      md5blks[i >> 2] =
        s.charCodeAt(i) + (s.charCodeAt(i + 1) << 8) +
        (s.charCodeAt(i + 2) << 16) + (s.charCodeAt(i + 3) << 24);
    }
    return md5blks;
  }

  function rhex(n) {
    let s = '';
    for (let j = 0; j < 4; j++) {
      s += ((n >> (j * 8 + 4)) & 0x0f).toString(16) + ((n >> (j * 8)) & 0x0f).toString(16);
    }
    return s;
  }

  /** UTF-8 编码为二进制字符串（不依赖已废弃的 unescape，service worker 安全） */
  function toUtf8Binary(str) {
    const s = String(str);
    const out = [];
    for (let i = 0; i < s.length; i++) {
      const code = s.codePointAt(i);
      if (code > 0xffff) i++; // 跳过代理对低位
      if (code < 0x80) {
        out.push(code);
      } else if (code < 0x800) {
        out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
      } else if (code < 0x10000) {
        out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
      } else {
        out.push(
          0xf0 | (code >> 18),
          0x80 | ((code >> 12) & 0x3f),
          0x80 | ((code >> 6) & 0x3f),
          0x80 | (code & 0x3f)
        );
      }
    }
    return out.map((b) => String.fromCharCode(b)).join('');
  }

  function md5(str) {
    // 先做 UTF-8 编码，支持中文
    const x = md51(toUtf8Binary(str));
    return rhex(x[0]) + rhex(x[1]) + rhex(x[2]) + rhex(x[3]);
  }

  /* ---------------- wbi 签名 ---------------- */
  /** 官方 mixinKeyEncTab 重排表 */
  const MIXIN_KEY_ENC_TAB = [
    46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49,
    33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40,
    61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11,
    36, 20, 34, 44, 52,
  ];

  function getMixinKey(orig) {
    return MIXIN_KEY_ENC_TAB.map((n) => orig[n]).join('').slice(0, 32);
  }

  /**
   * 生成 wbi 签名 query（不含起始 '?'）。
   * @param {object} params 业务参数
   * @param {string} imgKey /x/web-interface/nav → wbi_img.img_url 文件名（去扩展名）
   * @param {string} subKey wbi_img.sub_url 文件名（去扩展名）
   */
  function encWbi(params, imgKey, subKey) {
    const mixinKey = getMixinKey(imgKey + subKey);
    const wts = Math.round(Date.now() / 1000);
    const chrFilter = /[!'()*]/g;
    const sorted = Object.keys(params)
      .sort()
      .map((key) => {
        const value = String(params[key]).replace(chrFilter, '');
        return encodeURIComponent(key) + '=' + encodeURIComponent(value);
      });
    const query = sorted.join('&');
    // wts 参与排序拼接：按 key 排序后 wts 恰好排在 w_rid 之前、绝大多数业务 key 之后
    const full = query + '&wts=' + wts;
    const wRid = md5(full + mixinKey);
    return full + '&w_rid=' + wRid;
  }

  /** 从 nav 接口 wbi_img.img_url/sub_url 提取 key（文件名去扩展名） */
  function extractKey(url) {
    const m = /[0-9a-f]{32}\.(png|jpg|jpeg|gif|webp)$/i.exec(String(url || ''));
    return m ? m[0].replace(/\.[a-z]+$/i, '') : '';
  }

  TU.wbi = { md5, encWbi, getMixinKey, extractKey };
})();
