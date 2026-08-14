<script lang="ts">
  import { loadImageFromAppFolder } from '$lib/services/image-cache-service'

  let { url, name, fallback = '/blue.jpg', className = '', isLandscape = false } = $props()

  let imageUrl = $state<string>('/blue.jpg')
  let isLoading = $state(true)

  $effect(() => {
    const currentFallback = fallback

    if (!url) {
      imageUrl = currentFallback
      isLoading = false
      return
    }

    let isActive = true
    isLoading = true

    const safeName = name || 'card'
    imageUrl = currentFallback

    loadImageFromAppFolder(url, safeName).then((localUrl) => {
      if (isActive) {
        imageUrl = localUrl || currentFallback
        isLoading = false
      }
    })

    return () => {
      isActive = false
    }
  })
</script>

{#if isLandscape}
  <div class="landscape-container {className}">
    <div class="rotate-wrapper">
      <img src={imageUrl} alt={name || 'Card Image'}  draggable="false" class:loading={isLoading} loading="lazy" />
    </div>
  </div>
{:else}
  <img src={imageUrl} alt={name || 'Card Image'}  draggable="false" class={className} class:loading={isLoading} loading="lazy" />
{/if}

<style>
  .loading {
    opacity: 0.5;
  }

  /* ========== 战场横版模式 ========== */
  .landscape-container {
    position: relative;
    width: 100%;
    aspect-ratio: 1040 / 744;
    overflow: hidden;
    display: inline-block;
  }

  .rotate-wrapper {
    position: absolute;
    top: 50%;
    left: 50%;
    width: calc(100% * 744 / 1040);
    height: calc(100% * 1040 / 744);
    transform: translate(-50%, -50%) rotate(-90deg);
    transform-origin: center center;
  }

  .rotate-wrapper img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
    image-rendering: optimizeQuality;
  }
</style>
