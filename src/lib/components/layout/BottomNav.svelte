<script lang="ts">
  import { page } from '$app/state'
  import { LayoutDashboard, Library, Swords, Sparkles, BookOpen } from '@lucide/svelte'
  import { t } from 'svelte-i18n'

  const navItems = [
    { icon: LayoutDashboard, key: 'home', href: '/' },
    { icon: Library, key: 'cards', href: '/cards' },
    { icon: Swords, key: 'decks', href: '/decks' },
    { icon: Sparkles, key: 'collection', href: '/collection' },
    { icon: BookOpen, key: 'rules', href: '/rules' },
  ]

  function isActive(href: string) {
    const p = page.url.pathname
    if (href === '/') return p === '/'
    return p === href || p.startsWith(href + '/')
  }
</script>

<nav class="bottom-nav" aria-label={$t('nav.sectionTools')}>
  {#each navItems as item}
    {@const Icon = item.icon}
    {@const active = isActive(item.href)}
    <a
      href={item.href}
      class="bottom-nav-item"
      class:active
      aria-current={active ? 'page' : undefined}
    >
      <Icon size={22} strokeWidth={1.75} fill={active ? 'currentColor' : 'none'} />
      <span class="bottom-nav-label">{$t(`nav.${item.key}`)}</span>
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
      margin: 4px 2px;
      padding: 3px 0;
      border-radius: var(--radius-md);
      color: var(--text-secondary);
      text-decoration: none;
      font-size: var(--text-xs);
      transition:
        color 0.15s,
        background-color 0.15s;
    }

    .bottom-nav-item:hover {
      color: var(--accent-color);
    }

    .bottom-nav-item.active {
      background-color: color-mix(in oklab, var(--accent-color) 12%, transparent);
      color: var(--accent-color);
    }
  }
</style>
