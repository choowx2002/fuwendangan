<script lang="ts">
  import { loadImageFromAppFolder } from '$lib/services/image-cache-service' // 替换为你的实际路径

  let { url, name, fallback = '/blue.jpg', className = '' } = $props()

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

<img src={imageUrl} alt={name || 'Card Image'} class={className} class:loading={isLoading} />

<style>
  .loading {
    opacity: 0.5;
  }
</style>
