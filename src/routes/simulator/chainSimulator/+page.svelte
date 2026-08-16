<script lang="ts">
  import { get } from 'svelte/store'
  import {
    ChevronLeft,
    Camera,
    Settings,
    PanelRight,
    PanelLeft,
    History,
    RotateCcw,
  } from '@lucide/svelte'
  import type { DragDropState } from '@thisux/sveltednd'
  import CommonModal from '$lib/components/ui/CommonModal.svelte'
  import CardSimpleImage from '$lib/components/cards/CardSimpleImage.svelte'
  import Sidebar from '$lib/components/simulator/chain/Sidebar.svelte'
  import Zone from '$lib/components/simulator/chain/Zone.svelte'
  import SettingsPanel from '$lib/components/simulator/chain/SettingsPanel.svelte'
  import SnapshotManager from '$lib/components/simulator/chain/SnapshotManager.svelte'
  import {
    chainSimulatorState,
    chainSimulatorSettings,
    chainSimulatorSnapshots,
    createDefaultSettings,
    createGameState,
    createSimState,
    createSnapshot,
    simToZones,
    zonesToSim,
    deleteSnapshot,
    newChainItem,
    SIDE_DECK_KEY,
    type CardInstance,
    type ChainDragPayload,
    type ChainItem,
    type DisplayMode,
    type GameState,
    type SimState,
  } from '$lib/simulator/chain'
  import { searchCards, getBestPrint, printCacheName, type CardWithOwned } from '$lib/db'
  import { showToast } from '$lib/stores/ui-store.svelte'
  import { confirmAction } from '$lib/utils/confirm'
  import { t } from '$lib/i18n'
  import { toolsStoreReady } from '$lib/stores/tools'
  import { isMobile } from '$lib/utils/os'

  const PLAYER_COLORS = ['#e5484d', '#128378', '#d9730d', '#5b5bd6']

  const initialSim = get(chainSimulatorState) ?? createSimState(2, 2)
  const initialGame = createGameState(initialSim.playerCount, initialSim.battlefieldCount)
  initialGame.zones = simToZones(initialSim)

  let game = $state<GameState>(initialGame)
  let baseSim = $state<SimState>(initialSim)
  let cards = $state<Record<string, CardWithOwned | null>>({})
  let currentOwner = $state(0)
  let sidebarOpen = $state(true)
  let isDesktop = $state(true)
  let settingsOpen = $state(false)
  let historyOpen = $state(false)
  let previewItem = $state<CardInstance | null>(null)
  let editContext = $state<{ zoneKey: string; item: CardInstance } | null>(null)
  let editName = $state('')
  let editSubtitle = $state('')
  let editNote = $state('')
  let editOwner = $state(0)
  let storeHydrated = $state(false)
  let demoMode = $state(false)
  let demoIndex = $state(-1)
  let nonMobileOs = $state(true)
  let isSmallScreen = $state(false)

  const unsupported = $derived(!nonMobileOs || isSmallScreen)

  const currentSim = $derived(zonesToSim(game.zones, baseSim))

  const battlefieldKeys = $derived(
    Array.from({ length: baseSim.battlefieldCount }, (_, i) => `bf${i}`)
  )
  const playerIndexes = $derived(Array.from({ length: baseSim.playerCount }, (_, p) => p))
  const sharedBaseItems = $derived(getSharedItems('base'))
  const sharedDiscardItems = $derived(getSharedItems('discard'))
  const sharedBanishItems = $derived(getSharedItems('banish'))

  $effect(() => {
    if (!storeHydrated) return
    chainSimulatorState.set(currentSim)
  })

  $effect(() => {
    if (!storeHydrated) return
    chainSimulatorSettings.set(game.settings)
  })

  $effect(() => {
    if (!storeHydrated) return
    chainSimulatorSnapshots.set(game.snapshots)
  })

  $effect(() => {
    let cancelled = false
    toolsStoreReady.then(() => {
      if (cancelled) return
      const stored = get(chainSimulatorState)
      if (!stored.extra) stored.extra = { deck: [] }
      baseSim = stored
      game.zones = simToZones(stored)
      game.settings = get(chainSimulatorSettings) ?? game.settings
      game.snapshots = get(chainSimulatorSnapshots) ?? game.snapshots
      storeHydrated = true
    })
    return () => {
      cancelled = true
    }
  })

  $effect(() => {
    const mq = window.matchMedia('(min-width: 480px)')
    const update = () => {
      isDesktop = mq.matches
      if (mq.matches) sidebarOpen = true
    }
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  })

  $effect(() => {
    const mq = window.matchMedia('(max-width: 499.98px)')
    const update = () => {
      isSmallScreen = mq.matches
    }
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  })

  $effect(() => {
    let cancelled = false
    isMobile()
      .then((mobile) => {
        if (!cancelled) nonMobileOs = !mobile
      })
      .catch(() => {
        nonMobileOs = true
      })
    return () => {
      cancelled = true
    }
  })

  $effect(() => {
    for (const zoneItems of Object.values(game.zones)) {
      for (const item of zoneItems) {
        if (item.cardNo) void ensureCard(item.cardNo)
      }
    }
  })

  async function ensureCard(cardNo: string) {
    if (cards[cardNo] !== undefined) return
    try {
      const res = await searchCards({ searchText: cardNo, pageSize: 1, is_banned: false })
      cards[cardNo] = res.data[0] ?? null
    } catch (err) {
      console.error('[chain-sim] 加载卡牌失败:', cardNo, err)
      cards[cardNo] = null
    }
  }

  function titleForZone(key: string): string {
    if (key === 'chain') return $t('simulator.zone.chain')
    if (key === 'resolving') return $t('simulator.zone.resolving')
    if (key === 'pending') return $t('simulator.zone.pending')
    if (key.startsWith('bf'))
      return `${$t('simulator.zone.battlefield')} ${Number(key.slice(2)) + 1}`
    const pMatch = /^p(\d+)-(hand|base|discard|banish|deck)$/.exec(key)
    if (pMatch) {
      const names: Record<string, string> = {
        hand: $t('simulator.zone.hand'),
        base: $t('simulator.zone.base'),
        discard: $t('simulator.zone.discard'),
        banish: $t('simulator.zone.banish'),
        deck: $t('simulator.zone.deck'),
      }
      return `${names[pMatch[2]] ?? pMatch[2]} · ${$t('simulator.playerLabel', { values: { n: Number(pMatch[1]) + 1 } })}`
    }
    const custom = baseSim.customZones.find((z) => z.id === key)
    if (custom) return custom.name
    return key
  }

  function zoneItems(key: string): CardInstance[] {
    return (game.zones[key] ?? []) as CardInstance[]
  }

  function sharedTypeFromKey(key: string): 'base' | 'discard' | 'banish' | null {
    if (key === 'shared-base') return 'base'
    if (key === 'shared-discard') return 'discard'
    if (key === 'shared-banish') return 'banish'
    return null
  }

  function getSharedItems(type: 'base' | 'discard' | 'banish'): CardInstance[] {
    return playerIndexes.flatMap((p) => game.zones[`p${p}-${type}`] ?? [])
  }

  function setSharedItems(type: 'base' | 'discard' | 'banish', items: CardInstance[]) {
    for (const p of playerIndexes) {
      game.zones[`p${p}-${type}`] = []
    }
    for (const item of items) {
      const owner = Math.min(Math.max(item.owner ?? currentOwner, 0), baseSim.playerCount - 1)
      const key = `p${owner}-${type}`
      game.zones[key] = [...(game.zones[key] ?? []), { ...item, owner }]
    }
  }

  function genericZoneType(key: string): string {
    if (key.startsWith('bf')) return 'battlefield'
    const m = /^p(\d+)-(hand|base|discard|banish|deck)$/.exec(key)
    if (m) return m[2]
    return key
  }

  function modeForZone(key: string): DisplayMode {
    const mode = game.settings.zoneModes[genericZoneType(key)] ?? 'text'
    return mode === 'both' ? 'image' : mode
  }

  function getCardInsertIndex(
    targetZone: string,
    state: DragDropState<ChainDragPayload>,
    itemsOverride?: CardInstance[]
  ): number {
    const { targetElement, dropPosition } = state
    const cardEl =
      targetElement instanceof Element ? targetElement.closest<HTMLElement>('.zone-item') : null
    const items = itemsOverride ?? game.zones[targetZone] ?? []
    if (!cardEl || !cardEl.parentElement) return items.length
    const siblings = Array.from(cardEl.parentElement.children).filter((el) =>
      el.classList.contains('zone-item')
    ) as HTMLElement[]
    const idx = siblings.indexOf(cardEl)
    if (idx === -1) return items.length
    return dropPosition === 'after' ? idx + 1 : idx
  }

  function handleZoneDrop(targetZone: string, state: DragDropState<ChainDragPayload>) {
    const { draggedItem } = state
    const isPayload =
      typeof draggedItem === 'object' && draggedItem !== null && 'card' in draggedItem
    const card = isPayload
      ? (draggedItem as { card: ChainItem; columnId: string }).card
      : (draggedItem as ChainItem)
    const sourceZone = isPayload
      ? (draggedItem as { card: ChainItem; columnId: string }).columnId
      : null
    const targetShared = sharedTypeFromKey(targetZone)
    const sourceShared = sourceZone ? sharedTypeFromKey(sourceZone) : null

    if (targetShared) {
      const targetItems = getSharedItems(targetShared)
      const at = getCardInsertIndex(targetZone, state, targetItems)

      if (sourceShared === targetShared) {
        const items = [...targetItems]
        const idx = items.findIndex((c) => c.id === card.id)
        if (idx === -1) return
        const [moved] = items.splice(idx, 1)
        const insertAt = idx < at ? at - 1 : at
        items.splice(insertAt, 0, moved)
        setSharedItems(targetShared, items)
      } else if (sourceShared) {
        const srcItems = getSharedItems(sourceShared).filter((c) => c.id !== card.id)
        setSharedItems(sourceShared, srcItems)
        const items = [...targetItems]
        items.splice(at, 0, { ...card, owner: card.owner ?? currentOwner } as CardInstance)
        setSharedItems(targetShared, items)
      } else {
        if (sourceZone) {
          game.zones[sourceZone] = (game.zones[sourceZone] ?? []).filter((c) => c.id !== card.id)
        }
        const items = [...targetItems]
        items.splice(at, 0, { ...card, owner: card.owner ?? currentOwner } as CardInstance)
        setSharedItems(targetShared, items)
      }
      return
    }

    if (sourceShared) {
      const srcItems = getSharedItems(sourceShared).filter((c) => c.id !== card.id)
      setSharedItems(sourceShared, srcItems)
      const targetItems = game.zones[targetZone] ?? []
      const at = getCardInsertIndex(targetZone, state)
      const next = [...targetItems]
      next.splice(at, 0, card as CardInstance)
      game.zones[targetZone] = next
      return
    }

    const targetItems = game.zones[targetZone] ?? []

    if (!sourceZone) {
      game.zones[targetZone] = [...targetItems, card as CardInstance]
      return
    }

    const sourceItems = game.zones[sourceZone] ?? []
    const dragIndex = sourceItems.findIndex((c) => c.id === card.id)
    if (dragIndex === -1) return

    const at = getCardInsertIndex(targetZone, state)
    const [moved] = sourceItems.splice(dragIndex, 1)
    const insertAt = sourceZone === targetZone && dragIndex < at ? at - 1 : at
    const next = [...targetItems]
    next.splice(insertAt, 0, moved)
    game.zones[targetZone] = next
  }

  function clearZone(zoneKey: string) {
    const shared = sharedTypeFromKey(zoneKey)
    if (shared) {
      setSharedItems(shared, [])
    } else {
      game.zones[zoneKey] = []
    }
    showToast($t('simulator.zoneCleared'), 'success')
  }

  function removeCardInstance(zoneKey: string, item: CardInstance) {
    const shared = sharedTypeFromKey(zoneKey)
    if (shared) {
      setSharedItems(
        shared,
        getSharedItems(shared).filter((c) => c.id !== item.id)
      )
    } else {
      game.zones[zoneKey] = (game.zones[zoneKey] ?? []).filter((c) => c.id !== item.id)
    }
    showToast($t('simulator.removeCard'), 'success')
  }

  function removeCard(zoneKey: string, item: CardInstance, target: 'discard' | 'banish') {
    const sourceShared = sharedTypeFromKey(zoneKey)
    if (sourceShared) {
      const srcItems = getSharedItems(sourceShared).filter((c) => c.id !== item.id)
      setSharedItems(sourceShared, srcItems)
    } else {
      game.zones[zoneKey] = (game.zones[zoneKey] ?? []).filter((c) => c.id !== item.id)
    }
    const targetItems = getSharedItems(target)
    setSharedItems(target, [...targetItems, { ...item, owner: item.owner ?? currentOwner }])
    showToast(
      target === 'discard' ? $t('simulator.movedToDiscard') : $t('simulator.movedToBanish'),
      'success'
    )
  }

  function duplicateCard(zoneKey: string, item: CardInstance) {
    const { id: _oldId, ...rest } = item
    const copy = newChainItem({
      ...rest,
      tags: [...(item.tags ?? [])],
      rotated: false,
    }) as CardInstance
    const shared = sharedTypeFromKey(zoneKey)
    if (shared) {
      const items = [...getSharedItems(shared)]
      const idx = items.findIndex((c) => c.id === item.id)
      if (idx === -1) items.push(copy)
      else items.splice(idx + 1, 0, copy)
      setSharedItems(shared, items)
    } else {
      const items = [...(game.zones[zoneKey] ?? [])]
      const idx = items.findIndex((c) => c.id === item.id)
      if (idx === -1) items.push(copy)
      else items.splice(idx + 1, 0, copy)
      game.zones[zoneKey] = items
    }
    showToast($t('simulator.copied'), 'success')
  }

  function rotateCard(zoneKey: string, item: CardInstance) {
    const shared = sharedTypeFromKey(zoneKey)
    if (shared) {
      const items = getSharedItems(shared).map((c) =>
        c.id === item.id ? { ...c, rotated: !c.rotated } : c
      )
      setSharedItems(shared, items)
    } else {
      game.zones[zoneKey] = (game.zones[zoneKey] ?? []).map((c) =>
        c.id === item.id ? { ...c, rotated: !c.rotated } : c
      )
    }
  }

  function updateTags(zoneKey: string, item: CardInstance, tags: string[]) {
    const shared = sharedTypeFromKey(zoneKey)
    if (shared) {
      const items = getSharedItems(shared).map((c) => (c.id === item.id ? { ...c, tags } : c))
      setSharedItems(shared, items)
    } else {
      game.zones[zoneKey] = (game.zones[zoneKey] ?? []).map((c) =>
        c.id === item.id ? { ...c, tags } : c
      )
    }
  }

  function addCustom(partial: Partial<CardInstance>) {
    const item = newChainItem({
      ...partial,
      owner: partial.owner ?? currentOwner,
    }) as CardInstance
    game.zones[SIDE_DECK_KEY] = [item, ...(game.zones[SIDE_DECK_KEY] ?? [])]
    showToast($t('simulator.addedToSideDeck'), 'success')
  }

  function recordSnapshot(auto = false) {
    const snap = createSnapshot(currentSim, auto ? '自动保存' : undefined)
    game.snapshots = [...game.snapshots, snap].slice(-50)
    showToast(
      auto ? $t('simulator.autoSnapshotSaved') : $t('simulator.snapshotRecorded'),
      'success'
    )
  }

  function applySnapshotById(id: string) {
    const snap = game.snapshots.find((s) => s.id === id)
    if (!snap) return
    const next = snap.state
    if (!next.extra) next.extra = { deck: [] }
    baseSim = next
    game.zones = simToZones(next)
    showToast($t('simulator.snapshotApplied'), 'success')
  }

  function removeSnapshot(id: string) {
    deleteSnapshot(game, id)
    showToast($t('simulator.snapshotDeleted'), 'success')
  }

  function importState(state: SimState) {
    if (!state.extra) state.extra = { deck: [] }
    baseSim = state
    game.zones = simToZones(state)
    showToast($t('simulator.importSuccess'), 'success')
  }

  function resetGame() {
    demoMode = false
    baseSim = createSimState(2, 2)
    game.zones = simToZones(baseSim)
    game.snapshots = []
    game.settings = createDefaultSettings()
    showToast($t('simulator.resetGame'), 'success')
  }

  function setPlayerCount(n: number) {
    if (n < 2 || n > 4) return
    baseSim.playerCount = n
    while (baseSim.players.length < n) {
      baseSim.players.push({ hand: [], base: [], discard: [], banish: [] })
    }
    baseSim.players = baseSim.players.slice(0, n)
    game.zones = simToZones(baseSim)
  }

  function setBattlefieldCount(n: number) {
    if (n < 1 || n > 3) return
    baseSim.battlefieldCount = n
    baseSim.battlefields = Array.from({ length: n }, (_, i) => baseSim.battlefields[i] ?? [])
    game.zones = simToZones(baseSim)
  }

  function setZoneMode(key: string, mode: DisplayMode) {
    game.settings = {
      ...game.settings,
      zoneModes: { ...game.settings.zoneModes, [key]: mode },
    }
  }

  function setAllZoneModes(mode: DisplayMode) {
    const next: Record<string, DisplayMode> = {}
    for (const key of Object.keys(game.settings.zoneModes)) next[key] = mode
    game.settings = { ...game.settings, zoneModes: next }
  }

  function openEdit(zoneKey: string, item: CardInstance) {
    editContext = { zoneKey, item }
    editName = item.customName || ''
    editSubtitle = item.subtitle || ''
    editNote = item.customNote || ''
    editOwner = item.owner ?? currentOwner
  }

  function saveEdit() {
    if (!editContext) return
    const { zoneKey, item } = editContext
    const shared = sharedTypeFromKey(zoneKey)
    const updated = {
      ...item,
      customName: editName.trim() || null,
      subtitle: editSubtitle.trim() || null,
      customNote: editNote.trim() || null,
      owner: editOwner,
    }
    if (shared) {
      const items = getSharedItems(shared).map((c) => (c.id === item.id ? updated : c))
      setSharedItems(shared, items)
    } else {
      game.zones[zoneKey] = (game.zones[zoneKey] ?? []).map((c) => (c.id === item.id ? updated : c))
    }
    editContext = null
    showToast($t('simulator.savedCardInfo'), 'success')
  }

  function toggleDemo() {
    demoMode = !demoMode
    if (demoMode) {
      demoIndex = game.snapshots.length - 1
      if (game.snapshots.length > 0) {
        applySnapshotById(game.snapshots[demoIndex].id)
      }
    }
  }

  function goDemo(delta: number) {
    const snaps = game.snapshots
    if (!snaps.length) return
    const next = Math.min(snaps.length - 1, Math.max(0, demoIndex + delta))
    if (next === demoIndex) return
    demoIndex = next
    applySnapshotById(snaps[next].id)
  }

  function goDemoToFirst() {
    if (!game.snapshots.length) return
    demoIndex = 0
    applySnapshotById(game.snapshots[0].id)
  }

  function goDemoToLast() {
    if (!game.snapshots.length) return
    demoIndex = game.snapshots.length - 1
    applySnapshotById(game.snapshots[demoIndex].id)
  }

  $effect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const typing =
        !!target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      if (typing) return

      const ctrl = e.ctrlKey || e.metaKey
      if (ctrl && e.key.toLowerCase() === 's') {
        e.preventDefault()
        recordSnapshot(false)
        return
      }
      if (ctrl && e.key.toLowerCase() === 'h') {
        e.preventDefault()
        historyOpen = !historyOpen
        return
      }
      if (ctrl && e.key.toLowerCase() === 'b') {
        e.preventDefault()
        sidebarOpen = !sidebarOpen
        return
      }
      if (ctrl && e.key.toLowerCase() === 'v') {
        e.preventDefault()
        toggleDemo()
        return
      }
      if (demoMode) {
        if (e.key === 'ArrowRight') {
          e.preventDefault()
          goDemo(1)
          return
        }
        if (e.key === 'ArrowLeft') {
          e.preventDefault()
          goDemo(-1)
          return
        }
        if (ctrl && e.key === 'ArrowRight') {
          e.preventDefault()
          goDemoToLast()
          return
        }
        if (ctrl && e.key === 'ArrowLeft') {
          e.preventDefault()
          goDemoToFirst()
          return
        }
      }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  $effect(() => {
    const sec = game.settings.autoSnapshotIntervalSec
    if (!sec || sec <= 0) return
    const timer = setInterval(() => recordSnapshot(true), sec * 1000)
    return () => clearInterval(timer)
  })
</script>

{#if unsupported}
  <div class="unsupported-page">
    <h1>{$t('simulator.unsupportedMobileTitle')}</h1>
    <p>{$t('simulator.unsupportedMobileDesc')}</p>
    <button type="button" class="unsupported-back" onclick={() => window.history.back()}>
      {$t('common.back')}
    </button>
  </div>
{:else}
  <div class="chain-page">
    {#if !demoMode}
      <header class="chain-header">
        <button
          class="header-back-btn"
          onclick={() => window.history.back()}
          aria-label="返回"
          title="返回"
        >
          <ChevronLeft size={18} />
        </button>
        <h1 class="chain-title">{$t('simulator.chainTitle')}</h1>
        <div class="header-actions">
          <button type="button" class="header-btn" onclick={() => recordSnapshot(false)}>
            <Camera size={16} />
            {$t('simulator.snapshot')}
          </button>
          <button type="button" class="header-btn" onclick={() => (historyOpen = true)}>
            <History size={16} />
            {$t('simulator.history')}
          </button>
          <button
            type="button"
            class="header-btn"
            onclick={async () => {
              const ok = await confirmAction($t('simulator.resetAllConfirm'), {
                title: $t('simulator.resetAll'),
              })
              if (ok) resetGame()
            }}
          >
            <RotateCcw size={16} />
            {$t('simulator.resetAll')}
          </button>
          <button
            type="button"
            class="header-btn"
            title={sidebarOpen ? $t('simulator.hideSidebar') : $t('simulator.showSidebar')}
            onclick={() => (sidebarOpen = !sidebarOpen)}
          >
            {#if sidebarOpen}<PanelRight size={16} />{:else}<PanelLeft size={16} />{/if}
          </button>
          <button type="button" class="header-btn" onclick={() => (settingsOpen = true)}>
            <Settings size={16} />
            {$t('simulator.settings')}
          </button>
        </div>
      </header>
    {/if}

    <div class="chain-body" class:sidebar-hidden={!sidebarOpen} class:demo-mode={demoMode}>
      <main class="chain-main">
        <div
          class="board"
          style="--bf-count: {baseSim.battlefieldCount}; --player-count: {baseSim.playerCount}"
        >
          <div class="board-pending">
            <Zone
              zoneKey="pending"
              title={titleForZone('pending')}
              items={zoneItems('pending')}
              mode={modeForZone('pending')}
              {cards}
              playerColors={PLAYER_COLORS}
              snapToGrid={game.settings.snapToGrid}
              ondrop={handleZoneDrop}
              onremove={removeCard}
              onremovecard={removeCardInstance}
              onclear={clearZone}
              onduplicate={duplicateCard}
              onpreview={(item) => (previewItem = item)}
              onrotate={rotateCard}
              ontagchange={updateTags}
              onedit={openEdit}
            />
          </div>

          <div class="board-mid">
            <div class="mid-chain">
              <Zone
                zoneKey="chain"
                title={titleForZone('chain')}
                items={zoneItems('chain')}
                mode={modeForZone('chain')}
                {cards}
                playerColors={PLAYER_COLORS}
                snapToGrid={game.settings.snapToGrid}
                ondrop={handleZoneDrop}
                onremove={removeCard}
                onremovecard={removeCardInstance}
                onclear={clearZone}
                onduplicate={duplicateCard}
                onpreview={(item) => (previewItem = item)}
                onrotate={rotateCard}
                ontagchange={updateTags}
                onedit={openEdit}
              />
            </div>
            <div class="mid-resolving">
              <Zone
                zoneKey="resolving"
                title={titleForZone('resolving')}
                items={zoneItems('resolving')}
                mode={modeForZone('resolving')}
                {cards}
                playerColors={PLAYER_COLORS}
                snapToGrid={game.settings.snapToGrid}
                ondrop={handleZoneDrop}
                onremove={removeCard}
                onremovecard={removeCardInstance}
                onclear={clearZone}
                onduplicate={duplicateCard}
                onpreview={(item) => (previewItem = item)}
                onrotate={rotateCard}
                ontagchange={updateTags}
                onedit={openEdit}
              />
            </div>
          </div>

          <div class="board-battlefields">
            {#each battlefieldKeys as key (key)}
              <Zone
                zoneKey={key}
                title={titleForZone(key)}
                items={zoneItems(key)}
                mode={modeForZone(key)}
                {cards}
                playerColors={PLAYER_COLORS}
                snapToGrid={game.settings.snapToGrid}
                ondrop={handleZoneDrop}
                onremove={removeCard}
                onremovecard={removeCardInstance}
                onclear={clearZone}
                onduplicate={duplicateCard}
                onpreview={(item) => (previewItem = item)}
                onrotate={rotateCard}
                ontagchange={updateTags}
                onedit={openEdit}
              />
            {/each}
          </div>

          <div class="board-shared">
            <Zone
              zoneKey="shared-base"
              title={$t('simulator.zone.base')}
              items={sharedBaseItems}
              mode={modeForZone('base')}
              {cards}
              playerColors={PLAYER_COLORS}
              snapToGrid={game.settings.snapToGrid}
              ondrop={handleZoneDrop}
              onremove={removeCard}
              onremovecard={removeCardInstance}
              onclear={clearZone}
              onduplicate={duplicateCard}
              onpreview={(item) => (previewItem = item)}
              onrotate={rotateCard}
              ontagchange={updateTags}
              onedit={openEdit}
            />
            <Zone
              zoneKey="shared-discard"
              title={$t('simulator.zone.discard')}
              items={sharedDiscardItems}
              mode={modeForZone('discard')}
              {cards}
              playerColors={PLAYER_COLORS}
              snapToGrid={game.settings.snapToGrid}
              ondrop={handleZoneDrop}
              onremove={removeCard}
              onremovecard={removeCardInstance}
              onclear={clearZone}
              onduplicate={duplicateCard}
              onpreview={(item) => (previewItem = item)}
              onrotate={rotateCard}
              ontagchange={updateTags}
              onedit={openEdit}
            />
            <Zone
              zoneKey="shared-banish"
              title={$t('simulator.zone.banish')}
              items={sharedBanishItems}
              mode={modeForZone('banish')}
              {cards}
              playerColors={PLAYER_COLORS}
              snapToGrid={game.settings.snapToGrid}
              ondrop={handleZoneDrop}
              onremove={removeCard}
              onremovecard={removeCardInstance}
              onclear={clearZone}
              onduplicate={duplicateCard}
              onpreview={(item) => (previewItem = item)}
              onrotate={rotateCard}
              ontagchange={updateTags}
              onedit={openEdit}
            />
          </div>
        </div>
      </main>

      {#if !demoMode}
        <aside class="chain-side-col" class:open={sidebarOpen} class:mobile={!isDesktop}>
          {#if !isDesktop}
            <button
              type="button"
              class="sheet-handle"
              aria-label="收起侧栏"
              onclick={() => (sidebarOpen = false)}
            ></button>
          {/if}
          <Sidebar
            zones={game.zones}
            {cards}
            currentState={currentSim}
            bind:currentOwner
            playerColors={PLAYER_COLORS}
            onOwnerChange={(owner) => (currentOwner = owner)}
            onDropToZone={handleZoneDrop}
            onAddCustom={addCustom}
            onpreview={(item) => (previewItem = item)}
            onremove={removeCard}
            onremovecard={removeCardInstance}
            onclear={clearZone}
            onduplicate={duplicateCard}
            onrotate={rotateCard}
            ontagchange={updateTags}
            onedit={openEdit}
          />
        </aside>
      {/if}
    </div>

    {#if !isDesktop && !demoMode}
      {#if sidebarOpen}
        <button
          type="button"
          class="sheet-backdrop"
          aria-label="关闭侧栏"
          onclick={() => (sidebarOpen = false)}
        ></button>
      {:else}
        <button class="fab" onclick={() => (sidebarOpen = true)} aria-label="打开侧栏">
          <PanelRight size={22} />
        </button>
      {/if}
    {/if}

    {#if nonMobileOs}
      <div class="keyboard-help">
        <span>{$t('simulator.keyboardCtrlHover')}</span>
        {#if !demoMode}
          <span>{$t('simulator.keyboardCtrlS')}</span>
        {/if}
        <span>{demoMode ? $t('simulator.keyboardCtrlVExit') : $t('simulator.keyboardCtrlV')}</span>
        {#if demoMode}
          <span>{$t('simulator.keyboardPrevNext')}</span>
          <span>{$t('simulator.keyboardCtrlPrevNext')}</span>
        {/if}
      </div>
    {/if}

    <SnapshotManager
      open={historyOpen}
      onClose={() => (historyOpen = false)}
      snapshots={game.snapshots}
      currentState={currentSim}
      onRecord={() => recordSnapshot(false)}
      onApply={applySnapshotById}
      onDelete={removeSnapshot}
      onImport={importState}
    />

    <CommonModal open={settingsOpen} title="设置" onclose={() => (settingsOpen = false)}>
      <SettingsPanel
        settings={game.settings}
        playerCount={baseSim.playerCount}
        battlefieldCount={baseSim.battlefieldCount}
        onchange={(patch) => (game.settings = { ...game.settings, ...patch })}
        onZoneModeChange={setZoneMode}
        onAllZoneModeChange={setAllZoneModes}
        onPlayerCountChange={setPlayerCount}
        onBattlefieldCountChange={setBattlefieldCount}
        onreset={resetGame}
      />
    </CommonModal>

    <CommonModal
      open={!!previewItem}
      title={previewItem
        ? previewItem.customName ||
          cards[previewItem.cardNo ?? '']?.card_name_cn ||
          cards[previewItem.cardNo ?? '']?.card_name_en ||
          previewItem.cardNo ||
          previewItem.id
        : ''}
      onclose={() => (previewItem = null)}
    >
      {#if previewItem}
        {@const card = previewItem.cardNo ? cards[previewItem.cardNo] : null}
        {@const best = card ? getBestPrint(card) : null}
        <div class="preview-body">
          {#if best?.url}
            <CardSimpleImage url={best.url} name={printCacheName(best)} className="preview-img" />
          {/if}
          <p class="preview-name">
            {previewItem.customName ||
              card?.card_name_cn ||
              card?.card_name_en ||
              previewItem.cardNo ||
              previewItem.id}
          </p>
          {#if previewItem.subtitle}
            <p class="preview-subtitle">{previewItem.subtitle}</p>
          {/if}
          {#if previewItem.customNote}
            <p class="preview-note">{previewItem.customNote}</p>
          {/if}
        </div>
      {/if}
    </CommonModal>

    <CommonModal
      open={!!editContext}
      title={$t('simulator.editCardInfo')}
      onclose={() => (editContext = null)}
    >
      {#if editContext}
        <div class="edit-form">
          <label class="edit-field">
            <span>{$t('simulator.editName')}</span>
            <input type="text" bind:value={editName} placeholder="卡牌名称" />
          </label>
          <label class="edit-field">
            <span>{$t('simulator.editSubtitle')}</span>
            <input type="text" bind:value={editSubtitle} placeholder="副标题（可选）" />
          </label>
          <label class="edit-field">
            <span>{$t('simulator.editNote')}</span>
            <input type="text" bind:value={editNote} placeholder="备注（可选）" />
          </label>
          <label class="edit-field">
            <span>{$t('simulator.editOwner')}</span>
            <select bind:value={editOwner}>
              {#each playerIndexes as p (p)}
                <option value={p}>玩家 {p + 1}</option>
              {/each}
            </select>
          </label>
          <div class="edit-actions">
            <button type="button" class="btn" onclick={() => (editContext = null)}
              >{$t('simulator.cancel')}</button
            >
            <button type="button" class="btn primary" onclick={saveEdit}
              >{$t('simulator.save')}</button
            >
          </div>
        </div>
      {/if}
    </CommonModal>
  </div>
{/if}

<style>
  .unsupported-page {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    padding: 24px;
    text-align: center;
    gap: 8px;
  }

  .unsupported-page h1 {
    font-size: var(--text-xl);
    color: var(--text-primary);
  }

  .unsupported-page p {
    font-size: var(--text-sm);
    color: var(--text-tertiary);
  }

  .unsupported-back {
    margin-top: 8px;
    padding: 8px 16px;
    border: 1px solid var(--border-color);
    border-radius: 8px;
    background: var(--bg-secondary);
    color: var(--text-primary);
    font-size: var(--text-sm);
    cursor: pointer;
  }

  .unsupported-back:hover {
    border-color: var(--accent-color);
  }

  .chain-page {
    display: flex;
    flex-direction: column;
    height: 100%;
    padding: calc(12px + env(safe-area-inset-top)) 16px 16px;
    gap: 10px;
    overflow: hidden;
    --text-xs: 0.65rem;
    --text-sm: 0.75rem;
    --text-base: 0.9rem;
    --text-md: 1rem;
    --text-lg: 1.1rem;
    --text-xl: 1.25rem;
  }

  .chain-header {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-shrink: 0;
  }

  .header-back-btn,
  .header-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    border: 1px solid var(--border-color);
    border-radius: 8px;
    background: var(--bg-secondary);
    color: var(--text-secondary);
    cursor: pointer;
  }

  .header-back-btn {
    width: 34px;
    height: 34px;
  }

  .header-btn {
    padding: 6px 10px;
    font-size: var(--text-xs);
  }

  .header-back-btn:hover,
  .header-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .chain-title {
    margin: 0;
    font-size: var(--text-xl);
    font-weight: 700;
    color: var(--text-primary);
    white-space: nowrap;
  }

  .header-actions {
    display: flex;
    gap: 6px;
    margin-left: auto;
  }

  .chain-body {
    display: flex;
    gap: 14px;
    flex: 1;
    min-height: 0;
  }

  .chain-main {
    flex: 1;
    min-width: 0;
    min-height: 0;
  }

  .board {
    display: flex;
    flex-direction: column;
    gap: 12px;
    min-height: 0;
    overflow-y: auto;
  }

  .board-pending {
    flex: 1;
    /* min-height: 100px; */
  }

  .board-mid {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 160px;
    gap: 12px;
    flex: 1.2;
    min-height: 0;
  }

  .mid-chain,
  .mid-resolving {
    min-width: 0;
    min-height: 0;
  }

  .board-battlefields {
    display: grid;
    grid-template-columns: repeat(var(--bf-count, 2), minmax(0, 1fr));
    gap: 12px;
    flex: 1;
    min-height: 0;
  }

  .board-shared {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 12px;
    flex: 1.4;
    min-height: 0;
  }

  .chain-side-col {
    width: 320px;
    flex-shrink: 0;
    overflow-y: auto;
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-lg);
    padding: 12px;
    transition:
      width 0.2s ease,
      opacity 0.2s ease,
      margin 0.2s ease;
  }

  .chain-body.sidebar-hidden .chain-side-col {
    width: 0;
    padding: 0;
    border: none;
    opacity: 0;
    margin: 0;
    overflow: hidden;
    pointer-events: none;
  }

  .sheet-handle {
    display: block;
    width: 48px;
    height: 4px;
    border: none;
    border-radius: 999px;
    background: var(--border-color);
    margin: 0 auto 8px;
    padding: 0;
  }

  .sheet-backdrop {
    position: fixed;
    inset: 0;
    z-index: 40;
    border: none;
    padding: 0;
    background: rgba(0, 0, 0, 0.4);
    backdrop-filter: blur(2px);
  }

  .fab {
    position: fixed;
    bottom: calc(20px + env(safe-area-inset-bottom));
    right: 20px;
    z-index: 50;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 48px;
    height: 48px;
    border: none;
    border-radius: 50%;
    background: var(--accent-color);
    color: #fff;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
    cursor: pointer;
  }

  .preview-body {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
  }

  :global(.preview-img) {
    width: min(320px, 100%);
    border-radius: 10px;
  }

  .preview-name {
    font-weight: 600;
    text-align: center;
  }

  .preview-subtitle,
  .preview-note {
    color: var(--text-tertiary);
    font-size: var(--text-sm);
    text-align: center;
    white-space: pre-wrap;
  }

  .edit-form {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .edit-field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: var(--text-sm);
    color: var(--text-secondary);
  }

  .edit-field input,
  .edit-field select {
    padding: 7px 9px;
    border: 1px solid var(--border-color);
    border-radius: 8px;
    background: var(--surface);
    color: var(--text-primary);
    font-size: var(--text-sm);
  }

  .edit-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }

  .btn {
    padding: 7px 14px;
    border: 1px solid var(--border-color);
    border-radius: 8px;
    background: var(--surface);
    color: var(--text-primary);
    font-size: var(--text-sm);
    cursor: pointer;
  }

  .btn.primary {
    background: var(--accent-color);
    border-color: var(--accent-color);
    color: #fff;
  }

  @media (max-width: 479.99px) {
    .chain-page {
      padding: calc(10px + env(safe-area-inset-top)) 10px 90px;
    }

    .chain-body {
      position: relative;
    }

    .chain-side-col {
      position: fixed;
      left: 0;
      right: 0;
      bottom: 0;
      z-index: 45;
      width: 100%;
      max-height: 72svh;
      border-radius: 16px 16px 0 0;
      transform: translateY(105%);
      transition: transform 0.25s ease;
      box-shadow: 0 -8px 30px rgba(0, 0, 0, 0.2);
      opacity: 1;
      pointer-events: auto;
    }

    .chain-side-col.open {
      transform: translateY(0);
    }

    .chain-body.sidebar-hidden .chain-side-col {
      width: 100%;
      opacity: 1;
      pointer-events: auto;
      transform: translateY(105%);
    }

    .board-mid {
      grid-template-columns: 1fr;
    }

    .board-battlefields {
      grid-template-columns: 1fr;
    }

    .board-shared {
      grid-template-columns: 1fr;
    }
  }
  .keyboard-help {
    position: fixed;
    left: 12px;
    bottom: calc(12px + env(safe-area-inset-bottom));
    z-index: 900;
    display: flex;
    flex-wrap: wrap;
    gap: 4px 10px;
    max-width: 320px;
    padding: 6px 10px;
    border: 1px solid var(--border-color);
    border-radius: 10px;
    background: color-mix(in srgb, var(--bg-primary) 88%, transparent);
    backdrop-filter: blur(6px);
    color: var(--text-tertiary);
    font-size: 10px;
    pointer-events: none;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
  }

  .chain-body.demo-mode .chain-main {
    height: 100%;
  }
</style>
