<script lang="ts">
    import type {
        FilterOptions,
        ActiveFilter,
        FilterMode,
    } from "$lib/db/types";

    interface Props {
        filterOptions: FilterOptions | null;
        activeFilters: ActiveFilter[];
        onToggle: (type: ActiveFilter["type"], value: string) => void;
        onRemove: (type: ActiveFilter["type"], value: string) => void;
    }

    let { filterOptions, activeFilters, onToggle, onRemove }: Props = $props();

    // 将 options 分组映射为 UI 区块
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

    function handleRemove(
        e: MouseEvent & { currentTarget: EventTarget & HTMLButtonElement },
        type: string,
        value: string,
    ) {
        e.preventDefault();
        onRemove(type as any, value);
    }
</script>

<div class="filter-panel" id="panel">
    <div class="panel-header">
        <h2>筛选条件</h2>
        <span class="count">{activeFilters.length} 项已激活</span>
    </div>

    {#each sections as section}
        <section class="filter-section">
            <h3 class="section-title">{section.title}</h3>
            <div class="options-grid">
                {#each section.options as option}
                    {@const mode = getMode(section.type, option)}
                    <button
                        class="option-btn"
                        class:include={mode === "include"}
                        class:require={mode === "require"}
                        class:exclude={mode === "exclude"}
                        onclick={() => handleToggle(section.type, option)}
                        oncontextmenu={(e) =>
                            handleRemove(e, section.type, option)}
                    >
                        {option}
                    </button>
                {/each}
            </div>
        </section>
    {/each}
</div>

<style>
    .filter-panel {
        padding: 16px;
        height: 100%;
        overflow-y: auto;
        background: var(--bg-secondary);
    }

    .panel-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 16px;
        padding-bottom: 12px;
        border-bottom: 1px solid var(--border-color);
    }

    .panel-header h2 {
        font-size: 14px;
        font-weight: 600;
        margin: 0;
        color: var(--text-primary);
    }

    .panel-header .count {
        font-size: 12px;
        color: var(--text-tertiary);
        background: var(--bg-secondary);
        padding: 2px 6px;
        border-radius: 4px;
    }

    .filter-section {
        margin-bottom: 20px;
    }

    .section-title {
        font-size: 12px;
        font-weight: 600;
        color: var(--text-secondary);
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

    /* 激活状态样式 (Notion 标签色) */
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

    @media (max-width: 767.99px) {
        .filter-panel {
            width: min(70vw, 500px);
        }
    }
</style>
