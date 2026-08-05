<script lang="ts">
  let { count = 12 } = $props()
</script>

<div class="skeleton-grid">
  {#each Array(count) as _, i (i)}
    <div class="sk-tile">
      <div class="sk-img"></div>
      <div class="sk-line"></div>
      <div class="sk-line short"></div>
    </div>
  {/each}
</div>

<style>
  .skeleton-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: 14px;
    padding: 4px 2px 24px;
  }

  .sk-tile {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
  }

  .sk-img {
    width: 100%;
    aspect-ratio: 744 / 1040;
    border-radius: 8px;
    background: linear-gradient(100deg, var(--bg-secondary) 40%, var(--bg-hover) 50%, var(--bg-secondary) 60%);
    background-size: 200% 100%;
    animation: shimmer 1.4s infinite linear;
  }

  .sk-line {
    width: 70%;
    height: 10px;
    border-radius: 4px;
    background: var(--bg-secondary);
  }

  .sk-line.short {
    width: 45%;
  }

  @keyframes shimmer {
    from {
      background-position: 200% 0;
    }
    to {
      background-position: -200% 0;
    }
  }

  @media (max-width: 600.99px) {
    .skeleton-grid {
      grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
      gap: 10px;
    }
  }
</style>
