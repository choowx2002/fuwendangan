<script lang="ts">
  import { onMount } from 'svelte'
  import { get } from 'svelte/store'
  import { t } from '$lib/i18n'
  import { goto } from '$app/navigation'
  import CommonModal from '$lib/components/ui/CommonModal.svelte'
  import { open as openDialog } from '@tauri-apps/plugin-dialog'
  import { showMessage } from '$lib/utils/confirm'
  import { readText } from '@tauri-apps/plugin-clipboard-manager'
  import { readTextFile, readImageFileAsDataUrl } from '$lib/services/db-file-service'
  import {
    tryParseDeckCodeText,
    resolveDeckCards,
    parseGlobalOfficialText,
    resolveGlobalOfficialText,
    parseQrPayload,
    resolveQrPayload,
    type DecodedDeckResult,
    type ImportError,
  } from '$lib/decks/deck-import'
  import { decodeQrImageDataUrl, QR_PAYLOAD_VERSION } from '$lib/decks/deck-qr'
  import { isMobile } from '$lib/utils/os'
  import {
    setQrScanPending,
    consumeQrScanPending,
    consumeQrScanContent,
  } from '$lib/stores/qr-scan.svelte'
  import type { ImportDeckPayload } from '$lib/db'
  import { CircleCheck, CircleAlert, FileUp, ScanLine } from '@lucide/svelte'

  interface Props {
    open: boolean
    /** new：导入后跳转编辑器新建卡组；overwrite：由父级把解析结果写回现有卡组 */
    variant?: 'new' | 'overwrite'
    onclose: () => void
    onConfirm: (result: DecodedDeckResult) => void | Promise<void>
    onJsonConfirm: (payloads: ImportDeckPayload[]) => void | Promise<void>
    onRequestOpen?: () => void
  }

  let { open, variant = 'new', onclose, onConfirm, onJsonConfirm, onRequestOpen }: Props = $props()

  let importTab = $state<'code' | 'json' | 'text' | 'qr'>('code')
  let importCode = $state('')
  let importCodeError = $state('')
  let importCodeValid = $state(false)
  let importingCode = $state(false)
  let importedResult = $state<DecodedDeckResult | null>(null)

  let importQr = $state('')
  let importQrError = $state('')
  let importQrValid = $state(false)
  let importingQr = $state(false)
  let importedQrResult = $state<DecodedDeckResult | null>(null)

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

  let mobilePlatform = $state(false)

  function resetAll() {
    importTab = 'code'
    importCode = ''
    importCodeError = ''
    importCodeValid = false
    importedResult = null
    importText = ''
    importTextError = ''
    importTextValid = false
    importedTextResult = null
    importQr = ''
    importQrError = ''
    importQrValid = false
    importedQrResult = null
    jsonFileName = ''
    jsonDeckList = []
    selectedJsonDeckIds = []
    pendingJsonDecks = []
  }

  $effect(() => {
    if (open) resetAll()
  })

  async function pasteImportCode() {
    try {
      const text = await readText()
      if (text) {
        importCode = text
        validateImportCode()
      }
    } catch {
      importCodeError = get(t)('decks.readClipboardFailed')
      importCodeValid = false
    }
  }

  function importErrText(errors: ImportError[]): string {
    const first = errors[0]
    return first ? get(t)(first.messageKey, { values: first.params }) : ''
  }

  function validateImportCode() {
    const { deck, error } = tryParseDeckCodeText(importCode)
    importCodeError = error ?? ''
    importCodeValid = !!deck
  }

  async function confirmCodeImport() {
    const { deck: decoded, error } = tryParseDeckCodeText(importCode)
    if (!decoded) {
      importCodeError = error ?? get(t)('decks.parseCodeFailed')
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
        importCodeError = get(t)('decks.allCardsMissing', {
          values: {
            count: result.missingCount,
            codes: result.missingCodes.slice(0, 5).join(', '),
          },
        })
        importCodeValid = false
        return
      }
      importedResult = result
      await onConfirm(result)
    } finally {
      importingCode = false
    }
  }

  function validateImportText() {
    const parsed = parseGlobalOfficialText(importText)
    const hasAny = Object.values(parsed.zones).flat().length > 0 && parsed.errors.length === 0
    importTextError = importErrText(parsed.errors)
    importTextValid = hasAny
  }

  async function confirmTextImport() {
    const parsed = parseGlobalOfficialText(importText)
    const hasAny = Object.values(parsed.zones).flat().length > 0
    if (!hasAny) {
      importTextError = importErrText(parsed.errors) || get(t)('decks.parseTextFailed')
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
        importTextError = get(t)('decks.textNoMatches', {
          values: { codes: result.missingCodes.slice(0, 5).join(', ') },
        })
        importTextValid = false
        return
      }
      importedTextResult = result
      await onConfirm(result)
    } finally {
      importingText = false
    }
  }

  function validateImportQr() {
    const parsed = parseQrPayload(importQr)
    importQrError = importErrText(parsed.errors)
    importQrValid = parsed.errors.length === 0
  }

  function openScannerPage() {
    setQrScanPending()
    goto('/scanner')
  }

  async function uploadImportQr() {
    importingQr = true
    importQrError = ''
    try {
      const src = await openDialog({
        title: get(t)('decks.pickQrImage'),
        multiple: false,
        filters: [
          {
            name: get(t)('decks.imageFilter'),
            extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'],
          },
        ],
      })
      if (!src || Array.isArray(src)) return
      const dataUrl = await readImageFileAsDataUrl(src)
      const content = await decodeQrImageDataUrl(dataUrl)
      applyQrContent(content)
    } catch (error) {
      console.error('[ImportQr] 解析二维码图片失败:', error)
      importQrError = error instanceof Error ? error.message : get(t)('decks.qrParseFailed')
      importQrValid = false
    } finally {
      importingQr = false
    }
  }

  function applyQrContent(content: string) {
    importQr = content
    validateImportQr()
  }

  async function confirmQrImport() {
    const parsed = parseQrPayload(importQr)
    if (parsed.errors.length > 0) {
      importQrError = importErrText(parsed.errors)
      importQrValid = false
      return
    }
    importingQr = true
    try {
      const result = await resolveQrPayload(parsed)
      const totalResolved =
        result.deck.mainDeckCards.length +
        result.deck.runeCards.length +
        result.deck.battlefieldCards.length +
        result.deck.sideboardCards.length +
        result.deck.legendCards.length +
        result.deck.championCards.length
      if (totalResolved === 0) {
        importQrError = get(t)('decks.qrAllCardsMissing', {
          values: { codes: result.missingCodes.slice(0, 5).join(', ') },
        })
        importQrValid = false
        return
      }
      importedQrResult = result
      await onConfirm(result)
    } finally {
      importingQr = false
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
          player_name: m.player_name ?? null,
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
    if (variant === 'overwrite') {
      selectedJsonDeckIds = selectedJsonDeckIds.includes(id) ? [] : [id]
      return
    }
    selectedJsonDeckIds = selectedJsonDeckIds.includes(id)
      ? selectedJsonDeckIds.filter((d) => d !== id)
      : [...selectedJsonDeckIds, id]
  }

  function toggleAllJsonDecks() {
    selectedJsonDeckIds =
      selectedJsonDeckIds.length === jsonDeckList.length ? [] : jsonDeckList.map((d) => d.id)
  }

  async function openJsonFile() {
    const src = await openDialog({
      title: get(t)('decks.selectJsonTitle'),
      multiple: false,
      filters: [{ name: get(t)('decks.jsonFilter'), extensions: ['json'] }],
    })
    if (!src) return

    let content: string
    try {
      content = await readTextFile(String(src))
    } catch (e) {
      await showMessage(e instanceof Error ? e.message : get(t)('decks.readFileFailed'), {
        title: get(t)('decks.importTitle'),
        kind: 'error',
      })
      return
    }

    const decks = parseImportFile(content)
    if (decks.length === 0) {
      await showMessage(get(t)('decks.invalidJsonFile'), {
        title: get(t)('decks.importTitle'),
        kind: 'error',
      })
      return
    }

    jsonFileName = String(src).split(/[\\/]/).pop() ?? String(src)
    jsonDeckList = decks.map((d, i) => ({
      id: String(i),
      name: d.name,
      updatedAt: d.updated_at ? new Date(d.updated_at).toLocaleString() : get(t)('common.unknown'),
      versionCount: d.versions.length,
    }))
    selectedJsonDeckIds =
      variant === 'overwrite' && jsonDeckList.length > 0
        ? [jsonDeckList[0].id]
        : jsonDeckList.map((d) => d.id)
    pendingJsonDecks = decks
  }

  async function confirmJsonImport() {
    if (selectedJsonDeckIds.length === 0) return
    importingJson = true
    try {
      const chosen = pendingJsonDecks.filter((_, i) => selectedJsonDeckIds.includes(String(i)))
      await onJsonConfirm(chosen)
    } finally {
      importingJson = false
    }
  }

  onMount(() => {
    isMobile().then((is) => (mobilePlatform = is))
    if (consumeQrScanPending()) {
      onRequestOpen?.()
      setTimeout(() => {
        const content = consumeQrScanContent()
        if (content) {
          importTab = 'qr'
          importQr = content
          validateImportQr()
        }
      }, 0)
    }
  })
</script>

<CommonModal
  {open}
  title={variant === 'overwrite' ? $t('deckDetail.overwriteTitle') : $t('decks.importTitle')}
  subtitle={$t('decks.importSubtitle')}
  closable={!importingCode && !importingJson && !importingText && !importingQr}
  {onclose}
>
  <div class="import-method-list">
    <button
      type="button"
      class="import-method-option"
      class:selected={importTab === 'code'}
      onclick={() => (importTab = 'code')}
    >
      <span class="import-method-label">{$t('decks.importCodeLabel')}</span>
      <span class="import-method-desc">{$t('decks.importCodeDesc')}</span>
    </button>
    <button
      type="button"
      class="import-method-option"
      class:selected={importTab === 'json'}
      onclick={() => (importTab = 'json')}
    >
      <span class="import-method-label">{$t('decks.importJsonLabel')}</span>
      <span class="import-method-desc">{$t('decks.importJsonDesc')}</span>
    </button>
    <button
      type="button"
      class="import-method-option"
      class:selected={importTab === 'text'}
      onclick={() => (importTab = 'text')}
    >
      <span class="import-method-label">{$t('decks.importOfficialLabel')}</span>
      <span class="import-method-desc">{$t('decks.importOfficialDesc')}</span>
    </button>
    <button
      type="button"
      class="import-method-option"
      class:selected={importTab === 'qr'}
      onclick={() => (importTab = 'qr')}
    >
      <span class="import-method-label">{$t('decks.importQrLabel')}</span>
      <span class="import-method-desc">{$t('decks.importQrDesc')}</span>
    </button>
  </div>

  {#if importTab === 'code'}
    <div class="import-code-block">
      <div class="import-textarea-row">
        <textarea
          class="import-code-input"
          placeholder={$t('decks.codePlaceholder')}
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
          {$t('decks.paste')}
        </button>
      </div>

      {#if importCode && importCodeValid}
        <div class="import-hint import-hint-ok">
          <CircleCheck size={16} />
          <span>{$t('decks.codeValid')}</span>
        </div>
      {:else if importCodeError}
        <div class="import-hint import-hint-error">
          <CircleAlert size={16} />
          <span>{importCodeError}</span>
        </div>
      {/if}

      {#if importedResult}
        <div class="import-preview">
          <p>{$t('decks.parseSuccess')}</p>
          <ul>
            <li>
              {$t('decks.zoneMain', {
                values: { count: importedResult.deck.mainDeckCards.length },
              })}
            </li>
            <li>
              {$t('decks.zoneRune', { values: { count: importedResult.deck.runeCards.length } })}
            </li>
            <li>
              {$t('decks.zoneBattlefield', {
                values: { count: importedResult.deck.battlefieldCards.length },
              })}
            </li>
            <li>
              {$t('decks.zoneSideboard', {
                values: { count: importedResult.deck.sideboardCards.length },
              })}
            </li>
            {#if importedResult.deck.legendCards.length > 0}
              <li>
                {$t('decks.zoneLegend', {
                  values: { count: importedResult.deck.legendCards.length },
                })}
              </li>
            {/if}
            {#if importedResult.deck.championCards.length > 0}
              <li>
                {$t('decks.zoneChampion', {
                  values: { count: importedResult.deck.championCards.length },
                })}
              </li>
            {/if}
          </ul>
        </div>
      {/if}
    </div>
  {:else if importTab === 'json'}
    <div class="import-json-block">
      {#if jsonDeckList.length === 0}
        <div class="import-json-empty">
          <FileUp size={40} />
          <p>{$t('decks.jsonEmptyDesc')}</p>
          <button class="button button-ghost" onclick={openJsonFile} disabled={importingJson}>
            {$t('decks.chooseJsonFile')}
          </button>
        </div>
      {:else}
        <div class="import-json-file">
          <span class="import-json-name">{jsonFileName}</span>
          <button class="button button-ghost" onclick={openJsonFile} disabled={importingJson}>
            {$t('decks.reselect')}
          </button>
        </div>
        {#if variant === 'new'}
          <label class="import-select-all">
            <input
              type="checkbox"
              checked={selectedJsonDeckIds.length === jsonDeckList.length &&
                jsonDeckList.length > 0}
              onchange={toggleAllJsonDecks}
              disabled={importingJson}
            />
            <span>{$t('decks.selectAll', { values: { count: jsonDeckList.length } })}</span>
          </label>
        {/if}
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
                  {$t('decks.versionCount', {
                    values: { count: deck.versionCount, time: deck.updatedAt },
                  })}
                </span>
              </span>
            </label>
          {/each}
        </div>
      {/if}
    </div>
  {:else if importTab === 'text'}
    <div class="import-text-block">
      <div class="import-textarea-row">
        <textarea
          class="import-code-input"
          placeholder={$t('decks.textPlaceholder')}
          rows={9}
          bind:value={importText}
          oninput={validateImportText}
          disabled={importingText}></textarea>
      </div>

      {#if importText && importTextValid && !importTextError}
        <div class="import-hint import-hint-ok">
          <CircleCheck size={16} />
          <span>{$t('decks.textValid')}</span>
        </div>
      {:else if importTextError}
        <div class="import-hint import-hint-error">
          <CircleAlert size={16} />
          <span>{importTextError}</span>
        </div>
      {/if}

      {#if importedTextResult}
        <div class="import-preview">
          <p>{$t('decks.parseSuccess')}</p>
          <ul>
            <li>
              {$t('decks.zoneLegend', {
                values: { count: importedTextResult.deck.legendCards.length },
              })}
            </li>
            <li>
              {$t('decks.zoneChampion', {
                values: { count: importedTextResult.deck.championCards.length },
              })}
            </li>
            <li>
              {$t('decks.zoneMain', {
                values: { count: importedTextResult.deck.mainDeckCards.length },
              })}
            </li>
            <li>
              {$t('decks.zoneBattlefield', {
                values: { count: importedTextResult.deck.battlefieldCards.length },
              })}
            </li>
            <li>
              {$t('decks.zoneRune', {
                values: { count: importedTextResult.deck.runeCards.length },
              })}
            </li>
            <li>
              {$t('decks.zoneSideboard', {
                values: { count: importedTextResult.deck.sideboardCards.length },
              })}
            </li>
          </ul>
          {#if importedTextResult.missingCount > 0}
            <p class="import-warn">
              {$t('decks.textMissingWarn', {
                values: {
                  count: importedTextResult.missingCount,
                  codes: `${importedTextResult.missingCodes
                    .slice(0, 5)
                    .join(', ')}${importedTextResult.missingCount > 5 ? '...' : ''}`,
                },
              })}
            </p>
          {/if}
        </div>
      {/if}
    </div>
  {:else if importTab === 'qr'}
    <div class="import-qr-block">
      <div class="import-qr-actions">
        {#if mobilePlatform}
          <button
            type="button"
            class="button button-primary import-qr-btn"
            onclick={openScannerPage}
          >
            <ScanLine size={18} />
            {$t('decks.scan')}
          </button>
        {/if}
        <button
          type="button"
          class="button button-ghost"
          onclick={uploadImportQr}
          disabled={importingQr}
        >
          {$t('decks.uploadQr')}
        </button>
      </div>
      {#if importingQr}
        <div class="import-hint">
          <span>{$t('decks.qrRecognizing')}</span>
        </div>
      {/if}
      <textarea
        class="import-code-input"
        placeholder={$t('decks.qrPlaceholder')}
        rows={5}
        bind:value={importQr}
        oninput={validateImportQr}
        disabled={importingQr}></textarea>

      {#if importQr && importQrValid && !importQrError}
        <div class="import-hint import-hint-ok">
          <CircleCheck size={16} />
          <span>{$t('decks.formatValid', { values: { format: QR_PAYLOAD_VERSION } })}</span>
        </div>
      {:else if importQrError}
        <div class="import-hint import-hint-error">
          <CircleAlert size={16} />
          <span>{importQrError}</span>
        </div>
      {/if}

      {#if importedQrResult}
        <div class="import-preview">
          <p>{$t('decks.parseSuccess')}</p>
          <ul>
            <li>
              {$t('decks.zoneLegend', {
                values: { count: importedQrResult.deck.legendCards.length },
              })}
            </li>
            <li>
              {$t('decks.zoneChampion', {
                values: { count: importedQrResult.deck.championCards.length },
              })}
            </li>
            <li>
              {$t('decks.zoneMain', {
                values: { count: importedQrResult.deck.mainDeckCards.length },
              })}
            </li>
            <li>
              {$t('decks.zoneBattlefield', {
                values: { count: importedQrResult.deck.battlefieldCards.length },
              })}
            </li>
            <li>
              {$t('decks.zoneRune', { values: { count: importedQrResult.deck.runeCards.length } })}
            </li>
            <li>
              {$t('decks.zoneSideboard', {
                values: { count: importedQrResult.deck.sideboardCards.length },
              })}
            </li>
          </ul>
          {#if importedQrResult.missingCount > 0}
            <p class="import-warn">
              {$t('decks.missingWarn', {
                values: {
                  count: importedQrResult.missingCount,
                  codes: `${importedQrResult.missingCodes
                    .slice(0, 5)
                    .join(', ')}${importedQrResult.missingCount > 5 ? '...' : ''}`,
                },
              })}
            </p>
          {/if}
        </div>
      {/if}
    </div>
  {/if}

  {#snippet footer()}
    <button class="button button-ghost" onclick={onclose}>{$t('common.cancel')}</button>
    {#if importTab === 'code'}
      <button
        class="button button-primary"
        disabled={!importCodeValid || importingCode}
        onclick={confirmCodeImport}
      >
        {importingCode
          ? $t('decks.parsing')
          : variant === 'overwrite'
            ? $t('deckDetail.overwriteConfirm')
            : $t('decks.importToEditor')}
      </button>
    {:else if importTab === 'text'}
      <button
        class="button button-primary"
        disabled={!importTextValid || importingText}
        onclick={confirmTextImport}
      >
        {importingText
          ? $t('decks.parsing')
          : variant === 'overwrite'
            ? $t('deckDetail.overwriteConfirm')
            : $t('decks.importToEditor')}
      </button>
    {:else if importTab === 'qr'}
      <button
        class="button button-primary"
        disabled={!importQrValid || importingQr}
        onclick={confirmQrImport}
      >
        {importingQr
          ? $t('decks.parsing')
          : variant === 'overwrite'
            ? $t('deckDetail.overwriteConfirm')
            : $t('decks.importToEditor')}
      </button>
    {:else if jsonDeckList.length > 0}
      <button
        class="button button-primary"
        disabled={importingJson || selectedJsonDeckIds.length === 0}
        onclick={confirmJsonImport}
      >
        {importingJson
          ? $t('decks.importing')
          : variant === 'overwrite'
            ? $t('deckDetail.overwriteConfirm')
            : $t('decks.importToEditor')}
      </button>
    {/if}
  {/snippet}
</CommonModal>

<style>
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
    background: color-mix(in oklab, var(--accent-color) 8%, var(--surface));
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
    padding: 3px 10px;
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

  .import-qr-actions {
    display: flex;
    gap: 5px;
  }

  .import-qr-block {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }
</style>
