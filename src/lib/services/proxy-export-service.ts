import { jsPDF } from 'jspdf'
import type { DeckCardDetail } from '$lib/db'
import { printCacheName } from '$lib/db/helper'
import { sortForExport } from '$lib/decks/deck-export'
import { ZONE_CONFIG, type ZoneKey } from '$lib/decks/zone'
import { writeBytesFile } from './db-file-service'
import { loadCardImageElement } from './card-image-loader'

const PROXY_ZONE_ORDER: ZoneKey[] = [
  'legend',
  'champion',
  'mainDeck',
  'battlefields',
  'runes',
  'sideboard',
]

const PAGE_W = 210
const PAGE_H = 297
const CARD_W = 63.5
const CARD_H = 88.9
const COLS = 3
const ROWS = 3
const MARGIN = 5
const HEADER_H_MM = 7
const GRID_TOP = HEADER_H_MM + 4
const GRID_GAP_X = (PAGE_W - 2 * MARGIN - COLS * CARD_W) / (COLS - 1)
const GRID_GAP_Y = (PAGE_H - GRID_TOP - MARGIN - ROWS * CARD_H) / (ROWS - 1)

const CELL_W_PX = 500
const CELL_H_PX = 700

const HEADER_DPI = 6
const HEADER_W_PX = Math.round(PAGE_W * HEADER_DPI)
const HEADER_H_PX = Math.round(HEADER_H_MM * HEADER_DPI)

interface ProxyInstance {
  url: string
  cacheName: string
  label: string
}

interface ProxyPdfOptions {
  deckName?: string
  zones?: ZoneKey[]
  onProgress?: (percent: number) => void
}

const imageCache = new Map<string, Promise<string>>()

function displayName(card: DeckCardDetail): string {
  return card.sub_title_cn ? `${card.card_name_cn} - ${card.sub_title_cn}` : card.card_name_cn
}

function buildInstances(cards: DeckCardDetail[], zones: Set<ZoneKey>): ProxyInstance[] {
  const instances: ProxyInstance[] = []
  for (const zone of PROXY_ZONE_ORDER) {
    if (!zones.has(zone)) continue
    const list = cards.filter((c) => c.zone === zone)
    for (const c of sortForExport(list)) {
      for (let i = 0; i < c.quantity; i++) {
        instances.push({
          url: c.img_cdn,
          cacheName: printCacheName({ card_no_extend: c.print_code, language: c.language }),
          label: displayName(c),
        })
      }
    }
  }
  return instances
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = []
  let current = ''
  for (const ch of text) {
    if (ctx.measureText(current + ch).width > maxWidth && current) {
      lines.push(current)
      current = ch
    } else {
      current += ch
    }
  }
  if (current) lines.push(current)
  return lines.slice(0, 3)
}

function drawCover(ctx: CanvasRenderingContext2D, img: HTMLImageElement): void {
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, CELL_W_PX, CELL_H_PX)

  const isLandscape = img.naturalWidth > img.naturalHeight

  if (isLandscape) {
    const scale = Math.max(CELL_W_PX / img.naturalHeight, CELL_H_PX / img.naturalWidth)
    ctx.save()
    ctx.translate(CELL_W_PX / 2, CELL_H_PX / 2)
    ctx.rotate(-Math.PI / 2)
    ctx.drawImage(
      img,
      (-img.naturalWidth * scale) / 2,
      (-img.naturalHeight * scale) / 2,
      img.naturalWidth * scale,
      img.naturalHeight * scale
    )
    ctx.restore()
  } else {
    const scale = Math.max(CELL_W_PX / img.naturalWidth, CELL_H_PX / img.naturalHeight)
    ctx.drawImage(
      img,
      (CELL_W_PX - img.naturalWidth * scale) / 2,
      (CELL_H_PX - img.naturalHeight * scale) / 2,
      img.naturalWidth * scale,
      img.naturalHeight * scale
    )
  }
}

function renderPlaceholder(label: string): string {
  const canvas = document.createElement('canvas')
  canvas.width = CELL_W_PX
  canvas.height = CELL_H_PX
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#e2e8f0'
  ctx.fillRect(0, 0, CELL_W_PX, CELL_H_PX)
  ctx.fillStyle = '#64748b'
  ctx.font = '28px sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const lines = wrapText(ctx, label, CELL_W_PX - 24)
  const lineHeight = 36
  const startY = CELL_H_PX / 2 - ((lines.length - 1) * lineHeight) / 2
  lines.forEach((line, i) => {
    ctx.fillText(line, CELL_W_PX / 2, startY + i * lineHeight)
  })
  ctx.font = '20px sans-serif'
  ctx.fillStyle = '#94a3b8'
  ctx.fillText('(无图片)', CELL_W_PX / 2, CELL_H_PX - 24)
  return canvas.toDataURL('image/jpeg', 0.9)
}

function canvasFromImage(img: HTMLImageElement): string {
  const canvas = document.createElement('canvas')
  canvas.width = CELL_W_PX
  canvas.height = CELL_H_PX
  const ctx = canvas.getContext('2d')!
  drawCover(ctx, img)
  return canvas.toDataURL('image/jpeg', 0.92)
}

async function loadProxyImage(instance: ProxyInstance): Promise<string> {
  try {
    const img = await loadCardImageElement(instance.url, instance.cacheName)
    return canvasFromImage(img)
  } catch (error) {
    console.warn('[ProxyExport] 卡图加载失败，使用占位图:', instance.label, error)
    return renderPlaceholder(instance.label)
  }
}

function getProxyImage(instance: ProxyInstance): Promise<string> {
  if (!instance.url) return Promise.resolve(renderPlaceholder(instance.label))
  if (!imageCache.has(instance.url)) {
    imageCache.set(instance.url, loadProxyImage(instance))
  }
  return imageCache.get(instance.url)!
}

function renderHeader(deckName: string, pageNum: number, totalPages: number): string {
  const canvas = document.createElement('canvas')
  canvas.width = HEADER_W_PX
  canvas.height = HEADER_H_PX
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, HEADER_W_PX, HEADER_H_PX)
  ctx.fillStyle = '#111827'
  ctx.font = '600 24px sans-serif'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillText(deckName || '未命名卡组', 0, HEADER_H_PX / 2)
  ctx.font = '400 20px sans-serif'
  ctx.textAlign = 'right'
  ctx.fillText(`${pageNum} / ${totalPages}`, HEADER_W_PX, HEADER_H_PX / 2)
  return canvas.toDataURL('image/jpeg', 0.95)
}

export async function buildProxyPdf(
  cards: DeckCardDetail[],
  options: ProxyPdfOptions = {}
): Promise<Uint8Array> {
  const selectedZones = new Set<ZoneKey>(options.zones?.length ? options.zones : PROXY_ZONE_ORDER)
  const instances = buildInstances(cards, selectedZones)
  const uniqueImages = new Set(instances.map((i) => i.url).filter(Boolean))
  const completedImages = new Set<string>()
  const onProgress = options.onProgress

  const perPage = COLS * ROWS
  const totalPages = Math.max(1, Math.ceil(instances.length / perPage))
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })

  for (let page = 0; page < totalPages; page++) {
    if (page > 0) doc.addPage()

    const header = renderHeader(options.deckName ?? '', page + 1, totalPages)
    doc.addImage(header, 'JPEG', MARGIN, 0, PAGE_W - 2 * MARGIN, HEADER_H_MM)

    const pageCards = instances.slice(page * perPage, (page + 1) * perPage)
    for (let slot = 0; slot < pageCards.length; slot++) {
      const row = Math.floor(slot / COLS)
      const col = slot % COLS
      const x = MARGIN + col * (CARD_W + GRID_GAP_X)
      const y = GRID_TOP + row * (CARD_H + GRID_GAP_Y)
      const dataUrl = await getProxyImage(pageCards[slot])
      const url = pageCards[slot].url
      if (url && !completedImages.has(url)) {
        completedImages.add(url)
        if (onProgress && uniqueImages.size > 0) {
          onProgress(Math.round((completedImages.size / uniqueImages.size) * 100))
        }
      }
      doc.addImage(dataUrl, 'JPEG', x, y, CARD_W, CARD_H)
    }
  }

  return new Uint8Array(doc.output('arraybuffer'))
}

export async function writePdfToPath(bytes: Uint8Array, dest: string): Promise<void> {
  await writeBytesFile(bytes, dest, `proxy_export_${Date.now()}.pdf`)
}

export function downloadPdfInWeb(bytes: Uint8Array, name: string): void {
  const blob = new Blob([bytes], { type: 'application/pdf' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.click()
  URL.revokeObjectURL(url)
}
