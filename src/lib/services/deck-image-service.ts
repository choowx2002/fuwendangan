import type { DeckCardDetail } from '$lib/db'
import { printCacheName } from '$lib/db/helper'
import type { SortKeyItem } from '$lib/db/types'
import { ZONE_CONFIG } from '$lib/decks/zone'
import { COLOR_ORDER, normalizeColor, parseColorList } from '$lib/cards/utils/cost-curve-utils'
import { get } from 'svelte/store'
import { t } from '$lib/i18n'
import { loadCardImageElement } from './card-image-loader'
import { writeBytesFile } from './db-file-service'

const SCALE = 3
const WIDTH = 1000
const PAD = 24
const HERO_W = 110
const HERO_H = 154
const CARD_W = 96
const CARD_H = 134
const GAP = 12
const COLS_R = 6
const BF_W = 154
const BF_H = 110
const QR_SIZE = 100
const ICON_W = 64
const ICON_H = 36

const SECTION_GAP = 20
const LABEL_H = 30
const RUNE_ICON = 44
const RUNE_GAP = 10
const RUNE_FONT = '600 20px "Noto Sans SC", sans-serif'

/** 左栏（传奇/英雄/符文/战场）宽度：2 张英雄卡 + 间距 */
const LEFT_W = HERO_W * 2 + GAP

export const DECK_IMAGE_SORT_FIELDS = [
  { value: 'card_color_list', label: 'card_color_list', labelKey: 'cards.sortCardColorList' },
  { value: 'power', label: 'power', labelKey: 'cards.sortPower' },
  { value: 'energy', label: 'energy', labelKey: 'cards.sortEnergy' },
  { value: 'return_energy', label: 'return_energy', labelKey: 'cards.sortReturnEnergy' },
  { value: 'print_code', label: 'print_code', labelKey: 'cards.sortCardNo' },
  { value: 'rarity_name', label: 'rarity_name', labelKey: 'cards.sortRarity' },
]

export interface DeckBackground {
  color: string
  imageUrl?: string
  overlay?: number
  maskColor?: string
  /** 背景图缩放倍率（1 = cover 铺满基准） */
  scale?: number
  /** 背景图水平偏移（画布 px，可负） */
  offsetX?: number
  /** 背景图垂直偏移（画布 px，可负） */
  offsetY?: number
}

interface ImgJob {
  key: string
  url: string
  cacheName: string
}

interface RuneItem {
  color: string
  quantity: number
  label: string
  x: number
  y: number
}

interface Theme {
  name: string
  secondary: string
  divider: string
  placeholder: string
  qtyBg: string
  qtyText: string
  runeFallback: string
}

export interface DeckImageOptions {
  deckName?: string
  cards: DeckCardDetail[]
  sortRules: SortKeyItem[]
  background?: DeckBackground
  textColor?: string
  playerName?: string
  /** 标题行是否显示玩家名字 */
  showPlayerName?: boolean
  /** 预生成的卡组二维码 dataURL（右下角显示） */
  qrDataUrl?: string
  onProgress?: (percent: number) => void
}

function isDarkHex(hex: string): boolean {
  const m = hex.replace('#', '')
  const full =
    m.length === 3
      ? m
          .split('')
          .map((c) => c + c)
          .join('')
      : m
  const r = parseInt(full.slice(0, 2), 16)
  const g = parseInt(full.slice(2, 4), 16)
  const b = parseInt(full.slice(4, 6), 16)
  const lum = 0.299 * r + 0.587 * g + 0.114 * b
  return lum < 140
}

function buildTheme(bgColor: string): Theme {
  if (isDarkHex(bgColor)) {
    return {
      name: '#f9fafb',
      secondary: '#d1d5db',
      divider: 'rgba(255, 255, 255, 0.18)',
      placeholder: '#334155',
      qtyBg: 'rgba(255, 255, 255, 0.88)',
      qtyText: '#111827',
      runeFallback: '#4b5563',
    }
  }
  return {
    name: '#111827',
    secondary: '#6b7280',
    divider: '#e5e7eb',
    placeholder: '#e2e8f0',
    qtyBg: 'rgba(17, 24, 39, 0.85)',
    qtyText: '#ffffff',
    runeFallback: '#d1d5db',
  }
}

function fieldValue(card: DeckCardDetail, field: string): number | string | null {
  switch (field) {
    case 'print_code':
      return card.print_code
    case 'rarity_name':
      return card.rarity_name
    case 'card_color_list': {
      const colors = parseColorList(card.card_color_list)
      const color = normalizeColor(colors[0] ?? 'neutral')
      const idx = COLOR_ORDER.indexOf(color)
      return idx === -1 ? COLOR_ORDER.length : idx
    }
    case 'power':
      return card.power
    case 'energy':
      return card.energy
    case 'return_energy':
      return card.return_energy
    default:
      return null
  }
}

export function sortCards(list: DeckCardDetail[], rules: SortKeyItem[]): DeckCardDetail[] {
  const active = rules.filter((r) => r && r.name)
  if (active.length === 0) return list
  return [...list].sort((a, b) => {
    for (const rule of active) {
      const av = fieldValue(a, rule.name)
      const bv = fieldValue(b, rule.name)
      if (av === null || bv === null) continue
      let cmp = 0
      if (typeof av === 'number' && typeof bv === 'number') {
        cmp = av - bv
      } else {
        cmp = String(av).localeCompare(String(bv))
      }
      if (cmp !== 0) return rule.isAsc ? cmp : -cmp
    }
    return 0
  })
}

function drawCoverImage(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number,
  y: number,
  w: number,
  h: number,
  scale = 1,
  offsetX = 0,
  offsetY = 0
): void {
  const iw = img.naturalWidth
  const ih = img.naturalHeight
  if (!iw || !ih) return
  const s = Math.max(w / iw, h / ih) * scale
  const dw = iw * s
  const dh = ih * s
  ctx.drawImage(img, x + (w - dw) / 2 + offsetX, y + (h - dh) / 2 + offsetY, dw, dh)
}

function drawCoverIn(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement | null,
  x: number,
  y: number,
  w: number,
  h: number,
  placeholder: string
): void {
  ctx.fillStyle = placeholder
  ctx.fillRect(x, y, w, h)
  if (img) drawCoverImage(ctx, img, x, y, w, h)
}

function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

function drawQtyBadge(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  qty: number,
  theme: Theme
): void {
  if (qty < 1) return
  ctx.font = '600 20px sans-serif'
  const label = `×${qty}`
  const bw = ctx.measureText(label).width + 14
  const bh = 26
  roundRectPath(ctx, x + w - bw, y + h - bh, bw, bh, 6)
  ctx.fillStyle = theme.qtyBg
  ctx.fill()
  ctx.fillStyle = theme.qtyText
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(label, x + w - bw / 2, y + h - bh / 2 + 1)
}

function gridHeight(count: number): number {
  if (count === 0) return 0
  const rows = Math.ceil(count / COLS_R)
  return rows * CARD_H + (rows - 1) * GAP
}

function groupRunesByColor(runes: DeckCardDetail[]): { color: string; quantity: number }[] {
  const counts = new Map<string, number>()
  for (const slot of runes) {
    const colors = parseColorList(slot.card_color_list)
    const color = normalizeColor(colors[0] ?? 'neutral')
    counts.set(color, (counts.get(color) ?? 0) + slot.quantity)
  }
  return [...counts.entries()].map(([color, quantity]) => ({ color, quantity }))
}

function layoutRunes(
  ctx: CanvasRenderingContext2D,
  runes: { color: string; quantity: number }[],
  startX: number,
  startY: number,
  maxX: number
): { items: RuneItem[]; bottom: number } {
  const items: RuneItem[] = []
  let x = startX
  let y = startY
  for (const rune of runes) {
    ctx.font = RUNE_FONT
    const label = `×${rune.quantity}`
    const width = RUNE_ICON + 8 + ctx.measureText(label).width + 16
    if (x > startX && x + width > maxX) {
      x = startX
      y += RUNE_ICON + RUNE_GAP
    }
    items.push({ color: rune.color, quantity: rune.quantity, label, x, y })
    x += width
  }
  return { items, bottom: items.length ? y + RUNE_ICON : startY }
}

function loadImageFromUrl(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = url
  })
}

export async function buildDeckImage(options: DeckImageOptions): Promise<string> {
  const { deckName, cards, sortRules, onProgress } = options

  const legendCards = cards.filter((c) => c.zone === 'legend')
  const championCards = cards.filter((c) => c.zone === 'champion')
  const battlefieldCards = cards.filter((c) => c.zone === 'battlefields')
  const mainCards = sortCards(
    cards.filter((c) => c.zone === 'mainDeck'),
    sortRules
  )
  const sideCards = sortCards(
    cards.filter((c) => c.zone === 'sideboard'),
    sortRules
  )
  const runeCards = cards.filter((c) => c.zone === 'runes')

  const heroRowCards = [...legendCards, ...championCards]
  const totalCards = cards.reduce((s, c) => s + c.quantity, 0)

  // 收集需要加载的卡图
  const jobs: ImgJob[] = []
  const addJob = (card: DeckCardDetail) => {
    const key = `${card.print_code}-${card.language}`
    if (card.img_cdn && !jobs.some((j) => j.key === key)) {
      jobs.push({ key, url: card.img_cdn, cacheName: key })
    }
  }
  heroRowCards.forEach(addJob)
  battlefieldCards.forEach(addJob)
  mainCards.forEach(addJob)
  sideCards.forEach(addJob)

  const imageMap = new Map<string, HTMLImageElement>()
  const loaded = { count: 0 }
  await Promise.all(
    jobs.map(async (job) => {
      try {
        const img = await loadCardImageElement(job.url, job.cacheName)
        imageMap.set(job.key, img)
      } catch (error) {
        console.warn('[DeckImage] 卡图加载失败:', job.key, error)
      } finally {
        loaded.count += 1
        if (onProgress && jobs.length > 0) {
          onProgress(Math.round((loaded.count / jobs.length) * 100))
        }
      }
    })
  )

  const runeIconCache = new Map<string, HTMLImageElement | null>()
  const getRuneIcon = (color: string): Promise<HTMLImageElement | null> => {
    if (color === 'neutral') return Promise.resolve(null)
    if (runeIconCache.has(color)) return Promise.resolve(runeIconCache.get(color)!)
    return new Promise((resolve) => {
      const img = new Image()
      img.onload = () => {
        runeIconCache.set(color, img)
        resolve(img)
      }
      img.onerror = () => {
        runeIconCache.set(color, null)
        resolve(null)
      }
      img.src = `/runes/${color}.svg`
    })
  }

  const background = options.background ?? { color: '#ffffff' }
  const theme = buildTheme(background.color)
  if (options.textColor) {
    theme.name = options.textColor
    theme.secondary = options.textColor
  }

  const canvas = document.createElement('canvas')
  canvas.width = WIDTH * SCALE
  const ctx = canvas.getContext('2d')!
  ctx.scale(SCALE, SCALE)

  // ===== 排版计算 =====
  const y0 = PAD + (40 + SECTION_GAP)
  const leftEnd = PAD + LEFT_W
  const rightX = leftEnd + SECTION_GAP

  // 左栏：英雄行（传奇+英雄，超 2 张换行）
  let leftBottom = y0
  if (heroRowCards.length > 0) {
    const perRow = Math.max(1, Math.floor((LEFT_W + GAP) / (HERO_W + GAP)))
    const heroRows = Math.ceil(heroRowCards.length / perRow)
    leftBottom +=
      heroRows * HERO_H +
      (heroRows - 1) * GAP +
      (runeCards.length || battlefieldCards.length ? GAP : 0)
  }
  // 左栏：符文（流式）
  const runeLayout = layoutRunes(ctx, groupRunesByColor(runeCards), PAD, leftBottom, leftEnd)
  if (runeCards.length > 0) {
    leftBottom = runeLayout.bottom + (battlefieldCards.length ? GAP : 0)
  }
  // 左栏：战场（每行一张，旋转 -90° 横放）
  if (battlefieldCards.length > 0) {
    leftBottom += battlefieldCards.length * BF_H + (battlefieldCards.length - 1) * GAP
  }
  const leftH = leftBottom - y0

  // 右栏：主牌 + 备牌
  let rightBottom = y0
  if (mainCards.length > 0) {
    rightBottom += LABEL_H + gridHeight(mainCards.length)
  }
  if (sideCards.length > 0) {
    rightBottom += SECTION_GAP + LABEL_H + gridHeight(sideCards.length)
  }
  const rightH = rightBottom - y0

  const contentH = Math.max(leftH, rightH)
  const bottomY = y0 + contentH + SECTION_GAP
  const height = bottomY + QR_SIZE + PAD

  // 设置高度会重置变换，需重新应用缩放
  canvas.height = height * SCALE
  ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0)

  // 背景（支持缩放与偏移）
  ctx.fillStyle = background.color
  ctx.fillRect(0, 0, WIDTH, height)
  if (background.imageUrl) {
    const bgImage = await loadImageFromUrl(background.imageUrl)
    if (bgImage) {
      drawCoverImage(
        ctx,
        bgImage,
        0,
        0,
        WIDTH,
        height,
        background.scale ?? 1,
        background.offsetX ?? 0,
        background.offsetY ?? 0
      )
    }
    if (background.overlay != null && background.overlay > 0) {
      ctx.globalAlpha = background.overlay
      ctx.fillStyle = background.maskColor ?? '#ffffff'
      ctx.fillRect(0, 0, WIDTH, height)
      ctx.globalAlpha = 1
    }
  }

  // 头部：标题 +（玩家名字）+ 总张数
  let y = PAD
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = theme.name
  ctx.font = '700 32px "Noto Sans SC", sans-serif'
  const titleText = deckName || get(t)('builder.unnamedDeck')
  ctx.fillText(titleText, PAD, y + 20)
  const owner = options.playerName?.trim()
  if (options.showPlayerName && owner) {
    const titleW = ctx.measureText(titleText).width
    ctx.font = '400 22px "Noto Sans SC", sans-serif'
    ctx.fillStyle = theme.secondary
    ctx.fillText(`（${owner}）`, PAD + titleW + GAP, y + 20)
  }
  ctx.textAlign = 'right'
  ctx.font = '400 20px "Noto Sans SC", sans-serif'
  ctx.fillStyle = theme.secondary
  ctx.fillText(
    get(t)('deckDetail.imageTotalCards', { values: { count: totalCards } }),
    WIDTH - PAD,
    y + 22
  )
  ctx.strokeStyle = theme.divider
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(PAD, y + 40)
  ctx.lineTo(WIDTH - PAD, y + 40)
  ctx.stroke()
  y = y0

  // 左栏：英雄行（传奇 + 选定英雄）
  if (heroRowCards.length > 0) {
    const perRow = Math.max(1, Math.floor((LEFT_W + GAP) / (HERO_W + GAP)))
    const heroRows = Math.ceil(heroRowCards.length / perRow)
    heroRowCards.forEach((card, i) => {
      const col = i % perRow
      const row = Math.floor(i / perRow)
      const cx = PAD + col * (HERO_W + GAP)
      const cy = y + row * (HERO_H + GAP)
      const key = `${card.print_code}-${card.language}`
      drawCoverIn(ctx, imageMap.get(key) ?? null, cx, cy, HERO_W, HERO_H, theme.placeholder)
      drawQtyBadge(ctx, cx, cy, HERO_W, HERO_H, card.quantity, theme)
    })
    y +=
      heroRows * HERO_H +
      (heroRows - 1) * GAP +
      (runeCards.length || battlefieldCards.length ? GAP : 0)
  }

  // 左栏：符文
  if (runeCards.length > 0) {
    const layout = layoutRunes(ctx, groupRunesByColor(runeCards), PAD, y, leftEnd)
    for (const item of layout.items) {
      const icon = await getRuneIcon(item.color)
      if (icon) {
        ctx.drawImage(icon, item.x, item.y, RUNE_ICON, RUNE_ICON)
      } else {
        ctx.fillStyle = theme.runeFallback
        roundRectPath(ctx, item.x, item.y, RUNE_ICON, RUNE_ICON, 8)
        ctx.fill()
      }
      ctx.fillStyle = theme.name
      ctx.font = RUNE_FONT
      ctx.textAlign = 'left'
      ctx.textBaseline = 'middle'
      ctx.fillText(item.label, item.x + 52, item.y + RUNE_ICON / 2)
    }
    y = layout.bottom + (battlefieldCards.length ? GAP : 0)
  }

  // 左栏：战场（竖版卡图旋转 -90° 横放）
  battlefieldCards.forEach((card, i) => {
    const cx = PAD
    const cy = y + i * (BF_H + GAP)
    const key = `${card.print_code}-${card.language}`
    const img = imageMap.get(key) ?? null
    // 旋转坐标系内区域为 BF_H(宽) × BF_W(高)，旋转 -90° 后呈现 BF_W × BF_H 横版
    ctx.save()
    ctx.translate(cx + BF_W / 2, cy + BF_H / 2)
    ctx.rotate(-Math.PI / 2)
    drawCoverIn(ctx, img, -BF_H / 2, -BF_W / 2, BF_H, BF_W, theme.placeholder)
    ctx.restore()
    drawQtyBadge(ctx, cx, cy, BF_W, BF_H, card.quantity, theme)
  })

  // 右栏：主牌
  y = y0
  if (mainCards.length > 0) {
    ctx.textAlign = 'left'
    ctx.fillStyle = theme.secondary
    ctx.font = '600 22px "Noto Sans SC", sans-serif'
    ctx.fillText(get(t)(ZONE_CONFIG.mainDeck.labelKey), rightX, y + LABEL_H / 2)
    y += LABEL_H
    mainCards.forEach((card, i) => {
      const col = i % COLS_R
      const row = Math.floor(i / COLS_R)
      const cx = rightX + col * (CARD_W + GAP)
      const cy = y + row * (CARD_H + GAP)
      const key = `${card.print_code}-${card.language}`
      drawCoverIn(ctx, imageMap.get(key) ?? null, cx, cy, CARD_W, CARD_H, theme.placeholder)
      drawQtyBadge(ctx, cx, cy, CARD_W, CARD_H, card.quantity, theme)
    })
    y += gridHeight(mainCards.length)
  }

  // 右栏：备牌（主牌下方接着排）
  if (sideCards.length > 0) {
    y += SECTION_GAP
    ctx.textAlign = 'left'
    ctx.fillStyle = theme.secondary
    ctx.font = '600 22px "Noto Sans SC", sans-serif'
    ctx.fillText(get(t)(ZONE_CONFIG.sideboard.labelKey), rightX, y + LABEL_H / 2)
    y += LABEL_H
    sideCards.forEach((card, i) => {
      const col = i % COLS_R
      const row = Math.floor(i / COLS_R)
      const cx = rightX + col * (CARD_W + GAP)
      const cy = y + row * (CARD_H + GAP)
      const key = `${card.print_code}-${card.language}`
      drawCoverIn(ctx, imageMap.get(key) ?? null, cx, cy, CARD_W, CARD_H, theme.placeholder)
      drawQtyBadge(ctx, cx, cy, CARD_W, CARD_H, card.quantity, theme)
    })
  }

  // 底部条：应用图标（按背景深浅单色渲染）+ 二维码
  const iconImg = await loadImageFromUrl('/icon.png')
  if (iconImg) {
    ctx.filter = isDarkHex(background.color) ? 'brightness(0) invert(1)' : 'brightness(0)'
    ctx.drawImage(iconImg, PAD, bottomY + (QR_SIZE - ICON_H) / 2, ICON_W, ICON_H)
    ctx.filter = 'none'
  }
  if (options.qrDataUrl) {
    const qrImg = await loadImageFromUrl(options.qrDataUrl)
    if (qrImg) ctx.drawImage(qrImg, WIDTH - PAD - QR_SIZE, bottomY, QR_SIZE, QR_SIZE)
  }

  return canvas.toDataURL('image/jpeg', 0.92)
}

export function dataUrlToBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.split(',')[1] ?? ''
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

/**
 * 把 JPEG dataURL 重新解码为 PNG 字节。
 * 桌面端剪贴板（tauri image-png / arboard 需 RGBA）无法直接接受 JPEG 字节，复制前用此函数转换。
 */
export function jpegDataUrlToPngBytes(dataUrl: string): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(img, 0, 0)
      resolve(dataUrlToBytes(canvas.toDataURL('image/png')))
    }
    img.onerror = () => reject(new Error('JPEG dataURL 解码失败'))
    img.src = dataUrl
  })
}

export async function writeImageToPath(dataUrl: string, dest: string): Promise<void> {
  await writeBytesFile(dataUrlToBytes(dataUrl), dest, `deck_image_${Date.now()}.jpg`)
}

export function downloadImageInWeb(dataUrl: string, name: string): void {
  const anchor = document.createElement('a')
  anchor.href = dataUrl
  anchor.download = name
  anchor.click()
}
