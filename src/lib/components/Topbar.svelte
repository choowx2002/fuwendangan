<!-- src/lib/components/Topbar.svelte -->
<script lang="ts">
    import { Menu, Search, Bell } from "@lucide/svelte";

    let { isSidebarOpen = $bindable() } = $props();

    function toggleSidebar() {
        isSidebarOpen = !isSidebarOpen;
    }
</script>

<header class="topbar">
    <div class="left">
        <!-- 移动端或侧边栏关闭时显示菜单按钮 -->
        <button
            class="icon-btn menu-btn"
            onclick={toggleSidebar}
            aria-label="切换菜单"
        >
            <Menu size={20} />
        </button>
        <div class="breadcrumb">
            <span class="crumb">我的卡牌库</span>
            <span class="separator">/</span>
            <span class="crumb active">首页</span>
        </div>
    </div>

    <div class="right">
        <button class="icon-btn search-btn" aria-label="搜索">
            <Search size={18} />
            <span class="search-text">搜索卡牌、卡组...</span>
            <kbd>⌘K</kbd>
        </button>
        <button class="icon-btn" aria-label="通知">
            <Bell size={18} />
        </button>
    </div>
</header>

<style>
    .topbar {
        height: var(--topbar-height);
        min-height: var(--topbar-height);
        border-bottom: 1px solid var(--border-color);
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0 12px;
        background: var(--bg-primary);
        z-index: 30;
    }

    .left,
    .right {
        display: flex;
        align-items: center;
        gap: 8px;
    }

    .icon-btn {
        background: none;
        border: none;
        padding: 6px;
        border-radius: var(--radius-sm);
        color: var(--text-secondary);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background 0.1s;
    }
    .icon-btn:hover {
        background: var(--bg-hover);
        color: var(--text-primary);
    }

    .menu-btn {
        display: none;
    }
    @media (max-width: 767.99px) {
        .menu-btn {
            display: flex;
        }
    }

    .breadcrumb {
        font-size: 14px;
        color: var(--text-secondary);
        display: flex;
        align-items: center;
        gap: 6px;
    }
    .breadcrumb .active {
        color: var(--text-primary);
        font-weight: 500;
    }
    .separator {
        color: var(--text-tertiary);
    }

    .search-btn {
        background: var(--bg-secondary);
        border: 1px solid var(--border-color);
        padding: 4px 10px;
        gap: 8px;
        font-size: 14px;
        color: var(--text-tertiary);
        width: 240px;
        justify-content: flex-start;
    }
    .search-btn:hover {
        background: var(--bg-hover);
    }
    .search-text {
        flex: 1;
        text-align: left;
    }
    kbd {
        font-family: inherit;
        font-size: 12px;
        background: var(--bg-primary);
        border: 1px solid var(--border-color);
        border-radius: 3px;
        padding: 1px 4px;
        color: var(--text-secondary);
    }

    @media (max-width: 767.99px) {
        .search-btn {
            width: auto;
            padding: 6px;
        }
        .search-text,
        kbd {
            display: none;
        }
    }
</style>
