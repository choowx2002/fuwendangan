<script lang="ts">
  import { type ObjectFitType, loadImageFromAppFolder } from '$lib/services/image-cache-service'
  import { LoaderCircle } from '@lucide/svelte'

  let {
    src = '',
    name = 'image',
    alt = '',
    width = undefined,
    height = undefined,
    fit = 'cover' as ObjectFitType,
    borderRadius = '0px',
    placeholder = '',
    errorImage = '',
    lazy = true,
    className = '',
    style = '',
    isHover = true,
    // 新增：允许父组件传入错误处理回调
    onerror = undefined as ((e: Event) => void) | undefined,
  } = $props()

  let imageUrl = $state('')
  let loading = $state(true)
  let error = $state(false)
  let objectUrl = $state<string | null>(null)

  let containerElement = $state<HTMLDivElement | undefined>(undefined)
  let imgElement = $state<HTMLImageElement | undefined>(undefined)

  const fitStyles: Record<ObjectFitType, string> = {
    cover: 'object-fit: cover;',
    contain: 'object-fit: contain;',
    fill: 'object-fit: fill;',
    none: 'object-fit: none;',
    'scale-down': 'object-fit: scale-down;',
  }

  async function loadImage(): Promise<void> {
    if (!src) {
      loading = false
      return
    }

    loading = true
    error = false

    try {
      const url = await loadImageFromAppFolder(src, name)
      if (url) {
        if (objectUrl) URL.revokeObjectURL(objectUrl)
        imageUrl = url
        objectUrl = url
      } else {
        error = true
        onerror?.(new Event('error')) // 触发父组件回调
      }
    } catch (err) {
      console.error('[Image] 加载图片失败:', err)
      error = true
      onerror?.(new Event('error')) // 触发父组件回调
    } finally {
      loading = false
    }
  }

  // 【修复】使用 containerElement 进行懒加载观察
  $effect(() => {
    if (!src) {
      loading = false
      return
    }

    if (!lazy) {
      loadImage()
    } else {
      const el = containerElement
      if (el) {
        const obs = new IntersectionObserver(
          (entries) => {
            if (entries[0].isIntersecting) {
              loadImage()
              obs.disconnect()
            }
          },
          { rootMargin: '50px', threshold: 0.1 }
        )
        obs.observe(el)
        return () => obs.disconnect()
      }
    }
  })

  $effect(() => {
    const currentUrl = objectUrl
    return () => {
      if (currentUrl) URL.revokeObjectURL(currentUrl)
    }
  })

  function handleImgError(e: Event) {
    error = true
    loading = false
    onerror?.(e)
  }

  let showImgDownloadError = $state(false)

  function showError() {
    showImgDownloadError = true
  }
</script>

<div
  bind:this={containerElement}
  class="cache-image-container {className}"
  class:cache-image-container-hover={isHover}
  style="
        position: relative;
        width: {width || '100%'};
        height: {height || 'auto'};
        border-radius: {borderRadius};
        overflow: hidden;
        {style}
    "
>
  {#if loading}
    {#if placeholder}
      <img
        src={placeholder}
        alt="加载中..."
        style="width: 100%; height: 100%; object-fit: cover; opacity: 0.5;"
      />
    {:else}
      <div
        class="loading-placeholder"
        style="width: 100%; aspect-ratio: 744 / 1040; background: var(--bg-secondary); display: flex; align-items: center; justify-content: center;"
      >
        <!-- <span style="color: #999; font-size: var(--text-base);">加载中...</span> -->
        <LoaderCircle size={24} class="animate-spin" />
      </div>
    {/if}
  {:else if error}
    {#if errorImage}
      <img src={errorImage} alt="加载失败" style="width: 100%; height: 100%; object-fit: cover;" />
    {:else if src}
      <div class="error-placeholder">
        <img
          {src}
          alt={alt || name}
          style="width: 100%; height: 100%; {fitStyles[fit]};"
          onload={() => {
            loading = false
          }}
          onerror={showError}
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
        style="width: 100%; height: 100%; background: #f5f5f5; display: flex; align-items: center; justify-content: center; flex-direction: column; gap: 8px;"
      >
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#ccc" stroke-width="2">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <polyline points="21 15 16 10 5 21" />
        </svg>
        <span style="color: #999; font-size: var(--text-sm);">图片加载失败</span>
      </div>
    {/if}
  {:else if imageUrl}
    <img
      bind:this={imgElement}
      src={imageUrl}
      alt={alt || name}
      style="width: 100%; height: 100%; {fitStyles[
        fit
      ]}; border-radius: {borderRadius}; transition: opacity 0.3s ease; overflow: visible;"
      onload={() => {
        loading = false
      }}
      onerror={handleImgError}
    />
  {/if}
</div>

<style>
  .cache-image-container {
    display: inline-block;
    aspect-ratio: 744 / 1040;
    overflow: hidden;
    transition: all 0.2s ease;
  }
  .cache-image-container img {
    display: block;
    image-rendering: optimizeQuality;
  }

  .cache-image-container-hover:hover {
    /*box-shadow: 0 4px 12px rgba(0, 0, 0, 0.353);*/
    transform: translateY(-1px);
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
    background: rgba(0, 0, 0, 0.55);
    color: #fff;
    font-size: var(--text-sm);
  }

  .error-tip strong {
    font-size: var(--text-base);
  }

  .error-tip ul {
    margin: 0;
    padding-left: 1em;
    text-align: left;
  }
</style>
