/**
 * 管理员版本配置 — 出厂默认值
 * 当后端无 version_config 数据时，管理员编辑器用此数据预填充
 */

// 游戏王 — 罕贵度默认列表
export const FACTORY_RARITIES_YUGIOH = [
  '20SER', 'QCSER', 'PSER', 'HR', 'HPR', 'ESR', 'ESPR', 'SER',
  'SEMR', 'SEPR', 'PR', 'UPR', 'PGR', 'GSER', 'GMR', 'GR',
  'UTR', 'CR', 'UR', 'RR', 'USR', 'UMR', 'SR', 'SPR',
  'NPR', 'NMR', 'NKC', 'R', 'RKC', 'RPR', 'N', 'NR'
]

// 宝可梦 — 罕贵度默认列表
export const FACTORY_RARITIES_POKEMON = [
  'UR', 'HR', 'SR', 'SSR', 'AR', 'CHR', 'CSR', 'SAR',
  'R', 'U', 'C', 'PR', 'S', 'ACE', 'RR', 'K'
]

// 通用品相默认列表
export const FACTORY_GRADES = [
  { name: '99品', desc: '完美全新', hasSub: false },
  { name: '9品', desc: '近新优品', hasSub: false },
  { name: '78品', desc: '标准流通', hasSub: false },
  { name: '56品', desc: '中小瑕疵', hasSub: false },
  { name: '34品', desc: '重大次品', hasSub: false },
  { name: '评级卡', desc: '', hasSub: true },
  { name: '自定义', desc: '', hasSub: true }
]

// 默认罕贵度
export const FACTORY_DEFAULT_RARITY = 'SR'

// 默认品相
export const FACTORY_DEFAULT_GRADE = '78品'

/**
 * 根据版本名称判断卡牌类型，返回对应的出厂默认配置
 */
export const getFactoryDefaults = (versionName) => {
  const isPokemon = versionName && (
    versionName.includes('宝可梦') || versionName.toLowerCase().includes('pokemon')
  )
  return {
    rarities: isPokemon ? [...FACTORY_RARITIES_POKEMON] : [...FACTORY_RARITIES_YUGIOH],
    grades: FACTORY_GRADES.map(g => ({ ...g })),
    defaultRarity: FACTORY_DEFAULT_RARITY,
    defaultGrade: FACTORY_DEFAULT_GRADE
  }
}
