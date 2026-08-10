import type { DeckCardDetail } from '$lib/db'
import type { ZoneKey } from './zone'
import { get } from 'svelte/store'
import { t } from '$lib/i18n'

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
    img.onerror = () => reject(new Error(get(t)('decks.qrImgLoadFailed')))
    img.src = dataUrl
  })
  const canvas = document.createElement('canvas')
  const maxSize = 1024
  const scale = Math.min(1, maxSize / Math.max(img.naturalWidth, img.naturalHeight))
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale))
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale))
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error(get(t)('decks.qrCanvasFailed'))
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const result = jsQR(data, width, height, { inversionAttempts: 'dontInvert' })
  if (!result?.data) throw new Error(get(t)('decks.qrNoQrFound'))
  return result.data
}

/**
 * 实时摄像头扫码（桌面/Web）。
 * 打开相机并逐帧用 jsQR 解码，识别成功后回调 content。
 * 返回 stop 函数：停止取帧并释放摄像头。
 */
export async function startCameraQrScan(
  video: HTMLVideoElement,
  onDecoded: (content: string) => void
): Promise<() => void> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error(get(t)('scanner.noCamera'))
  }

  let stream: MediaStream | null = null
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: 'environment',
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
      audio: false,
    })
  } catch {
    throw new Error(get(t)('scanner.permissionDenied'))
  }

  video.srcObject = stream
  await video.play().catch(() => {
    stream?.getTracks().forEach((track) => track.stop())
    throw new Error(get(t)('scanner.noCamera'))
  })

  const jsQR = (await import('jsqr')).default
  const canvas = document.createElement('canvas')
  const canvasCtx = canvas.getContext('2d', { willReadFrequently: true })
  if (!canvasCtx) {
    stream.getTracks().forEach((track) => track.stop())
    throw new Error(get(t)('decks.qrCanvasFailed'))
  }
  const ctx: CanvasRenderingContext2D = canvasCtx

  let rafId = 0
  let lastDecode = 0
  let stopped = false
  const decodedSet = new Set<string>()

  function tick(now: number) {
    if (stopped) return
    if (now - lastDecode >= 120) {
      lastDecode = now
      const { videoWidth, videoHeight } = video
      if (videoWidth > 0 && videoHeight > 0) {
        canvas.width = videoWidth
        canvas.height = videoHeight
        ctx.drawImage(video, 0, 0, videoWidth, videoHeight)
        const { data, width, height } = ctx.getImageData(0, 0, videoWidth, videoHeight)
        const result = jsQR(data, width, height, { inversionAttempts: 'dontInvert' })
        if (result?.data && !decodedSet.has(result.data)) {
          decodedSet.add(result.data)
          onDecoded(result.data)
        }
      }
    }
    rafId = requestAnimationFrame(tick)
  }
  rafId = requestAnimationFrame(tick)

  return () => {
    stopped = true
    cancelAnimationFrame(rafId)
    stream?.getTracks().forEach((track) => track.stop())
  }
}
