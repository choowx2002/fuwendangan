<script lang="ts">
  import { onMount } from 'svelte'
  import { t } from '$lib/i18n'
  import { get } from 'svelte/store'
  import { isTauri } from '$lib/db/env'
  import { getDecks, getLatestDeckCards, type Deck, type DeckCardDetail } from '$lib/db'
  import { normalizeSignedSuffix } from '$lib/decks/deck-import'
  import type { RiftAtlasMatchRecord } from '$lib/replay/types'

  export interface DeckBindSelection {
    deckId: string | null
    /** 每个分组与所选卡组的主牌重叠率 */
    overlaps: Map<string, number>
  }

  interface Props {
    groups: RiftAtlasMatchRecord[]
    onChanged: (selection: DeckBindSelection) => void
  }
  let { groups, onChanged }: Props = $props()

  interface DeckOption {
    deck: Deck
    /** 各组重叠率（key = group.key） */
    overlaps: Map<string, number>
    /** 各组中的最大重叠率（用于排序/徽标） */
    maxOverlap: number
  }

  let options = $state<DeckOption[]>([])
  let loading = $state(true)
  let selectedId = $state<string | null>(null)

  function mainDeckCodes(group: RiftAtlasMatchRecord): Set<string> {
    const codes = new Set<string>()
    const selfId = group.perspective?.localPlayerId
    const self = selfId ? (group.players?.[selfId] ?? null) : null
    for (const en of self?.deck?.mainDeck ?? []) codes.add(normalizeSignedSuffix(en.cardCode))
    return codes
  }

  function deckCodeSet(cards: DeckCardDetail[]): Set<string> {
    const codes = new Set<string>()
    for (const c of cards) {
      if (c.zone === 'sideboard') continue
      if (c.print_code) codes.add(normalizeSignedSuffix(c.print_code))
    }
    return codes
  }

  function overlapRatio(a: Set<string>, b: Set<string>): number {
    if (a.size === 0) return 0
    let hit = 0
    for (const code of a) if (b.has(code)) hit++
    return hit / a.size
  }

  function emit(deckId: string | null) {
    selectedId = deckId
    const overlaps = new Map<string, number>()
    if (deckId === null) {
      for (const g of groups) overlaps.set(g.key, 0)
    } else {
      const opt = options.find((o) => o.deck.id === deckId)
      if (opt) {
        for (const g of groups) overlaps.set(g.key, opt.overlaps.get(g.key) ?? 0)
      }
    }
    onChanged({ deckId, overlaps })
  }

  onMount(async () => {
    if (!isTauri) {
      loading = false
      return
    }
    try {
      const decks = await getDecks()
      const loaded: DeckOption[] = []
      for (const deck of decks) {
        const cards = await getLatestDeckCards(deck.id)
        const codes = deckCodeSet(cards)
        const overlaps = new Map<string, number>()
        for (const g of groups) overlaps.set(g.key, overlapRatio(mainDeckCodes(g), codes))
        const maxOverlap = [...overlaps.values()].reduce((a, b) => Math.max(a, b), 0)
        loaded.push({ deck, overlaps, maxOverlap })
      }
      loaded.sort(
        (a, b) =>
          b.maxOverlap - a.maxOverlap || b.deck.updated_at!.localeCompare(a.deck.updated_at ?? '')
      )
      options = loaded
    } catch {
      options = []
    } finally {
      loading = false
    }
  })
</script>

<div class="panel">
  <h4>{$t('replay.deckBindTitle')}</h4>

  {#if !isTauri}
    <p class="hint">{$t('replay.webNoDeckBind')}</p>
  {:else if loading}
    <p class="hint">{$t('replay.deckLoading')}</p>
  {:else if options.length === 0}
    <p class="hint">{$t('replay.deckLoadFailed')}</p>
  {:else}
    <label class="opt">
      <input
        type="radio"
        name="replay-deck"
        checked={selectedId === null}
        onchange={() => emit(null)}
      />
      <span>{$t('replay.deckBindNone')}</span>
      <span class="opt-hint">{$t('replay.deckBindNoneHint')}</span>
    </label>
    {#each options as opt (opt.deck.id)}
      <label class="opt">
        <input
          type="radio"
          name="replay-deck"
          checked={selectedId === opt.deck.id}
          onchange={() => emit(opt.deck.id)}
        />
        <span class="opt-name">{opt.deck.name}</span>
        {#if opt.maxOverlap >= 0.7}
          <span class="badge match">
            {$t('replay.deckMatchScore', { values: { pct: Math.round(opt.maxOverlap * 100) } })}
          </span>
        {/if}
      </label>
    {/each}
  {/if}
</div>

<style>
  .panel {
    background: var(--surface);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-lg);
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  h4 {
    margin: 0;
    font-size: var(--text-base);
    color: var(--text-secondary);
  }
  .hint {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--text-tertiary);
  }
  .opt {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: var(--text-base);
    color: var(--text-primary);
    cursor: pointer;
    padding: 4px 6px;
    border-radius: var(--radius-sm);
  }
  .opt:hover {
    background: var(--bg-hover);
  }
  .opt-name {
    font-weight: 500;
  }
  .opt-hint {
    font-size: var(--text-xs);
    color: var(--text-tertiary);
  }
  .badge.match {
    font-size: var(--text-xs);
    font-weight: 600;
    border-radius: 8px;
    padding: 1px 8px;
    background: #fff3e0;
    color: #b45309;
    border: 1px solid #fcd9a8;
  }
</style>
