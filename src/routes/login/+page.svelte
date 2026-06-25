<script lang="ts">
	import { supabase } from '$lib/database/supabaseClient';
	import { goto } from '$app/navigation'; // SvelteKit 专属路由跳转
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import bannerImg from '$lib/assets/home_bg.jpg';
	import mainIcon from '$lib/assets/fuwendangan_logo_zn.webp';

	// Svelte 5 Runes
	let email = $state('');
	let password = $state('');
	let isLoading = $state(false);
	let errorMsg = $state('');
	let isAuth = $state(false);

	onMount(() => {
		supabase.auth.getSession().then(({ data: { session } }) => {
			if (session) {
				isAuth = true;
				navigateToDashboard();
			}
		});
	});

	async function handleLogin(e: SubmitEvent) {
		e.preventDefault();
		isLoading = true;
		errorMsg = '';

		const { error } = await supabase.auth.signInWithPassword({
			email,
			password
		});

		if (error) {
			if (error.message.includes('Invalid login credentials')) {
				errorMsg = '契约验证失败，请检查邮箱或秘钥';
			} else {
				errorMsg = error.message;
			}
			isLoading = false;
		} else {
			isAuth = true;
			const {
				data: { session }
			} = await supabase.auth.getSession();
			console.log(session?.user.user_metadata);
			// 输出: { role: "admin", ...其他你设置的字段 }
			// 延迟跳转，展示成功动画
			setTimeout(() => navigateToDashboard(), 800);
		}
	}

	function navigateToDashboard() {
		goto(resolve('/dashboard'));
	}
</script>

<!-- 1. 背景层：使用你的 banner 图片 -->
<div
	class="fixed inset-0 z-0 bg-cover bg-center bg-no-repeat"
	style="background-image: url({bannerImg});"
>
	<!-- 遮罩层：压暗背景，确保白色文字清晰可见 -->
	<div class="absolute inset-0 bg-linear-to-b from-black/40 via-black/60 to-black/80"></div>
</div>

<!-- 2. 内容层：居中卡片 -->
<div class="fadeIn fixed inset-0 z-10 flex justify-center items-center text-cyan-200 p-4">
	<div
		class="relative w-full max-w-md bg-cyan-900/60 backdrop-blur-xl rounded-2xl p-8 md:p-10 shadow-2xl shadow-black/50 text-center"
	>
		<img
			src={mainIcon}
			role="presentation"
			aria-label="back to home"
			class="mx-auto mb-4"
			alt="main icon"
			onclick={() => goto(resolve('/'))}
		/>

		{#if isAuth && !errorMsg}
			<!-- 成功状态 -->
			<div class="text-green-400 text-lg py-8 flex flex-col items-center gap-4">
				<span class="text-3xl drop-shadow-[0_0_10px_#4ade80] animate-pulse">✦</span>
				<p>契约已成，正在进入档案库...</p>
			</div>
		{:else}
			<!-- 登录表单 -->
			<form onsubmit={handleLogin} class="flex flex-col gap-6 text-left">
				<div>
					<label for="email" class="block text-sm text-cyan-400 mb-2 tracking-wide">契约邮箱</label>
					<input
						type="email"
						id="email"
						bind:value={email}
						placeholder="your@email.com"
						required
						class="w-full px-4 py-3 bg-black/30 border rounded-lg text-cyan-50 text-base transition-all duration-300 focus:outline-none focus:border-cyan-400 focus:ring-2 focus:ring-sky-400/20 focus:bg-black/50"
					/>
				</div>

				<div>
					<label for="password" class="block text-sm text-cyan-400 mb-2 tracking-wide">秘钥</label>
					<input
						type="password"
						id="password"
						bind:value={password}
						placeholder="••••••••"
						required
						class="w-full px-4 py-3 bg-black/30 border rounded-lg text-cyan-50 text-base transition-all duration-300 focus:outline-none focus:border-cyan-400 focus:ring-2 focus:ring-sky-400/20 focus:bg-black/50"
					/>
				</div>

				{#if errorMsg}
					<div
						class="bg-red-500/10 text-red-300 p-3 rounded-md text-sm text-center border border-red-500/30 animate-[fadeIn_0.3s_ease-in-out]"
					>
						{errorMsg}
					</div>
				{/if}

				<button
					type="submit"
					disabled={isLoading}
					class="mt-2 py-3 bg-cyan-300 text-black border-none rounded-lg text-lg font-bold tracking-wider cursor-pointer transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-cyan-500/40 flex justify-center items-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:hover:shadow-none"
				>
					{#if isLoading}
						<span class="w-5 h-5 border-2 rounded-full border-t-white animate-spin"></span>
						正在验证...
					{:else}
						开启档案
					{/if}
				</button>
			</form>
		{/if}
	</div>
</div>

<!-- 仅保留极少量的全局/自定义动画 CSS，其余全部交给 Tailwind -->
<style>
	.fadeIn {
		animation: fadeIn 1.5s ease-in-out;
	}

	@keyframes fadeIn {
		from {
			opacity: 0;
			transform: translateY(-5px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}
</style>
