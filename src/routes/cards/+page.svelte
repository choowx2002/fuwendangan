<!-- src/routes/cards/+page.svelte -->
<script lang="ts">
    import { searchCards, getFilterOptions } from "$lib/db";
    import SearchBar from "$lib/components/cards/SearchBar.svelte";
    import FilterPanel from "$lib/components/cards/FilterPanel.svelte";
    import CardItem from "$lib/components/cards/CardItem.svelte";
    import type {
        ActiveFilter,
        CardSearchResult,
        FilterOptions,
    } from "$lib/db/types";
    import { Loader2, Filter } from "@lucide/svelte";
    import { buildSearchParams } from "$lib/db/helper";

    let filterOptions = $state<FilterOptions | null>(null);
    let searchResult = $state<CardSearchResult | null>(null);
    let activeFilters = $state<ActiveFilter[]>([]);
    let currentSearchText = $state("");
    let isLoading = $state(true);
    let isMobileFilterOpen = $state(false);

    // 初始化
    $effect(() => {
        async function init() {
            filterOptions = await getFilterOptions();
            await performSearch();
        }
        init();
    });

    async function performSearch() {
        isLoading = true;
        try {
            // 核心：一键将 UI 状态转换为底层参数！
            const params = buildSearchParams(
                activeFilters,
                currentSearchText,
                1,
                30,
            );
            searchResult = await searchCards(params);
        } catch (e) {
            console.error("搜索失败:", e);
        } finally {
            isLoading = false;
        }
    }

    function handleTextSearch(text: string) {
        currentSearchText = text;
        performSearch();
    }

    // Popdown 点击或右侧面板点击都会触发此函数
    function handleToggleFilter(type: ActiveFilter["type"], value: string) {
        const existingIndex = activeFilters.findIndex(
            (f) => f.type === type && f.value === value,
        );
        let newFilters = [...activeFilters];

        if (existingIndex === -1) {
            // 新增，默认 include
            newFilters.push({ type, value, mode: "include" });
        } else {
            const current = newFilters[existingIndex];
            if (current.mode === "include")
                newFilters[existingIndex] = { ...current, mode: "require" };
            else if (current.mode === "require")
                newFilters[existingIndex] = { ...current, mode: "exclude" };
            else newFilters.splice(existingIndex, 1); // exclude -> 移除
        }

        activeFilters = newFilters;
        performSearch();
    }

    function hancleRemoveFilter(type: ActiveFilter["type"], value: string) {
        const existingIndex = activeFilters.findIndex(
            (f) => f.type === type && f.value === value,
        );

        if (existingIndex === -1) return;

        let newFilters = [...activeFilters];

        newFilters.splice(existingIndex, 1);

        activeFilters = newFilters;
        performSearch();
    }

    function handleAddFromPopdown(filter: ActiveFilter) {
        // Popdown 默认添加为 include
        if (
            !activeFilters.some(
                (f) => f.value === filter.value && f.type === filter.type,
            )
        ) {
            activeFilters = [...activeFilters, { ...filter, mode: "include" }];
            performSearch();
        }
    }
</script>

<div class="page-wrapper">
    <!-- 左侧：搜索 + 网格 -->
    <main class="main-content">
        <header class="search-header">
            <SearchBar
                {filterOptions}
                onAddFilter={handleAddFromPopdown}
                onTextSearch={handleTextSearch}
            />
            <!-- 移动端筛选开关 -->
            <button
                class="mobile-filter-btn"
                onclick={() => (isMobileFilterOpen = !isMobileFilterOpen)}
            >
                <Filter size={18} />
                <span>筛选</span>
            </button>
        </header>

        <section class="results-area">
            {#if isLoading}
                <div class="loading-state">
                    <Loader2 class="animate-spin" size={24} />
                </div>
            {:else if searchResult?.data.length}
                <div class="card-grid">
                    {#each searchResult.data as card (card.id)}
                        <CardItem {card} />
                    {/each}
                </div>
            {:else}
                <div class="empty-state">
                    <p>未找到匹配卡牌</p>
                </div>
            {/if}
        </section>
    </main>

    <!-- 右侧：过滤面板 (桌面端固定，移动端抽屉) -->
    <aside class="right-filter" class:mobile-open={isMobileFilterOpen}>
        <FilterPanel
            {filterOptions}
            {activeFilters}
            onToggle={handleToggleFilter}
            onRemove={hancleRemoveFilter}
        />
        {#if isMobileFilterOpen}
            <div
                role="presentation"
                class="mobile-overlay"
                onclick={() => (isMobileFilterOpen = false)}
            ></div>
        {/if}
    </aside>
</div>

<style>
    .page-wrapper {
        display: flex;
        height: calc(100vh - var(--topbar-height));
        overflow: hidden;
    }

    .main-content {
        flex: 1;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        padding: 24px;
        background: var(--bg-primary);
    }

    .search-header {
        display: flex;
        align-items: center;
        gap: 16px;
        padding-bottom: 12px;
    }

    .mobile-filter-btn {
        display: none;
        align-items: center;
        gap: 6px;
        padding: 8px 14px;
        background: var(--bg-secondary);
        border: 1px solid var(--border-color);
        border-radius: var(--radius-md);
        font-size: 14px;
        cursor: pointer;
    }

    .results-area {
        flex: 1;
        overflow-y: auto;
        padding-right: 4px;
        padding-top: 12px;
    }

    .card-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
        gap: 16px;
    }

    /* 右侧面板容器 */
    .right-filter {
        width: 300px;
        flex-shrink: 0;
        border-left: 1px solid var(--border-color);
        overflow: hidden;
        transition: transform 0.28s cubic-bezier(0.22, 1, 0.36, 1);
        will-change: transform;
    }

    .mobile-overlay {
        display: none;
    }

    @media (max-width: 767.99px) {
        .right-filter {
            position: fixed;
            top: 0;
            right: 0;
            height: 100vh;
            width: 100vw;
            z-index: 100;
            transform: translateX(100%);
            box-shadow: -12px 0 40px rgba(0, 0, 0, 0.2);
            display: flex;
            flex-direction: column;
            padding-top: env(safe-area-inset-top);
            padding-bottom: env(safe-area-inset-bottom);
            align-items: flex-end;
        }

        .right-filter.mobile-open {
            transform: translateX(0);
        }

        .mobile-overlay {
            display: block;
            position: fixed;
            inset: 0;
            background: rgba(0, 0, 0, 0.35);
            opacity: 1;
            z-index: -1;
        }

        .mobile-filter-btn {
            display: flex;
        }

        .card-grid {
            grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
            gap: 10px;
        }

        .main-content {
            padding: 16px;
        }
    }

    .loading-state,
    .empty-state {
        display: flex;
        justify-content: center;
        align-items: center;
        height: 300px;
        color: var(--text-tertiary);
    }
    @keyframes spin {
        to {
            transform: rotate(360deg);
        }
    }

    .animate-spin {
        animation: spin 1s linear infinite;
    }
</style>
