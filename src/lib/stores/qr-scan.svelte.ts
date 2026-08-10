let pendingScan = $state(false)
let scannedContent = $state('')

export function setQrScanPending() {
  pendingScan = true
}

export function consumeQrScanPending(): boolean {
  const current = pendingScan
  pendingScan = false
  return current
}

export function setQrScanContent(content: string) {
  scannedContent = content
}

export function consumeQrScanContent(): string {
  const current = scannedContent
  scannedContent = ''
  return current
}
