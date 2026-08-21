<script lang="ts">
  import { loadImageFromAppFolder } from '$lib/services/image-cache-service'
  import { isTauri } from '$lib/db/env'
  import type { ReplayCardMeta } from '$lib/replay/card-meta'

  interface Props {
    card: Record<string, unknown> | null
    meta: ReplayCardMeta | null
  }
  let { card, meta }: Props = $props()

  // 只展示：卡图 + 技能效果（中文优先）。其余一概不渲染。
  const eventName = $derived(typeof card?.name === 'string' ? String(card.name) : '')
  const name = $derived(meta?.name ?? eventName ?? '')
  const effectText = $derived(meta?.description?.trim() ?? '')
  const isBattlefield = $derived(
    (typeof card?.type === 'string' && card.type === 'battlefield') ||
      (meta?.type ?? '').includes('战场')
  )

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
      .catch(() => {})
    return () => {
      active = false
    }
  })

  function onArtError() {
    artSrc = '/blue.jpg'
  }
</script>

<div class="tip">
  <div class="tip-art" class:bf={isBattlefield}>
    <img src={artSrc} alt={name} draggable="false" onerror={onArtError} />
  </div>
  {#if effectText}
    <div class="tip-effect">{effectText}</div>
  {/if}
</div>

<style>
  .tip {
    display: flex;
    gap: 10px;
    padding: 8px;
    background: color-mix(in srgb, var(--surface) 92%, transparent);
    backdrop-filter: blur(12px);
    border: 1px solid var(--border-color);
    border-radius: 12px;
    box-shadow: 0 16px 48px rgba(0, 0, 0, 0.4);
    pointer-events: none;
    max-width: 340px;
    max-height: 320px;
  }
  .tip-art {
    flex: none;
    width: 118px;
    aspect-ratio: 744 / 1039;
    border-radius: 8px;
    overflow: hidden;
    border: 1px solid var(--border-color);
    background: var(--surface-muted);
  }
  .tip-art.bf {
    aspect-ratio: 1039 / 744;
    align-self: center;
  }
  .tip-art img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .tip-effect {
    flex: 1 1 auto;
    min-width: 0;
    max-height: 100%;
    overflow-y: auto;
    font-size: 13px;
    line-height: 1.55;
    color: var(--text-primary);
    white-space: pre-wrap;
    padding: 2px 2px;
  }
</style>
