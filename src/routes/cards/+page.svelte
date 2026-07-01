<!-- src/routes/cards/+page.svelte -->
<script lang="ts">
    import { searchCards, getFilterOptions } from "$lib/db";
    import SearchBar from "$lib/components/cards/SearchBar.svelte";
    import FilterPanel from "$lib/components/cards/FilterPanel.svelte";
    import CardItem from "$lib/components/cards/CardItem.svelte";
    import type { ActiveFilter, FilterOptions } from "$lib/db/types";
    import { LoaderCircle, SlidersHorizontal } from "@lucide/svelte";
    import { buildSearchParams } from "$lib/db/helper";
    import { onDestroy, onMount } from "svelte";

    // --- 基础状态 ---
    let filterOptions = $state<FilterOptions | null>(null);
    let activeFilters = $state<ActiveFilter[]>([]);
    let currentSearchText = $state("");
    let isFilterOpen = $state(false);

    // --- 无限滚动专属状态 ---
    let displayedCards = $state<any[]>([]); // 当前页面展示的所有卡牌
    let currentPage = $state(1); // 当前请求的页码
    let hasMore = $state(true); // 是否还有更多数据
    let isLoading = $state(true); // 首次加载状态
    let isLoadingMore = $state(false); // 滚动加载状态

    function observeSentinel(node: HTMLDivElement) {
        const observer = new IntersectionObserver(
            (entries) => {
                // 当哨兵进入视口，且满足加载条件时触发
                if (
                    entries[0].isIntersecting &&
                    hasMore &&
                    !isLoadingMore &&
                    !isLoading
                ) {
                    performSearch(true);
                }
            },
            { threshold: 0.1 },
        );

        // 元素挂载到 DOM 时开始观察
        observer.observe(node);

        // 返回销毁函数：元素从 DOM 移除时自动断开连接
        return {
            destroy() {
                observer.disconnect();
            },
        };
    }

    // --- 初始化 ---
    $effect(() => {
        async function init() {
            filterOptions = await getFilterOptions();
            await performSearch(); // 首次加载
        }
        init();
    });

    // --- 核心搜索逻辑 ---
    async function performSearch(isLoadMore = false) {
        // 防抖/防重复触发：如果正在加载更多，则忽略
        if (isLoadingMore) return;

        if (!isLoadMore) {
            currentPage = 1;
            displayedCards = [];
            hasMore = true;
            isLoading = true;
        } else {
            // 【加载更多】：设置加载中标记
            isLoadingMore = true;
        }

        try {
            const params = buildSearchParams(
                activeFilters,
                currentSearchText,
                currentPage,
                30, // pageSize
            );

            const result = await searchCards(params);
            if (isLoadMore) {
                // 追加数据到现有列表
                displayedCards = [...displayedCards, ...result.data];
            } else {
                // 替换数据
                displayedCards = result.data;
            }

            // 判断是否还有下一页
            hasMore = displayedCards.length < result.total;

            // 页码 +1，为下一次加载做准备
            currentPage++;
        } catch (e) {
            console.error("搜索失败:", e);
        } finally {
            isLoading = false;
            isLoadingMore = false;
        }
    }

    // --- 事件处理 ---
    function handleTextSearch(text: string) {
        currentSearchText = text;
        performSearch(); // 触发全新搜索
    }

    function handleToggleFilter(type: ActiveFilter["type"], value: string) {
        const existingIndex = activeFilters.findIndex(
            (f) => f.type === type && f.value === value,
        );
        let newFilters = [...activeFilters];

        if (existingIndex === -1) {
            newFilters.push({ type, value, mode: "include" });
        } else {
            const current = newFilters[existingIndex];
            if (current.mode === "include")
                newFilters[existingIndex] = { ...current, mode: "require" };
            else if (current.mode === "require")
                newFilters[existingIndex] = { ...current, mode: "exclude" };
            else newFilters.splice(existingIndex, 1);
        }

        activeFilters = newFilters;
    }

    function handleRemoveFilter(type: ActiveFilter["type"], value: string) {
        activeFilters = activeFilters.filter(
            (f) => !(f.type === type && f.value === value),
        );
    }

    function handleClearFilter() {
        activeFilters = [];
    }

    function handleAddFromPopdown(filter: ActiveFilter) {
        if (
            !activeFilters.some(
                (f) => f.value === filter.value && f.type === filter.type,
            )
        ) {
            activeFilters = [...activeFilters, { ...filter, mode: "include" }];
            performSearch();
        }
    }

    onMount(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.ctrlKey && event.key.toLowerCase() === "f") {
                event.preventDefault();
                isFilterOpen = !isFilterOpen;
                if (!isFilterOpen) performSearch();
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => {
            window.removeEventListener("keydown", handleKeyDown);
        };
    });
</script>

<div class="page-wrapper">
    <main class="main-content">
        <header class="search-header">
            <div class="search-wrapper">
                <SearchBar
                    {filterOptions}
                    onAddFilter={handleAddFromPopdown}
                    onTextSearch={handleTextSearch}
                />
            </div>

            <button
                class="filter-toggle-btn"
                onclick={() => (isFilterOpen = true)}
            >
                <SlidersHorizontal size={18} />
                <span>筛选</span>
                {#if activeFilters.length > 0}
                    <span class="badge">{activeFilters.length}</span>
                {/if}
            </button>
        </header>

        <section class="results-area">
            <!-- 首次加载的大 Loading -->
            {#if isLoading && displayedCards.length === 0}
                <div class="loading-state">
                    <LoaderCircle class="animate-spin" size={24} />
                </div>

                <!-- 有数据时展示网格 -->
            {:else if displayedCards.length > 0}
                <div class="card-grid">
                    {#each displayedCards as card (card.id)}
                        <CardItem {card} />
                    {/each}
                </div>

                <!-- 底部状态提示与哨兵元素 -->
                <div class="bottom-status">
                    {#if isLoadingMore}
                        <div class="loading-more">
                            <LoaderCircle class="animate-spin" size={16} />
                            <span>正在加载更多...</span>
                        </div>
                    {:else if !hasMore}
                        <div class="no-more">
                            <span>—— 已经到底啦 ——</span>
                        </div>
                    {/if}

                    <div use:observeSentinel class="sentinel"></div>
                </div>

                <!-- 搜索无结果 -->
            {:else}
                <div class="empty-state">
                    <p>未找到匹配卡牌</p>
                </div>
            {/if}
        </section>
    </main>

    <FilterPanel
        isOpen={isFilterOpen}
        {filterOptions}
        {activeFilters}
        onToggle={handleToggleFilter}
        onRemove={handleRemoveFilter}
        onClear={handleClearFilter}
        onClose={() => {
            isFilterOpen = false;
            performSearch();
        }}
    />
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
        padding-bottom: 0;
        background: var(--bg-primary);
    }

    .search-header {
        display: flex;
        align-items: center;
        gap: 16px;
        padding-bottom: 12px;
        flex-shrink: 0;
    }

    .search-wrapper {
        flex: 1;
    }

    .filter-toggle-btn {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 8px 14px;
        background: var(--bg-secondary);
        border: 1px solid var(--border-color);
        border-radius: var(--radius-md);
        font-size: 14px;
        cursor: pointer;
        white-space: nowrap;
        transition: all 0.15s;
        box-shadow: 0 1px 4px 0px rgba(0, 0, 0, 0.05);
    }

    .filter-toggle-btn:hover {
        background: var(--bg-hover);
        border-color: #d3d1cb;
    }

    .badge {
        background: var(--accent-color);
        color: white;
        font-size: 11px;
        font-weight: 600;
        padding: 1px 6px;
        border-radius: 99px;
        margin-left: 4px;
    }

    .results-area {
        flex: 1;
        overflow-y: auto;
        padding-right: 4px;
        padding-top: 12px;
    }

    .card-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
        gap: 16px;
    }

    /* ================= 底部状态与哨兵 ================= */
    .bottom-status {
        margin-top: 24px;
        padding-bottom: 24px; /* 留出底部安全距离 */
    }

    .loading-more,
    .no-more {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        padding: 16px 0;
        color: var(--text-tertiary);
        font-size: 13px;
    }

    /* 哨兵元素：高度极小，不可见，仅用于被 Observer 监测 */
    .sentinel {
        height: 1px;
        width: 100%;
    }

    /* ================= 移动端适配 ================= */
    @media (max-width: 767.99px) {
        .main-content {
            padding: 16px;
            padding-bottom: 0;
        }
        .card-grid {
            grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
            gap: 10px;
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
    :global(.animate-spin) {
        animation: spin 1s linear infinite;
    }
</style>
