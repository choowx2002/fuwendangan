<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { supabase } from '$lib/database/supabaseClient';

	let { children } = $props();

	let isLoading = $state(true);
	let userEmail = $state('');

	onMount(async () => {
		const {
			data: { session }
		} = await supabase.auth.getSession();
		if (!session) {
			goto('/login');
		} else {
			userEmail = session.user.email!;
			isLoading = false;
		}

		supabase.auth.onAuthStateChange((_event, session) => {
			if (!session) {
				goto('/login');
			}
		});
	});

	async function handleLogout() {
		await supabase.auth.signOut();
		goto('/login');
	}
</script>

{#if isLoading}
	<div class="loading">
		<p>验证会话中...</p>
	</div>
{:else}
	<div class="admin-layout">
		<nav class="admin-nav">
			<span class="user-info">👤 {userEmail}</span>
			<div class="nav-links">
				<a href="/admin/cards">卡牌管理</a>
				<button onclick={handleLogout} class="btn-logout">退出</button>
			</div>
		</nav>
		<main class="admin-main">
			{@render children?.()}
		</main>
	</div>
{/if}

<style>
	.loading {
		display: flex;
		justify-content: center;
		align-items: center;
		height: 100vh;
		font-size: 1.2rem;
		color: #666;
	}
	.admin-layout {
		min-height: 100vh;
		background: #f5f7fa;
	}
	.admin-nav {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 0.75rem 1.5rem;
		background: #1a1a2e;
		color: white;
	}
	.nav-links {
		display: flex;
		gap: 1rem;
		align-items: center;
	}
	.nav-links a {
		color: #a0c4ff;
		text-decoration: none;
	}
	.btn-logout {
		background: #e63946;
		color: white;
		border: none;
		padding: 0.4rem 0.8rem;
		border-radius: 4px;
		cursor: pointer;
	}
	.admin-main {
		padding: 1.5rem;
		max-width: 1400px;
		margin: 0 auto;
	}
</style>
