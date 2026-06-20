<script lang="ts">
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';
	import { page } from '$app/state';
	let { children } = $props();
	let isHome = page.url.pathname === '/';
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>

{#if !isHome}
	<!-- <nav class="z-100">
		<a href="/" aria-current={page.url.pathname === '/' ? 'page' : undefined}>Home</a>
		<a href="/library" aria-current={page.url.pathname === '/library' ? 'page' : undefined}
			>library</a
		>
	</nav> -->
{/if}

<main>
	{@render children()}
</main>
