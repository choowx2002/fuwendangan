<script lang="ts">
  import type { CardBase, CardPrint } from '$lib/db/types'
  import CachedImage from './CachedImage.svelte'

  interface Props {
    card: CardBase & { card_prints?: CardPrint[] }
  }

  let { card }: Props = $props()

  const defaultPrint = $derived(
    card.card_prints?.find((p) => p.is_default) ?? card.card_prints?.[0]
  )

  // 【修复】使用 null 作为初始值，避免缓存 blue.jpg
  let currentSrc = $state<string | null>(null)
  let fallbackCount = $state(0)

  $effect(() => {
    // 只有当 defaultPrint 存在时才设置 src
    if (defaultPrint) {
      currentSrc = defaultPrint.img_cdn ?? defaultPrint.tts_cdn ?? null
      fallbackCount = 0
    }
  })

  function handleError(e: Event) {
    if (!defaultPrint) return

    const img = e.target as HTMLImageElement

    if (fallbackCount === 0 && defaultPrint.tts_cdn && currentSrc !== defaultPrint.tts_cdn) {
      currentSrc = defaultPrint.tts_cdn
      fallbackCount++
    } else if (currentSrc !== null) {
      currentSrc = null
      img.onerror = null
    }
  }
</script>

<div class="card-item">
  {#if currentSrc}
    <CachedImage
      src={currentSrc}
      name={`${card.id}-${defaultPrint?.id || 'default'}`}
      width="100%"
      borderRadius="6px"
      fit="cover"
      onerror={handleError}
    />
  {:else}
    <!-- 显示占位符，但不通过 CachedImage 缓存 -->
    <div
      class="placeholder"
      style="width: 100%; height: 100%; background: var(--bg-secondary); display: flex; align-items: center; justify-content: center;"
    >
      <span style="color: var(--text-muted); font-size: 12px;">无图片</span>
    </div>
  {/if}
  <h5 style="color: var(--text-primary) ;margin: 0; text-align: center;">
    {`${card.card_name_cn} ${card.sub_title_cn || ''}`}
  </h5>
</div>

<style>
  .card-item {
    display: block;
    position: relative;
    /* aspect-ratio: 744 / 1040; */
    /* border-radius: var(--radius-md); */
    text-decoration: none;
    cursor: pointer;
  }
</style>
