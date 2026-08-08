<script lang="ts">
  import { page } from '$app/state'
  import { LayoutDashboard, Library, Swords, Sparkles, BookOpen } from '@lucide/svelte'

  const navItems = [
    { icon: LayoutDashboard, label: '首页', href: '/' },
    { icon: Library, label: '单卡库', href: '/cards' },
    { icon: Swords, label: '我的卡组', href: '/decks' },
    { icon: Sparkles, label: '收藏与闪卡', href: '/collection' },
    { icon: BookOpen, label: '游戏文档', href: '/rules' },
  ]

  function isActive(href: string) {
    const p = page.url.pathname
    if (href === '/') return p === '/'
    return p === href || p.startsWith(href + '/')
  }
</script>

<nav class="bottom-nav" aria-label="底部导航">
  {#each navItems as item}
    {@const Icon = item.icon}
    {@const active = isActive(item.href)}
    <a
      href={item.href}
      class="bottom-nav-item"
      class:active
      aria-current={active ? 'page' : undefined}
    >
      <Icon size={22} strokeWidth={1.75} />
      <span class="bottom-nav-label">{item.label}</span>
    </a>
  {/each}
</nav>

<style>
  .bottom-nav {
    display: none;
  }

  @media (max-width: 767.99px) {
    .bottom-nav {
      display: flex;
      flex-shrink: 0;
      height: calc(56px + env(safe-area-inset-bottom));
      padding-bottom: env(safe-area-inset-bottom);
      padding-left: env(safe-area-inset-left);
      padding-right: env(safe-area-inset-right);
      background: var(--bg-primary);
      border-top: 1px solid var(--border-color);
      z-index: 30;
    }

    .bottom-nav-item {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 2px;
      color: var(--text-secondary);
      text-decoration: none;
      font-size: var(--text-xs);
      transition: color 0.15s;
    }

    .bottom-nav-item:hover,
    .bottom-nav-item.active {
      color: var(--accent-color);
    }
  }
</style>
