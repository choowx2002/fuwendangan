<script lang="ts">
    import { Search, X } from "@lucide/svelte";
    import type {
        FilterOptions,
        ActiveFilter,
        FilterType,
    } from "$lib/db/types";
    import { onMount } from "svelte";

    interface Props {
        filterOptions: FilterOptions | null;
        onAddFilter: (filter: ActiveFilter) => void;
        onTextSearch: (text: string) => void;
    }

    let { filterOptions, onAddFilter, onTextSearch }: Props = $props();

    let searchText = $state("");
    let isFocused = $state(false);
    let activeIndex = $state(-1);
    let inputEl = $state<HTMLInputElement | null>(null);

    // 定义带分类信息的建议项
    interface Suggestion {
        value: string;
        type: FilterType;
    }

    let suggestions = $derived.by(() => {
        if (!searchText.trim() || !filterOptions) return [];
        const text = searchText.trim().toLowerCase();

        // 构建带真实 type 的建议列表
        const allSuggestions: Suggestion[] = [
            ...(filterOptions.tags || []).map((v) => ({
                value: v,
                type: "tag" as FilterType,
            })),
            ...(filterOptions.keywords || []).map((v) => ({
                value: v,
                type: "keyword" as FilterType,
            })),
            ...(filterOptions.advanced_tags || []).map((v) => ({
                value: v,
                type: "advanced_tag" as FilterType,
            })),
            // ...(filterOptions.champions || []).map((v) => ({
            //     value: v,
            //     type: "champion_tag" as FilterType,
            // })),
            ...(filterOptions.regions || []).map((v) => ({
                value: v,
                type: "region" as FilterType,
            })),
        ];

        // 基于 value 去重 (保留第一次出现的 type)
        const uniqueMap = new Map<string, Suggestion>();
        for (const s of allSuggestions) {
            if (!uniqueMap.has(s.value)) uniqueMap.set(s.value, s);
        }

        return Array.from(uniqueMap.values())
            .filter((s) => s.value.toLowerCase().includes(text))
            .slice(0, 8);
    });

    $effect(() => {
        activeIndex = -1;
    });

    function handleKeydown(e: KeyboardEvent) {
        if (!isFocused || suggestions.length === 0) {
            if (e.key === "Enter") {
                e.preventDefault();
                onTextSearch(searchText);
            } else if (e.key === "Escape") {
                inputEl?.blur();
            }
            return;
        }

        if (e.key === "ArrowDown") {
            e.preventDefault();
            activeIndex = (activeIndex + 1) % suggestions.length;
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            activeIndex =
                (activeIndex - 1 + suggestions.length) % suggestions.length;
        } else if (e.key === "Enter") {
            e.preventDefault();
            if (activeIndex >= 0) {
                selectSuggestion(suggestions[activeIndex]);
            } else {
                onTextSearch(searchText);
            }
        } else if (e.key === "Escape") {
            inputEl?.blur();
        }
    }

    onMount(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (
                event.ctrlKey &&
                event.key.toLowerCase() === "k" &&
                !isFocused
            ) {
                event.preventDefault();
                const searchBarEl = document.getElementById("searchBar");
                if (searchBarEl) {
                    searchBarEl.focus();
                }
            }
        };

        window.addEventListener("keydown", handleKeyDown);

        return () => {
            window.removeEventListener("keydown", handleKeyDown);
        };
    });

    // 【关键修复】：传入完整的 suggestion 对象，保留真实的 type
    function selectSuggestion(suggestion: Suggestion) {
        onAddFilter({
            value: suggestion.value,
            mode: "include",
            type: suggestion.type, // 传递真实的分类！
        });
        searchText = "";
        inputEl?.blur();
    }

    function clearSearch() {
        searchText = "";
        onTextSearch("");
        inputEl?.focus();
    }
</script>

<div class="search-wrapper" class:focused={isFocused}>
    <div class="search-input-container">
        <Search size={16} class="search-icon" />
        <input
            id="searchBar"
            bind:this={inputEl}
            type="text"
            bind:value={searchText}
            placeholder="搜索卡牌名称、效果，或输入标签..."
            onfocus={() => (isFocused = true)}
            onblur={() => setTimeout(() => (isFocused = false), 200)}
            onkeydown={handleKeydown}
        />
        {#if searchText}
            <button class="clear-btn" onclick={clearSearch} aria-label="清除">
                <X size={14} />
            </button>
        {/if}
    </div>

    {#if isFocused && suggestions.length > 0}
        <div class="popdown">
            {#each suggestions as suggestion, i}
                <button
                    class="suggestion-item"
                    class:active={i === activeIndex}
                    onmousedown={(e) => {
                        e.preventDefault();
                        selectSuggestion(suggestion);
                    }}
                >
                    <span class="tag-text">{suggestion.value}</span>
                    <span class="tag-hint">回车添加为筛选条件</span>
                </button>
            {/each}
        </div>
    {/if}
</div>

<style>
    .search-wrapper {
        position: relative;
        width: 100%;
        max-width: 600px;
    }

    .search-input-container {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 12px;
        border: 1px solid var(--border-color);
        border-radius: var(--radius-md);
        background: var(--bg-secondary);
        transition: all 0.15s;
        box-shadow: 0 1px 4px 0px rgba(0, 0, 0, 0.2);
    }

    .search-wrapper.focused .search-input-container {
        /* border-color: var(--accent-color); */
        box-shadow: 0 0 0 3px rgba(19, 205, 171, 0.53);
    }

    .search-icon {
        color: var(--text-tertiary);
        flex-shrink: 0;
    }

    input {
        flex: 1;
        border: none;
        outline: none;
        font-size: 14px;
        background: transparent;
        color: var(--text-primary);
    }
    input::placeholder {
        color: var(--text-tertiary);
    }

    .clear-btn {
        background: none;
        border: none;
        padding: 4px;
        border-radius: 50%;
        color: var(--text-tertiary);
        cursor: pointer;
        display: flex;
    }
    .clear-btn:hover {
        background: var(--bg-hover);
        color: var(--text-primary);
    }

    .popdown {
        position: absolute;
        top: calc(100% + 4px);
        left: 0;
        right: 0;
        background: var(--bg-primary);
        border: 1px solid var(--border-color);
        border-radius: var(--radius-md);
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
        z-index: 100;
        overflow: hidden;
        animation: slideDown 0.15s ease;
    }

    @keyframes slideDown {
        from {
            opacity: 0;
            transform: translateY(-4px);
        }
        to {
            opacity: 1;
            transform: translateY(0);
        }
    }

    .suggestion-item {
        width: 100%;
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 8px 12px;
        border: none;
        background: none;
        text-align: left;
        font-size: 14px;
        color: var(--text-primary);
        cursor: pointer;
        transition: background 0.1s;
    }

    .suggestion-item:hover,
    .suggestion-item.active {
        background: var(--bg-hover);
    }

    .tag-text {
        font-weight: 500;
    }

    .tag-hint {
        font-size: 12px;
        color: var(--text-tertiary);
    }
</style>
