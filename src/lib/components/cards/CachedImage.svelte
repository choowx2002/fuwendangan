<script lang="ts">
    import { loadImageFromAppFolder } from "$lib/cards/image-cache";
    import type { ObjectFitType } from "$lib/cards/image-cache";

    let {
        src = "",
        name = "image",
        alt = "",
        width = undefined,
        height = undefined,
        fit = "cover" as ObjectFitType,
        borderRadius = "0px",
        placeholder = "",
        errorImage = "",
        lazy = true,
        className = "",
        style = "",
        // 新增：允许父组件传入错误处理回调
        onerror = undefined as ((e: Event) => void) | undefined,
    } = $props();

    let imageUrl = $state("");
    let loading = $state(true);
    let error = $state(false);
    let objectUrl = $state<string | null>(null);

    // 【修复】绑定到外层容器，确保无论什么状态下 DOM 都存在
    let containerElement = $state<HTMLDivElement | undefined>(undefined);
    let imgElement = $state<HTMLImageElement | undefined>(undefined);

    const fitStyles: Record<ObjectFitType, string> = {
        cover: "object-fit: cover;",
        contain: "object-fit: contain;",
        fill: "object-fit: fill;",
        none: "object-fit: none;",
        "scale-down": "object-fit: scale-down;",
    };

    async function loadImage(): Promise<void> {
        if (!src) {
            loading = false;
            return;
        }

        loading = true;
        error = false;

        try {
            const url = await loadImageFromAppFolder(src, name);
            if (url) {
                if (objectUrl) URL.revokeObjectURL(objectUrl);
                imageUrl = url;
                objectUrl = url;
            } else {
                error = true;
                onerror?.(new Event("error")); // 触发父组件回调
            }
        } catch (err) {
            console.error("[Image] 加载图片失败:", err);
            error = true;
            onerror?.(new Event("error")); // 触发父组件回调
        } finally {
            loading = false;
        }
    }

    // 【修复】使用 containerElement 进行懒加载观察
    $effect(() => {
        if (!src) {
            loading = false;
            return;
        }

        if (!lazy) {
            loadImage();
        } else {
            const el = containerElement;
            if (el) {
                const obs = new IntersectionObserver(
                    (entries) => {
                        if (entries[0].isIntersecting) {
                            loadImage();
                            obs.disconnect();
                        }
                    },
                    { rootMargin: "50px", threshold: 0.1 },
                );
                obs.observe(el);
                return () => obs.disconnect();
            }
        }
    });

    $effect(() => {
        const currentUrl = objectUrl;
        return () => {
            if (currentUrl) URL.revokeObjectURL(currentUrl);
        };
    });

    function handleImgError(e: Event) {
        error = true;
        loading = false;
        onerror?.(e);
    }
</script>

<!-- 【修复】将 bind:this 绑定到外层 div -->
<div
    bind:this={containerElement}
    class="cache-image-container {className}"
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
                style="width: 100%; height: 100%; background: var(--bg-secondary); display: flex; align-items: center; justify-content: center;"
            >
                <span style="color: #999; font-size: 14px;">加载中...</span>
            </div>
        {/if}
    {:else if error}
        {#if errorImage}
            <img
                src={errorImage}
                alt="加载失败"
                style="width: 100%; height: 100%; object-fit: cover;"
            />
        {:else}
            <div
                class="error-placeholder"
                style="width: 100%; height: 100%; background: #f5f5f5; display: flex; align-items: center; justify-content: center; flex-direction: column; gap: 8px;"
            >
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
                <span style="color: #999; font-size: 12px;">图片加载失败</span>
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
                loading = false;
            }}
            onerror={handleImgError}
        />
    {/if}
</div>

<style>
    .cache-image-container {
        display: inline-block;
    }
    .cache-image-container img {
        display: block;
    }
</style>
