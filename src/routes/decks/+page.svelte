<script lang="ts">
  import { beforeNavigate, goto } from '$app/navigation'
  import CardSimpleImage from '$lib/components/cards/CardSimpleImage.svelte'
  import {
    deleteDeck,
    duplicateDeck,
    getDeckList,
    toggleFavorite,
    getMatchStatsForDecks,
    importDecksFromJson,
    type ImportDeckPayload,
    type DeckListResult,
  } from '$lib/db'
  import { getRelativeTime } from '$lib/utils/time-helper'
  import { DECK_FORMATS } from '$lib/decks/format'
  import { setTopbar, showToast } from '$lib/stores/ui-store.svelte'
  import { ttsState } from '$lib/stores/tts'
  import { spawnDeckToTTS } from '$lib/services/deck-tts-service'
  import {
    parseDeckCodeText,
    resolveDeckCards,
    parseGlobalOfficialText,
    resolveGlobalOfficialText,
    type DecodedDeckResult,
  } from '$lib/decks/deck-import'
  import { setPendingDeckImport } from '$lib/stores/deck-import.svelte'
  import CommonModal from '$lib/components/ui/CommonModal.svelte'
  import {
    Plus,
    Search,
    Funnel,
    Copy,
    Trash2,
    Folder,
    HeartIcon,
    Import as ImportIcon,
    FileUp,
    CircleAlert,
    CircleCheck,
    Import,
    Download,
    Send,
    LoaderCircle,
    CopyPlus,
  } from '@lucide/svelte'
  import { ask, message, open } from '@tauri-apps/plugin-dialog'
  import { readText } from '@tauri-apps/plugin-clipboard-manager'
  import { readTextFile } from '$lib/services/db-file-service'
  import { onMount } from 'svelte'

  let allDecks = $state<DeckListResult[]>([])
  let matchStatsMap = $state<Map<string, import('$lib/db/types').MatchSummary>>(new Map())

  let searchQuery = $state('')
  let selectedFormat = $state('全部')
  let showFavoritesOnly = $state(false)
  let activeTags = $state<string[]>([])
  let tagMatchMode = $state<'all' | 'any'>('all')
  let showTagSuggestions = $state(false)
  let activeSuggestionIndex = $state(-1)

  let showImportModal = $state(false)
  let importTab = $state<'code' | 'json' | 'text'>('code')
  let importCode = $state('')
  let importCodeError = $state('')
  let importCodeValid = $state(false)
  let importingCode = $state(false)
  let importedResult = $state<DecodedDeckResult | null>(null)

  let sendingTtsDeckId = $state<string | null>(null)

  let importText = $state('')
  let importTextError = $state('')
  let importTextValid = $state(false)
  let importingText = $state(false)
  let importedTextResult = $state<DecodedDeckResult | null>(null)

  let jsonFileName = $state('')
  let jsonDeckList = $state<
    { id: string; name: string; updatedAt: string; versionCount: number }[]
  >([])
  let selectedJsonDeckIds = $state<string[]>([])
  let pendingJsonDecks = $state<ImportDeckPayload[]>([])
  let importingJson = $state(false)

  export const formats = ['全部', ...DECK_FORMATS]

  const allTags = $derived(
    [...new Set(allDecks.flatMap((d) => d.tags ?? []))].sort((a, b) => a.localeCompare(b))
  )

  const tagSuggestions = $derived.by(() => {
    if (!searchQuery.trim()) return []
    const q = searchQuery.trim().toLowerCase()
    return allTags.filter((t) => t.toLowerCase().includes(q) && !activeTags.includes(t)).slice(0, 8)
  })

  const filteredDecks = $derived(
    allDecks.filter((deck) => {
      const q = searchQuery.trim().toLowerCase()
      const deckTags = deck.tags ?? []
      const matchesSearch =
        !q ||
        deck.name.toLowerCase().includes(q) ||
        deckTags.some((t) => t.toLowerCase().includes(q))
      const matchesFormat = selectedFormat === '全部' || deck.format === selectedFormat
      const matchesFavorite = !showFavoritesOnly || deck.is_favorite
      const matchesTags =
        activeTags.length === 0 ||
        (tagMatchMode === 'all'
          ? activeTags.every((t) => deckTags.includes(t))
          : activeTags.some((t) => deckTags.includes(t)))
      return matchesSearch && matchesFormat && matchesFavorite && matchesTags
    })
  )

  function addTag(tag: string) {
    if (!tag || activeTags.includes(tag)) return
    activeTags = [...activeTags, tag]
    searchQuery = ''
    showTagSuggestions = false
    activeSuggestionIndex = -1
  }

  function removeTag(tag: string) {
    activeTags = activeTags.filter((t) => t !== tag)
  }

  function handleTagKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      showTagSuggestions = false
      return
    }
    if (tagSuggestions.length === 0) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      activeSuggestionIndex = (activeSuggestionIndex + 1) % tagSuggestions.length
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      activeSuggestionIndex =
        activeSuggestionIndex <= 0 ? tagSuggestions.length - 1 : activeSuggestionIndex - 1
    } else if (event.key === 'Enter') {
      const idx = activeSuggestionIndex >= 0 ? activeSuggestionIndex : 0
      if (tagSuggestions[idx]) {
        event.preventDefault()
        addTag(tagSuggestions[idx])
      }
    }
  }

  async function toggleFavoriteAction(deckId: string) {
    await toggleFavorite(deckId)
    init()
  }

  async function deleteDeckAsk(name: string, deckId: string) {
    const confirm = await ask(`你确定要删除 ${name} 吗？`, {
      kind: 'warning',
      okLabel: '确定',
      cancelLabel: '取消',
    })

    if (confirm) {
      if (await deleteDeck(deckId)) {
        init()
      }
    }
  }

  async function duplicateDeckAsk(name: string, deckId: string) {
    const confirm = await ask(`你确定要创建 ${name} 副本吗？`, {
      kind: 'warning',
      okLabel: '确定',
      cancelLabel: '取消',
    })

    if (!confirm) return

    try {
      const newDeckId = await duplicateDeck(deckId)
      if (newDeckId) {
        message('复制成功！').then(init)
      }
    } catch (error) {
      console.error(error)
      message('复制失败')
    }
  }

  async function generateDeckTTS(name: string, deckId: string) {
    if (sendingTtsDeckId) return
    sendingTtsDeckId = deckId
    try {
      const count = await spawnDeckToTTS(deckId)
      showToast(`已将 ${name} 的 ${count} 张卡牌发送到 TTS`, 'success')
    } catch (error) {
      console.error('[Decks] TTS 生成失败:', error)
      showToast('生成失败，请检查 TTS 连接', 'error')
    } finally {
      sendingTtsDeckId = null
    }
  }

  function openImportDeckModal() {
    importTab = 'code'
    importCode = ''
    importCodeError = ''
    importCodeValid = false
    importedResult = null
    importText = ''
    importTextError = ''
    importTextValid = false
    importedTextResult = null
    jsonFileName = ''
    jsonDeckList = []
    selectedJsonDeckIds = []
    pendingJsonDecks = []
    showImportModal = true
  }

  async function pasteImportCode() {
    try {
      const text = await readText()
      if (text) {
        importCode = text
        validateImportCode()
      }
    } catch {
      importCodeError = '读取剪贴板失败'
      importCodeValid = false
    }
  }

  function validateImportCode() {
    const decoded = parseDeckCodeText(importCode)
    importCodeError = decoded ? '' : '无法解析该卡组代码，请检查是否复制完整。'
    importCodeValid = !!decoded
  }

  async function confirmCodeImport() {
    const decoded = parseDeckCodeText(importCode)
    if (!decoded) {
      importCodeError = '无法解析该卡组代码，请检查是否复制完整。'
      importCodeValid = false
      return
    }
    importingCode = true
    try {
      const result = await resolveDeckCards(decoded)
      const totalResolved =
        result.deck.mainDeckCards.length +
        result.deck.runeCards.length +
        result.deck.battlefieldCards.length +
        result.deck.sideboardCards.length +
        result.deck.legendCards.length +
        result.deck.championCards.length
      if (totalResolved === 0) {
        importCodeError = `本地缺少全部卡牌（${result.missingCount} 张），无法导入：${result.missingCodes
          .slice(0, 5)
          .join(', ')}`
        importCodeValid = false
        return
      }
      importedResult = result
      setPendingDeckImport(result)
      showImportModal = false
      goto('/decks/builder?import=1')
    } finally {
      importingCode = false
    }
  }

  function validateImportText() {
    const parsed = parseGlobalOfficialText(importText)
    console.log(parsed);
    const hasAny =
      Object.values(parsed.zones).flat().length > 0 && parsed.errors.length === 0
    importTextError = parsed.errors[0] ?? ''
    importTextValid = hasAny
  }

  async function confirmTextImport() {
    const parsed = parseGlobalOfficialText(importText)
    const hasAny = Object.values(parsed.zones).flat().length > 0
    if (!hasAny) {
      importTextError = parsed.errors[0] ?? '未解析到任何卡牌，请检查文本格式。'
      importTextValid = false
      return
    }
    importingText = true
    try {
      const result = await resolveGlobalOfficialText(parsed)
      const totalResolved =
        result.deck.mainDeckCards.length +
        result.deck.runeCards.length +
        result.deck.battlefieldCards.length +
        result.deck.sideboardCards.length +
        result.deck.legendCards.length +
        result.deck.championCards.length
      if (totalResolved === 0) {
        importTextError = `本地匹配不到任何卡牌名称：${result.missingCodes.slice(0, 5).join(', ')}`
        importTextValid = false
        return
      }
      importedTextResult = result
      setPendingDeckImport(result)
      showImportModal = false
      goto('/decks/builder?import=1')
    } finally {
      importingText = false
    }
  }

  function parseImportFile(content: string): ImportDeckPayload[] {
    let parsed: unknown
    try {
      parsed = JSON.parse(content)
    } catch {
      return []
    }
    if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as any).decks)) return []

    const decks: ImportDeckPayload[] = []
    for (const d of (parsed as any).decks) {
      if (!d || typeof d !== 'object' || !d.name) continue
      const versions = Array.isArray(d.versions) ? d.versions : []
      const cleanVersions = versions
        .filter((v: any) => v && typeof v.version_number === 'number')
        .map((v: any) => ({
          version_number: v.version_number,
          note: v.note ?? null,
          created_at: v.created_at ?? null,
          cards: (Array.isArray(v.cards) ? v.cards : [])
            .filter((c: any) => c && (c.card_id || c.print_code) && c.quantity > 0 && c.zone)
            .map((c: any) => ({
              card_id: c.card_id,
              print_code: c.print_code ?? null,
              quantity: c.quantity,
              zone: c.zone,
            })),
        }))

      const cleanMatches = (Array.isArray(d.matches) ? d.matches : [])
        .filter((m: any) => m && Array.isArray(m.games) && m.games.length > 0)
        .map((m: any) => ({
          group_name: m.group_name ?? null,
          opponent_name: m.opponent_name ?? null,
          opponent_deck: m.opponent_deck ?? null,
          opp_legend_id: m.opp_legend_id ?? null,
          opp_legend_print_id: m.opp_legend_print_id ?? null,
          opp_legend_name: m.opp_legend_name ?? null,
          opp_legend_image: m.opp_legend_image ?? null,
          deck_version_id: m.deck_version_id ?? null,
          deck_version_number:
            typeof m.deck_version_number === 'number' ? m.deck_version_number : null,
          best_of: typeof m.best_of === 'number' ? m.best_of : null,
          note: m.note ?? null,
          played_at: m.played_at ?? null,
          created_at: m.created_at ?? null,
          updated_at: m.updated_at ?? null,
          games: m.games
            .filter((g: any) => g && typeof g.game_number === 'number')
            .map((g: any) => ({
              game_number: g.game_number,
              my_score: g.my_score ?? null,
              opp_score: g.opp_score ?? null,
              win_type: g.win_type ?? 'normal',
              is_win: !!g.is_win,
              is_first:
                g.is_first === true || g.is_first === 1
                  ? true
                  : g.is_first === false || g.is_first === 0
                    ? false
                    : null,
              win_reason: g.win_reason ?? null,
              log: g.log ?? null,
            })),
        }))

      decks.push({
        name: d.name,
        description: d.description ?? null,
        format: d.format ?? null,
        cover_image: d.cover_image ?? null,
        tags: Array.isArray(d.tags) ? d.tags.filter((t: any) => typeof t === 'string') : [],
        is_favorite: !!d.is_favorite,
        created_at: d.created_at ?? null,
        updated_at: d.updated_at ?? null,
        versions: cleanVersions,
        matches: cleanMatches,
      })
    }
    return decks
  }

  function toggleJsonDeck(id: string) {
    selectedJsonDeckIds = selectedJsonDeckIds.includes(id)
      ? selectedJsonDeckIds.filter((d) => d !== id)
      : [...selectedJsonDeckIds, id]
  }

  function toggleAllJsonDecks() {
    selectedJsonDeckIds =
      selectedJsonDeckIds.length === jsonDeckList.length ? [] : jsonDeckList.map((d) => d.id)
  }

  async function openJsonFile() {
    const src = await open({
      title: '选择导出的 JSON 文件',
      multiple: false,
      filters: [{ name: 'JSON 文件', extensions: ['json'] }],
    })
    if (!src) return

    let content: string
    try {
      content = await readTextFile(String(src))
    } catch (e) {
      await message(e instanceof Error ? e.message : '读取文件失败', {
        title: '导入',
        kind: 'error',
      })
      return
    }

    const decks = parseImportFile(content)
    if (decks.length === 0) {
      await message('文件格式不正确或没有可导入的卡组，请选择 Rune Archive 导出的 JSON 文件。', {
        title: '导入',
        kind: 'error',
      })
      return
    }

    jsonFileName = String(src).split(/[\\/]/).pop() ?? String(src)
    jsonDeckList = decks.map((d, i) => ({
      id: String(i),
      name: d.name,
      updatedAt: d.updated_at ? new Date(d.updated_at).toLocaleString() : '未知',
      versionCount: d.versions.length,
    }))
    selectedJsonDeckIds = jsonDeckList.map((d) => d.id)
    pendingJsonDecks = decks
  }

  async function confirmJsonImport() {
    if (selectedJsonDeckIds.length === 0) return
    importingJson = true
    try {
      const chosen = pendingJsonDecks.filter((_, i) => selectedJsonDeckIds.includes(String(i)))
      const { imported, missingCards } = await importDecksFromJson(chosen, {
        latestOnly: false,
        filterMissingCards: true,
      })
      const missingText = missingCards > 0 ? `（跳过 ${missingCards} 张本地缺失的卡牌）` : ''
      await message(`已导入 ${imported} 副卡组${missingText}！`, { title: '导入', kind: 'info' })
      showImportModal = false
      init()
    } catch (e) {
      await message(e instanceof Error ? e.message : '导入失败', { title: '导入', kind: 'error' })
    } finally {
      importingJson = false
    }
  }

  const init = async () => {
    const { decks } = await getDeckList()
    allDecks = decks
    matchStatsMap = await getMatchStatsForDecks(decks.map((d) => d.id))
  }

  onMount(() => {
    init()
  })

  $effect(() => {
    setTopbar({
      title: '我的卡组',
      description: `管理你的所有卡组，共 ${allDecks.length} 副`,
      actions: [
        {
          key: 'new-deck',
          label: '新建卡组',
          icon: Plus,
          variant: 'primary',
          priority: 0,
          onClick: () => goto('/decks/builder'),
        },
        {
          key: 'import-deck',
          label: '导入卡组',
          icon: Download,
          variant: 'ghost',
          onClick: () => openImportDeckModal(),
        },
      ],
    })
  })

  beforeNavigate(({ from, cancel, type, delta }) => {
    const isBackward = type === 'popstate' && delta && delta < 0
    if (isBackward) {
      cancel()
      goto('/')
    }
  })
</script>

<div class="decks-page">
  <section class="filter-bar">
    <div
      class="search-box"
      onfocusout={(e) => {
        const next = e.relatedTarget as Node | null
        if (next && (e.currentTarget as HTMLElement).contains(next)) return
        showTagSuggestions = false
      }}
    >
      <div class="search-icon">
        <Search size={18} />
      </div>
      <input
        type="text"
        placeholder="搜索卡组名称或标签..."
        bind:value={searchQuery}
        class="search-input"
        onfocus={() => (showTagSuggestions = true)}
        oninput={() => {
          showTagSuggestions = true
          activeSuggestionIndex = -1
        }}
        onkeydown={handleTagKeydown}
      />
      {#if showTagSuggestions && tagSuggestions.length > 0}
        <div class="tag-suggest-popdown">
          {#each tagSuggestions as tag, i (tag)}
            <button
              type="button"
              class="suggestion-item"
              class:active={i === activeSuggestionIndex}
              onmousedown={(e) => e.preventDefault()}
              onclick={() => addTag(tag)}
            >
              <span class="tag-text">{tag}</span>
              <span class="tag-hint">回车/点击添加为筛选条件</span>
            </button>
          {/each}
        </div>
      {/if}
    </div>

    <div class="filter-controls">
      <div class="format-filter">
        <Funnel size={16} class="filter-icon" />
        <select bind:value={selectedFormat} class="format-select">
          {#each formats as format}
            <option value={format}>{format}</option>
          {/each}
        </select>
      </div>

      <button
        class="button button-ghost favorite-filter"
        class:active={showFavoritesOnly}
        onclick={() => (showFavoritesOnly = !showFavoritesOnly)}
      >
        <Folder size={16} />
        <span>收藏</span>
      </button>
    </div>
  </section>

  {#if activeTags.length > 0}
    <div class="tag-filter-bar">
      <div class="tag-match-toggle">
        <button
          class="tag-mode-btn"
          class:active={tagMatchMode === 'all'}
          onclick={() => (tagMatchMode = 'all')}
        >
          全部满足
        </button>
        <button
          class="tag-mode-btn"
          class:active={tagMatchMode === 'any'}
          onclick={() => (tagMatchMode = 'any')}
        >
          任一满足
        </button>
      </div>
      <div class="active-tags">
        {#each activeTags as tag (tag)}
          <span class="active-tag-chip">
            {tag}
            <button
              type="button"
              class="active-tag-remove"
              onclick={() => removeTag(tag)}
              aria-label="移除标签"
            >
              ×
            </button>
          </span>
        {/each}
      </div>
      <button class="clear-tags-btn" onclick={() => (activeTags = [])}>清除</button>
    </div>
  {/if}

  {#if filteredDecks.length === 0}
    <div class="empty-state">
      <Folder size={48} class="empty-icon" />
      <h3>没有找到匹配的卡组</h3>
      <p>试试调整筛选条件或创建新卡组</p>
    </div>
  {:else}
    <div class="decks-grid">
      {#each filteredDecks as deck (deck.id)}
        {@const s = matchStatsMap.get(deck.id)}
        <div
          class="deck-card"
          class:favorite={deck.is_favorite}
          role="presentation"
          onclick={() => goto(`/decks/${deck.id}`)}
        >
          <div class="deck-header">
            <div class="deck-avatar">
              <CardSimpleImage
                url={deck.legend_image}
                name={`${deck.legend_print_code ?? 'default'}-${deck.legend_lang ?? 'default'}`}
              />
            </div>
            <div class="deck-info">
              <h3 class="deck-name">{deck.name}</h3>
              <span class="deck-format-badge">{deck.format}</span>
            </div>
          </div>

          <div class="deck-stats-row">
            <div class="stat-item">
              <span class="stat-label">版本</span>
              <span class="stat-value">v{deck.latest_version_number?.toFixed(1)}</span>
            </div>
            <div class="stat-item">
              <span class="stat-label">卡牌</span>
              <span class="stat-value">{deck.latest_version_card_count}</span>
            </div>
            <div class="stat-item">
              <span class="stat-label">战绩</span>
              <span class="stat-value record">
                {#if s && s.games > 0}
                  <span class="win">{s.wins}</span>
                  <span class="separator">-</span>
                  <span class="loss">{s.losses}</span>
                {:else}
                  <span class="muted">-</span>
                {/if}
              </span>
            </div>
            <div class="stat-item" title={new Date(deck.updated_at!).toLocaleString()}>
              <span class="stat-label">更新</span>
              <span class="stat-value time">{getRelativeTime(deck.updated_at!)}</span>
            </div>
          </div>

          {#if deck.tags && deck.tags.length > 0}
            <div class="deck-tag-row">
              {#each deck.tags.slice(0, 3) as tag (tag)}
                <span class="deck-tag-chip">{tag}</span>
              {/each}
              {#if deck.tags.length > 3}
                <span class="deck-tag-more">+{deck.tags.length - 3}</span>
              {/if}
            </div>
          {/if}

          <div class="deck-actions">
            <button
              class="button-icon action-btn"
              onclick={(e) => {
                e.stopPropagation()
                duplicateDeckAsk(deck.name, deck.id)
              }}
              title="复制卡组副本"
            >
              <CopyPlus size={16} />
            </button>
            <button
              class="button-icon action-btn"
              onclick={(e) => {
                e.stopPropagation()
                toggleFavoriteAction(deck.id)
              }}
              title="收藏/取消收藏"
            >
              {#if deck.is_favorite}
                <HeartIcon fill="red" color={'red'} size={16} />
              {:else}
                <HeartIcon size={16} />
              {/if}
            </button>
            <button
              class="button-icon action-btn action-btn-danger"
              onclick={(e) => {
                e.stopPropagation()
                deleteDeckAsk(deck.name, deck.id)
              }}
              title="删除卡组"
            >
              <Trash2 size={16} />
            </button>

            {#if $ttsState.sendPort}
              <button
              style="margin-left: auto;"
                class="button button-ghost"
                class:tts-sending={sendingTtsDeckId === deck.id}
                onclick={(e) => {
                  e.stopPropagation()
                  generateDeckTTS(deck.name, deck.id)
                }}
                disabled={sendingTtsDeckId !== null && sendingTtsDeckId !== deck.id}
                title="生成卡牌TTS"
              >
                {#if sendingTtsDeckId === deck.id}
                  <LoaderCircle size={16} class="spin" />
                {:else}
                  TTS 生成
                {/if}
              </button>
            {/if}
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>

<CommonModal
  open={showImportModal}
  title="导入卡组"
  subtitle="通过卡组代码或 Rune Archive JSON 文件导入"
  closable={!importingCode && !importingJson}
  onclose={() => (showImportModal = false)}
>
  <div class="import-method-list">
    <button
      type="button"
      class="import-method-option"
      class:selected={importTab === 'code'}
      onclick={() => (importTab = 'code')}
    >
      <span class="import-method-label">卡组代码</span>
      <span class="import-method-desc">粘贴 Piltover / Riftbound 卡组代码，支持含备牌与选定英雄</span>
    </button>
    <button
      type="button"
      class="import-method-option"
      class:selected={importTab === 'json'}
      onclick={() => (importTab = 'json')}
    >
      <span class="import-method-label">JSON 文件</span>
      <span class="import-method-desc">从 Rune Archive 导出的 JSON 文件导入副卡组</span>
    </button>
    <button
      type="button"
      class="import-method-option"
      class:selected={importTab === 'text'}
      onclick={() => (importTab = 'text')}
    >
      <span class="import-method-label">国际官方文本</span>
      <span class="import-method-desc">粘贴官方英文文本格式卡组清单（Legend/Champion/Main Deck/Battlefields/Rune Pool/Sideboard）</span>
    </button>
  </div>

  {#if importTab === 'code'}
    <div class="import-code-block">
      <div class="import-textarea-row">
        <textarea
          class="import-code-input"
          placeholder="粘贴 Piltover / Riftbound 卡组代码，例如 CIAAAAAAAAAQCAAAA...（支持备牌与选定英雄）"
          rows={5}
          bind:value={importCode}
          oninput={validateImportCode}
          disabled={importingCode}></textarea>
        <button
          type="button"
          class="button button-ghost paste-btn"
          onclick={pasteImportCode}
          disabled={importingCode}
        >
          粘贴
        </button>
      </div>

      {#if importCode && importCodeValid}
        <div class="import-hint import-hint-ok">
          <CircleCheck size={16} />
          <span>代码有效</span>
        </div>
      {:else if importCodeError}
        <div class="import-hint import-hint-error">
          <CircleAlert size={16} />
          <span>{importCodeError}</span>
        </div>
      {/if}

      {#if importedResult}
        <div class="import-preview">
          <p>解析成功：</p>
          <ul>
            <li>主牌堆 {importedResult.deck.mainDeckCards.length} 张</li>
            <li>符文 {importedResult.deck.runeCards.length} 张</li>
            <li>战场 {importedResult.deck.battlefieldCards.length} 张</li>
            <li>备牌 {importedResult.deck.sideboardCards.length} 张</li>
            {#if importedResult.deck.legendCards.length > 0}
              <li>传奇 {importedResult.deck.legendCards.length} 张</li>
            {/if}
            {#if importedResult.deck.championCards.length > 0}
              <li>选定英雄 {importedResult.deck.championCards.length} 张</li>
            {/if}
          </ul>
          {#if importedResult.missingCount > 0}
            <p class="import-warn">
              本地缺少 {importedResult.missingCount} 张卡牌（{importedResult.missingCodes
                .slice(0, 5)
                .join(', ')}{importedResult.missingCount > 5
                ? '...'
                : ''}），导入后请到编辑器手动补充。
            </p>
          {/if}
        </div>
      {/if}
    </div>
  {:else if importTab === 'json'}
    <div class="import-json-block">
      {#if jsonDeckList.length === 0}
        <div class="import-json-empty">
          <FileUp size={40} />
          <p>选择 Rune Archive 导出的 JSON 文件，预览后选择要导入的卡组。</p>
          <button class="button button-ghost" onclick={openJsonFile} disabled={importingJson}>
            选择 JSON 文件
          </button>
        </div>
      {:else}
        <div class="import-json-file">
          <span class="import-json-name">{jsonFileName}</span>
          <button class="button button-ghost" onclick={openJsonFile} disabled={importingJson}>
            重新选择
          </button>
        </div>
        <label class="import-select-all">
          <input
            type="checkbox"
            checked={selectedJsonDeckIds.length === jsonDeckList.length && jsonDeckList.length > 0}
            onchange={toggleAllJsonDecks}
            disabled={importingJson}
          />
          <span>全选（{jsonDeckList.length} 副卡组）</span>
        </label>
        <div class="import-json-list">
          {#each jsonDeckList as deck}
            <label class="import-json-row">
              <input
                type="checkbox"
                checked={selectedJsonDeckIds.includes(deck.id)}
                onchange={() => toggleJsonDeck(deck.id)}
                disabled={importingJson}
              />
              <span class="import-json-info">
                <span class="import-json-row-name">{deck.name}</span>
                <span class="import-json-row-meta">
                  {deck.versionCount} 个版本 · {deck.updatedAt}
                </span>
              </span>
            </label>
          {/each}
        </div>
      {/if}
    </div>
  {:else}
    <div class="import-text-block">
      <div class="import-textarea-row">
        <textarea
          class="import-code-input"
          placeholder={'粘贴国际官方文本格式的卡组清单，例如：\nLegend: 1 Master Yi, Wuju Bladesman\nChampion: 1 Master Yi, Tempered\nMain Deck: 3 Charm 3 Defy 3 Discipline...\nBattlefields: 1 The Arena\'s Greatest...\nRune Pool: 7 Body Rune 5 Calm Rune\nSideboard: 3 Disarming Rake 2 Alpha Strike...'}
          rows={9}
          bind:value={importText}
          oninput={validateImportText}
          disabled={importingText}
        ></textarea>
      </div>

      {#if importText && importTextValid && !importTextError}
        <div class="import-hint import-hint-ok">
          <CircleCheck size={16} />
          <span>文本格式有效</span>
        </div>
      {:else if importTextError}
        <div class="import-hint import-hint-error">
          <CircleAlert size={16} />
          <span>{importTextError}</span>
        </div>
      {/if}

      {#if importedTextResult}
        <div class="import-preview">
          <p>解析成功：</p>
          <ul>
            <li>传奇 {importedTextResult.deck.legendCards.length} 张</li>
            <li>选定英雄 {importedTextResult.deck.championCards.length} 张</li>
            <li>主牌堆 {importedTextResult.deck.mainDeckCards.length} 张</li>
            <li>战场 {importedTextResult.deck.battlefieldCards.length} 张</li>
            <li>符文 {importedTextResult.deck.runeCards.length} 张</li>
            <li>备牌 {importedTextResult.deck.sideboardCards.length} 张</li>
          </ul>
          {#if importedTextResult.missingCount > 0}
            <p class="import-warn">
              本地匹配不到 {importedTextResult.missingCount} 张（{importedTextResult.missingCodes
                .slice(0, 5)
                .join(', ')}{importedTextResult.missingCount > 5 ? '...' : ''}），导入后请到编辑器手动补充。
            </p>
          {/if}
        </div>
      {/if}
    </div>
  {/if}

  {#snippet footer()}
    <button class="button button-ghost" onclick={() => (showImportModal = false)}>取消</button>
    {#if importTab === 'code'}
      <button
        class="button button-primary"
        disabled={!importCodeValid || importingCode}
        onclick={confirmCodeImport}
      >
        {importingCode ? '解析中...' : '导入到编辑器'}
      </button>
    {:else if importTab === 'text'}
      <button
        class="button button-primary"
        disabled={!importTextValid || importingText}
        onclick={confirmTextImport}
      >
        {importingText ? '解析中...' : '导入到编辑器'}
      </button>
    {:else if jsonDeckList.length > 0}
      <button
        class="button button-primary"
        disabled={importingJson || selectedJsonDeckIds.length === 0}
        onclick={confirmJsonImport}
      >
        {importingJson ? '导入中...' : `导入 ${selectedJsonDeckIds.length} 副卡组`}
      </button>
    {/if}
  {/snippet}
</CommonModal>

<style>
  .decks-page {
    max-width: 1200px;
    margin: 0 auto;
    padding: 24px 32px;
  }

  @media (max-width: 767.99px) {
    .decks-page {
      padding: 24px 16px 80px;
    }
  }

  .filter-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 24px;
    flex-wrap: wrap;
  }

  .search-box {
    position: relative;
    flex: 1;
    min-width: 200px;
    max-width: 400px;
  }

  .search-icon {
    position: absolute;
    left: 12px;
    top: 50%;
    transform: translateY(-50%);
    color: var(--text-tertiary);
    pointer-events: none;
  }

  .search-input {
    width: 100%;
    padding: 10px 12px 10px 40px;
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    font-size: var(--text-base);
    background: var(--bg-primary);
    color: var(--text-primary);
    outline: none;
    transition: border-color 0.15s;
  }

  .search-input:focus {
    border-color: var(--accent-color);
    box-shadow: 0 0 0 3px color-mix(in oklab, var(--accent-color) 15%, transparent);
  }

  .search-input::placeholder {
    color: var(--text-tertiary);
  }

  .filter-controls {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .format-filter {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    background: var(--bg-primary);
  }

  :global(.filter-icon) {
    color: var(--text-tertiary);
    flex-shrink: 0;
  }

  .format-select {
    border: none;
    background: transparent;
    font-size: var(--text-base);
    color: var(--text-primary);
    outline: none;
    cursor: pointer;
    min-width: 60px;
  }

  .favorite-filter.active {
    background: var(--text-primary);
    color: white;
    border-color: var(--text-primary);
  }

  .favorite-filter.active:hover {
    background: #2f2e29;
    color: white;
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 80px 24px;
    text-align: center;
  }

  :global(.empty-icon) {
    color: var(--text-tertiary);
    margin-bottom: 16px;
  }

  .empty-state h3 {
    font-size: var(--text-xl);
    font-weight: 600;
    margin: 0 0 8px 0;
    color: var(--text-primary);
  }

  .empty-state p {
    font-size: var(--text-base);
    color: var(--text-secondary);
    margin: 0;
  }

  .decks-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 16px;
  }

  @media (max-width: 769.99px) {
    .decks-grid {
      grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
    }
  }

  @media (max-width: 480.99px) {
    .decks-grid {
      grid-template-columns: 1fr;
    }
  }

  .deck-card {
    display: flex;
    flex-direction: column;
    padding: 20px;
    border: 1px solid var(--border-color);
    border-radius: var(--radius-lg);
    background: var(--bg-secondary);
    transition: all 0.15s;
    position: relative;
    overflow: hidden;
    cursor: pointer;
  }

  .deck-card:hover {
    border-color: #d3d1cb;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
    transform: translateY(-2px);
  }

  .deck-card.favorite {
    border-color: var(--accent-color);
  }

  .deck-card.favorite::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 5px;
    background: var(--accent-color);
    border-radius: var(--radius-lg) var(--radius-lg) 0 0;
  }

  .deck-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    margin-bottom: 16px;
    gap: 12px;
  }

  .deck-info {
    flex: 1;
    min-width: 0;
  }

  .deck-name {
    font-size: var(--text-lg);
    font-weight: 600;
    margin: 0 0 4px 0;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .deck-format-badge {
    display: inline-block;
    font-size: var(--text-sm);
    padding: 2px 8px;
    background: var(--bg-primary);
    border-radius: var(--radius-sm);
    color: var(--text-secondary);
  }

  .deck-stats-row {
    display: flex;
    align-items: center;
    gap: 20px;
    margin-bottom: 16px;
    padding-bottom: 16px;
    border-bottom: 1px solid var(--border-color);
  }

  .stat-item {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .stat-label {
    font-size: var(--text-xs);
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }

  .stat-value {
    font-size: var(--text-base);
    font-weight: 500;
    color: var(--text-primary);
  }

  .stat-value.record {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .stat-value .win {
    color: #0f7b6c;
  }

  .stat-value .loss {
    color: #e03e3e;
  }

  .stat-value .separator {
    color: var(--text-tertiary);
    font-weight: 400;
  }

  .stat-value .muted {
    color: var(--text-tertiary);
  }

  .stat-value.time {
    color: var(--text-secondary);
    font-weight: 400;
  }

  .deck-actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .action-btn {
    border-radius: var(--radius-md);
    border: 1px solid var(--border-color);
    width: 36px;
    height: 36px;
  }

  .action-btn:hover {
    border-color: #d3d1cb;
  }

  .action-btn-danger:hover {
    background: #fee;
    color: #e03e3e;
    border-color: #fcc;
  }

  .action-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .tts-sending {
    border-color: var(--accent-color);
    color: var(--accent-color);
  }

  :global(.spin) {
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    from {
      transform: rotate(0deg);
    }
    to {
      transform: rotate(360deg);
    }
  }

  .deck-avatar {
    height: 48px;
    width: 48px;
    overflow: hidden;
    border-radius: 50%;
    box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
    flex-shrink: 0;
  }

  :global(.deck-avatar > img) {
    width: 100%;
    transform: scale(2);
    object-fit: cover;
    object-position: center 10px;
  }

  .tag-suggest-popdown {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    right: 0;
    background: var(--bg-primary);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
    z-index: 100;
    overflow: hidden;
    animation: slideDown 0.15s ease;
  }

  @keyframes slideDown {
    from {
      opacity: 0;
      transform: translateY(-4px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .suggestion-item {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 8px 12px;
    border: none;
    background: transparent;
    cursor: pointer;
    font-size: var(--text-base);
    color: var(--text-primary);
    text-align: left;
  }

  .suggestion-item:hover,
  .suggestion-item.active {
    background: var(--bg-hover, rgba(0, 0, 0, 0.05));
  }

  .tag-text {
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tag-hint {
    font-size: var(--text-sm);
    color: var(--text-tertiary);
    flex-shrink: 0;
  }

  .tag-filter-bar {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
    margin: -12px 0 20px 0;
    padding: 10px 12px;
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    background: var(--bg-secondary);
  }

  .tag-match-toggle {
    display: flex;
    gap: 4px;
    padding: 3px;
    background: var(--bg-primary);
    border-radius: var(--radius-sm);
  }

  .tag-mode-btn {
    padding: 4px 10px;
    font-size: var(--text-sm);
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
  }

  .tag-mode-btn.active {
    background: var(--accent-color);
    color: var(--bg-primary);
    font-weight: 500;
  }

  .active-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    flex: 1;
    min-width: 0;
  }

  .active-tag-chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 3px 8px;
    font-size: var(--text-sm);
    border-radius: 999px;
    background: color-mix(in srgb, var(--accent-color) 15%, transparent);
    border: 1px solid color-mix(in srgb, var(--accent-color) 45%, transparent);
    color: var(--text-primary);
  }

  .active-tag-remove {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    padding: 0;
    border: none;
    border-radius: 50%;
    background: transparent;
    color: var(--text-secondary);
    font-size: 14px;
    line-height: 1;
    cursor: pointer;
  }

  .active-tag-remove:hover {
    background: rgba(0, 0, 0, 0.12);
    color: var(--text-primary);
  }

  .clear-tags-btn {
    padding: 4px 10px;
    font-size: var(--text-sm);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
  }

  .clear-tags-btn:hover {
    border-color: #d3d1cb;
    color: var(--text-primary);
  }

  .deck-tag-row {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin: -6px 0 12px 0;
  }

  .deck-tag-chip {
    display: inline-block;
    padding: 2px 10px;
    font-size: var(--text-sm);
    border-radius: 999px;
    background: color-mix(in srgb, var(--accent-color) 10%, transparent);
    border: 1px solid color-mix(in srgb, var(--accent-color) 35%, transparent);
    color: var(--text-secondary);
  }

  .deck-tag-more {
    font-size: var(--text-sm);
    color: var(--text-tertiary);
    align-self: center;
  }

  .import-method-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .import-method-option {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
    width: 100%;
    padding: 12px 14px;
    text-align: left;
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    color: var(--text-primary);
    cursor: pointer;
    transition:
      border-color 0.15s,
      background 0.15s,
      box-shadow 0.15s;
  }

  .import-method-option:hover {
    border-color: var(--accent-color);
  }

  .import-method-option.selected {
    border-color: var(--accent-color);
    background: color-mix(in oklab, var(--accent-color) 8%, white);
    box-shadow: 0 0 0 2px color-mix(in oklab, var(--accent-color) 20%, transparent);
  }

  .import-method-label {
    font-size: var(--text-base);
    font-weight: 600;
  }

  .import-method-desc {
    font-size: var(--text-xs);
    color: var(--text-secondary);
    line-height: 1.4;
  }

  .import-code-block,
  .import-text-block {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .import-textarea-row {
    display: flex;
    align-items: flex-start;
    gap: 8px;
  }

  .import-code-input {
    flex: 1;
    width: 100%;
    padding: 10px 12px;
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    font-size: var(--text-sm);
    font-family: inherit;
    line-height: 1.5;
    background: var(--bg-primary);
    color: var(--text-primary);
    outline: none;
    resize: vertical;
    word-break: break-all;
  }

  .import-code-input:focus {
    border-color: var(--accent-color);
    box-shadow: 0 0 0 3px color-mix(in oklab, var(--accent-color) 15%, transparent);
  }

  .paste-btn {
    flex-shrink: 0;
  }

  .import-hint {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: var(--text-sm);
    padding: 8px 10px;
    border-radius: var(--radius-sm);
  }

  .import-hint-ok {
    color: #0f7b6c;
    background: color-mix(in srgb, #0f7b6c 10%, transparent);
  }

  .import-hint-error {
    color: #e03e3e;
    background: color-mix(in srgb, #e03e3e 10%, transparent);
  }

  .import-preview {
    padding: 12px;
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    background: var(--bg-secondary);
    font-size: var(--text-sm);
    color: var(--text-primary);
  }

  .import-preview p {
    margin: 0 0 4px 0;
  }

  .import-preview ul {
    margin: 0;
    padding-left: 18px;
    color: var(--text-secondary);
  }

  .import-warn {
    color: #b45309;
  }

  .import-json-block {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .import-json-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    padding: 24px;
    text-align: center;
    color: var(--text-secondary);
  }

  .import-json-empty p {
    margin: 0;
    max-width: 320px;
  }

  .import-json-empty :global(svg) {
    color: var(--text-tertiary);
  }

  .import-json-file {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 12px;
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    background: var(--bg-secondary);
  }

  .import-json-name {
    font-size: var(--text-sm);
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .import-select-all {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: var(--text-sm);
    color: var(--text-primary);
    cursor: pointer;
  }

  .import-json-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
    max-height: 260px;
    overflow-y: auto;
  }

  .import-json-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    border-radius: var(--radius-sm);
    cursor: pointer;
  }

  .import-json-row:hover {
    background: var(--bg-hover, rgba(0, 0, 0, 0.04));
  }

  .import-json-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .import-json-row-name {
    font-size: var(--text-base);
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .import-json-row-meta {
    font-size: var(--text-sm);
    color: var(--text-tertiary);
  }
</style>
