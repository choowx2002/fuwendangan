import type { DecodedDeckResult } from '$lib/decks/deck-import'

let pendingImport = $state<DecodedDeckResult | null>(null)

export function setPendingDeckImport(result: DecodedDeckResult) {
  pendingImport = result
}

export function consumePendingDeckImport(): DecodedDeckResult | null {
  const current = pendingImport
  pendingImport = null
  return current
}
