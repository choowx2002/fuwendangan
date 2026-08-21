<script lang="ts">
  import { t } from '$lib/i18n'
  import { get } from 'svelte/store'
  import { isTauri } from '$lib/db/env'
  import { showToast } from '$lib/stores/ui-store.svelte'
  import type { RiftAtlasGame, RiftAtlasMatchRecord, ReplayPlayer } from '$lib/replay/types'
  import { baseCardCode, resolveCardMetas, type ReplayCardMeta } from '$lib/replay/card-meta'
  import { readGroupAnnotation, saveGroupAnnotation } from '$lib/services/replay-library-service'
  import {
    createDeck,
    createMatch,
    deleteMatchByReplayKey,
    findSyncedMatchForReplay,
    getCardAndPrintByPrintCode,
    getAllDecksWithLegend,
    getDeckVersions,
    getMatchByReplayKey,
    saveDeckAsNewVersion,
    updateMatch,
    type DeckCardInput,
    type DeckLegendInfo,
    type DeckVersion,
    type MatchGameInput,
    type MatchInput,
    type MatchWithGames,
  } from '$lib/db'
  import CommonModal from '$lib/components/ui/CommonModal.svelte'
  import CardSimpleImage from '$lib/components/cards/CardSimpleImage.svelte'
  import { ChevronDown, ChevronUp, LoaderCircle, Plus, Save, Unlink } from '@lucide/svelte'

  type ResultMark = 'win' | 'loss' | 'draw'

  interface DeckZone {
    label: string
    entries: { count: number; name: string; cardCode: string }[]
  }

  interface Props {
    open: boolean
    group: RiftAtlasMatchRecord
    onClose: () => void
    /** 保存/解除绑定成功后通知父级刷新绑定指示 */
    onChanged: () => void
  }
  let { open, group, onClose, onChanged }: Props = $props()

  // 观战仅是角标，不再开关任何编辑能力
  const players = $derived(group.players ?? {})
  const playerList = $derived(Object.values(players).slice(0, 2))
  const isSpectator = $derived(!!group.perspective?.isSpectator)

  const boTotal = $derived.by(() => {
    const m = /bo(\d+)/i.exec(group.meta?.format ?? '')
    return m ? parseInt(m[1], 10) : 1
  })

  let loading = $state(true)
  let saving = $state(false)
  let record = $state<MatchWithGames | null>(null)
  /** 无本机链接、经身份指纹找到的已同步记录（保存走 updateMatch 合并） */
  let adopted = $state(false)
  let myPlayerId = $state<string | null>(null)
  let results = $state<Record<number, ResultMark | undefined>>({})
  let note = $state('')
  let deckOptions = $state<DeckLegendInfo[]>([])
  let deckId = $state<string | null>(null)
  let versionId = $state<string | null>(null)
  let versions = $state<DeckVersion[]>([])
  let metas = $state(new Map<string, ReplayCardMeta>())
  /** playerId → 是否展开卡表（默认收起） */
  let collapsed = $state<Record<string, boolean>>({})
  // 从本局卡表导入卡组
  let importSrcPlayerId = $state<string | null>(null)
  /** 用户是否手动改过来源（改过则不再跟随视角切换） */
  let importSrcTouched = $state(false)
  let newDeckName = $state('')
  let overwriteTargetId = $state<string | null>(null)
  let importing = $state(false)
  let missingCount = $state(0)

  // 视角派生：我方 = 用户选定（卡组绑定可自动决定）
  const selfPlayer = $derived(playerList.find((p) => p.id === myPlayerId) ?? null)
  const oppPlayer = $derived(playerList.find((p) => p.id !== myPlayerId) ?? null)

  // 双方传奇（用于卡组过滤与头像）
  const legendCodes = $derived(
    playerList.map((p) => p.legend?.cardCode ?? '').filter((c) => c !== '')
  )
  /** 仅最新版传奇命中两位玩家任一传奇的卡组（用户确认按最新版本过滤） */
  const candidateDecks = $derived(
    deckOptions.filter((d) => {
      if (!d.legend_print_code) return false
      const code = baseCardCode(d.legend_print_code)
      return legendCodes.some((c) => baseCardCode(c) === code)
    })
  )
  const selectedVersion = $derived(versions.find((v) => v.id === versionId) ?? null)

  // 导入来源玩家（默认跟随「我方」；可在下拉手动切换）
  const importSourcePlayer = $derived(
    playerList.find((p) => p.id === importSrcPlayerId) ??
      playerList.find((p) => p.id === myPlayerId) ??
      null
  )
  /** 是否有任一玩家带卡表可导入 */
  const hasImportableDeck = $derived(playerList.some((p) => !!p.deck))

  $effect(() => {
    if (!open) return
    void load()
  })

  // 卡表缩略图元数据（与复盘卡片一致：渲染期直查本地库，查询失败走占位）
  $effect(() => {
    if (!open) return
    const codes: string[] = []
    for (const p of playerList) {
      if (p?.legend?.cardCode) codes.push(p.legend.cardCode)
      for (const zone of [
        p?.deck?.legend,
        p?.deck?.champion,
        p?.deck?.mainDeck,
        p?.deck?.battlefields,
        p?.deck?.runes,
        p?.deck?.sideboard,
      ]) {
        for (const e of zone ?? []) codes.push(e.cardCode)
      }
    }
    let active = true
    void (async () => {
      const m = await resolveCardMetas(codes)
      if (!active) return
      metas = m
    })()
    return () => {
      active = false
    }
  })

  function defaultMyPlayerId(): string | null {
    const local = group.perspective?.localPlayerId
    if (local && playerList.some((p) => p.id === local)) return local
    return playerList[0]?.id ?? null
  }

  /** 绑定卡组传奇命中的玩家（决定分数方向）；无命中 → null */
  function inferMyPlayerForBound(bound: MatchWithGames): string | null {
    if (!bound.deck_id) return null
    const deck = deckOptions.find((d) => d.id === bound.deck_id)
    if (!deck?.legend_print_code) return null
    const code = baseCardCode(deck.legend_print_code)
    return playerList.find((p) => p.legend && baseCardCode(p.legend.cardCode) === code)?.id ?? null
  }

  function zonesOf(
    dl: RiftAtlasMatchRecord['players'][string]['deck'] | null | undefined
  ): DeckZone[] {
    if (!dl) return []
    const g = get(t)
    const raw: [string, { count: number; name: string; cardCode: string }[]][] = [
      [g('replay.deckZoneLegend'), dl.legend],
      [g('replay.deckZoneChampion'), dl.champion],
      [g('replay.deckZoneMain'), dl.mainDeck],
      [g('replay.deckZoneBattlefields'), dl.battlefields],
      [g('replay.deckZoneRunes'), dl.runes],
      [g('replay.deckZoneSideboard'), dl.sideboard],
    ]
    return raw
      .filter(([, entries]) => entries.length > 0)
      .map(([label, entries]) => ({ label, entries }))
  }

  function legendDisplay(p: ReplayPlayer): { img: string; cacheName: string; name: string } {
    const code = p.legend?.cardCode ?? ''
    const meta = metas.get(code)
    return {
      img: meta?.imgCdn ?? '',
      cacheName: meta?.cacheName ?? '',
      name: meta?.name ?? p.legend?.name ?? p.name ?? '?',
    }
  }

  function toggleCollapse(id: string) {
    collapsed = { ...collapsed, [id]: !collapsed[id] }
  }

  function prefillResults(m: MatchWithGames) {
    const gameNumbers = new Set((group.games ?? []).map((g) => g.gameNumber))
    for (const g of m.games ?? []) {
      if (!gameNumbers.has(g.game_number)) continue
      results[g.game_number] = g.win_type === 'draw' ? 'draw' : g.is_win ? 'win' : 'loss'
    }
  }

  async function refreshVersionsFor(deckIdValue: string | null, preferVersionId: string | null) {
    if (!deckIdValue) {
      versions = []
      versionId = null
      return
    }
    const list = await getDeckVersions(deckIdValue)
    versions = list
    versionId = list.some((v) => v.id === preferVersionId) ? preferVersionId : (list[0]?.id ?? null)
  }

  async function load() {
    loading = true
    saving = false
    record = null
    adopted = false
    results = {}
    note = ''
    deckId = null
    versionId = null
    versions = []
    deckOptions = []
    metas = new Map()
    collapsed = {}
    importSrcPlayerId = null
    importSrcTouched = false
    newDeckName = ''
    overwriteTargetId = null
    importing = false
    missingCount = 0
    try {
      if (isTauri) {
        deckOptions = await getAllDecksWithLegend()
      }

      let bound: MatchWithGames | null = null
      if (isTauri) {
        const keyed = await getMatchByReplayKey(group.key)
        if (keyed) {
          bound = keyed
        } else {
          const synced = await findSyncedMatchForReplay({
            roomCode: group.meta?.roomCode ?? null,
            startedAt: group.meta?.startedAt ?? null,
          })
          if (synced) {
            bound = synced
            adopted = true
          }
        }
      }

      const ann = isTauri ? await readGroupAnnotation(group.key) : null

      if (bound) {
        record = bound
        deckId = bound.deck_id
        note = bound.note ?? ''
        prefillResults(bound)
        myPlayerId = inferMyPlayerForBound(bound) ?? ann?.myPlayerId ?? defaultMyPlayerId()
        await refreshVersionsFor(bound.deck_id, bound.deck_version_id ?? null)
      } else {
        myPlayerId = ann?.myPlayerId ?? defaultMyPlayerId()
        if (ann) {
          results = ann.results ?? {}
          note = ann.note ?? ''
        }
      }
      importSrcPlayerId = myPlayerId
      newDeckName = suggestDeckName()
      overwriteTargetId = candidateDecks[0]?.id ?? null
    } catch (e) {
      console.error('[replay-import] 对局资料加载失败', e)
    } finally {
      loading = false
    }
  }

  /** 切换视角：已标记的 胜↔负 翻转（平局不变），保证语义跟随视角 */
  function setMyPlayer(id: string) {
    if (id === myPlayerId) return
    const next: Record<number, ResultMark | undefined> = {}
    for (const [k, v] of Object.entries(results)) {
      const n = Number(k)
      if (v === 'win') next[n] = 'loss'
      else if (v === 'loss') next[n] = 'win'
      else next[n] = v
    }
    results = next
    myPlayerId = id
    // 导入来源默认跟随「我方」（用户手动改过后不再跟随）
    if (!importSrcTouched) importSrcPlayerId = id
  }

  function onDeckChange(id: string) {
    if (saving) return
    deckId = id || null
    if (!deckId) {
      versions = []
      versionId = null
      return
    }
    const deck = candidateDecks.find((d) => d.id === deckId) ?? null
    if (deck?.legend_print_code) {
      const code = baseCardCode(deck.legend_print_code)
      const matched = playerList.find((p) => p.legend && baseCardCode(p.legend.cardCode) === code)
      if (matched) setMyPlayer(matched.id)
    }
    void refreshVersionsFor(deckId, null)
  }

  /** 新卡组默认名：传奇名 + 日期 */
  function suggestDeckName(): string {
    const src = importSourcePlayer
    const legend = src?.legend?.name ?? src?.name
    const date = new Date(group.meta?.startedAt ?? Date.now()).toLocaleDateString()
    return legend ? `${legend} ${date}` : `${group.meta?.roomCode ?? ''} ${date}`.trim()
  }

  /** 卡号 → 本地卡图（SC 优先，找不到返回 null） */
  async function resolvePrintForCode(
    code: string
  ): Promise<{ printId: string; printCode: string } | null> {
    try {
      const card = await getCardAndPrintByPrintCode(baseCardCode(code))
      if (!card) return null
      const print =
        card.card_prints.find((p) => p.id === (card.selectedPrints ?? '')) ?? card.card_prints[0]
      if (!print) return null
      return { printId: print.id, printCode: print.card_no_extend ?? '' }
    } catch {
      return null
    }
  }

  /** 将来源玩家卡表解析为 DeckCardInput（本地库查不到的卡跳过并计数） */
  async function buildDeckInputsFromPlayer(
    p: ReplayPlayer
  ): Promise<{ cards: DeckCardInput[]; missing: number }> {
    const cards: DeckCardInput[] = []
    let missing = 0
    if (!p.deck) return { cards, missing }
    const zones: [string, { count: number; name: string; cardCode: string }[]][] = [
      ['legend', p.deck.legend],
      ['champion', p.deck.champion],
      ['mainDeck', p.deck.mainDeck],
      ['battlefields', p.deck.battlefields],
      ['runes', p.deck.runes],
      ['sideboard', p.deck.sideboard],
    ]
    for (const [zone, entries] of zones) {
      for (const entry of entries) {
        const found = await resolvePrintForCode(entry.cardCode)
        if (!found) {
          missing++
          continue
        }
        cards.push({
          cardPrintId: found.printId,
          printCode: found.printCode,
          quantity: entry.count,
          zone,
        })
      }
    }
    return { cards, missing }
  }

  /** 导入后：刷新候选列表并按 onDeckChange 逻辑选中（视角跟随新卡组传奇） */
  async function afterDeckImport(deckIdValue: string) {
    deckOptions = await getAllDecksWithLegend()
    onDeckChange(deckIdValue)
  }

  async function handleCreateDeck() {
    const src = importSourcePlayer
    if (importing || !src?.deck) return
    const name = newDeckName.trim()
    if (!name) {
      showToast(get(t)('replay.importNameRequired'), 'error')
      return
    }
    importing = true
    missingCount = 0
    try {
      const { cards, missing } = await buildDeckInputsFromPlayer(src)
      if (cards.length === 0) {
        showToast(get(t)('replay.importNoCards'), 'error')
        return
      }
      const deckIdValue = await createDeck({ name })
      await saveDeckAsNewVersion(deckIdValue, cards)
      missingCount = missing
      await afterDeckImport(deckIdValue)
      console.log('[replay-import] 已从复盘新建卡组', {
        key: group.key,
        deckId: deckIdValue,
        cards: cards.length,
        missing,
      })
      showToast(get(t)('replay.deckCreated', { values: { name } }), 'success')
    } catch (e) {
      console.error('[replay-import] 从复盘新建卡组失败', e)
      showToast(get(t)('replay.importFailed'), 'error')
    } finally {
      importing = false
    }
  }

  async function handleAddVersion() {
    const src = importSourcePlayer
    if (importing || !src?.deck || !overwriteTargetId) return
    importing = true
    missingCount = 0
    try {
      const { cards, missing } = await buildDeckInputsFromPlayer(src)
      if (cards.length === 0) {
        showToast(get(t)('replay.importNoCards'), 'error')
        return
      }
      await saveDeckAsNewVersion(overwriteTargetId, cards)
      missingCount = missing
      const target = deckOptions.find((d) => d.id === overwriteTargetId)
      await afterDeckImport(overwriteTargetId)
      console.log('[replay-import] 已为已有卡组添加新版本', {
        key: group.key,
        deckId: overwriteTargetId,
        cards: cards.length,
        missing,
      })
      showToast(
        get(t)('replay.deckVersionAdded', { values: { name: target?.name ?? '' } }),
        'success'
      )
    } catch (e) {
      console.error('[replay-import] 为已有卡组添加新版本失败', e)
      showToast(get(t)('replay.importFailed'), 'error')
    } finally {
      importing = false
    }
  }

  function scoreOf(g: RiftAtlasGame): { my: number | null; opp: number | null } {
    const selfId = selfPlayer?.id
    const oppId = oppPlayer?.id
    return {
      my: selfId ? (g.score?.[selfId] ?? null) : null,
      opp: oppId ? (g.score?.[oppId] ?? null) : null,
    }
  }

  // 该局先后手角色（实际先手 firstPlayerId 优先，缺失回退 starterChooserPlayerId；
  // 未知 → 双方均为 null，不显示标签）
  function gameRoles(game: RiftAtlasGame): {
    self: 'first' | 'second' | null
    opp: 'first' | 'second' | null
  } {
    const first = game.firstPlayerId ?? game.starterChooserPlayerId ?? null
    if (first == null) return { self: null, opp: null }
    const selfId = selfPlayer?.id
    const oppId = oppPlayer?.id
    if (selfId && first === selfId) return { self: 'first', opp: 'second' }
    if (oppId && first === oppId) return { self: 'second', opp: 'first' }
    return { self: null, opp: null }
  }

  function setResult(gameNumber: number, mark: ResultMark) {
    results[gameNumber] = results[gameNumber] === mark ? undefined : mark
  }

  function buildGameInputs(): MatchGameInput[] {
    const selfId = selfPlayer?.id
    const oppId = oppPlayer?.id
    const out: MatchGameInput[] = []
    for (const g of group.games ?? []) {
      const mark = results[g.gameNumber]
      if (!mark) continue
      out.push({
        game_number: g.gameNumber,
        my_score: selfId ? (g.score?.[selfId] ?? null) : null,
        opp_score: oppId ? (g.score?.[oppId] ?? null) : null,
        win_type: mark === 'draw' ? 'draw' : 'normal',
        is_win: mark === 'win',
        is_first:
          g.firstPlayerId == null && g.starterChooserPlayerId == null
            ? null
            : selfId != null && (g.firstPlayerId ?? g.starterChooserPlayerId) === selfId,
        win_reason: null,
        log: null,
      })
    }
    return out
  }

  async function resolveOppLegend(): Promise<{
    id: string | null
    printId: string | null
    name: string
    image: string
  }> {
    const legend = oppPlayer?.legend
    if (!legend) return { id: null, printId: null, name: '', image: '' }
    try {
      const card = await getCardAndPrintByPrintCode(legend.cardCode)
      if (!card) return { id: null, printId: null, name: legend.name ?? '', image: '' }
      const print = card.card_prints?.[0] ?? null
      return {
        id: card.id,
        printId: print?.id ?? null,
        name: card.card_name_cn ?? card.card_name_en ?? legend.name ?? '',
        image: print?.img_cdn ?? '',
      }
    } catch {
      return { id: null, printId: null, name: legend.name ?? '', image: '' }
    }
  }

  async function save() {
    if (saving) return
    saving = true
    try {
      const trimmedNote = note.trim() === '' ? null : note.trim()
      const annotation = {
        myPlayerId,
        results: Object.fromEntries(
          Object.entries(results)
            .filter(([, v]) => v !== undefined)
            .map(([k, v]) => [Number(k), v!])
        ),
        note: trimmedNote,
        updatedAt: Date.now(),
      }
      let annSaved = false
      if (isTauri) {
        annSaved = await saveGroupAnnotation(group.key, annotation)
      }

      if (deckId) {
        const legend = await resolveOppLegend()
        const input: MatchInput = {
          deck_id: deckId,
          deck_version_id: selectedVersion?.id ?? null,
          deck_version_number: selectedVersion?.version_number ?? null,
          player_name: selfPlayer?.name ?? null,
          group_name: group.meta?.roomCode ?? null,
          opponent_name: oppPlayer?.name ?? null,
          opponent_deck: oppPlayer?.decklistRaw ?? null,
          opp_legend_id: legend.id,
          opp_legend_print_id: legend.printId,
          opp_legend_name: legend.name,
          opp_legend_image: legend.image,
          best_of: boTotal,
          note: trimmedNote,
          played_at: group.meta?.startedAt ? new Date(group.meta.startedAt).toISOString() : null,
          replay_key: group.key,
        }
        const gameInputs = buildGameInputs()
        if (record) {
          await updateMatch(record.id, input, gameInputs)
        } else {
          await createMatch(input, gameInputs)
        }
        console.log('[replay-import] 对局资料已保存（绑定卡组）', {
          key: group.key,
          deckId,
          versionId,
          adopted,
          annSaved,
          games: gameInputs.length,
        })
      } else if (record) {
        // 不再绑定 → 删除原记录（注解已写入 json）
        await deleteMatchByReplayKey(group.key)
        record = null
        adopted = false
        console.log('[replay-import] 对局资料已保存（解除绑定，注解保留在复盘文件）', {
          key: group.key,
          annSaved,
        })
      } else {
        console.log('[replay-import] 对局资料已保存（无绑定，注解在复盘文件）', {
          key: group.key,
          annSaved,
        })
      }
      if (!annSaved) {
        console.warn('[replay-import] 注解未能写入复盘文件（可能库中无该局）', { key: group.key })
      }
      showToast(get(t)('replay.matchSaved'), 'success')
      onChanged()
      onClose()
    } catch (e) {
      console.error('[replay-import] 对局资料保存失败', e)
      showToast(get(t)('replay.matchSaveFailed'), 'error')
    } finally {
      saving = false
    }
  }

  async function unbind() {
    if (saving || !record) return
    saving = true
    try {
      await deleteMatchByReplayKey(group.key)
      record = null
      adopted = false
      deckId = null
      versions = []
      versionId = null
      console.log('[replay-import] 已解除绑定（注解保留在复盘文件）', { key: group.key })
      showToast(get(t)('replay.matchUnbound'), 'success')
      onChanged()
    } catch (e) {
      console.error('[replay-import] 解除绑定失败', e)
      showToast(get(t)('replay.matchUnbindFailed'), 'error')
    } finally {
      saving = false
    }
  }
</script>

<CommonModal
  {open}
  title={$t('replay.matchInfoTitle')}
  subtitle={$t('replay.matchInfoHint')}
  width="min(600px, 100%)"
  onclose={onClose}
>
  {#if loading}
    <div class="loading-hint">
      <span class="spin"><LoaderCircle size={18} /></span>
      <span>{$t('replay.libraryLoading')}</span>
    </div>
  {:else}
    {#if playerList.length > 0}
      <section class="sec">
        <h4 class="sec-title">{$t('replay.perspectiveTitle')}</h4>
        <p class="hint">{$t('replay.perspectiveHint')}</p>
        <div class="persp-row">
          {#each playerList as p (p.id)}
            {@const ld = legendDisplay(p)}
            <button
              class="persp-btn"
              class:on={myPlayerId === p.id}
              onclick={() => setMyPlayer(p.id)}
              disabled={!isTauri || saving}
            >
              <span class="persp-avatar">
                <CardSimpleImage url={ld.img} name={ld.cacheName} />
              </span>
              <span class="persp-name">{p.name ?? '?'}</span>
              <span class="persp-tag"
                >{myPlayerId === p.id ? $t('replay.sideSelf') : $t('replay.sideOpp')}</span
              >
            </button>
          {/each}
        </div>
      </section>
    {/if}

    {#each playerList as p (p.id)}
      {@const ld = legendDisplay(p)}
      <section class="sec">
        <button
          class="dl-header"
          onclick={() => toggleCollapse(p.id)}
          disabled={!p.deck}
          aria-expanded={!!collapsed[p.id]}
        >
          <span class="dl-header-legend">
            <span class="dl-header-img">
              <CardSimpleImage url={ld.img} name={ld.cacheName} />
            </span>
            <span class="dl-header-name">{p.deck ? ld.name : $t('replay.decklistEmpty')}</span>
          </span>
          {#if p.deck}
            <span class="dl-chevron">
              {#if collapsed[p.id]}
                <ChevronUp size={16} />
              {:else}
                <ChevronDown size={16} />
              {/if}
            </span>
          {/if}
        </button>
        {#if collapsed[p.id] && p.deck}
          <div class="dl-body">
            {#each zonesOf(p.deck) as zone (zone.label)}
              <div class="zone">
                <div class="zone-label">{zone.label}</div>
                <div class="zone-cards">
                  {#each zone.entries as entry (entry.cardCode)}
                    <span class="dl-card">
                      <span class="dl-card-img">
                        <CardSimpleImage
                          url={metas.get(entry.cardCode)?.imgCdn ?? ''}
                          name={metas.get(entry.cardCode)?.cacheName ?? ''}
                        />
                        {#if entry.count > 1}
                          <span class="dl-card-count">×{entry.count}</span>
                        {/if}
                      </span>
                    </span>
                  {/each}
                </div>
              </div>
            {/each}
          </div>
        {/if}
      </section>
    {/each}

    <section class="sec">
      <h4 class="sec-title">{$t('replay.boundDeckRequired')}</h4>
      <p class="hint">{$t('replay.boundDeckRequiredHint')}</p>
      {#if adopted}
        <p class="hint adopt-hint">{$t('replay.syncedRecordFound')}</p>
      {/if}
      {#if record && deckId}
        <p class="hint">
          {$t('replay.boundCurrent', {
            values: {
              name: candidateDecks.find((d) => d.id === deckId)?.name ?? deckId ?? '',
            },
          })}
        </p>
      {/if}
      {#if !isTauri}
        <p class="hint">{$t('replay.webNoDeckBind')}</p>
      {:else}
        {#if candidateDecks.length === 0}
          <p class="hint">{$t('replay.deckSelectEmpty')}</p>
        {:else}
          <label class="field">
            <span class="field-label">{$t('replay.deckSelectLabel')}</span>
            <select
              class="input select"
              value={deckId ?? ''}
              onchange={(e) => onDeckChange((e.currentTarget as HTMLSelectElement).value)}
              disabled={saving}
            >
              <option value="">{$t('replay.deckSelectNone')}</option>
              {#each candidateDecks as d (d.id)}
                <option value={d.id}>
                  {d.name}{d.legend_name ? ` · ${d.legend_name}` : ''}
                </option>
              {/each}
            </select>
          </label>
          {#if deckId}
            <label class="field">
              <span class="field-label">{$t('replay.versionSelectLabel')}</span>
              <select
                class="input select"
                value={versionId ?? ''}
                onchange={(e) => (versionId = (e.currentTarget as HTMLSelectElement).value || null)}
                disabled={saving}
              >
                {#if versions.length === 0}
                  <option value="">{$t('replay.deckLoadFailed')}</option>
                {:else}
                  {#each versions as v (v.id)}
                    <option value={v.id}>
                      v{v.version_number}
                      {new Date(v.created_at ?? '').toLocaleDateString()}
                      {#if v.note}· {v.note}{/if}
                    </option>
                  {/each}
                {/if}
              </select>
            </label>
          {/if}
        {/if}
      {/if}
    </section>

    {#if isTauri && hasImportableDeck}
      <section class="sec import-sec">
        <h4 class="sec-title">{$t('replay.importFromReplayTitle')}</h4>
        <p class="hint">{$t('replay.importFromReplayHint')}</p>
        <label class="field">
          <span class="field-label">{$t('replay.importSourceLabel')}</span>
          <select
            class="input select"
            value={importSourcePlayer?.id ?? ''}
            onchange={(e) => {
              importSrcPlayerId = (e.currentTarget as HTMLSelectElement).value || null
              importSrcTouched = true
              if (!newDeckName.trim()) newDeckName = suggestDeckName()
            }}
            disabled={importing}
          >
            {#each playerList as p (p.id)}
              <option value={p.id} disabled={!p.deck}>
                {p.name ?? '?'}{p.deck ? '' : `（${$t('replay.importNoDeckHint')}）`}
              </option>
            {/each}
          </select>
        </label>

        <div class="import-row">
          <label class="field grow">
            <span class="field-label">{$t('replay.newDeckNameLabel')}</span>
            <input
              class="input text"
              type="text"
              bind:value={newDeckName}
              disabled={importing}
              placeholder={$t('replay.newDeckNamePlaceholder')}
            />
          </label>
          <button
            class="modal-btn"
            disabled={importing || !importSourcePlayer?.deck}
            onclick={() => void handleCreateDeck()}
          >
            {#if importing}
              <span class="spin"><LoaderCircle size={15} /></span>
            {:else}
              <Plus size={15} />
            {/if}
            {$t('replay.createDeckAction')}
          </button>
        </div>

        <div class="import-row">
          <label class="field grow">
            <span class="field-label">{$t('replay.overwriteDeckLabel')}</span>
            <select
              class="input select"
              value={overwriteTargetId ?? ''}
              onchange={(e) =>
                (overwriteTargetId = (e.currentTarget as HTMLSelectElement).value || null)}
              disabled={importing}
            >
              {#if candidateDecks.length === 0}
                <option value="">{$t('replay.deckSelectEmpty')}</option>
              {:else}
                {#each candidateDecks as d (d.id)}
                  <option value={d.id}>{d.name}</option>
                {/each}
              {/if}
            </select>
          </label>
          <button
            class="modal-btn"
            disabled={importing || !importSourcePlayer?.deck || !overwriteTargetId}
            onclick={() => void handleAddVersion()}
          >
            <Save size={15} />
            {$t('replay.overwriteDeckAction')}
          </button>
        </div>

        {#if missingCount > 0}
          <p class="hint warn-hint">
            {$t('replay.importMissingCards', { values: { n: missingCount } })}
          </p>
        {/if}
      </section>
    {/if}

    <section class="sec">
      <h4 class="sec-title">{$t('replay.gameResultTitle')}</h4>
      <p class="hint">{$t('replay.gameResultHint')}</p>
      <div class="game-list">
        {#each group.games ?? [] as game (game.gameNumber)}
          {@const s = scoreOf(game)}
          {@const roles = gameRoles(game)}
          <div class="game-row">
            <span class="game-side" title={selfPlayer?.name ?? ''}>
              <span class="side-avatar">
                <CardSimpleImage
                  url={selfPlayer ? legendDisplay(selfPlayer).img : ''}
                  name={selfPlayer ? legendDisplay(selfPlayer).cacheName : ''}
                />
              </span>
              {#if roles.self}
                <span
                  class="turn-tag"
                  class:first={roles.self === 'first'}
                  title={$t('replay.firstMoveHint', { values: { name: selfPlayer?.name ?? '-' } })}
                  >{$t(roles.self === 'first' ? 'replay.firstTurn' : 'replay.secondTurn')}</span
                >
              {/if}
            </span>
            <span class="game-score">{s.my ?? '-'}:{s.opp ?? '-'}</span>
            <span class="game-side opp" title={oppPlayer?.name ?? ''}>
              <span class="side-avatar">
                <CardSimpleImage
                  url={oppPlayer ? legendDisplay(oppPlayer).img : ''}
                  name={oppPlayer ? legendDisplay(oppPlayer).cacheName : ''}
                />
              </span>
              {#if roles.opp}
                <span
                  class="turn-tag"
                  class:first={roles.opp === 'first'}
                  title={$t('replay.firstMoveHint', { values: { name: oppPlayer?.name ?? '-' } })}
                  >{$t(roles.opp === 'first' ? 'replay.firstTurn' : 'replay.secondTurn')}</span
                >
              {/if}
            </span>
            <div class="seg">
              <button
                class="seg-btn"
                class:on={results[game.gameNumber] === 'win'}
                onclick={() => setResult(game.gameNumber, 'win')}
                disabled={!isTauri || saving}
              >
                {$t('replay.resultWin')}
              </button>
              <button
                class="seg-btn"
                class:on={results[game.gameNumber] === 'loss'}
                onclick={() => setResult(game.gameNumber, 'loss')}
                disabled={!isTauri || saving}
              >
                {$t('replay.resultLoss')}
              </button>
              <button
                class="seg-btn"
                class:on={results[game.gameNumber] === 'draw'}
                onclick={() => setResult(game.gameNumber, 'draw')}
                disabled={!isTauri || saving}
              >
                {$t('replay.resultDraw')}
              </button>
            </div>
          </div>
        {/each}
      </div>
    </section>

    <section class="sec">
      <h4 class="sec-title">{$t('replay.noteLabel')}</h4>
      <textarea
        class="note-input"
        bind:value={note}
        placeholder={$t('replay.notePlaceholder')}
        rows={3}
        disabled={!isTauri}></textarea>
    </section>
  {/if}

  {#snippet footer()}
    {#if !loading && isTauri}
      {#if record}
        <button class="modal-btn danger" disabled={saving} onclick={() => void unbind()}>
          <Unlink size={15} />
          {$t('replay.unbindAction')}
        </button>
      {/if}
      <button class="modal-btn primary" disabled={saving} onclick={() => void save()}>
        {#if saving}
          <span class="spin"><LoaderCircle size={15} /></span>
        {/if}
        {$t('common.save')}
      </button>
    {:else if !loading}
      <button class="modal-btn" onclick={onClose}>{$t('common.close')}</button>
    {/if}
  {/snippet}
</CommonModal>

<style>
  .loading-hint {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    color: var(--text-tertiary);
    font-size: var(--text-base);
    padding: 24px 0;
  }
  .spin {
    animation: loading-spin 0.9s linear infinite;
    display: inline-flex;
  }
  @keyframes loading-spin {
    to {
      transform: rotate(360deg);
    }
  }
  .sec {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .sec-title {
    margin: 0;
    font-size: var(--text-base);
    font-weight: 700;
    color: var(--text-primary);
  }
  .hint {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--text-tertiary);
  }
  .adopt-hint {
    color: #b45309;
    background: #fff8ec;
    border: 1px solid #fcd9a8;
    border-radius: var(--radius-sm);
    padding: 4px 8px;
  }
  .persp-row {
    display: flex;
    gap: 8px;
  }
  .persp-btn {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    flex: 1;
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    background: var(--surface);
    color: var(--text-primary);
    padding: 6px 10px;
    cursor: pointer;
    font-size: var(--text-sm);
  }
  .persp-btn:hover:not(:disabled) {
    background: var(--bg-hover);
  }
  .persp-btn.on {
    border-color: var(--accent-color);
    background: color-mix(in srgb, var(--accent-color) 10%, transparent);
  }
  .persp-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
  .persp-avatar {
    width: 24px;
    aspect-ratio: 744 / 1039;
    flex: none;
    border-radius: 3px;
    overflow: hidden;
    border: 1px solid var(--border-color);
    background: var(--surface-muted);
  }
  .persp-avatar :global(img),
  .dl-header-img :global(img),
  .dl-card-img :global(img) {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .persp-name {
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .persp-tag {
    margin-left: auto;
    font-size: var(--text-xs);
    color: var(--text-tertiary);
    flex: none;
  }
  .dl-header {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    background: var(--surface);
    color: var(--text-primary);
    padding: 6px 10px;
    cursor: pointer;
    font-size: var(--text-base);
    text-align: left;
  }
  .dl-header:hover:not(:disabled) {
    background: var(--bg-hover);
  }
  .dl-header:disabled {
    opacity: 0.6;
    cursor: default;
  }
  .dl-header-legend {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }
  .dl-header-img {
    width: 36px;
    aspect-ratio: 744 / 1039;
    flex: none;
    border-radius: 3px;
    overflow: hidden;
    border: 1px solid var(--border-color);
    background: var(--surface-muted);
  }
  .dl-header-name {
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .dl-chevron {
    margin-left: auto;
    color: var(--text-tertiary);
    display: inline-flex;
    flex: none;
  }
  .dl-body {
    display: flex;
    flex-direction: column;
    gap: 6px;
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    padding: 8px;
    background: var(--surface-muted);
  }
  .zone {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .zone-label {
    font-size: var(--text-xs);
    font-weight: 600;
    color: var(--text-secondary);
    margin-top: 2px;
  }
  .zone-cards {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    max-height: 220px;
    overflow-y: auto;
  }
  .dl-card {
    display: inline-flex;
  }
  .dl-card-img {
    position: relative;
    width: 50px;
    aspect-ratio: 744 / 1039;
    flex: none;
    border-radius: 3px;
    overflow: hidden;
    border: 1px solid var(--border-color);
    background: var(--surface-muted);
  }
  .dl-card-count {
    position: absolute;
    right: 0;
    bottom: 0;
    font-size: 10px;
    font-weight: 700;
    line-height: 1;
    padding: 1px 3px;
    background: rgba(0, 0, 0, 0.72);
    color: #fff;
    border-top-left-radius: 3px;
    font-variant-numeric: tabular-nums;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .field-label {
    font-size: var(--text-xs);
    font-weight: 600;
    color: var(--text-secondary);
  }
  .input.select {
    width: 100%;
    box-sizing: border-box;
    background: var(--surface);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    color: var(--text-primary);
    font-size: var(--text-base);
    padding: 6px 8px;
    font-family: inherit;
  }
  .input.select:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
  .input.text {
    width: 100%;
    box-sizing: border-box;
    background: var(--surface-muted);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    color: var(--text-primary);
    font-size: var(--text-base);
    padding: 6px 8px;
    font-family: inherit;
  }
  .input.text:focus {
    outline: none;
    border-color: var(--accent-color);
  }
  .import-sec {
    border-top: 1px dashed var(--border-color);
    padding-top: 10px;
  }
  .import-row {
    display: flex;
    align-items: flex-end;
    gap: 8px;
  }
  .grow {
    flex: 1;
    min-width: 0;
  }
  .warn-hint {
    color: #b45309;
  }
  .game-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .game-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .game-side {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    width: 44px;
    flex: none;
  }
  .game-side .side-avatar {
    width: 22px;
    aspect-ratio: 744 / 1039;
    flex: none;
    border-radius: 3px;
    overflow: hidden;
    border: 1px solid var(--border-color);
    background: var(--surface-muted);
  }
  .game-side.opp {
    margin-left: auto;
  }
  .game-side .side-avatar :global(img) {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .turn-tag {
    font-size: 10px;
    font-weight: 700;
    line-height: 1.2;
    padding: 1px 5px;
    border-radius: 999px;
    background: var(--surface-muted);
    color: var(--text-secondary);
    white-space: nowrap;
  }
  .turn-tag.first {
    background: var(--accent-color);
    color: #fff;
  }
  .game-score {
    font-variant-numeric: tabular-nums;
    font-size: var(--text-sm);
    color: var(--text-secondary);
    min-width: 48px;
    text-align: center;
    flex: none;
  }
  .seg {
    display: inline-flex;
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    overflow: hidden;
    flex: none;
  }
  .seg-btn {
    border: none;
    background: transparent;
    color: var(--text-secondary);
    font-size: var(--text-sm);
    padding: 3px 12px;
    cursor: pointer;
    transition: all 0.12s ease;
  }
  .seg-btn:hover:not(:disabled) {
    background: var(--bg-hover);
  }
  .seg-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .seg-btn.on {
    background: var(--accent-color);
    color: #fff;
    font-weight: 600;
  }
  .note-input {
    width: 100%;
    resize: vertical;
    box-sizing: border-box;
    background: var(--surface-muted);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    color: var(--text-primary);
    font-size: var(--text-base);
    padding: 8px 10px;
    font-family: inherit;
  }
  .note-input:focus {
    outline: none;
    border-color: var(--accent-color);
  }
  .note-input:disabled {
    opacity: 0.6;
  }
  .modal-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    border-radius: var(--radius-md);
    padding: 7px 16px;
    font-size: var(--text-base);
    cursor: pointer;
    border: 1px solid var(--border-color);
    background: var(--surface);
    color: var(--text-primary);
  }
  .modal-btn:hover {
    background: var(--bg-hover);
  }
  .modal-btn.primary {
    background: var(--accent-color);
    color: #fff;
    border-color: transparent;
  }
  .modal-btn.primary:hover {
    filter: brightness(1.08);
  }
  .modal-btn.danger {
    color: #b42318;
    border-color: #f5b5ad;
    background: transparent;
    margin-right: auto;
  }
  .modal-btn.danger:hover {
    background: #fdecea;
  }
  .modal-btn:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
</style>
