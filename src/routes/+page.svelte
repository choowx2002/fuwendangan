<!-- src/routes/+page.svelte -->
<script lang="ts">
    import {
        Plus,
        Clock,
        TrendingUp,
        Dice5,
        Coins,
        ChevronRight,
    } from "@lucide/svelte";

    // 模拟数据
    const recentDecks = [
        {
            name: "红绿快攻 (RG Aggro)",
            format: "标准",
            wins: 12,
            losses: 4,
            updated: "2小时前",
        },
        {
            name: "蓝白控制 (WU Control)",
            format: "薪传",
            wins: 8,
            losses: 7,
            updated: "昨天",
        },
        {
            name: "勇得中速 (Jund Midrange)",
            format: "摩登",
            wins: 15,
            losses: 5,
            updated: "3天前",
        },
    ];

    const quickTools = [
        {
            icon: Dice5,
            label: "生命计数器",
            desc: "双人对战计分",
            color: "#e03e3e",
        },
        {
            icon: Coins,
            label: "掷币/掷骰",
            desc: "随机数生成",
            color: "#d9730d",
        },
        {
            icon: TrendingUp,
            label: "胜率统计",
            desc: "查看近期战绩",
            color: "#0f7b6c",
        },
    ];
</script>

<div class="page-container">
    <header class="page-header">
        <h1 class="page-title">首页</h1>
        <p class="page-desc">欢迎回来，天龠wx。今天想玩点什么？</p>
    </header>

    <!-- 快速操作区 -->
    <section class="section">
        <div class="section-header">
            <h2 class="section-title">快速开始</h2>
        </div>
        <div class="quick-actions">
            <button class="action-card primary">
                <Plus size={20} />
                <span>新建卡组</span>
            </button>
            <button class="action-card">
                <Clock size={20} />
                <span>导入单卡</span>
            </button>
        </div>
    </section>

    <!-- 常用工具 -->
    <section class="section">
        <div class="section-header">
            <h2 class="section-title">对战工具</h2>
            <a href="/tools" class="see-all"
                >查看全部 <ChevronRight size={14} /></a
            >
        </div>
        <div class="tools-grid">
            {#each quickTools as tool}
                <!-- svelte-ignore a11y_invalid_attribute -->
                <a href="#" class="tool-card">
                    <div
                        class="tool-icon"
                        style="background: {tool.color}15; color: {tool.color}"
                    >
                        <tool.icon size={22} />
                    </div>
                    <div class="tool-info">
                        <span class="tool-label">{tool.label}</span>
                        <span class="tool-desc">{tool.desc}</span>
                    </div>
                </a>
            {/each}
        </div>
    </section>

    <!-- 最近卡组 -->
    <section class="section">
        <div class="section-header">
            <h2 class="section-title">最近使用的卡组</h2>
            <a href="/decks" class="see-all"
                >管理卡组 <ChevronRight size={14} /></a
            >
        </div>
        <div class="deck-list">
            {#each recentDecks as deck}
                <!-- svelte-ignore a11y_invalid_attribute -->
                <a href="#" class="deck-item">
                    <div class="deck-main">
                        <span class="deck-name">{deck.name}</span>
                        <span class="deck-format">{deck.format}</span>
                    </div>
                    <div class="deck-stats">
                        <span class="stat win">{deck.wins}胜</span>
                        <span class="stat loss">{deck.losses}负</span>
                        <span class="stat time">{deck.updated}</span>
                    </div>
                </a>
            {/each}
        </div>
    </section>
</div>

<style>
    .page-container {
        max-width: 900px;
        margin: 0 auto;
        padding: 40px 24px 80px;
    }

    @media (max-width: 767px) {
        .page-container {
            padding: 24px 16px 80px;
        }
    }

    .page-header {
        margin-bottom: 40px;
    }

    .page-title {
        font-size: 40px;
        font-weight: 700;
        margin: 0 0 8px 0;
        letter-spacing: -0.5px;
    }

    .page-desc {
        font-size: 16px;
        color: var(--text-secondary);
        margin: 0;
    }

    .section {
        margin-bottom: 36px;
    }

    .section-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 12px;
    }

    .section-title {
        font-size: 14px;
        font-weight: 600;
        color: var(--text-secondary);
        text-transform: uppercase;
        letter-spacing: 0.5px;
        margin: 0;
    }

    .see-all {
        font-size: 13px;
        color: var(--text-tertiary);
        text-decoration: none;
        display: flex;
        align-items: center;
        gap: 2px;
    }
    .see-all:hover {
        color: var(--text-primary);
    }

    /* 快速操作 */
    .quick-actions {
        display: flex;
        gap: 12px;
        flex-wrap: wrap;
    }

    .action-card {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 10px 16px;
        border: 1px solid var(--border-color);
        border-radius: var(--radius-md);
        background: var(--bg-primary);
        font-size: 14px;
        font-weight: 500;
        color: var(--text-primary);
        cursor: pointer;
        transition: all 0.15s;
    }
    .action-card:hover {
        background: var(--bg-secondary);
        border-color: #d3d1cb;
    }
    .action-card.primary {
        background: var(--text-primary);
        color: white;
        border-color: var(--text-primary);
    }
    .action-card.primary:hover {
        background: #2f2e29;
    }

    /* 工具网格 */
    .tools-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
        gap: 12px;
    }

    .tool-card {
        display: flex;
        align-items: center;
        gap: 14px;
        padding: 16px;
        border: 1px solid var(--border-color);
        border-radius: var(--radius-md);
        text-decoration: none;
        color: inherit;
        transition: all 0.15s;
    }
    .tool-card:hover {
        background: var(--bg-secondary);
        border-color: #d3d1cb;
        transform: translateY(-1px);
    }

    .tool-icon {
        width: 40px;
        height: 40px;
        border-radius: var(--radius-md);
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
    }

    .tool-info {
        display: flex;
        flex-direction: column;
    }
    .tool-label {
        font-size: 14px;
        font-weight: 600;
    }
    .tool-desc {
        font-size: 12px;
        color: var(--text-tertiary);
        margin-top: 2px;
    }

    /* 卡组列表 */
    .deck-list {
        border: 1px solid var(--border-color);
        border-radius: var(--radius-md);
        overflow: hidden;
    }

    .deck-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 14px 16px;
        text-decoration: none;
        color: inherit;
        border-bottom: 1px solid var(--border-color);
        transition: background 0.1s;
    }
    .deck-item:last-child {
        border-bottom: none;
    }
    .deck-item:hover {
        background: var(--bg-secondary);
    }

    .deck-main {
        display: flex;
        align-items: center;
        gap: 12px;
    }
    .deck-name {
        font-size: 14px;
        font-weight: 500;
    }
    .deck-format {
        font-size: 12px;
        padding: 2px 6px;
        background: var(--bg-hover);
        border-radius: 4px;
        color: var(--text-secondary);
    }

    .deck-stats {
        display: flex;
        align-items: center;
        gap: 16px;
        font-size: 13px;
    }
    .stat {
        color: var(--text-tertiary);
    }
    .stat.win {
        color: #0f7b6c;
        font-weight: 500;
    }
    .stat.loss {
        color: #e03e3e;
        font-weight: 500;
    }

    @media (max-width: 767.99px) {
        .deck-item {
            flex-direction: column;
            align-items: flex-start;
            gap: 8px;
        }
        .deck-stats {
            width: 100%;
            justify-content: flex-start;
        }
    }
</style>
