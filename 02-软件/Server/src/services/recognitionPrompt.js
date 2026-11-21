/**
 * 识别提示词方案（可选可切换）
 *
 * 配置存在 Storage/recognition-prompts.json —— 该目录不在 .gitignore 里，
 * 关服务时 autoGitSave 会自动提交，所以改动能被 git 追踪。
 *
 * 结构：按版本（versionId）分组，每个版本各有一套方案、各有一个"当前启用"。
 * 文案里的 {lang} 占位符会按该版本的语言替换成 JP / SC / EN / TC / KR。
 *
 * 找不到分组的版本（如宝可梦）→ 回退到内置的老逻辑，保证不会识别不了。
 */
const fs = require('fs');
const path = require('path');

const CONFIG_PATH = process.env.RECOGNITION_PROMPT_PATH
  || path.join(__dirname, '../../../Storage/recognition-prompts.json');

// 版本 lang（中文）→ 卡面语种码
const LANG_CODE = { '日文': 'JP', '英文': 'EN', '中文': 'SC', '简中': 'SC', '繁中': 'TC', '韩文': 'KR' };

// 认不出来时的暗号（每套方案的正文都带上这一段）
const FAIL_TAIL = '如果无法识别或不确定卡牌编号，请只返回 FAIL 这4个英文字母，不要返回其他任何内容。';

// ── 出厂文案 ──
// 系统默认（= 改造前线上在跑的那段，只把写死的 JP 换成 {lang}）
const SYS_DEFAULT_YUGIOH = '识别游戏王卡牌编号：前缀为2-4位字母数字，中间横杠分隔，搭配{lang}等两位语种代码，后缀为字母+数字组合，只提取该格式编号，忽略卡牌所有文字、效果、杂码。拍摄对焦卡牌底部小字，画面清晰无遮挡，仅输出识别出的编号，不要任何多余内容。如QCAC-{lang}001';

// 新版：覆盖 PH / DL / 20TH 等形态（语种码可有可无、末段位数不固定、末段可能带字母）
const V2_YUGIOH = '识别游戏王卡牌编号：编号印在卡牌底部小字处，请重点看那里，画面清晰无遮挡。编号为「前缀-末段」或「前缀-语种码-末段」，中间用横杠分隔：前缀是2-4位字母或数字（如DL1、EE2、PH、QCAC、20TH）；语种码可有可无，有的话是{lang}这类两位大写字母，老卡牌没有语种码；末段是数字，或一个字母加数字，位数不固定。只提取该格式的编号，忽略卡牌所有文字、效果、卡密等杂码。严格照卡面上印的原样输出：卡面上有几个前导零就写几个零（印的是 DL1-000 就写 DL1-000，不要缩写成 DL1-00 或 DL1-0），不要增减位数、不要自己加语种码。仅输出识别出的编号，不要任何多余内容。例如：PH-01、DL1-044、EE2-JP021、20TH-JPS01、PHNI-JP000';

const SYS_DEFAULT_NOTE = '要求 AI 找「前缀-两位语种码-字母数字」格式的编号，只认 JP 这种两位语种码，末尾是字母数字组合。认不出来就返回 FAIL。';
const V2_NOTE = '明确说了「语种码可有可无」（PH-01 就没有）、「末段位数按卡面实际」（2位/3位都行）、「末段可能有字母」（S01）、「前导零照抄不缩写」（DL1-000 别写成 DL1-00）。并给了几个覆盖各种形态的例子，让 AI 照葫芦画瓢。';

// 出厂默认配置（文件不存在时自播种）
function seedConfig() {
  const mk = (name, family, lang, prompts) => ({ name, family, lang, prompts });
  const sysDefault = () => ({
    id: 'sys-default', name: '系统默认', builtin: true,
    text: SYS_DEFAULT_YUGIOH + ' ' + FAIL_TAIL, note: SYS_DEFAULT_NOTE,
  });
  const v2 = () => ({
    id: 'v2-coverage', name: '覆盖 PH / 20TH 形态',
    text: V2_YUGIOH + ' ' + FAIL_TAIL, note: V2_NOTE,
  });
  return {
    _说明: '识别提示词方案。text 里的 {lang} 会按该版本语言替换成 JP/SC/EN/TC/KR。builtin 的方案是基线，不建议删。',
    active: { '1': 'sys-default', '2': 'sys-default', '3': 'sys-default' },
    versions: {
      '1': mk('游戏王日文', '游戏王', 'JP', [sysDefault(), v2()]),
      '2': mk('游戏王简中', '游戏王', 'SC', [sysDefault()]),
      '3': mk('游戏王英文', '游戏王', 'EN', [sysDefault()]),
    },
  };
}

// ── 读写 ──
let _cache = null;
let _cacheTime = 0;
const CACHE_TTL = 2000; // 2 秒，避免识别时每次读盘

function loadConfig({ force = false } = {}) {
  const now = Date.now();
  if (!force && _cache && (now - _cacheTime) < CACHE_TTL) return _cache;
  try {
    if (!fs.existsSync(CONFIG_PATH)) {
      const seeded = seedConfig();
      fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(seeded, null, 2), 'utf-8');
      console.log('[提示词] 首次生成配置文件:', CONFIG_PATH);
      _cache = seeded;
    } else {
      _cache = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    }
  } catch (e) {
    console.error('[提示词] 读配置失败，改用内置默认:', e.message);
    _cache = seedConfig();
  }
  // 结构兜底
  if (!_cache.versions || typeof _cache.versions !== 'object') _cache.versions = {};
  if (!_cache.active || typeof _cache.active !== 'object') _cache.active = {};
  _cacheTime = now;
  return _cache;
}

function saveConfig(cfg) {
  cfg._上次修改 = new Date().toISOString();
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf-8');
  _cache = cfg;
  _cacheTime = Date.now();
  return cfg;
}

// ── 查找 ──
/** 先按 versionId 找，找不到再按版本名找（防 versionId 变动） */
function findGroup(cfg, versionId, versionName) {
  const key = String(versionId == null ? '' : versionId);
  if (cfg.versions[key]) return { key, group: cfg.versions[key] };
  if (versionName) {
    for (const [k, g] of Object.entries(cfg.versions)) {
      if (g && g.name === versionName) return { key: k, group: g };
    }
  }
  return null;
}

function langOf(group, versionLang) {
  return (group && group.lang) || LANG_CODE[versionLang] || 'JP';
}

/** 把 {lang} 换成实际语种码 */
function render(text, lang) {
  return String(text || '').replace(/\{lang\}/g, lang);
}

/** 内置老逻辑：未分组的版本（宝可梦等）走这里，保证不失能 */
function legacyPrompt(versionName, versionLang) {
  const name = String(versionName || '');
  const lang = LANG_CODE[versionLang] || 'JP';
  if (name.includes('游戏王') || name.toLowerCase().includes('yugioh')) {
    return render(SYS_DEFAULT_YUGIOH, lang) + ' ' + FAIL_TAIL;
  }
  if (name.includes('宝可梦') || name.toLowerCase().includes('pokemon')) {
    return `识别宝可梦卡牌编号：格式为字母数字组合/横杠分隔，搭配${lang}语种标识。拍摄对焦卡牌底部小字，画面清晰无遮挡，仅输出识别出的编号，不要任何多余内容。如SV-${lang}-001 ` + FAIL_TAIL;
  }
  return `识别卡牌编号：提取卡牌上的标准编号格式（前缀字母数字-语种代码${lang}-后缀数字），拍摄对焦卡牌底部小字，画面清晰无遮挡，仅输出识别出的编号，不要任何多余内容。 ` + FAIL_TAIL;
}

/**
 * 取当前生效的方案（识别时用）
 * @param {{versionId?:number|string, versionName?:string, versionLang?:string, promptId?:string}} opts
 *        promptId 用于「批量识别锁定」：整批强制用同一套，不受中途切换影响
 * @returns {{promptKey:string, promptId:string, name:string, text:string, builtin:boolean, fallback:boolean}}
 */
function getActivePrompt(opts = {}) {
  const { versionId, versionName, versionLang, promptId } = opts;
  const cfg = loadConfig();
  const hit = findGroup(cfg, versionId, versionName);

  if (hit && Array.isArray(hit.group.prompts) && hit.group.prompts.length) {
    const list = hit.group.prompts;
    // 锁定优先 → 其次配置里的当前启用 → 再次第一套
    let p = null;
    if (promptId) p = list.find((x) => x.id === promptId) || null;
    if (!p) {
      const actId = cfg.active[hit.key];
      p = list.find((x) => x.id === actId) || list[0];
    }
    if (p) {
      const lang = langOf(hit.group, versionLang);
      return {
        promptKey: hit.key + ':' + p.id,
        promptId: p.id,
        name: p.name || p.id,
        text: render(p.text, lang),
        builtin: !!p.builtin,
        fallback: false,
      };
    }
  }

  // 未分组版本 → 内置兜底
  return {
    promptKey: 'builtin:legacy',
    promptId: 'builtin',
    name: '系统内置（该版本未分组）',
    text: legacyPrompt(versionName, versionLang),
    builtin: true,
    fallback: true,
  };
}

/** 给管理页用：某版本的全部方案 + 当前启用 + 渲染后的原文 */
function getGroupView(opts = {}) {
  const { versionId, versionName, versionLang } = opts;
  const cfg = loadConfig();
  const hit = findGroup(cfg, versionId, versionName);
  if (!hit) {
    return {
      versionId: versionId == null ? null : versionId,
      versionName: versionName || '',
      grouped: false,
      activeId: 'builtin',
      list: [{
        id: 'builtin', name: '系统内置（该版本未分组）', builtin: true,
        text: legacyPrompt(versionName, versionLang),
        note: '这个版本还没建方案，走的是出厂内置逻辑。要给它加方案，跟我说。',
      }],
    };
  }
  const lang = langOf(hit.group, versionLang);
  const activeId = cfg.active[hit.key] || (hit.group.prompts[0] && hit.group.prompts[0].id);
  return {
    versionId: versionId == null ? null : versionId,
    versionKey: hit.key,
    versionName: hit.group.name || versionName || '',
    family: hit.group.family || '',
    lang,
    grouped: true,
    activeId,
    list: hit.group.prompts.map((p) => ({
      id: p.id,
      name: p.name || p.id,
      builtin: !!p.builtin,
      text: render(p.text, lang),
      note: p.note || '',
      active: p.id === activeId,
    })),
  };
}

/** 切换某版本当前启用的方案 */
function setActive(versionId, promptId, versionName) {
  const cfg = loadConfig();
  const hit = findGroup(cfg, versionId, versionName);
  if (!hit) return { ok: false, error: '这个版本还没有方案分组' };
  const p = (hit.group.prompts || []).find((x) => x.id === promptId);
  if (!p) return { ok: false, error: '找不到方案: ' + promptId };
  cfg.active[hit.key] = promptId;
  saveConfig(cfg);
  return { ok: true, versionKey: hit.key, activeId: promptId, name: p.name || promptId };
}

module.exports = {
  CONFIG_PATH,
  LANG_CODE,
  FAIL_TAIL,
  loadConfig,
  saveConfig,
  getActivePrompt,
  getGroupView,
  setActive,
};
