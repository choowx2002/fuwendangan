<script lang="ts">
  import { onDestroy } from 'svelte'
  import { draggable } from '@thisux/sveltednd'
  import { Eye, Copy, Tags, Trash2, RotateCw, X, Pencil } from '@lucide/svelte'
  import { getBestPrint, printCacheName, type CardWithOwned } from '$lib/db'
  import CardSimpleImage from '$lib/components/cards/CardSimpleImage.svelte'
  import type { CardInstance, DisplayMode } from '$lib/simulator/chain'
  import { t } from '$lib/i18n'

  let {
    item,
    card = null,
    mode = 'text',
    zoneKey,
    ownerColor = '',
    playerLabel = '',
    dragDisabled = false,
    showLabel = true,
    onpreview,
    onremove,
    onremovecard,
    onduplicate,
    onrotate,
    ontagchange,
    onedit,
  }: {
    item: CardInstance
    card?: CardWithOwned | null
    mode?: DisplayMode
    zoneKey: string
    ownerColor?: string
    playerLabel?: string
    dragDisabled?: boolean
    showLabel?: boolean
    onpreview?: (item: CardInstance) => void
    onremove?: (zoneKey: string, item: CardInstance, target: 'discard' | 'banish') => void
    onremovecard?: (zoneKey: string, item: CardInstance) => void
    onduplicate?: (zoneKey: string, item: CardInstance) => void
    onrotate?: (zoneKey: string, item: CardInstance) => void
    ontagchange?: (zoneKey: string, item: CardInstance, tags: string[]) => void
    onedit?: (zoneKey: string, item: CardInstance) => void
  } = $props()

  const best = $derived(card ? getBestPrint(card) : null)
  const showImage = $derived(mode === 'image' || mode === 'both')
  const showText = $derived(mode === 'text' || mode === 'both')
  const displayName = $derived(
    item.customName ||
      (card ? card.card_name_cn || card.card_name_en || item.cardNo || '' : item.cardNo || '')
  )
  const subtitle = $derived(
    item.subtitle || (card ? card.sub_title_cn || card.sub_title_en || '' : '') || ''
  )
  const fullName = $derived(subtitle ? `${displayName} · ${subtitle}` : displayName)

  const tags = $derived(item.tags ?? [])

  let menuOpen = $state(false)
  let menuPos = $state({ x: 0, y: 0 })
  let editingTags = $state(false)
  let tagDraft = $state('')
  let ctrlPreview = $state<{ x: number; y: number } | null>(null)
  let longPressTimer: ReturnType<typeof setTimeout> | undefined

  onDestroy(() => {
    clearTimeout(longPressTimer)
  })

  function handleCtrlHover(e: MouseEvent) {
    if (e.ctrlKey && !menuOpen) {
      ctrlPreview = { x: e.clientX, y: e.clientY }
    }
  }

  function clearCtrlHover() {
    ctrlPreview = null
  }

  $effect(() => {
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Control') ctrlPreview = null
    }
    window.addEventListener('keyup', onKeyUp)
    return () => window.removeEventListener('keyup', onKeyUp)
  })

  function openMenu(e: MouseEvent | TouchEvent) {
    e.preventDefault()
    const point = 'touches' in e ? e.touches[0] : e
    menuPos = { x: point.clientX, y: point.clientY }
    menuOpen = true
  }

  function closeMenu() {
    menuOpen = false
    editingTags = false
    tagDraft = ''
  }

  function addTag() {
    const tag = tagDraft.trim()
    if (!tag || tags.includes(tag)) return
    ontagchange?.(zoneKey, item, [...tags, tag])
    tagDraft = ''
  }

  function removeTag(tag: string) {
    ontagchange?.(
      zoneKey,
      item,
      tags.filter((t) => t !== tag)
    )
  }
</script>

<div
  class="chain-card"
  class:rotated={item.rotated}
  class:face-down={item.faceDown}
  role="group"
  aria-label={fullName || item.id}
  onmouseenter={handleCtrlHover}
  onmousemove={handleCtrlHover}
  onmouseleave={clearCtrlHover}
  use:draggable={{
    container: zoneKey,
    dragData: { card: item, columnId: zoneKey },
    disabled: dragDisabled,
    interactive: ['.context-menu', '.tag-editor', 'button', 'input'],
  }}
>
  <div
    class="card-body"
    oncontextmenu={(e) => openMenu(e)}
    ontouchstart={(e) => {
      longPressTimer = setTimeout(() => openMenu(e as TouchEvent), 500)
    }}
    ontouchend={() => clearTimeout(longPressTimer)}
    ontouchcancel={() => clearTimeout(longPressTimer)}
    role="group"
    aria-label={fullName || item.id}
  >
    {#if showImage}
      <div class="img-wrap">
        <CardSimpleImage
          url={best?.url ?? ''}
          name={best ? printCacheName(best) : displayName}
          className="card-img"
          fallback="/blue.jpg"
        />
        {#if ownerColor && showLabel}
          <span class="img-owner-chip" style="--owner-color: {ownerColor}">
            {playerLabel}
          </span>
        {/if}
      </div>
      {#if mode === 'image' && showLabel}
        <span class="image-name">{fullName || item.id}</span>
      {/if}
    {/if}

    {#if showText}
      <div class="text-wrap">
        {#if ownerColor}
          <span class="owner-chip" style="--owner-color: {ownerColor}">
            {playerLabel}
          </span>
        {/if}
        <span class="name">{fullName || item.id}</span>
        {#if item.customNote}
          <span class="note">{item.customNote}</span>
        {/if}
      </div>
    {/if}
  </div>

  {#if tags.length > 0}
    <div class="badges">
      {#each tags as tag (tag)}
        <span class="badge">{tag}</span>
      {/each}
    </div>
  {/if}

  {#if menuOpen}
    <button
      type="button"
      class="menu-backdrop"
      aria-label={$t('simulator.closeMenu')}
      tabindex="-1"
      onclick={closeMenu}
      oncontextmenu={(e) => {
        e.preventDefault()
        closeMenu()
      }}
    ></button>

    <div class="context-menu" style="left: {menuPos.x}px; top: {menuPos.y}px;" role="menu">
      <button
        type="button"
        onclick={() => {
          onpreview?.(item)
          closeMenu()
        }}
      >
        <Eye size={14} />
        {$t('simulator.preview')}
      </button>
      <button
        type="button"
        onclick={() => {
          onremovecard?.(zoneKey, item)
          closeMenu()
        }}
      >
        <Trash2 size={14} />
        {$t('simulator.removeCard')}
      </button>
      <button
        type="button"
        onclick={() => {
          onremove?.(zoneKey, item, 'discard')
          closeMenu()
        }}
      >
        <Trash2 size={14} />
        {$t('simulator.sendToDiscard')}
      </button>
      <button
        type="button"
        onclick={() => {
          onremove?.(zoneKey, item, 'banish')
          closeMenu()
        }}
      >
        <Trash2 size={14} />
        {$t('simulator.sendToBanish')}
      </button>
      <button
        type="button"
        onclick={() => {
          onduplicate?.(zoneKey, item)
          closeMenu()
        }}
      >
        <Copy size={14} />
        {$t('simulator.duplicate')}
      </button>
      <button
        type="button"
        onclick={() => {
          onrotate?.(zoneKey, item)
          closeMenu()
        }}
      >
        <RotateCw size={14} />
        {$t('simulator.rotate')}
      </button>
      <button
        type="button"
        onclick={() => {
          onedit?.(zoneKey, item)
          closeMenu()
        }}
      >
        <Pencil size={14} />
        {$t('simulator.editCardInfo')}
      </button>
      <button type="button" onclick={() => (editingTags = !editingTags)}>
        <Tags size={14} />
        {$t('simulator.editTags')}
      </button>

      {#if editingTags}
        <div class="tag-editor" role="group" aria-label="标签编辑">
          {#each tags as tag (tag)}
            <span class="tag">
              {tag}
              <button type="button" onclick={() => removeTag(tag)}>
                <X size={10} />
              </button>
            </span>
          {/each}
          <input
            bind:value={tagDraft}
            placeholder={$t('simulator.tagPlaceholder')}
            onkeydown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                addTag()
              }
            }}
          />
          <button type="button" onclick={addTag}>{$t('simulator.addTag')}</button>
        </div>
      {/if}
    </div>
  {/if}

  {#if ctrlPreview}
    <div
      class="ctrl-preview"
      style="left: {ctrlPreview.x + 18 > window.innerWidth - 240
        ? ctrlPreview.x - 240 - 12
        : ctrlPreview.x + 18}px; top: {ctrlPreview.y + 18 > window.innerHeight - 340
        ? ctrlPreview.y - 340 - 12
        : ctrlPreview.y + 18}px;"
    >
      {#if showImage}
        <CardSimpleImage
          url={best?.url ?? ''}
          name={best ? printCacheName(best) : displayName}
          className="ctrl-preview-img"
          fallback="/blue.jpg"
        />
      {/if}
      <span class="ctrl-preview-name">{fullName || item.id}</span>
    </div>
  {/if}
</div>

<style>
  .chain-card {
    position: relative;
    width: 100%;
    border-radius: 10px;
    background: var(--surface);
    border: 1px solid var(--border-subtle);
    overflow: visible;
    user-select: none;
  }

  .chain-card.rotated .img-wrap {
    transform: rotate(90deg) scale(0.82);
  }

  .card-body {
    padding: 4px;
    cursor: pointer;
  }

  .img-wrap {
    position: relative;
    border-radius: 6px;
    overflow: hidden;
    border: 1px solid var(--border-subtle);
    background: var(--surface-muted);
  }

  :global(.card-img) {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  .text-wrap {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 2px 0;
  }

  .img-owner-chip {
    position: absolute;
    top: 4px;
    left: 4px;
    z-index: 2;
    padding: 1px 6px;
    border-radius: 999px;
    font-size: 9px;
    font-weight: 600;
    color: #fff;
    background: color-mix(in srgb, #666 72%, transparent);
    pointer-events: none;
  }

  .image-name {
    display: block;
    margin-top: 3px;
    font-size: 10px;
    color: var(--text-primary);
    line-height: 1.2;
    text-align: center;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .owner-chip {
    align-self: flex-start;
    padding: 1px 6px;
    border-radius: 999px;
    font-size: 10px;
    font-weight: 600;
    color: var(--text-tertiary);
    background: color-mix(in srgb, #888 12%, transparent);
  }

  .name {
    font-size: var(--text-xs);
    color: var(--text-primary);
    line-height: 1.3;
    display: -webkit-box;
    line-clamp: 3;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
    word-break: break-all;
  }

  .note {
    font-size: 10px;
    color: var(--text-tertiary);
  }

  .badges {
    position: absolute;
    top: 22px;
    left: 4px;
    z-index: 2;
    display: flex;
    flex-direction: column;
    gap: 2px;
    pointer-events: none;
  }

  .badge {
    font-size: 9px;
    padding: 1px 5px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--accent-color) 85%, #000);
    color: #fff;
    max-width: 90px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .menu-backdrop {
    position: fixed;
    inset: 0;
    z-index: 999;
    background: transparent;
    border: none;
    padding: 0;
  }

  .context-menu {
    position: fixed;
    z-index: 1000;
    min-width: 160px;
    padding: 6px;
    border: 1px solid var(--border-color);
    border-radius: 12px;
    background: var(--bg-primary);
    box-shadow: 0 16px 40px rgba(0, 0, 0, 0.18);
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .context-menu button {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    border: none;
    border-radius: 8px;
    background: transparent;
    color: var(--text-primary);
    font-size: var(--text-sm);
    cursor: pointer;
    text-align: left;
    width: 100%;
  }

  .context-menu button:hover {
    background: var(--bg-hover);
  }

  .tag-editor {
    padding: 8px;
    border-top: 1px solid var(--border-subtle);
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }

  .tag {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    padding: 2px 6px;
    border-radius: 999px;
    background: var(--bg-hover);
    font-size: 11px;
  }

  .tag-editor input {
    flex: 1;
    min-width: 80px;
    border: 1px solid var(--border-color);
    border-radius: 6px;
    padding: 4px 6px;
    background: var(--surface);
    color: var(--text-primary);
    font-size: 12px;
  }
  .ctrl-preview {
    position: fixed;
    z-index: 2000;
    width: 240px;
    padding: 8px;
    border: 1px solid var(--border-color);
    border-radius: 12px;
    background: var(--bg-primary);
    box-shadow: 0 16px 40px rgba(0, 0, 0, 0.22);
    pointer-events: none;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  :global(.ctrl-preview-img) {
    width: 100%;
    border-radius: 8px;
  }

  .ctrl-preview-name {
    font-size: var(--text-xs);
    color: var(--text-primary);
    text-align: center;
    line-height: 1.3;
  }
</style>
