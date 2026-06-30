<!-- src/lib/components/LoadingModal.svelte -->
<script lang="ts">
    import { CheckCircle, AlertCircle, RefreshCw } from "@lucide/svelte";

    interface Props {
        status: "loading" | "syncing" | "success" | "error";
        message?: string;
        onRetry?: () => void;
    }

    let { status, message, onRetry }: Props = $props();

    const statusConfig = {
        loading: {
            text: "正在初始化数据库...",
            subtext: "首次启动可能需要几秒钟",
            showGif: true,
        },
        syncing: {
            text: "正在同步卡牌数据...",
            subtext: "从云端拉取最新卡库",
            showGif: true,
        },
        success: {
            text: "初始化完成",
            subtext: "即将进入应用",
            showGif: false,
        },
        error: {
            text: "初始化失败",
            subtext: message || "请检查网络连接后重试",
            showGif: false,
        },
    };

    const config = $derived(statusConfig[status]);
</script>

<div class="modal-overlay">
    <div class="modal-card">
        {#if config.showGif}
            <div class="gif-container">
                <!-- 替换为你的 GIF 路径 -->
                <img src="/loading.gif" alt="Loading" class="loading-gif" />
            </div>
        {:else if status === "success"}
            <div class="icon-container success">
                <CheckCircle size={48} strokeWidth={1.5} />
            </div>
        {:else if status === "error"}
            <div class="icon-container error">
                <AlertCircle size={48} strokeWidth={1.5} />
            </div>
        {/if}

        <div class="content">
            <h2 class="title">{config.text}</h2>
            <p class="subtitle">{config.subtext}</p>
        </div>

        {#if status === "error" && onRetry}
            <button class="retry-btn" onclick={onRetry}>
                <RefreshCw size={16} />
                <span>重试</span>
            </button>
        {/if}
    </div>
</div>

<style>
    .modal-overlay {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.5);
        backdrop-filter: blur(8px);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 9999;
        animation: fadeIn 0.2s ease;
    }

    @keyframes fadeIn {
        from {
            opacity: 0;
        }
        to {
            opacity: 1;
        }
    }

    .modal-card {
        background: var(--bg-primary);
        border-radius: 12px;
        padding: 40px;
        max-width: 400px;
        width: 90%;
        text-align: center;
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
        animation: slideUp 0.3s ease;
    }

    @keyframes slideUp {
        from {
            opacity: 0;
            transform: translateY(20px);
        }
        to {
            opacity: 1;
            transform: translateY(0);
        }
    }

    .gif-container {
        margin-bottom: 24px;
        overflow: hidden;
    }

    .loading-gif {
        width: 50%;
        min-width: 300px;
        /* height: 120px; */
        object-fit: cover;
    }

    .icon-container {
        margin-bottom: 24px;
        display: flex;
        justify-content: center;
    }

    .icon-container.success {
        color: #0f7b6c;
    }

    .icon-container.error {
        color: #e03e3e;
    }

    .content {
        margin-bottom: 24px;
    }

    .title {
        font-size: 18px;
        font-weight: 600;
        color: var(--text-primary);
        margin: 0 0 8px 0;
    }

    .subtitle {
        font-size: 14px;
        color: var(--text-secondary);
        margin: 0;
        line-height: 1.5;
    }

    .retry-btn {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 10px 20px;
        background: var(--text-primary);
        color: white;
        border: none;
        border-radius: var(--radius-md);
        font-size: 14px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.15s;
    }

    .retry-btn:hover {
        background: #2f2e29;
        transform: translateY(-1px);
    }

    .retry-btn:active {
        transform: translateY(0);
    }
</style>
