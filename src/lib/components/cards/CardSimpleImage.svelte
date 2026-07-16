<script lang="ts">
  import { loadImageFromAppFolder } from '$lib/services/image-cache-service' // 替换为你的实际路径

  let { url, name, fallback = '/blue.jpg', className = '' } = $props()

  // 修复：使用固定字符串初始化，避免直接引用 prop 导致只捕获初始值
  let imageUrl = $state<string>('/blue.jpg')
  let isLoading = $state(true)

  $effect(() => {
    // 在 effect 内部读取 fallback，Svelte 会自动将其作为依赖项追踪
    const currentFallback = fallback

    if (!url) {
      imageUrl = currentFallback
      isLoading = false
      return
    }

    let isActive = true
    isLoading = true

    // 使用 card_no 或 id 作为 name 更稳定，避免中文名特殊字符问题
    const safeName = name || 'card'

    // 在加载期间先显示 fallback
    imageUrl = currentFallback

    loadImageFromAppFolder(url, safeName).then((localUrl) => {
      if (isActive) {
        // 加载成功则显示本地缓存 URL，失败则回退到 fallback
        imageUrl = localUrl || currentFallback
        isLoading = false
      }
    })

    // 清理函数：防止组件快速销毁时状态更新导致内存泄漏或竞态条件
    return () => {
      isActive = false
    }
  })
</script>

<img src={imageUrl} alt={name || 'Card Image'} class={className} class:loading={isLoading} />

<style>
  .loading {
    opacity: 0.5;
    /* 你可以在这里添加 CSS 骨架屏或 loading 动画 */
    /* 例如: animation: pulse 1.5s infinite; */
  }
</style>
