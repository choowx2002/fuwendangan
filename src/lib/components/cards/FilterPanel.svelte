<script lang="ts">
    import { X } from "@lucide/svelte";
    import type {
        FilterOptions,
        ActiveFilter,
        FilterMode,
    } from "$lib/db/types";

    interface Props {
        isOpen: boolean;
        filterOptions: FilterOptions | null;
        activeFilters: ActiveFilter[];
        onToggle: (type: ActiveFilter["type"], value: string) => void;
        onRemove: (type: ActiveFilter["type"], value: string) => void;
        onClear: () => void;
        onClose: () => void;
    }

    let {
        isOpen,
        filterOptions,
        activeFilters,
        onToggle,
        onRemove,
        onClear,
        onClose,
    }: Props = $props();

    const sections = $derived.by(() => {
        if (!filterOptions) return [];
        const map = (
            type: ActiveFilter["type"],
            options: string[] | undefined,
        ) => ({
            type,
            title:
                type === "card_color_list"
                    ? "颜色"
                    : type === "card_category"
                      ? "类别"
                      : type === "region"
                        ? "地区"
                        : type === "tag"
                          ? "标签"
                          : type === "keyword"
                            ? "关键字"
                            : type === "advanced_tag"
                              ? "进阶标签"
                              : type === "series"
                                ? "系列"
                                : type === "rarity"
                                  ? "稀有度"
                                  : type,
            options: options || [],
        });

        return [
            map("card_color_list", filterOptions.colors),
            map("card_category", filterOptions.categories),
            map("series", filterOptions.series),
            map("rarity", filterOptions.rarities),
            map("region", filterOptions.regions),
            map("tag", filterOptions.tags),
            map("keyword", filterOptions.keywords),
            map("advanced_tag", filterOptions.advanced_tags),
        ].filter((s) => s.options.length > 0);
    });

    function getMode(type: string, value: string): FilterMode | null {
        return (
            activeFilters.find((f) => f.type === type && f.value === value)
                ?.mode || null
        );
    }

    function handleToggle(type: string, value: string) {
        onToggle(type as any, value);
    }

    function handleRemove(e: MouseEvent, type: string, value: string) {
        e.preventDefault();
        onRemove(type as any, value);
    }
</script>

{#if isOpen}
    <!-- 遮罩层：点击关闭 -->
    <div class="modal-container">
        <div class="modal-inner">
            <div class="overlay" onclick={onClose} role="presentation"></div>
            <div
                class="modal-content"
                tabindex="-1"
                role="dialog"
                aria-modal="true"
            >
                <!-- 头部 -->
                <header class="modal-header">
                    <h2>筛选条件</h2>
                    <button
                        class="close-btn"
                        onclick={onClose}
                        aria-label="关闭"
                    >
                        <X size={20} />
                    </button>
                </header>

                <!-- 内容区：可滚动 -->
                <div class="modal-body">
                    {#each sections as section}
                        <section class="filter-section">
                            <h3 class="section-title">{section.title}</h3>
                            <div class="options-grid">
                                {#each section.options as option}
                                    {@const mode = getMode(
                                        section.type,
                                        option,
                                    )}
                                    <button
                                        class="option-btn"
                                        class:include={mode === "include"}
                                        class:require={mode === "require"}
                                        class:exclude={mode === "exclude"}
                                        onclick={() =>
                                            handleToggle(section.type, option)}
                                        oncontextmenu={(e) =>
                                            handleRemove(
                                                e,
                                                section.type,
                                                option,
                                            )}
                                    >
                                        {option}
                                    </button>
                                {/each}
                            </div>
                        </section>
                    {/each}
                </div>

                <!-- 底部操作栏 (移动端极其友好) -->
                <footer class="modal-footer">
                    <div>
                        <span class="count"
                            >{activeFilters.length} 项已激活</span
                        >
                        <button class="clear-btn" onclick={onClear}>重置</button
                        >
                    </div>

                    <button class="apply-btn" onclick={onClose}>完成</button>
                </footer>
            </div>
        </div>
    </div>
{/if}

<style>
    /* 遮罩层 */
    .modal-container {
        position: fixed;
        inset: 0;
        background: transparent;
        z-index: 1000;
        animation: fadeIn 0.2s ease;
    }

    .modal-inner {
        position: relative;
        width: 100%;
        height: 100%;
        display: flex;
        justify-content: center;
        align-items: center;
    }

    .overlay {
        position: absolute;
        inset: 0;
        background-color: rgba(0, 0, 0, 0.4);
        z-index: 40;
        backdrop-filter: blur(2px);
    }

    /* 弹窗主体 (桌面端居中) */
    .modal-content {
        background: var(--bg-secondary);
        border-radius: 16px;
        width: 90vw;
        max-width: 900px;
        max-height: 85vh;
        display: flex;
        position: absolute;
        z-index: 50;
        flex-direction: column;
        box-shadow: 0 10px 40px rgba(0, 0, 0, 0.15);
        animation: slideUp 0.25s cubic-bezier(0.22, 1, 0.36, 1);
        overflow: hidden;
    }

    .modal-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 16px 20px;
        border-bottom: 1px solid var(--border-color);
        flex-shrink: 0;
    }

    .modal-header h2 {
        font-size: 16px;
        font-weight: 600;
        margin: 0;
        color: var(--text-primary);
    }

    .close-btn {
        background: none;
        border: none;
        cursor: pointer;
        color: var(--text-secondary);
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 4px;
        border-radius: 50%;
        transition: background 0.15s;
    }
    .close-btn:hover {
        background: var(--bg-hover);
        color: var(--text-primary);
    }

    .modal-body {
        flex: 1;
        overflow-y: auto;
        column-count: 2;
        padding: 16px 20px;
    }

    .modal-footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 12px 20px;
        border-top: 1px solid var(--border-color);
        background: var(--bg-secondary);
        flex-shrink: 0;
    }

    .count {
        font-size: 13px;
        color: var(--text-secondary);
    }

    .apply-btn {
        padding: 8px 20px;
        background: var(--text-primary);
        color: var(--bg-primary);
        border: none;
        border-radius: var(--radius-md);
        font-size: 14px;
        font-weight: 500;
        cursor: pointer;
        transition: opacity 0.15s;
    }

    .clear-btn {
        background: transparent;
        border: none;
        font-size: 13px;
        font-weight: 500;
        cursor: pointer;
        color: #c5221f;
    }

    .apply-btn:hover {
        opacity: 0.9;
    }

    /* ================= 内部元素样式 ================= */
    .filter-section {
        break-inside: avoid;
        margin-bottom: 20px;
    }

    .section-title {
        font-size: 14px;
        font-weight: 600;
        color: var(--text-primary);
        text-transform: uppercase;
        letter-spacing: 0.5px;
        margin: 0 0 8px 0;
    }

    .options-grid {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
    }

    .option-btn {
        padding: 4px 10px;
        font-size: 13px;
        border: 1px solid var(--border-color);
        border-radius: 4px;
        background: var(--bg-primary);
        color: var(--text-primary);
        cursor: pointer;
        transition: all 0.15s;
        white-space: nowrap;
    }
    .option-btn:hover {
        background: var(--bg-hover);
        border-color: #d3d1cb;
    }

    .option-btn.include {
        background: #e8f0fe;
        border-color: #d2e3fc;
        color: #1967d2;
        font-weight: 500;
    }
    .option-btn.require {
        background: #e6f4ea;
        border-color: #ceead6;
        color: #137333;
        font-weight: 500;
    }
    .option-btn.exclude {
        background: #fce8e6;
        border-color: #f5c6c0;
        color: #c5221f;
        font-weight: 500;
    }

    /* ================= 移动端适配 (底部弹出抽屉) ================= */
    @media (max-width: 767.99px) {
        .modal-container {
            padding: 0;
            align-items: flex-end;
        }

        .modal-content {
            max-width: 100%;
            width: 100%;
            height: calc(100dvh - env(safe-area-inset-top));
            max-height: 100vh;
            border-radius: 0;
            border-bottom-left-radius: 0;
            border-bottom-right-radius: 0;
            animation: slideUpMobile 0.3s cubic-bezier(0.22, 1, 0.36, 1);
        }

        .modal-body {
            column-count: unset;
        }

        .filter-section {
            break-inside: unset;
        }
    }

    /* ================= 动画 ================= */
    @keyframes fadeIn {
        from {
            opacity: 0;
        }
        to {
            opacity: 1;
        }
    }

    @keyframes slideUp {
        from {
            opacity: 0;
            transform: translateY(20px) scale(0.98);
        }
        to {
            opacity: 1;
            transform: translateY(0) scale(1);
        }
    }

    @keyframes slideUpMobile {
        from {
            transform: translateY(100%);
        }
        to {
            transform: translateY(0);
        }
    }
</style>
