/**
 * lib/defaults.js
 * 默认词库、分区常量、storage schema 定义。
 * 供 background.js（importScripts）与 content 侧（content_scripts 注入）共用。
 */
(function () {
  'use strict';
  const TU = (globalThis.TU = globalThis.TU || {});

  /** 设置项默认值（见计划书 §7，按实测反馈修订） */
  const DEFAULT_SETTINGS = {
    enabled: true,     // 总开关
    strictMode: true,  // 严格白名单档（默认）/ 宽松档
    // 首页拉流开关（默认开，按实测反馈修订）：开启时隐藏原生瀑布流，替换为自建青少年聚合流
    // （白名单UP投稿 + 分区排行榜精选，紧凑无空白）；关闭则保留B站原生流仅由 DOM 过滤引擎净化
    teenFeed: true,
    // 注：直播全站拦截为强制行为（计划书决策 4），不设开关，仅受 enabled 总开关控制
  };

  /** 黑名单关键词（计划书 §8.1；"模拟器"存疑不入默认名单） */
  const KEYWORDS_BLACKLIST = [
    // 游戏类
    '游戏', '手游', '网游', '王者', '吃鸡', '原神', '明日方舟', '蛋仔派对',
    '第五人格', '我的世界', '塞尔达', 'Switch', 'PS5', 'Steam', '电竞',
    '开黑', '上分', '排位', '抽卡', '氪金',
    // 暴力恐怖灵异类
    '暴力', '血腥', '恐怖', '惊悚', '灵异', '鬼', '丧尸', '僵尸', '凶杀',
    '命案', '细思极恐', '都市怪谈', '克苏鲁', '未解之谜', '致郁',
    // 直播低俗类
    '直播', '开播', '主播', '福利', '擦边', '黑丝', '福利姬', 'asmr',
  ];

  /** 白名单关键词（计划书 §8.2） */
  const KEYWORDS_WHITELIST = [
    '历史', '地理', '科普', '知识', '纪录片', '英语', '文学', '语文', '诗词',
    '古诗词', '名著', '物理', '化学', '生物', '数学', '天文', '宇宙', '航天',
    '恐龙', '动物', '自然', '海洋', '百科', '启蒙', '少儿', '动画', '国学',
    '成语', '典故', '考古', '博物馆', '文明', '地图', '科学', '实验', '手工',
    '教育', '学习', '编程', '航天航空', '自然科学',
  ];

  /** 分区 tid 黑名单（计划书 §8.3；138 搞笑/5 娱乐/181 影视剪辑可选、默认不启用） */
  const TID_BLACKLIST = [4, 171, 172, 65, 121, 119];
  /** 分区 tid 白名单：36 知识、177 纪录片（动画区 1 不整区白名单） */
  const TID_WHITELIST = [36, 177];

  /** 分区名称表（options 展示与日志说明用；实施首日可用 API 探针校准） */
  const TID_NAMES = {
    1: '动画', 4: '游戏', 5: '娱乐', 11: '电视剧', 13: '番剧', 23: '电影',
    21: 'MAD·AMV', 25: 'MMD·3D', 27: '综合动画', 36: '知识', 65: '网络游戏',
    119: '鬼畜', 121: '单机游戏', 138: '搞笑', 160: '生活', 168: '国创相关',
    169: '数码', 171: '电子竞技', 172: '手机游戏', 177: '纪录片',
    181: '影视', 188: '科普', 201: '科学科普', 202: '社科·法律·心理',
    203: '人文历史', 204: '财经商业', 205: '校园学习', 206: '野生技术协会',
    207: '职业职场', 217: '动物圈', 223: '汽车', 234: '运动',
  };

  /** 可选附加黑名单分区（options 中展示为可选，默认未勾选） */
  const TID_BLACKLIST_OPTIONAL = [138, 5, 181];

  /** 白名单 UP 种子：默认不预置（实测反馈：不需要默认值，白名单完全由家长自行导入） */
  const UP_SEEDS = [];

  function nowSec() {
    return Math.floor(Date.now() / 1000);
  }

  function makeUpEntry(name, mid, face) {
    return { name: String(name).trim(), mid: mid || undefined, face: face || undefined, addedAt: nowSec() };
  }

  /** 全量默认配置（深拷贝返回） */
  function defaultConfig() {
    return {
      settings: { ...DEFAULT_SETTINGS },
      keywordsBlacklist: KEYWORDS_BLACKLIST.slice(),
      keywordsWhitelist: KEYWORDS_WHITELIST.slice(),
      upWhitelist: UP_SEEDS.map((n) => makeUpEntry(n)), // 默认空，首次使用由家长导入
      upBlacklist: [],
      tidBlacklist: TID_BLACKLIST.slice(),
      tidWhitelist: TID_WHITELIST.slice(),
      cache: { bvVerdict: {} },
      blockedLog: [],
    };
  }

  /** storage.local 中用到的顶层键 */
  const STORAGE_KEYS = [
    'settings', 'keywordsBlacklist', 'keywordsWhitelist', 'upWhitelist',
    'upBlacklist', 'tidBlacklist', 'tidWhitelist', 'cache', 'blockedLog',
  ];

  TU.defaults = {
    DEFAULT_SETTINGS,
    KEYWORDS_BLACKLIST,
    KEYWORDS_WHITELIST,
    TID_BLACKLIST,
    TID_BLACKLIST_OPTIONAL,
    TID_WHITELIST,
    TID_NAMES,
    UP_SEEDS,
    STORAGE_KEYS,
    defaultConfig,
    makeUpEntry,
    nowSec,
  };
})();
