import type { DeckCardDetail } from '$lib/db'
import type { ZoneKey } from './zone'

export const QR_PAYLOAD_VERSION = 'RA1'

type QrCardZone = 'main' | 'side' | 'champion'

function deckZoneOf(zone: ZoneKey): QrCardZone {
  if (zone === 'sideboard') return 'side'
  if (zone === 'champion') return 'champion'
  return 'main'
}

const ZONE_LETTER: Record<QrCardZone, string> = { main: 'm', side: 's', champion: 'c' }
const ZONE_ORDER: Record<QrCardZone, number> = { main: 0, side: 1, champion: 2 }

type QrZoneEntry = { cardNo: string; quantity: number }

function buildZoneLine(letter: string, total: number, entries: QrZoneEntry[]): string {
  const pairs = entries.map((e) => `${e.cardNo}:${e.quantity}`).join(':')
  return `${letter}${total}${pairs ? `:${pairs}` : ''}`
}

export function serializeDeckPayload(zoneCards: Record<ZoneKey, DeckCardDetail[]>): string | null {
  const zoneEntries = new Map<QrCardZone, Map<string, number>>()

  for (const zoneKey of Object.keys(zoneCards) as ZoneKey[]) {
    const zone = deckZoneOf(zoneKey)
    let map = zoneEntries.get(zone)
    if (!map) {
      map = new Map()
      zoneEntries.set(zone, map)
    }
    for (const card of zoneCards[zoneKey]) {
      if (!card.card_no) continue
      map.set(card.card_no, (map.get(card.card_no) ?? 0) + card.quantity)
    }
  }

  const allZones: QrCardZone[] = ['main', 'side', 'champion']
  const lines: string[] = []

  for (const zone of allZones.sort((a, b) => ZONE_ORDER[a] - ZONE_ORDER[b])) {
    const map = zoneEntries.get(zone)
    if (!map || map.size === 0) continue
    const entries: QrZoneEntry[] = [...map.entries()]
      .filter(([, qty]) => qty > 0)
      .map(([cardNo, quantity]) => ({ cardNo, quantity }))
      .sort((a, b) => a.cardNo.localeCompare(b.cardNo))
    if (entries.length === 0) continue
    const total = entries.reduce((sum, e) => sum + e.quantity, 0)
    lines.push(buildZoneLine(ZONE_LETTER[zone], total, entries))
  }

  if (lines.length === 0) return null
  return [QR_PAYLOAD_VERSION, ...lines].join('\n')
}

export async function buildDeckQrDataUrl(payload: string): Promise<string> {
  const { default: QRCode } = await import('qrcode')
  return QRCode.toDataURL(payload, {
    errorCorrectionLevel: 'M',
    margin: 2,
    width: 320,
  })
}

/**
 * 从二维码图片 dataURL 解码出文本内容（用于「上传二维码」导入）。
 * 依赖 jsQR（本地解码，无网络请求）。
 */
export async function decodeQrImageDataUrl(dataUrl: string): Promise<string> {
  const jsQR = (await import('jsqr')).default
  const img = new Image()
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = () => reject(new Error('二维码图片加载失败'))
    img.src = dataUrl
  })
  const canvas = document.createElement('canvas')
  const maxSize = 1024
  const scale = Math.min(1, maxSize / Math.max(img.naturalWidth, img.naturalHeight))
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale))
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale))
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('无法创建画布上下文')
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const result = jsQR(data, width, height, { inversionAttempts: 'dontInvert' })
  if (!result?.data) throw new Error('未能在图片中识别到二维码')
  return result.data
}
