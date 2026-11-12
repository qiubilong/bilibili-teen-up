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
    strictMode: true,  // 严格白名单档（默认）/ 宽松档（仅黑名单）
    // 注：直播全站拦截为强制行为（计划书决策 4），不设开关，仅受 enabled 总开关控制
    // 注：首页不再替换为自建流（已废弃）：保留B站原生推荐流，被拦卡片用知识卡遮罩覆盖
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

  /** 知识卡内容库：被拦卡片的遮罩上展示（小学英语单词 / 成语 / 小知识），
      保留原生布局无空白的同时把屏蔽位变成学习位 */
  const KNOWLEDGE_CARDS = [
    // 小学英语核心词（word: 英文 / phon: 音标 / zh: 中文）
    { type: 'word', word: 'apple', phon: '/ˈæpl/', zh: 'n. 苹果' },
    { type: 'word', word: 'book', phon: '/bʊk/', zh: 'n. 书；书本' },
    { type: 'word', word: 'cat', phon: '/kæt/', zh: 'n. 猫' },
    { type: 'word', word: 'dog', phon: '/dɒɡ/', zh: 'n. 狗' },
    { type: 'word', word: 'egg', phon: '/eɡ/', zh: 'n. 鸡蛋' },
    { type: 'word', word: 'fish', phon: '/fɪʃ/', zh: 'n. 鱼' },
    { type: 'word', word: 'girl', phon: '/ɡɜːl/', zh: 'n. 女孩' },
    { type: 'word', word: 'hand', phon: '/hænd/', zh: 'n. 手' },
    { type: 'word', word: 'kite', phon: '/kaɪt/', zh: 'n. 风筝' },
    { type: 'word', word: 'lion', phon: '/ˈlaɪən/', zh: 'n. 狮子' },
    { type: 'word', word: 'milk', phon: '/mɪlk/', zh: 'n. 牛奶' },
    { type: 'word', word: 'nose', phon: '/nəʊz/', zh: 'n. 鼻子' },
    { type: 'word', word: 'orange', phon: '/ˈɒrɪndʒ/', zh: 'n. 橙子；橘色' },
    { type: 'word', word: 'pig', phon: '/pɪɡ/', zh: 'n. 猪' },
    { type: 'word', word: 'run', phon: '/rʌn/', zh: 'v. 跑；跑步' },
    { type: 'word', word: 'sun', phon: '/sʌn/', zh: 'n. 太阳' },
    { type: 'word', word: 'tree', phon: '/triː/', zh: 'n. 树' },
    { type: 'word', word: 'water', phon: '/ˈwɔːtə/', zh: 'n. 水' },
    { type: 'word', word: 'yellow', phon: '/ˈjeləʊ/', zh: 'adj. 黄色的' },
    { type: 'word', word: 'zoo', phon: '/zuː/', zh: 'n. 动物园' },
    { type: 'word', word: 'happy', phon: '/ˈhæpi/', zh: 'adj. 快乐的' },
    { type: 'word', word: 'family', phon: '/ˈfæməli/', zh: 'n. 家庭；家人' },
    { type: 'word', word: 'school', phon: '/skuːl/', zh: 'n. 学校' },
    { type: 'word', word: 'friend', phon: '/frend/', zh: 'n. 朋友' },
    { type: 'word', word: 'teacher', phon: '/ˈtiːtʃə/', zh: 'n. 老师' },
    { type: 'word', word: 'student', phon: '/ˈstjuːdnt/', zh: 'n. 学生' },
    { type: 'word', word: 'morning', phon: '/ˈmɔːnɪŋ/', zh: 'n. 早晨；上午' },
    { type: 'word', word: 'spring', phon: '/sprɪŋ/', zh: 'n. 春天；泉水' },
    { type: 'word', word: 'winter', phon: '/ˈwɪntə/', zh: 'n. 冬天' },
    { type: 'word', word: 'rain', phon: '/reɪn/', zh: 'n. 雨 v. 下雨' },
    { type: 'word', word: 'snow', phon: '/snəʊ/', zh: 'n. 雪 v. 下雪' },
    { type: 'word', word: 'star', phon: '/stɑː/', zh: 'n. 星星；明星' },
    { type: 'word', word: 'moon', phon: '/muːn/', zh: 'n. 月亮' },
    { type: 'word', word: 'river', phon: '/ˈrɪvə/', zh: 'n. 河流' },
    { type: 'word', word: 'mountain', phon: '/ˈmaʊntən/', zh: 'n. 山；山脉' },
    { type: 'word', word: 'flower', phon: '/ˈflaʊə/', zh: 'n. 花' },
    // 小学常见成语（text: 成语 / mean: 释义）
    { type: 'idiom', text: '画蛇添足', mean: '做了多余的事，反而得不偿失' },
    { type: 'idiom', text: '守株待兔', mean: '不主动努力，妄想靠运气获得成功' },
    { type: 'idiom', text: '亡羊补牢', mean: '出了问题及时补救，还不算晚' },
    { type: 'idiom', text: '掩耳盗铃', mean: '自己欺骗自己，明明掩盖不住偏要掩盖' },
    { type: 'idiom', text: '拔苗助长', mean: '急于求成，反而把事情弄坏' },
    { type: 'idiom', text: '狐假虎威', mean: '借着别人的威势吓唬人' },
    { type: 'idiom', text: '井底之蛙', mean: '眼界狭小、见识短浅的人' },
    { type: 'idiom', text: '刻舟求剑', mean: '拘泥成例，不知随情势变化' },
    { type: 'idiom', text: '自相矛盾', mean: '言行前后抵触，不能自圆其说' },
    { type: 'idiom', text: '滥竽充数', mean: '没本领的人混在行家里充数' },
    { type: 'idiom', text: '买椟还珠', mean: '舍本逐末，取舍不当' },
    { type: 'idiom', text: '南辕北辙', mean: '行动与目的相反，越高越远' },
    { type: 'idiom', text: '对牛弹琴', mean: '对不懂道理的人讲道理，白费口舌' },
    { type: 'idiom', text: '画龙点睛', mean: '在关键处加上一笔，使内容更生动传神' },
    { type: 'idiom', text: '胸有成竹', mean: '做事之前已有通盘考虑' },
    { type: 'idiom', text: '熟能生巧', mean: '熟练了就能找到窍门' },
    { type: 'idiom', text: '滴水穿石', mean: '坚持不懈，事久必成' },
    { type: 'idiom', text: '凿壁偷光', mean: '家境贫寒仍刻苦学习' },
    { type: 'idiom', text: '叶公好龙', mean: '表面爱好某事物，实际并非真正爱好' },
    { type: 'idiom', text: '杯弓蛇影', mean: '疑神疑鬼，自相惊扰' },
    // 小知识（fact: 一句话知识点）
    { type: 'fact', text: '地球绕太阳公转一周约 365 天，这就是一年。' },
    { type: 'fact', text: '光速约每秒 30 万公里，是宇宙中最快的速度。' },
    { type: 'fact', text: '人体最大的器官是皮肤。' },
    { type: 'fact', text: '竹子其实是草本植物，不是树。' },
    { type: 'fact', text: '彩虹有红、橙、黄、绿、蓝、靛、紫七种颜色。' },
    { type: 'fact', text: '中国最长的河流是长江，全长约 6300 公里。' },
    { type: 'fact', text: '标准大气压下，水的沸点是 100 摄氏度。' },
    { type: 'fact', text: '大熊猫每天要花 10 小时以上吃竹子。' },
    { type: 'fact', text: '企鹅主要生活在南半球，不会飞但擅长游泳。' },
    { type: 'fact', text: '昆虫都有 6 条腿，蜘蛛 8 条腿不是昆虫。' },
    { type: 'fact', text: '鲨鱼在地球上已生活超过 4 亿年，比恐龙还早。' },
    { type: 'fact', text: '长城总长超过 2 万公里，是世界文化遗产。' },
    { type: 'fact', text: '蜜蜂通过跳“8字舞”告诉同伴花蜜的位置。' },
    { type: 'fact', text: '章鱼有 3 颗心脏和蓝色的血液。' },
    { type: 'fact', text: '树的年轮一圈代表一年，数年轮能知树龄。' },
    { type: 'fact', text: '一年有 24 个节气，是古人观察太阳得出的。' },
    { type: 'fact', text: '月晕而风，础润而雨：自然现象常能预示天气变化。' },
    { type: 'fact', text: '人体共有 206 块骨头，婴儿出生时约有 300 块。' },
    { type: 'fact', text: '骆驼的驼峰储存的是脂肪，不是水。' },
    { type: 'fact', text: '缘木求鱼：方向不对，再努力也达不到目的。' },
  ];

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
    KNOWLEDGE_CARDS,
    STORAGE_KEYS,
    defaultConfig,
    makeUpEntry,
    nowSec,
  };
})();
