<!-- src/routes/+layout.svelte -->
<script lang="ts">
    import AppShell from "../lib/components/AppShell.svelte";
    import LoadingModal from "../lib/components/LoadingModal.svelte";
    import { initializeDatabase } from "../lib/db";
    import "../app.css";

    let { children } = $props();

    type LoadStatus = "loading" | "syncing" | "success" | "error";
    let status = $state<LoadStatus>("loading");
    let errorMessage = $state<string>("");

    async function init() {
        status = "loading";
        errorMessage = "";

        try {
            // 模拟分阶段状态（可选）
            setTimeout(() => {
                if (status === "loading") status = "syncing";
            }, 500);

            await initializeDatabase();

            // 成功后短暂显示成功状态
            // status = "success";
            setTimeout(() => {
                status = "success"; // 保持 success 状态，或者你可以直接隐藏 modal
            }, 800);
        } catch (error) {
            console.error("[Layout] 初始化失败:", error);
            status = "error";
            errorMessage = error instanceof Error ? error.message : "未知错误";
        }
    }

    $effect(() => {
        init();
    });

    function handleRetry() {
        init();
    }
</script>

<div class="layout-root">
    {#if status === "error"}
        <LoadingModal {status} message={errorMessage} onRetry={handleRetry} />
    {:else if status !== "success"}
        <LoadingModal {status} />
    {/if}

    {#if status === "success"}
        <AppShell>
            {@render children()}
        </AppShell>
    {/if}
</div>

<style>
    .layout-root {
        width: 100%;
        height: 100vh;
        overflow: hidden;
    }
</style>
