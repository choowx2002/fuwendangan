<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { supabase } from '$lib/database/supabaseClient';
	import { resolve } from '$app/paths';
	import bannerImg from '$lib/assets/home_bg.jpg';
	import { page } from '$app/state';

	let { children } = $props();

	let isLoading = $state(true);
	let userEmail = $state('');

	onMount(async () => {
		const {
			data: { session }
		} = await supabase.auth.getSession();
		if (!session) {
			goto(resolve('/login'));
		} else {
			userEmail = session.user.email!;
			isLoading = false;
		}

		supabase.auth.onAuthStateChange((_event, session) => {
			if (!session) {
				goto(resolve('/login'));
			}
		});
	});

	async function handleLogout() {
		await supabase.auth.signOut();
		goto(resolve('/login'));
	}
</script>

{#if isLoading}
	<div
		class="fixed inset-0 z-0 bg-cover bg-center bg-no-repeat"
		style="background-image: url({bannerImg});"
	>
		<div
			class="gap-3 absolute inset-0 bg-linear-to-b from-black/40 via-black/60 to-black/80 flex justify-center-safe items-center-safe"
		>
			<svg class="animate-spin h-8 w-8" viewBox="0 0 24 24" fill="none">
				<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
				<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
			</svg>
			<h1 class="text-2xl animate-pulse">加载中</h1>
		</div>
	</div>
{:else}
	<div class="relative h-svh overflow-auto bg-black text-white">
		<div class="fixed inset-0 z-0 pointer-events-none">
			<img
				src={bannerImg}
				alt="Riftbound Banner"
				class="w-full h-full object-cover object-top blur-sm"
			/>
			<div class="absolute inset-0 bg-linear-to-b from-black/10 via-black/10 to-black"></div>
			<div class="absolute inset-0 vignette"></div>
		</div>
		{#if page.url.pathname === '/admin/cards'}
			<nav class="relative z-10 p-3.5 flex justify-between shadow-cyan-100/50 shadow-2xs">
				<span class="font-extrabold">当前账号：{userEmail}</span>
				<div class="nav-links">
					<button
						onclick={handleLogout}
						class="bg-red-700 rounded px-2 py-1 text-sm font-bold cursor-pointer">退出</button
					>
				</div>
			</nav>
		{/if}
		<main class="relative z-10 min-h-screen flex flex-col bg-black/35">
			{@render children?.()}
		</main>
	</div>
{/if}

<style>
</style>
