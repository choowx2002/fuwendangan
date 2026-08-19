<script lang="ts">
  import { t } from '$lib/i18n'
  import { loadImageFromAppFolder } from '$lib/services/image-cache-service'
  import { isTauri } from '$lib/db/env'
  import { baseCardCode, type ReplayCardMeta } from '$lib/replay/card-meta'
  import { X } from '@lucide/svelte'

  interface Props {
    card: Record<string, unknown> | null
    meta: ReplayCardMeta | null
    side?: 'self' | 'opp' | null
    zone?: string | null
    onClose?: () => void
  }
  let { card, meta, side = null, zone = null, onClose }: Props = $props()

  const code = $derived(typeof card?.cardCode === 'string' ? String(card.cardCode) : '')
  const eventName = $derived(typeof card?.name === 'string' ? String(card.name) : '')
  const name = $derived(meta?.name ?? eventName ?? '')
  const eventType = $derived(typeof card?.type === 'string' ? String(card.type) : '')
  const typeLabel = $derived(eventType || meta?.type || '')
  const isBattlefield = $derived(eventType === 'battlefield' || (meta?.type ?? '').includes('战场'))
  const exhausted = $derived(card?.exhausted === true)
  const hidden = $derived(card?.hidden === true)
  const energy = $derived(
    meta?.energyCost ?? (typeof card?.energyCost === 'number' ? card.energyCost : null)
  )
  const might = $derived(meta?.might ?? (typeof card?.might === 'number' ? card.might : null))
  const whiteCounter = $derived(
    typeof card?.whiteCounter === 'number' ? Number(card.whiteCounter) : null
  )
  const redCounter = $derived(typeof card?.redCounter === 'number' ? Number(card.redCounter) : null)
  const sideLabel = $derived(
    side === 'self' ? $t('replay.sideSelf') : side === 'opp' ? $t('replay.sideOpp') : ''
  )
  const zoneLabel = $derived(zone ?? '')

  // 卡图：本地 SC prints（img_cdn）；无本地图/Web 模式时显示占位卡背
  // 仅依赖 imgCdn/cacheName，避免悬停不同卡牌（同图）时反复闪烁
  let artSrc = $state('/blue.jpg')

  $effect(() => {
    const imgCdn = meta?.imgCdn ?? null
    const cacheName = meta?.cacheName ?? 'replay-card'
    if (!isTauri || !imgCdn) {
      artSrc = '/blue.jpg'
      return
    }
    let active = true
    loadImageFromAppFolder(imgCdn, cacheName)
      .then((url) => {
        if (active && url) artSrc = url
      })
      .catch(() => {
        // 本地读取失败时保持占位
      })
    return () => {
      active = false
    }
  })

  function onArtError() {
    artSrc = '/blue.jpg'
  }
</script>

<div class="reader">
  <div class="r-head">
    <span class="r-ctx">
      {#if sideLabel && zoneLabel}
        {$t('replay.readerSideZone', { values: { side: sideLabel, zone: zoneLabel } })}
      {:else if sideLabel}
        {sideLabel}
      {:else if zoneLabel}
        {zoneLabel}
      {:else}
        {' '}
      {/if}
    </span>
    {#if onClose}
      <button
        class="r-close"
        onclick={onClose}
        title={$t('replay.readerClose')}
        aria-label={$t('replay.readerClose')}
      >
        <X size={13} />
      </button>
    {/if}
  </div>

  {#if !card}
    <div class="r-empty">
      <span>{$t('replay.readerEmpty')}</span>
    </div>
  {:else}
    <div class="r-art" class:bf={isBattlefield}>
      {#if hidden}
        <div class="r-hidden">{$t('replay.readerHidden')}</div>
      {/if}
      <img src={artSrc} alt={name} draggable="false" onerror={onArtError} />
    </div>
    <div class="r-copy">
      <div class="r-name">{name || $t('replay.readerUnknown')}</div>
      {#if meta?.subtitle}
        <div class="r-sub">{meta.subtitle}</div>
      {/if}
      {#if typeLabel}
        <div class="r-type">{typeLabel}</div>
      {/if}
      <div class="r-stats">
        {#if energy !== null}<span class="r-stat g"><b>{$t('replay.energy')}</b> {energy}</span
          >{/if}
        {#if might !== null}<span class="r-stat o"><b>{$t('replay.power')}</b> {might}</span>{/if}
        {#if whiteCounter !== null || redCounter !== null}
          <span class="r-stat">
            {#if whiteCounter !== null}<span class="ct w">{whiteCounter}</span>{/if}
            {#if redCounter !== null}<span class="ct r">{redCounter}</span>{/if}
          </span>
        {/if}
        {#if exhausted}
          <span class="r-stat x">{$t('replay.readerExhausted')}</span>
        {/if}
      </div>
      {#if meta?.description}
        <div class="r-desc">{meta.description}</div>
      {:else if !meta?.found}
        <div class="r-desc muted">{$t('replay.readerNoDesc')}</div>
      {/if}
      {#if meta?.flavor}
        <div class="r-flavor">“{meta.flavor}”</div>
      {/if}
      {#if code}
        <div class="r-code">{baseCardCode(code)}</div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .reader {
    display: flex;
    flex-direction: column;
    gap: 8px;
    height: 100%;
    min-height: 0;
  }
  .r-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    flex: none;
  }
  .r-ctx {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-tertiary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .r-close {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    border-radius: 6px;
    border: 1px solid var(--border-subtle);
    background: var(--surface-muted);
    color: var(--text-secondary);
    cursor: pointer;
    flex: none;
  }
  .r-close:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }
  .r-empty {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    text-align: center;
    color: var(--text-tertiary);
    font-size: 13px;
    padding: 20px;
    border: 1px dashed var(--border-subtle);
    border-radius: 12px;
  }
  /* 大图：高度方向尽量撑满可用空间 */
  .r-art {
    position: relative;
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
    justify-content: center;
    align-items: center;
  }
  .r-art img {
    max-width: 100%;
    max-height: 100%;
    width: auto;
    height: auto;
    border-radius: 10px;
    border: 1px solid var(--border-color);
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.35);
    display: block;
  }
  .r-hidden {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 12px;
    font-weight: 800;
    letter-spacing: 0.2em;
    text-transform: uppercase;
    color: #fff;
    background: rgba(8, 12, 20, 0.55);
    border-radius: 10px;
  }
  .r-copy {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 8px 10px;
    background: var(--surface-muted);
    border: 1px solid var(--border-subtle);
    border-radius: 12px;
  }
  .r-name {
    font-size: 16px;
    font-weight: 800;
    color: var(--text-primary);
    line-height: 1.25;
  }
  .r-sub {
    font-size: 12px;
    color: var(--text-tertiary);
  }
  .r-type {
    font-size: 12px;
    color: var(--text-secondary);
  }
  .r-stats {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 2px;
  }
  .r-stat {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 12px;
    font-weight: 700;
    color: var(--text-primary);
    background: var(--surface);
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
    padding: 1px 8px;
  }
  .r-stat b {
    color: var(--text-tertiary);
    font-weight: 600;
    font-size: 11px;
  }
  .r-stat.g b {
    color: #128378;
  }
  .r-stat.o b {
    color: #d9730d;
  }
  .r-stat.x {
    color: var(--text-tertiary);
    font-weight: 600;
  }
  .ct {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 16px;
    height: 16px;
    border-radius: 50%;
    font-size: 10px;
    font-weight: 800;
    color: #000;
  }
  .ct.w {
    background: #f4f4f4;
  }
  .ct.r {
    background: #e05252;
  }
  .r-desc {
    margin-top: 6px;
    font-size: 13px;
    line-height: 1.6;
    color: var(--text-primary);
    white-space: pre-wrap;
  }
  .r-desc.muted {
    color: var(--text-tertiary);
    font-style: italic;
  }
  .r-flavor {
    margin-top: 2px;
    font-size: 12px;
    line-height: 1.5;
    color: var(--text-tertiary);
    font-style: italic;
  }
  .r-code {
    margin-top: auto;
    padding-top: 4px;
    font-size: 11px;
    color: var(--text-tertiary);
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }
</style>
