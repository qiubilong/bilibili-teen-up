/**
 * 冒烟测试：判定链 + MD5 + wbi 重排（node smoke-test.js，跑完即删）
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ctx = { console };
vm.createContext(ctx);
for (const f of ['lib/defaults.js', 'lib/judge.js', 'lib/wbi.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, f), 'utf8'), ctx, { filename: f });
}
const { TU } = ctx;
let failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a === b) console.log('PASS', name);
  else { failed++; console.log('FAIL', name, '=>', a, 'expect', b); }
}

/* ---- MD5 已知值 ---- */
eq(TU.wbi.md5('hello'), '5d41402abc4b2a76b9719d911017c592', 'md5(hello)');
eq(TU.wbi.md5('abc'), '900150983cd24fb0d6963f7d28e17f72', 'md5(abc)');
eq(TU.wbi.md5('你好'), '7eca689f0d3389d9dea66ae112e5cfd7', 'md5(你好/utf8)');

/* ---- wbi mixin key 重排（官方表，32 位截断） ---- */
const orig = 'abcdefghijklmnopqrstuvwxyzabcdef'; // 32 字符
eq(TU.wbi.getMixinKey(orig).length, 32, 'mixinKey 长度 32');
eq(TU.wbi.extractKey('https://i0.hdslb.com/bfs/wbi/7cd084941338484aae1ad9425b84077c.png'), '7cd084941338484aae1ad9425b84077c', 'extractKey');

/* ---- 判定链（白名单 UP 测试名单自建，不依赖默认种子——种子已改为不预置） ---- */
const cfg = TU.defaults.defaultConfig();
cfg.upWhitelist = [TU.defaults.makeUpEntry('李永乐老师')]; // 无 mid：名称匹配路径（有 mid 会在卡片无 upMid 时触发重名防护）
const jcfg = TU.judge.buildJudgeConfig(cfg);

eq(TU.judge.judgeCard({ title: '王者荣耀五杀集锦', upName: '路人', tid: 172 }, jcfg), { verdict: 'block', reason: 'black-word:王者' }, '黑词拦截');
eq(TU.judge.judgeCard({ title: '今天天气真好', upName: '王者解说君' }, jcfg), { verdict: 'block', reason: 'black-word:王者' }, 'UP名命中黑词拦截');
eq(TU.judge.judgeCard({ title: '今天天气真好', upName: '王者解说君', upMid: 2 }, TU.judge.buildJudgeConfig({ ...cfg, upWhitelist: [...(cfg.upWhitelist || []), TU.defaults.makeUpEntry('王者解说君', 2)] })).verdict, 'block', 'UP名黑词优先于白UP名单');
eq(TU.judge.judgeCard({ title: '原神3.0', upName: '李永乐老师', upMid: 1 }, jcfg).verdict, 'block', '白名单UP发黑词仍拦（兜底）');
eq(TU.judge.judgeCard({ title: '随便什么标题', upName: '李永乐老师', upMid: 1 }, jcfg), { verdict: 'pass', reason: 'white-up' }, '白名单UP放行');
eq(TU.judge.judgeCard({ title: '随便什么标题', upName: '李永乐老师' }, jcfg).verdict, 'pass', '白名单UP名称全等匹配');
eq(TU.judge.judgeCard({ title: '一堂物理课', upName: '陌生人' }, jcfg), { verdict: 'pass', reason: 'white-word:物理' }, '白词放行');
eq(TU.judge.judgeCard({ title: '随便', upName: '陌生人', tid: 36 }, jcfg), { verdict: 'pass', reason: 'white-tid:36' }, '白tid放行');
eq(TU.judge.judgeCard({ title: '随便什么内容', upName: '陌生人', tid: 21 }, jcfg), { verdict: 'strict-hide', reason: 'strict' }, '严格档中间地带隐藏');
eq(TU.judge.judgeCard({ title: '日常生活vlog', upName: '陌生人', tid: 160 }, TU.judge.buildJudgeConfig({ ...cfg, settings: { ...cfg.settings, strictMode: false } })), { verdict: 'pass', reason: 'loose' }, '宽松档中间地带放行');
eq(TU.judge.judgeCard({ title: '标题正常', upName: 'x', tid: 4 }, jcfg).verdict, 'block', '黑tid拦截');
eq(TU.judge.judgeCard({ title: '夏季联赛', upName: 'x', isLive: true }, jcfg).verdict, 'block', '直播卡片拦截');
eq(TU.judge.judgeCard({ title: '直播', upName: '李永乐老师' }, jcfg).verdict, 'block', '黑词"直播"优先于白UP');
eq(TU.judge.judgeCard({ title: '鬼斧神工的工艺', upName: 'x' }, jcfg).verdict, 'block', '单字黑词"鬼"包含匹配');
eq(TU.judge.judgeCard({ title: '正则测试ABC123', upName: 'x' }, TU.judge.buildJudgeConfig({ ...cfg, keywordsBlacklist: ['/abc\\d+/i'] })).verdict, 'block', '正则条目黑词');
eq(TU.judge.judgeCard({ title: '无效正则[', upName: 'x' }, TU.judge.buildJudgeConfig({ ...cfg, keywordsBlacklist: ['/[/x', '无效正则'] })).verdict, 'block', '无效正则降级文本');

/* ---- UP 名单匹配 ---- */
eq(TU.judge.matchUp([{ name: 'A', mid: 100 }, { name: 'B' }], 'B', null), { name: 'B' }, '名称全等匹配');
eq(TU.judge.matchUp([{ name: 'A', mid: 100 }], 'C', 100), { name: 'A', mid: 100 }, 'mid 精确匹配');
eq(TU.judge.matchUp([{ name: 'A', mid: 100 }], 'A', 999), null, '名称相同mid不同不匹配（重名防护）');

/* ---- UP 名称解析（与 options.js 同规则，模拟验证） ---- */
function parseNames(text) {
  const out = []; const seen = new Set();
  String(text || '').split(/[\r\n,，、;；\t]+/).map((s) => s.trim()).filter(Boolean)
    .forEach((n) => { if (!seen.has(n)) { seen.add(n); out.push(n); } });
  return out;
}
eq(parseNames('宝宝巴士，凯叔讲故事、李永乐老师\n\n 星球研究所\t历史调研室；, ,沙盘上的战争 '), ['宝宝巴士', '凯叔讲故事', '李永乐老师', '星球研究所', '历史调研室', '沙盘上的战争'], '分隔符解析（含空格保留）');

console.log(failed === 0 ? '\nALL PASSED' : '\n' + failed + ' FAILED');
process.exit(failed === 0 ? 0 : 1);
