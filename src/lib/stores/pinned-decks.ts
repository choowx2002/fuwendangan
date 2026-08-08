import { get } from 'svelte/store'
import { persistentWritable } from './settings'

export const pinnedDeckIds = persistentWritable<string[]>('pinnedDecks', [])

export function isDeckPinned(id: string): boolean {
  return get(pinnedDeckIds).includes(id)
}

export function togglePinDeck(id: string): void {
  const current = get(pinnedDeckIds)
  pinnedDeckIds.set(current.includes(id) ? current.filter((d) => d !== id) : [...current, id])
}

export function pinDeck(id: string): void {
  if (!get(pinnedDeckIds).includes(id)) {
    pinnedDeckIds.set([...get(pinnedDeckIds), id])
  }
}

export function unpinDeck(id: string): void {
  pinnedDeckIds.set(get(pinnedDeckIds).filter((d) => d !== id))
}
