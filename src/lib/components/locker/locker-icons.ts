/**
 * 储物柜/抽屉图标目录：引用 static/ 下三组 SVG 素材（rarities / runes / types）。
 * DB 中 icon 存完整静态路径（如 /runes/red.svg），为空时显示默认 favicon。
 */

export const DEFAULT_LOCKER_ICON = '/favicon.png'

export const LOCKER_ICON_CATEGORIES = ['rarities', 'runes', 'types'] as const
export type LockerIconCategory = (typeof LOCKER_ICON_CATEGORIES)[number]

export interface LockerIconOption {
  /** 唯一键（`rarities/Common`、`runes/red`…），用于 each 的 key */
  value: string
  /** 显示名（去掉扩展名） */
  label: string
  /** 静态资源路径 */
  src: string
  category: LockerIconCategory
}

const rarities = ['Common', 'Uncommon', 'Rare', 'Epic', 'OverNumbered']
const runes = ['red', 'orange', 'yellow', 'green', 'blue', 'purple']
const types = ['Unit', 'ChampionUnit', 'Spell', 'Gear', 'Rune', 'Battlefield', 'Legend']

function build(category: LockerIconCategory, names: string[]): LockerIconOption[] {
  return names.map((name) => ({
    value: `${category}/${name}`,
    label: name,
    src: `/${category}/${name}.svg`,
    category,
  }))
}

export const LOCKER_ICONS: LockerIconOption[] = [
  ...build('rarities', rarities),
  ...build('runes', runes),
  ...build('types', types),
]

/** 已登记图标路径集合，用于校验存储值是否仍有效 */
const KNOWN_PATHS = new Set(LOCKER_ICONS.map((i) => i.src))

/** 解析图标路径：未知/空值回退到默认 favicon */
export function resolveLockerIcon(icon: string | null | undefined): string {
  if (icon && KNOWN_PATHS.has(icon)) return icon
  return DEFAULT_LOCKER_ICON
}
