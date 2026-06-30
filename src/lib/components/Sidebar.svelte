<!-- src/lib/components/Sidebar.svelte -->
<script lang="ts">
  import { 
    LayoutDashboard, Library, Swords, Wrench, 
    Settings, ChevronRight, Plus, Sparkles 
  } from '@lucide/svelte';

  let { isOpen = $bindable() } = $props();

  const navItems = [
    { icon: LayoutDashboard, label: '首页', href: '/', active: true },
    { icon: Library, label: '单卡库', href: '/cards' },
    { icon: Swords, label: '我的卡组', href: '/decks' },
    { icon: Sparkles, label: '收藏与闪卡', href: '/collection' },
  ];

  const toolItems = [
    { icon: Wrench, label: '对战工具', href: '/tools' },
    { icon: Settings, label: '设置', href: '/settings' },
  ];

  function closeIfMobile() {
    if (window.innerWidth < 768) {
      isOpen = false;
    }
  }
</script>

<aside class="sidebar" class:open={isOpen}>
  <div class="sidebar-header">
    <div class="workspace">
      <div class="workspace-icon">TCG</div>
      <span class="workspace-name">我的卡牌库</span>
    </div>
    <button class="icon-btn" aria-label="新建">
      <Plus size={16} />
    </button>
  </div>

  <nav class="nav-section">
    {#each navItems as item}
      <a 
        href={item.href} 
        class="nav-item" 
        class:active={item.active}
        onclick={closeIfMobile}
      >
        <item.icon size={18} strokeWidth={1.75} />
        <span>{item.label}</span>
      </a>
    {/each}
  </nav>

  <div class="divider"></div>

  <nav class="nav-section">
    <div class="section-title">工具与设置</div>
    {#each toolItems as item}
      <a 
        href={item.href} 
        class="nav-item"
        onclick={closeIfMobile}
      >
        <item.icon size={18} strokeWidth={1.75} />
        <span>{item.label}</span>
      </a>
    {/each}
  </nav>
  
  <div class="sidebar-footer">
    <div class="user-info">
      <div class="avatar">天</div>
      <span>天龠wx</span>
    </div>
  </div>
</aside>

<style>
  .sidebar {
    position: fixed;
    top: 0;
    left: 0;
    bottom: 0;
    width: var(--sidebar-width);
    background: var(--bg-secondary);
    border-right: 1px solid var(--border-color);
    display: flex;
    flex-direction: column;
    z-index: 50;
    transform: translateX(-100%);
    transition: transform 0.2s ease;
  }

  .sidebar.open {
    transform: translateX(0);
  }

  @media (min-width: 768px) {
    .sidebar {
      transform: translateX(0);
    }
  }

  .sidebar-header {
    padding: 12px;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .workspace {
    display: flex;
    align-items: center;
    gap: 8px;
    font-weight: 600;
    font-size: 14px;
  }

  .workspace-icon {
    width: 22px;
    height: 22px;
    background: var(--accent-color);
    color: white;
    border-radius: var(--radius-sm);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 10px;
    font-weight: 700;
  }

  .icon-btn {
    background: none;
    border: none;
    padding: 4px;
    border-radius: var(--radius-sm);
    color: var(--text-secondary);
    cursor: pointer;
    display: flex;
  }
  .icon-btn:hover {
    background: var(--bg-hover);
  }

  .nav-section {
    padding: 0 8px;
    margin-bottom: 8px;
  }

  .section-title {
    font-size: 12px;
    color: var(--text-tertiary);
    padding: 8px 12px 4px;
    font-weight: 500;
  }

  .nav-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 12px;
    border-radius: var(--radius-sm);
    color: var(--text-secondary);
    text-decoration: none;
    font-size: 14px;
    cursor: pointer;
    transition: background 0.1s;
  }

  .nav-item:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .nav-item.active {
    background: var(--bg-active);
    color: var(--text-primary);
    font-weight: 500;
  }

  .divider {
    height: 1px;
    background: var(--border-color);
    margin: 8px 16px;
  }

  .sidebar-footer {
    margin-top: auto;
    padding: 12px;
    border-top: 1px solid var(--border-color);
  }

  .user-info {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 14px;
    font-weight: 500;
  }

  .avatar {
    width: 24px;
    height: 24px;
    background: #e0dcd3;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 12px;
    color: var(--text-primary);
  }
</style>