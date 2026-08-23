<script lang="ts">
  import { t } from '$lib/i18n'
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
/** 宽度由父容器（flex）决定，忽略 width（用于自适应撑满） */
  fluid?: boolean
  /** 强制显示正面卡面（忽略 back/placeholder/hidden），用于连锁区 */
  forceFace?: boolean
  }
  let {
    card = null,
    meta = null,
    back = false,
    width = 58,
    nameOverride = null,
    showType = true,
    fluid = false,
    forceFace = false,
  }: Props = $props()

  const code = $derived(typeof card?.cardCode === 'string' ? String(card.cardCode) : '')
  const resolved = $derived(meta ?? (code ? createFallbackMeta(code) : null))
  const eventName = $derived(typeof card?.name === 'string' ? String(card.name) : '')
  const name = $derived(nameOverride ?? resolved?.name ?? (eventName || '?'))
  const eventType = $derived(typeof card?.type === 'string' ? String(card.type) : '')
  const typeLabel = $derived(eventType || resolved?.type || '')
  const isBattlefield = $derived(
    eventType === 'battlefield' || (resolved?.type ?? '').includes('战场')
  )
  const exhausted = $derived(card?.exhausted === true)
  const hidden = $derived(card?.hidden === true)
  const placeholder = $derived(card?.isPlaceholder === true)
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

{#if !forceFace && (back || placeholder || !card)}
  <div class="rc back" style="width: {fluid ? '100%' : width + 'px'}">
    <img src="/blue.jpg" alt="" draggable="false" />
  </div>
{:else}
  <div
    class="rc face {isBattlefield ? 'bf' : ''} {exhausted ? 'exhausted' : ''}"
    style="width: {fluid ? '100%' : width + 'px'}"
    data-code={code}
    data-name={name}
  >
    <div class="rc-art">
      <img src={artSrc} alt={name} draggable="false" onerror={onArtError} />
      {#if !forceFace && hidden}
        <span class="rc-hidden">{$t('replay.hiddenCard')}</span>
      {/if}
    </div>
    {#if might !== null}
      <span class="rc-might">{might}</span>
    {/if}
    {#if whiteCounter !== null || redCounter !== null}
      <span class="rc-badges">
        {#if whiteCounter !== null}<span class="rc-badge w">{whiteCounter}</span>{/if}
        {#if redCounter !== null}<span class="rc-badge r">{redCounter}</span>{/if}
      </span>
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
    container-type: inline-size;
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
  .rc.face.exhausted {
    transform: rotate(90deg);
  }
  /* hidden 卡：图面中央标注（待命中 / hidden） */
  .rc-hidden {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: clamp(6px, 14cqw, 13px);
    font-weight: 800;
    letter-spacing: 0.18em;
    color: #fff;
    background: rgba(8, 12, 20, 0.55);
  }
  /* 战力：左上角，尺寸随卡宽（cqw = 卡宽百分比） */
  .rc-might {
    position: absolute;
    top: 4%;
    left: 4%;
    width: 24cqw;
    height: 24cqw;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 14cqw;
    font-weight: 800;
    color: #0a1a33;
    background: #ffbb6e;
    border: 1px solid rgba(255, 255, 255, 0.5);
  }
  /* 白/红计数器：左下角 */
  .rc-badges {
    position: absolute;
    left: 4%;
    bottom: 4%;
    display: flex;
    gap: 2px;
  }
  .rc-badge {
    width: 17cqw;
    height: 17cqw;
    border-radius: 50%;
    font-size: 10cqw;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #000;
    font-weight: 800;
  }
  .rc-badge.w {
    background: #f4f4f4;
  }
  .rc-badge.r {
    background: #e05252;
  }
</style>
