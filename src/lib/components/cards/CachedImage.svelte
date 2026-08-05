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
    style = '',
    isHover = true,
    onerror = undefined as ((e: Event) => void) | undefined,
    isLandscape = false,
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

  // 根据模式计算 aspect-ratio
  const aspectRatio = $derived(isLandscape ? '1040 / 744' : '744 / 1040')

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
    const currentRequestId = ++requestId
    loading = true
    error = false
    showImgDownloadError = false
    imageUrl = ''

    try {
      const url = await loadImageFromAppFolder(src, name)
      if (currentRequestId !== requestId) return
      if (url) {
        cleanupObjectUrl()
        imageUrl = url
        currentObjectUrl = url
      } else {
        error = true
        onerror?.(new Event('loadImageFromAppFolder returned null'))
      }
    } catch (err) {
      if (currentRequestId !== requestId) return
      console.error('[CacheImage] 加载图片失败:', err)
      error = true
      onerror?.(new Event('loadImageFromAppFolder threw error'))
    } finally {
      if (currentRequestId !== requestId) return
      loading = false
    }
  }

  $effect(() => {
    imageUrl = ''
    error = false
    showImgDownloadError = false

    if (!src) {
      loading = false
      cleanupObjectUrl()
      return
    }

    if (!lazy) {
      loading = true
      loadImage()
    } else {
      loading = true
      const el = containerElement
      if (el) {
        const obs = new IntersectionObserver(
          (entries) => {
            if (entries[0].isIntersecting) {
              loadImage()
              obs.disconnect()
            }
          },
          { rootMargin: '50px', threshold: 0.01 }
        )
        obs.observe(el)
        return () => obs.disconnect()
      }
    }
  })

  $effect(() => {
    return () => cleanupObjectUrl()
  })

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
  class:landscape={isLandscape}
  style:position="relative"
  style:width={width || '100%'}
  style:height={height || 'auto'}
  style:border-radius={borderRadius}
  style:overflow="hidden"
  style:aspect-ratio={aspectRatio}
  {style}
>
  <!-- ★ 旋转 wrapper：仅在 isLandscape 时生效 -->
  <div class="rotate-wrapper" class:active={isLandscape}>
    {#if loading}
      {#if placeholder}
        <img
          src={placeholder}
          alt="加载中..."
          style="width: 100%; height: 100%; {fitStyles[fit]}; opacity: 0.5;"
        />
      {:else}
        <div class="loading-placeholder">
          <LoaderCircle size={24} class="animate-spin" />
        </div>
      {/if}
    {:else if error}
      {#if errorImage}
        <img src={errorImage} alt="加载失败" style="width: 100%; height: 100%; {fitStyles[fit]};" />
      {:else if src}
        <div class="error-placeholder">
          <img
            {src}
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
        <div class="error-placeholder error-placeholder-empty">
          <svg
            width="40"
            height="40"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#ccc"
            stroke-width="2"
          >
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <polyline points="21 15 16 10 5 21" />
          </svg>
          <span style="color: #999; font-size: 14px;">图片加载失败</span>
        </div>
      {/if}
    {:else if imageUrl}
      <img
        src={imageUrl}
        alt={alt || name}
        style="width: 100%; height: 100%; {fitStyles[
          fit
        ]}; border-radius: {borderRadius}; transition: opacity 0.3s ease;"
        onerror={handleImgError}
      />
    {/if}
  </div>
</div>

<style>
  .cache-image-container {
    display: inline-block;
    overflow: hidden;
    transition: all 0.2s ease;
  }

  .cache-image-container img {
    display: block;
    image-rendering: optimizeQuality;
  }

  .cache-image-container-hover:hover {
    transform: translateY(-1px);
  }

  /* ========== 核心：旋转 wrapper ========== */
  .rotate-wrapper {
    width: 100%;
    height: 100%;
  }

  .rotate-wrapper.active {
    position: absolute;
    top: 50%;
    left: 50%;
    width: calc(100% * 744 / 1040);
    height: calc(100% * 1040 / 744);
    transform: translate(-50%, -50%) rotate(-90deg);
    transform-origin: center center;
  }

  /* ========== 加载占位 ========== */
  .loading-placeholder {
    width: 100%;
    height: 100%;
    background: var(--bg-secondary, #f0f0f0);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  /* ========== 错误状态 ========== */
  .error-placeholder {
    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
  }

  .error-placeholder-empty {
    background: var(--bg-secondary, #f5f5f5);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-direction: column;
    gap: 8px;
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
    font-size: 14px;
    backdrop-filter: blur(2px);
  }

  .error-tip strong {
    font-size: 16px;
  }

  .error-tip ul {
    margin: 0;
    padding-left: 1em;
    text-align: left;
    line-height: 1.5;
  }
</style>
