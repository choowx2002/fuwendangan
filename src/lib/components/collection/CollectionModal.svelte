<script lang="ts">
  import type { CardPrint, CardWithOwned, CollectionLang } from '$lib/db'
  import { getCardCollection, getPrintsByCardId, upsertLangQty, getCustomLanguages } from '$lib/db'
  import { printCacheName } from '$lib/db/helper'
  import { PRESET_LANGUAGE_CODES, languageDisplayName } from '$lib/db'
  import { X, Plus, Trash2, Pencil } from '@lucide/svelte'
  import CachedImage from '../cards/CachedImage.svelte'
  import CustomPrintModal from './CustomPrintModal.svelte'
  import {
    type VariantBucket,
    classifyVariant,
  } from '$lib/cards/utils/variant-utils'
  import { isTauri } from '$lib/db/env'
  import { showToast } from '$lib/stores/ui-store.svelte'
  import { t } from '$lib/i18n'
  import { get } from 'svelte/store'

  interface Props {
    card: (CardWithOwned & { card_prints?: CardPrint[] }) | null
    isOpen: boolean
    onClose: () => void
    onChanged: () => void
    initialVariant?: string
  }

  let { card, isOpen, onClose, onChanged, initialVariant }: Props = $props()

  const BUCKET_LABEL_KEYS: Record<VariantBucket, string> = {
    base: 'collection.bucketBase',
    alt: 'collection.bucketAlt',
    overnum: 'collection.bucketOvernum',
    rune: 'collection.bucketRune',
    token: 'collection.bucketToken',
  }

  interface VariantView {
    cardNoExtend: string
    prints: CardPrint[]
    bucket: VariantBucket
    isCustom: boolean
    hasFoil: boolean
    totalOwned: number
    langs: CollectionLang[]
  }

  let variants = $state<VariantView[]>([])
  let selectedNo = $state('')
  let newLangInput = $state('SC')
  let langOptions = $state<string[]>([...PRESET_LANGUAGE_CODES])
  let customLangNames = $state(new Map<string, string>())
  let showCustomForm = $state(false)
  let editCustomPrint = $state<CardPrint | null>(null)
  let loadId = 0

  const selectedVariant = $derived(variants.find((v) => v.cardNoExtend === selectedNo))

  // 预览卡图：优先非自建打印，避免历史存量同号自定打印顶掉原图
  const previewPrint = $derived.by(() => {
    const v = selectedVariant
    if (!v || v.prints.length === 0) return undefined
    return v.prints.find((p) => !p.is_custom) ?? v.prints[0]
  })

  const bucketRank: Record<VariantBucket, number> = {
    rune: 0,
    token: 1,
    base: 2,
    alt: 3,
    overnum: 4,
  }

  const sortedVariants = $derived(
    [...variants].sort(
      (a, b) =>
        bucketRank[a.bucket] - bucketRank[b.bucket] || a.cardNoExtend.localeCompare(b.cardNoExtend)
    )
  )

  /** 概要：选中卡牌的普卡/闪卡/语言数统计 */
  const summary = $derived.by(() => {
    const v = selectedVariant
    if (!v) return { total: 0, normal: 0, foil: 0, langs: 0 }
    return {
      total: v.totalOwned,
      normal: v.langs.reduce((a, l) => a + (l.normal_qty ?? 0), 0),
      foil: v.langs.reduce((a, l) => a + (l.foil_qty ?? 0), 0),
      langs: v.langs.length,
    }
  })

  /** 添加语言下拉默认值：优先 SC，再按常用预设，最后取第一个未添加的语言 */
  const nextLangDefault = $derived.by(() => {
    const existing = new Set(selectedVariant?.langs.map((l) => l.language_code) ?? [])
    const preferred = ['SC', 'TC', 'EN', 'JP', 'KR', 'FR']
    for (const c of preferred) {
      if (langOptions.includes(c) && !existing.has(c)) return c
    }
    return langOptions.find((c) => !existing.has(c)) ?? langOptions[0] ?? ''
  })

  const isAddDisabled = $derived(
    !selectedVariant ||
      !newLangInput ||
      selectedVariant.langs.some((l) => l.language_code === newLangInput)
  )

  async function loadData() {
    if (!card) return
    const customs = await getCustomLanguages()
    customLangNames = new Map(customs.map((c) => [c.code, c.name]))
    langOptions = [...PRESET_LANGUAGE_CODES, ...customs.map((c) => c.code)]
    // 每次从 DB 重新拉取打印列表，保证保存/编辑后立即反映最新数据
    const printList = await getPrintsByCardId(card.id)
    const map = new Map<string, CardPrint[]>()
    for (const p of printList) {
      const no = p.card_no_extend ?? card.id
      if (!map.has(no)) map.set(no, [])
      map.get(no)!.push(p)
    }
    const langMap = await getCardCollection(card.card_no)

    let next: VariantView[] = Array.from(map.entries()).map(([no, prints]) => {
      const langs = langMap.get(no) ?? []
      const bucket = classifyVariant(card.card_category, prints[0]?.extend_rarity_name)
      return {
        cardNoExtend: no,
        prints,
        bucket,
        isCustom: prints.some((p) => p.is_custom),
        hasFoil: langs.some((l) => l.foil_qty > 0),
        totalOwned: langs.reduce((a, l) => a + (l.normal_qty ?? 0) + (l.foil_qty ?? 0), 0),
        langs,
      }
    })
    variants = next
    selectedNo =
      initialVariant && next.some((v) => v.cardNoExtend === initialVariant)
        ? initialVariant
        : (next.find((v) => v.hasFoil)?.cardNoExtend ?? next[0]?.cardNoExtend ?? '')
  }

  $effect(() => {
    if (!isOpen || !card) {
      variants = []
      selectedNo = ''
      showCustomForm = false
      editCustomPrint = null
      return
    }
    const id = ++loadId
    void loadData().then(() => {
      if (id !== loadId) return
    })
  })

  // 打开或切换卡牌后，语言下拉默认指向下一个未添加的语言
  $effect(() => {
    if (!isOpen) return
    newLangInput = nextLangDefault
  })

  function saveAndReload(no: string, lang: string, patch: { normal?: number; foil?: number }) {
    void upsertLangQty(card!.card_no, no, lang, patch)
      .then(() => loadData())
      .then(() => onChanged?.())
      .catch((err) => {
        showToast(
          get(t)('collection.opFailedWith', {
            values: { msg: err instanceof Error ? err.message : get(t)('common.unknownError') },
          }),
          'error'
        )
      })
  }

  function addLangTo(v: VariantView) {
    const lang = newLangInput.trim()
    if (!lang) return
    if (v.langs.some((l) => l.language_code === lang)) return
    saveAndReload(v.cardNoExtend, lang, { normal: 1, foil: 0 })
  }

  function openEdit(v: VariantView) {
    const custom = v.prints.find((p) => p.is_custom) ?? v.prints[0]
    editCustomPrint = custom
    showCustomForm = true
  }

  async function removeCustom(v: VariantView) {
    const custom = v.prints.find((p) => p.is_custom)
    if (!custom) return
    const confirmed = isTauri
      ? await (
          await import('@tauri-apps/plugin-dialog')
        ).ask(
          get(t)('collection.deleteCustomConfirm', { values: { cardNo: v.cardNoExtend } }),
          {
            title: get(t)('collection.deleteCustomTitle'),
            kind: 'warning',
            okLabel: get(t)('collection.deleteAction'),
            cancelLabel: get(t)('common.cancel'),
          }
        )
      : window.confirm(
          get(t)('collection.deleteCustomConfirm', { values: { cardNo: v.cardNoExtend } })
        )
    if (!confirmed) return
    try {
      const { deleteCustomPrint } = await import('$lib/db')
      const token = await deleteCustomPrint(custom.id)
      if (token) {
        const { deleteCachedImage } = await import('$lib/services/db-file-service')
        await deleteCachedImage(token)
      }
      await loadData()
      onChanged?.()
      showToast(get(t)('collection.customPrintDeleted'), 'success')
    } catch (err) {
      showToast(
        get(t)('collection.deleteFailedWith', {
          values: { msg: err instanceof Error ? err.message : get(t)('common.unknownError') },
        }),
        'error'
      )
    }
  }

  function openCreateCustom() {
    editCustomPrint = null
    showCustomForm = true
  }
</script>

{#if isOpen && card}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="modal-overlay" onclick={onClose} role="presentation">
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="modal-content" onclick={(e) => e.stopPropagation()}>
      <button class="close-btn" onclick={onClose} aria-label={$t('common.close')}>
        <X size={20} />
      </button>

      <div class="modal-header">
        <h2 class="card-title">{card.card_name_cn} <small>{card.card_name_en}</small></h2>
        <span class="card-no">{card.card_no}</span>
      </div>

      <div class="modal-body">
        <div class="preview-col">
          <div class="preview-card">
            {#if previewPrint}
              <CachedImage
                src={previewPrint.img_cdn ?? previewPrint.tts_cdn ?? ''}
                name={printCacheName(previewPrint)}
                fit="cover"
                borderRadius="8px"
                isHover={false}
              />
            {:else}
              <div class="no-image">{$t('collection.noImage')}</div>
            {/if}
          </div>

          <div class="variant-tabs">
            {#each sortedVariants as v (v.cardNoExtend)}
              <button
                class="variant-tab"
                class:active={selectedNo === v.cardNoExtend}
                class:foil={v.hasFoil}
                onclick={() => (selectedNo = v.cardNoExtend)}
                title={`${v.cardNoExtend}${v.hasFoil ? $t('collection.hasFoilSuffix') : ''}`}
              >
                {$t(BUCKET_LABEL_KEYS[v.bucket])}
                {#if v.isCustom}<em>*</em>{/if}
                <span class="tab-badge" class:zero={v.totalOwned === 0}>{v.totalOwned}</span>
                {#if v.hasFoil}<span class="foil-dot"></span>{/if}
              </button>
            {/each}
          </div>
        </div>

        <div class="edit-col">
          {#if sortedVariants.length === 0}
            <div class="empty-box">
              <p class="empty-title">{$t('collection.noPrints')}</p>
              <p class="empty-sub">{$t('collection.noPrintsHint')}</p>
              <button class="btn-mini" onclick={openCreateCustom}>
                <Plus size={13} /> {$t('collection.customPrint')}
              </button>
            </div>
          {:else if selectedVariant}
            {@const v = selectedVariant}

            <div class="variant-head">
              <span class="head-no">{v.cardNoExtend}</span>
              <span class="chip">{$t(BUCKET_LABEL_KEYS[v.bucket])}</span>
              {#if card.card_no && v.cardNoExtend.toUpperCase().slice(0, 3) !== card.card_no
                    .toUpperCase()
                    .slice(0, 3)}
                <span class="chip proto">{$t('collection.protoChip', { values: { cardNo: card.card_no } })}</span>
              {/if}
              {#if v.isCustom}
                <span class="chip promo">{$t('collection.customChip')}</span>
              {/if}
              <span class="chip total-chip">{v.totalOwned}</span>

              {#if isTauri && v.isCustom}
                <div class="head-actions">
                  <button class="icon-btn" title={$t('collection.editCustomPrint')} onclick={() => openEdit(v)}>
                    <Pencil size={14} />
                  </button>
                  <button
                    class="icon-btn danger"
                    title={$t('collection.deleteCustomTitle')}
                    onclick={() => removeCustom(v)}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              {/if}
            </div>

            <div class="summary">
              {$t('collection.collectedPrefix')}
              <strong>{summary.total}</strong>
              {$t('collection.cardUnit')} · {$t('collection.normalSuffix')}
              <strong>{summary.normal}</strong>
              · {$t('collection.foilSuffix')}
              <strong class="foil">{summary.foil}</strong>
              · {$t('collection.langsSuffix')} <strong>{summary.langs}</strong>{$t('collection.langKindsUnit')}
            </div>

            {#if v.langs.length === 0}
              <div class="empty-langs">
                <p class="empty-title">{$t('collection.noCollectionRows')}</p>
                <p class="empty-sub">
                  {$t('collection.noCollectionHint')}
                </p>
                <div class="add-row">{@render langAddControl()}</div>
              </div>
            {:else}
              <div class="matrix">
                <div class="matrix-head">
                  <span>{$t('collection.languageLabel')}</span>
                  <span class="col-qty">{$t('collection.normalCol')}</span>
                  <span class="col-qty">{$t('collection.foilCol')}</span>
                  <span class="col-total">{$t('collection.totalCol')}</span>
                </div>
                {#each v.langs as l (l.id)}
                  <div class="matrix-row" class:has-foil={(l.foil_qty ?? 0) > 0}>
                    <span class="row-lang"
                      >{languageDisplayName(l.language_code, customLangNames)}</span
                    >
                    {@render stepper(v, l.language_code, 'normal', l.normal_qty ?? 0)}
                    {@render stepper(v, l.language_code, 'foil', l.foil_qty ?? 0)}
                    <span class="row-total">{(l.normal_qty ?? 0) + (l.foil_qty ?? 0)}</span>
                  </div>
                {/each}
              </div>

              <div class="add-row">{@render langAddControl()}</div>
            {/if}
          {/if}

          <div class="toolbar">
            <button class="btn-mini" onclick={openCreateCustom}>
              <Plus size={13} /> {$t('collection.customPrint')}
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>

  {#snippet stepper(v: VariantView, lang: string, kind: 'normal' | 'foil', qty: number)}
    <div class="stepper" class:foil={kind === 'foil'}>
      <button
        aria-label={$t('collection.decOneAria', {
          values: {
            lang: languageDisplayName(lang, customLangNames),
            kind: kind === 'normal' ? $t('collection.normalCol') : $t('collection.foilCol'),
          },
        })}
        onclick={() =>
          saveAndReload(
            v.cardNoExtend,
            lang,
            kind === 'normal' ? { normal: qty - 1 } : { foil: qty - 1 }
          )}
        disabled={qty <= 0}
      >
        −
      </button>
      <span class="qty">{qty}</span>
      <button
        aria-label={$t('collection.incOneAria', {
          values: {
            lang: languageDisplayName(lang, customLangNames),
            kind: kind === 'normal' ? $t('collection.normalCol') : $t('collection.foilCol'),
          },
        })}
        onclick={() =>
          saveAndReload(
            v.cardNoExtend,
            lang,
            kind === 'normal' ? { normal: qty + 1 } : { foil: qty + 1 }
          )}
      >
        +
      </button>
    </div>
  {/snippet}

  {#snippet langAddControl()}
    <select class="lang-input" bind:value={newLangInput} title={$t('collection.selectLangTitle')}>
      {#each langOptions as code (code)}
        {@const added = selectedVariant?.langs.some((l) => l.language_code === code)}
        <option value={code} disabled={added}>
          {languageDisplayName(code, customLangNames)}{added ? $t('collection.alreadyAdded') : ''}
        </option>
      {/each}
    </select>
    <button
      class="btn-add"
      onclick={() => selectedVariant && addLangTo(selectedVariant)}
      disabled={isAddDisabled}
    >
      <Plus size={14} /> {$t('collection.addCardAction')}
    </button>
  {/snippet}

  <CustomPrintModal
    cardId={card?.id ?? ''}
    cardNo={card?.card_no ?? ''}
    editPrint={editCustomPrint}
    isOpen={showCustomForm}
    onClose={() => {
      showCustomForm = false
      editCustomPrint = null
    }}
    onSaved={(printId) => {
      void loadData().then(() => {
        // 保存后自动定位到刚创建/更新的自定打印卡牌
        const target = variants.find((v) => v.prints.some((p) => p.id === printId))
        if (target) selectedNo = target.cardNoExtend
        onChanged?.()
      })
    }}
  />
{/if}

<style>
  .modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.4);
    backdrop-filter: blur(2px);
    z-index: 1000;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px;
  }

  .modal-content {
    background: var(--bg-primary);
    width: 100%;
    max-width: min(960px, 100%);
    max-height: 90vh;
    border-radius: 12px;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    position: relative;
  }

  .close-btn {
    position: absolute;
    top: 14px;
    right: 14px;
    z-index: 10;
    background: rgba(255, 255, 255, 0.9);
    border: none;
    width: 30px;
    height: 30px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    color: var(--text-primary);
  }

  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 18px 24px 0;
  }

  .card-title {
    margin: 0;
    font-size: var(--text-2xl);
    color: var(--text-primary);
  }

  .card-title small {
    font-size: var(--text-sm);
    color: var(--text-secondary);
    margin-left: 6px;
  }

  .card-no {
    font-size: var(--text-sm);
    color: var(--text-secondary);
  }

  .modal-body {
    display: grid;
    grid-template-columns: minmax(210px, 240px) minmax(0, 1fr);
    gap: 24px;
    padding: 18px 24px 24px;
    overflow-y: auto;
    align-items: start;
  }

  .preview-col {
    width: 100%;
    min-width: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
  }

  /* 关键：固定卡图比例，标准卡牌比例一般是 63:88 */
  .preview-card {
    width: min(100%, 230px);
    aspect-ratio: 63 / 88;
    border-radius: 8px;
    overflow: hidden;
    background: var(--bg-secondary);
    flex-shrink: 0;
  }

  /* 强制子组件根节点填满容器，避免 FoilCard / CachedImage 内部固定尺寸撑开 */
  .preview-card > :global(*) {
    width: 100% !important;
    height: 100% !important;
    border-radius: inherit;
  }

  /* 图片、canvas 等媒体内容统一 cover */
  .preview-card :global(img),
  .preview-card :global(canvas),
  .preview-card :global(svg),
  .preview-card :global(video) {
    width: 100% !important;
    height: 100% !important;
    object-fit: cover;
    display: block;
  }

  .no-image {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 0;
    background: var(--bg-secondary);
    color: var(--text-tertiary);
  }

  .variant-tabs {
    width: min(100%, 230px);
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    justify-content: center;
  }

  .variant-tab {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    border-radius: 99px;
    border: 1px solid var(--border-color);
    background: var(--bg-secondary);
    color: var(--text-primary);
    font-size: var(--text-sm);
    cursor: pointer;
  }

  .variant-tab.active {
    border-color: var(--accent-color);
    color: var(--accent-color);
    font-weight: 600;
    background: color-mix(in srgb, var(--accent-color) 10%, var(--bg-secondary));
  }

  .variant-tab.foil:not(.active) {
    border-color: #eab308;
    color: #eab308;
  }

  .variant-tab em {
    font-style: normal;
    color: #a855f7;
  }

  .tab-badge {
    min-width: 18px;
    padding: 0 4px;
    border-radius: 99px;
    font-size: var(--text-xs);
    line-height: 16px;
    text-align: center;
    background: color-mix(in srgb, var(--accent-color) 15%, var(--bg-primary));
    color: var(--accent-color);
    font-weight: 600;
  }

  .tab-badge.zero {
    background: var(--bg-primary);
    color: var(--text-tertiary);
  }

  .foil-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: #eab308;
    box-shadow: 0 0 0 2px color-mix(in srgb, #eab308 25%, transparent);
  }

  .edit-col {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 12px;
    min-width: 0;
  }

  .variant-head {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .head-no {
    font-weight: 700;
    font-size: var(--text-md);
    color: var(--text-primary);
  }

  .head-actions {
    margin-left: auto;
    display: flex;
    gap: 6px;
  }

  .icon-btn {
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--border-color);
    border-radius: 8px;
    background: var(--bg-secondary);
    color: var(--text-secondary);
    cursor: pointer;
  }

  .icon-btn:hover {
    color: var(--accent-color);
    border-color: var(--accent-color);
  }

  .icon-btn.danger:hover {
    color: #ef4444;
    border-color: #ef4444;
  }

  .chip {
    font-size: var(--text-xs);
    padding: 2px 8px;
    border-radius: 99px;
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    color: var(--text-primary);
  }

  .chip.promo {
    border-color: rgba(168, 85, 247, 0.4);
    color: #a855f7;
  }

  .chip.proto {
    border-color: rgba(59, 130, 246, 0.4);
    color: #3b82f6;
  }

  .chip.total-chip {
    font-weight: 600;
  }

  .summary {
    font-size: var(--text-sm);
    color: var(--text-secondary);
    padding: 6px 10px;
    border-radius: 8px;
    background: var(--bg-secondary);
  }

  .summary strong {
    color: var(--text-primary);
    font-variant-numeric: tabular-nums;
  }

  .summary strong.foil {
    color: #eab308;
  }

  .matrix {
    border: 1px solid var(--border-color);
    border-radius: 10px;
    overflow: hidden;
  }

  .matrix-head {
    display: grid;
    grid-template-columns: minmax(110px, 1fr) auto auto 44px;
    align-items: center;
    gap: 8px;
    padding: 6px 12px;
    background: var(--bg-secondary);
    font-size: var(--text-xs);
    color: var(--text-tertiary);
  }

  .col-qty,
  .col-total {
    text-align: right;
  }

  .matrix-row {
    display: grid;
    grid-template-columns: minmax(110px, 1fr) auto auto 44px;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    border-top: 1px solid var(--border-color);
  }

  .matrix-row:hover {
    background: var(--bg-secondary);
  }

  .matrix-row.has-foil {
    background: color-mix(in srgb, #eab308 7%, var(--bg-primary));
  }

  .row-lang {
    font-size: var(--text-sm);
    color: var(--text-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .row-total {
    text-align: right;
    font-size: var(--text-sm);
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    color: var(--text-primary);
  }

  .stepper {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    justify-self: end;
  }

  .stepper button {
    width: 28px;
    height: 28px;
    border: 1px solid var(--border-color);
    border-radius: 8px;
    background: var(--bg-secondary);
    color: var(--text-primary);
    font-size: var(--text-md);
    line-height: 1;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .stepper button:hover:not(:disabled) {
    border-color: var(--accent-color);
    color: var(--accent-color);
  }

  .stepper button:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }

  .stepper .qty {
    min-width: 44px;
    text-align: center;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    font-size: var(--text-sm);
    color: var(--text-primary);
  }

  .stepper.foil .qty {
    color: #eab308;
  }

  .add-row {
    display: flex;
    align-items: center;
    gap: 8px;
    border-top: 1px dashed var(--border-color);
    padding-top: 12px;
  }

  .add-row .lang-input {
    flex: 1;
    min-width: 0;
  }

  .lang-input {
    padding: 7px 10px;
    border-radius: 8px;
    border: 1px solid var(--border-color);
    background: var(--bg-secondary);
    color: var(--text-primary);
    font-size: var(--text-sm);
  }

  .lang-input:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn-add {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 7px 14px;
    border-radius: 8px;
    border: 1px solid var(--accent-color);
    background: var(--accent-color);
    color: #fff;
    font-size: var(--text-sm);
    cursor: pointer;
    white-space: nowrap;
  }

  .btn-add:hover:not(:disabled) {
    background: color-mix(in oklab, var(--accent-color) 85%, black);
    border-color: color-mix(in oklab, var(--accent-color) 85%, black);
  }

  .btn-add:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .empty-box,
  .empty-langs {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding: 24px 16px;
    border: 1px dashed var(--border-color);
    border-radius: 10px;
    text-align: center;
  }

  .empty-title {
    margin: 0;
    font-size: var(--text-md);
    font-weight: 600;
    color: var(--text-primary);
  }

  .empty-sub {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--text-tertiary);
  }

  .empty-langs .add-row {
    width: 100%;
    max-width: 360px;
    border-top: none;
    padding-top: 8px;
  }

  .btn-mini {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 3px 10px;
    border-radius: 6px;
    border: 1px solid var(--border-color);
    background: transparent;
    color: var(--text-secondary);
    font-size: var(--text-xs);
    cursor: pointer;
  }

  .btn-mini:hover {
    color: var(--accent-color);
    border-color: var(--accent-color);
  }

  .toolbar {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
  }

  @media (max-width: 767.99px) {
    .modal-overlay {
      padding: 8px;
    }

    .modal-body {
      grid-template-columns: 1fr;
      gap: 16px;
      padding: 14px 16px 20px;
    }

    .preview-card {
      width: min(100%, 220px);
    }

    .variant-tabs {
      width: min(100%, 220px);
    }

    .matrix {
      overflow-x: auto;
      -webkit-overflow-scrolling: touch;
    }

    .matrix-head,
    .matrix-row {
      grid-template-columns: minmax(0, 1fr) auto auto 36px;
      gap: 6px;
      padding: 6px 8px;
    }

    .stepper button {
      width: 24px;
      height: 26px;
    }

    .stepper .qty {
      min-width: 26px;
    }
  }

  @media (min-width: 768px) {
    .preview-col {
      position: sticky;
      top: 0;
    }
  }
</style>
