<script lang="ts">
  import { type ObjectFitType, loadImageFromAppFolder } from '$lib/services/image-cache-service'
  import { LoaderCircle } from '@lucide/svelte'

  let {
    src = '',
    name = 'image',
    alt = '',
    width = undefined as string | number | undefined,
    height = undefined as string | number | undefined,
    fit = 'cover' as ObjectFitType,
    borderRadius = '0px',
    placeholder = '',
    errorImage = '',
    lazy = true,
    className = '',
    style = 'aspect-ratio: 744 / 1040;',
    isHover = true,
    onerror = undefined as ((e: Event) => void) | undefined,
  } = $props()

  let imageUrl = $state('')
  let loading = $state(true)
  let error = $state(false)
  let showImgDownloadError = $state(false)
  
  let currentObjectUrl: string | null = null
  let requestId = 0

  let containerElement = $state<HTMLDivElement | undefined>(undefined)

  const fitStyles: Record<ObjectFitType, string> = {
    cover: 'object-fit: cover;',
    contain: 'object-fit: contain;',
    fill: 'object-fit: fill;',
    none: 'object-fit: none;',
    'scale-down': 'object-fit: scale-down;',
  }

  // 统一清理 Object URL，防止内存泄漏
  function cleanupObjectUrl() {
    if (currentObjectUrl) {
      URL.revokeObjectURL(currentObjectUrl)
      currentObjectUrl = null
    }
  }

  async function loadImage() {
    if (!src) {
      loading = false
      imageUrl = ''
      error = false
      return
    }

    // 第 13 条：生成当前请求的唯一 ID
    const currentRequestId = ++requestId
    
    loading = true
    error = false
    showImgDownloadError = false
    imageUrl = '' // 第 12 条：清空旧图，防止切换时闪烁

    try {
      const url = await loadImageFromAppFolder(src, name)

      // 第 13 条：防止异步竞态。如果在此期间发起了新请求，则丢弃当前结果
      if (currentRequestId !== requestId) return

      if (url) {
        cleanupObjectUrl() // 清理旧的 Object URL
        imageUrl = url
        currentObjectUrl = url
      } else {
        error = true
        onerror?.(new Event('loadImageFromAppFolder returned null'))
      }
    } catch (err) {
      // 第 13 条：捕获异常时同样需要校验请求 ID
      if (currentRequestId !== requestId) return
      
      console.error('[CacheImage] 加载图片失败:', err)
      error = true
      onerror?.(new Event('loadImageFromAppFolder threw error'))
    } finally {
      if (currentRequestId !== requestId) return
      loading = false
    }
  }

  // 监听 src 和 lazy 的变化
  $effect(() => {
    // 第 12 条：src 变化时，立即重置状态
    imageUrl = ''
    error = false
    showImgDownloadError = false

    if (!src) {
      loading = false
      cleanupObjectUrl()
      return
    }

    if (!lazy) {
      // 第 2 条：支持 preload (lazy={false})
      loading = true
      loadImage()
    } else {
      // 懒加载模式
      loading = true // 保持 loading 状态，直到进入视口
      const el = containerElement
      
      if (el) {
        const obs = new IntersectionObserver(
          (entries) => {
            if (entries[0].isIntersecting) {
              loadImage()
              obs.disconnect() // 加载后断开观察，节省性能
            }
          },
          { rootMargin: '50px', threshold: 0.01 } // threshold 0.01 更容易在虚拟列表中触发
        )
        obs.observe(el)

        // 清理函数：组件销毁或 effect 重新运行时触发（完美支持第 10 条虚拟列表）
        return () => {
          obs.disconnect()
        }
      }
    }
  })

  // 组件销毁时确保清理 Object URL
  $effect(() => {
    return () => {
      cleanupObjectUrl()
    }
  })

  // 统一处理 <img> 标签的加载失败
  function handleImgError(e: Event) {
    error = true
    loading = false
    showImgDownloadError = true
    onerror?.(e)
  }
</script>

<div
  bind:this={containerElement}
  class="cache-image-container {className}"
  class:cache-image-container-hover={isHover}
  style:position="relative"
  style:width={width || '100%'}
  style:height={height || 'auto'}
  style:border-radius={borderRadius}
  style:overflow="hidden"
  {style}
>
  {#if loading}
    {#if placeholder}
      <img
        src={placeholder}
        alt="加载中..."
        style="width: 100%; height: 100%; {fitStyles[fit]}; opacity: 0.5;"
      />
    {:else}
      <div
        class="loading-placeholder"
        style="width: 100%; height: 100%; background: var(--bg-secondary, #f0f0f0); display: flex; align-items: center; justify-content: center;"
      >
        <LoaderCircle size={24} class="animate-spin" />
      </div>
    {/if}
    
  {:else if error}
    {#if errorImage}
      <!-- 第 6 条：自定义错误图片 -->
      <img
        src={errorImage}
        alt="加载失败"
        style="width: 100%; height: 100%; {fitStyles[fit]};"
      />
    {:else if src}
      <!-- Fallback 机制：如果缓存加载失败，尝试直接用原 src 加载 (如 CDN 直链) -->
      <div class="error-placeholder">
        <img
          src={src}
          alt={alt || name}
          style="width: 100%; height: 100%; {fitStyles[fit]};"
          onerror={handleImgError}
        />
        
        {#if showImgDownloadError}
          <div class="error-tip">
            <strong>无法加载图片</strong>
            <span>可能原因：</span>
            <ul>
              <li>网络连接异常</li>
              <li>图片服务器暂时不可用</li>
              <li>中国大陆地区可能因网络环境导致无法访问</li>
              <li>图片资源不存在或已被移除</li>
            </ul>
          </div>
        {/if}
      </div>
    {:else}
      <div
        class="error-placeholder"
        style="width: 100%; height: 100%; background: var(--bg-secondary, #f5f5f5); display: flex; align-items: center; justify-content: center; flex-direction: column; gap: 8px;"
      >
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#ccc" stroke-width="2">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <polyline points="21 15 16 10 5 21" />
        </svg>
        <span style="color: #999; font-size: var(--text-sm, 14px);">图片加载失败</span>
      </div>
    {/if}
    
  {:else if imageUrl}
    <img
      src={imageUrl}
      alt={alt || name}
      style="width: 100%; height: 100%; {fitStyles[fit]}; border-radius: {borderRadius}; transition: opacity 0.3s ease;"
      onerror={handleImgError}
    />
  {/if}
</div>

<style>
  .cache-image-container {
    display: inline-block;
    /* 默认 aspect-ratio，可通过 prop style 覆盖 */
    aspect-ratio: 744 / 1040; 
    overflow: hidden;
    transition: all 0.2s ease;
  }

  .cache-image-container img {
    display: block;
    image-rendering: optimizeQuality;
  }

  .cache-image-container-hover:hover {
    transform: translateY(-1px);
    /* 如果需要阴影，可在此处取消注释 */
    /* box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15); */
  }

  .error-placeholder {
    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
  }

  .error-tip {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    gap: 6px;
    padding: 12px;
    text-align: center;
    background: rgba(0, 0, 0, 0.65);
    color: #fff;
    font-size: var(--text-sm, 14px);
    backdrop-filter: blur(2px);
  }

  .error-tip strong {
    font-size: var(--text-base, 16px);
  }

  .error-tip ul {
    margin: 0;
    padding-left: 1em;
    text-align: left;
    line-height: 1.5;
  }
</style>