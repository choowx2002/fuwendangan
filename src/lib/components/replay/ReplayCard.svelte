<script lang="ts">
  import { loadImageFromAppFolder } from '$lib/services/image-cache-service'
  import { isTauri } from '$lib/db/env'
  import { createFallbackMeta, type ReplayCardMeta } from '$lib/replay/card-meta'

  interface Props {
    /** 事件卡对象（含 name/type/cardCode/exhausted 等字段） */
    card?: Record<string, unknown> | null
    /** 解析后的卡牌元数据（本地库）；缺省时按 cardCode 现算兜底 */
    meta?: ReplayCardMeta | null
    /** 显示卡背（隐藏信息区） */
    back?: boolean
    width?: number
    nameOverride?: string | null
    showType?: boolean
  }
  let {
    card = null,
    meta = null,
    back = false,
    width = 58,
    nameOverride = null,
    showType = true,
  }: Props = $props()

  const code = $derived(typeof card?.cardCode === 'string' ? String(card.cardCode) : '')
  const resolved = $derived(meta ?? (code ? createFallbackMeta(code) : null))
  const eventName = $derived(typeof card?.name === 'string' ? String(card.name) : '')
  const name = $derived(nameOverride ?? resolved?.name ?? (eventName || '?'))
  const eventType = $derived(typeof card?.type === 'string' ? String(card.type) : '')
  const typeLabel = $derived(eventType || resolved?.type || '')
  const isUnit = $derived(eventType === 'unit' || (resolved?.type ?? '').includes('单位'))
  const isBattlefield = $derived(
    eventType === 'battlefield' || (resolved?.type ?? '').includes('战场')
  )
  const exhausted = $derived(card?.exhausted === true)
  const placeholder = $derived(card?.isPlaceholder === true)
  const energyCost = $derived(
    resolved?.energyCost ?? (typeof card?.energyCost === 'number' ? card.energyCost : null)
  )
  const might = $derived(resolved?.might ?? (typeof card?.might === 'number' ? card.might : null))
  const whiteCounter = $derived(
    typeof card?.whiteCounter === 'number' ? Number(card.whiteCounter) : null
  )
  const redCounter = $derived(typeof card?.redCounter === 'number' ? Number(card.redCounter) : null)

  // 卡图只来自本地 SC prints（img_cdn）；无本地图时显示占位卡背
  let artSrc = $state('/blue.jpg')

  $effect(() => {
    if (!isTauri || !resolved?.imgCdn) {
      artSrc = '/blue.jpg'
      return
    }
    let active = true
    loadImageFromAppFolder(resolved.imgCdn, resolved.cacheName ?? 'replay-card')
      .then((url) => {
        if (active && url) artSrc = url
      })
      .catch(() => {
        // 本地读取失败时保持占位卡背
      })
    return () => {
      active = false
    }
  })

  function onArtError() {
    artSrc = '/blue.jpg'
  }
</script>

{#if back || placeholder || !card}
  <div class="rc back" style="width:{width}px">
    <img src="/blue.jpg" alt="" draggable="false" />
  </div>
{:else}
  <div
    class="rc face {isBattlefield ? 'bf' : ''} {exhausted ? 'exhausted' : ''}"
    style="width:{width}px"
    data-code={code}
    data-name={name}
  >
    <div class="rc-art">
      <img src={artSrc} alt={name} loading="lazy" draggable="false" onerror={onArtError} />
    </div>
    {#if energyCost !== null}
      <span class="rc-cost">{energyCost}</span>
    {/if}
    {#if isUnit && might !== null}
      <span class="rc-might">{might}</span>
    {/if}
    {#if whiteCounter !== null || redCounter !== null}
      <span class="rc-badges">
        {#if whiteCounter !== null}<span class="rc-badge w">{whiteCounter}</span>{/if}
        {#if redCounter !== null}<span class="rc-badge r">{redCounter}</span>{/if}
      </span>
    {/if}
    <div class="rc-name">{name}</div>
    {#if showType && typeLabel}
      <div class="rc-type">{typeLabel}</div>
    {/if}
  </div>
{/if}

<style>
  .rc {
    position: relative;
    aspect-ratio: 744 / 1039;
    border-radius: 6px;
    flex: none;
    background: var(--surface-muted);
    border: 1px solid var(--border-color);
    font-size: 10px;
    line-height: 1.15;
    overflow: hidden;
  }
  .rc.bf {
    aspect-ratio: 800 / 573;
  }
  .rc.back img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .rc-art {
    position: absolute;
    inset: 0;
    overflow: hidden;
  }
  .rc-art img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .rc.face.exhausted .rc-art img {
    filter: grayscale(0.55) brightness(0.72);
  }
  .rc.face.exhausted {
    transform: rotate(90deg);
  }
  .rc-cost,
  .rc-might {
    position: absolute;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 10px;
    font-weight: 700;
    color: #0a1a33;
    border: 1px solid rgba(255, 255, 255, 0.5);
  }
  .rc-cost {
    top: 3px;
    left: 3px;
    background: #78ddb7;
  }
  .rc-might {
    right: 3px;
    bottom: 3px;
    background: #ffbb6e;
  }
  .rc-badges {
    position: absolute;
    top: 3px;
    right: 3px;
    display: flex;
    gap: 2px;
  }
  .rc-badge {
    width: 13px;
    height: 13px;
    border-radius: 50%;
    font-size: 9px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #000;
    font-weight: 700;
  }
  .rc-badge.w {
    background: #f4f4f4;
  }
  .rc-badge.r {
    background: #e05252;
  }
  .rc-name {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    background: linear-gradient(180deg, transparent, rgba(7, 19, 47, 0.92));
    color: #fff;
    text-align: center;
    font-size: 9px;
    padding: 10px 3px 2px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .rc-type {
    position: absolute;
    top: 3px;
    right: 3px;
    font-size: 7px;
    font-weight: 600;
    letter-spacing: 0.04em;
    color: var(--text-secondary);
    background: rgba(255, 255, 255, 0.85);
    border-radius: 5px;
    padding: 1px 4px;
    max-width: 80%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
