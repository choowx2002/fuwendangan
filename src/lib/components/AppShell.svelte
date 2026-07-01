<!-- src/lib/components/AppShell.svelte -->
<script lang="ts">
    import Topbar from "./Topbar.svelte";
    import Sidebar from "./Sidebar.svelte";

    let { children } = $props();
    let isSidebarOpen = $state(false);
    let isSidebarMinimized = $state(false);
    let isMobile = $state(false);

    // 监听窗口大小变化，桌面端自动展开侧边栏
    function handleResize() {
        if (window.innerWidth >= 767.99) {
            isMobile = false;
            isSidebarOpen = true;
        } else {
            isSidebarOpen = false;
            isMobile = true;
        }
    }

    $effect(() => {
        handleResize();
        window.addEventListener("resize", handleResize);
        return () => window.removeEventListener("resize", handleResize);
    });
</script>

<div
    class="app-shell"
    class:sidebar-open={isSidebarOpen}
    class:isMinimized={isSidebarMinimized}
>
    <Sidebar
        bind:isOpen={isSidebarOpen}
        bind:isMinimized={isSidebarMinimized}
    />

    <div class="main-area">
        {#if isMobile}
            <Topbar bind:isSidebarOpen />
        {/if}
        <main class="content">
            {@render children()}
        </main>
    </div>

    <!-- 移动端遮罩层 -->
    {#if isSidebarOpen && window.innerWidth < 767.99}
        <div
            class="overlay"
            onclick={() => (isSidebarOpen = false)}
            role="presentation"
        ></div>
    {/if}
</div>

<style>
    .app-shell {
        display: flex;
        height: 100vh;
        width: 100vw;
        position: relative;
        overflow: hidden;
    }

    .main-area {
        flex: 1;
        display: flex;
        flex-direction: column;
        min-width: 0; /* 防止 flex 子元素溢出 */
        transition: margin-left 0.2s ease;
    }

    /* 桌面端布局 */
    @media (min-width: 767.99px) {
        .sidebar-open .main-area {
            margin-left: var(--sidebar-width);
        }

        .isMinimized .main-area {
            margin-left: 64px;
        }
    }

    .content {
        flex: 1;
        overflow-y: auto;
        background-color: var(--bg-primary);
    }

    .overlay {
        position: fixed;
        inset: 0;
        background-color: rgba(0, 0, 0, 0.4);
        z-index: 40;
        backdrop-filter: blur(2px);
    }
</style>
