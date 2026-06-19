<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import bannerImgSrc from '$lib/assets/home_bg.jpg';

	let firefliesContainer: HTMLDivElement;
	let bannerImg: HTMLImageElement;
	let animationFrameId: number;

	onMount(() => {
		// 生成萤火虫
		if (firefliesContainer) {
			const fireflyCount = 30;
			const fragment = document.createDocumentFragment();

			for (let i = 0; i < fireflyCount; i++) {
				const firefly = document.createElement('div');
				firefly.className = 'firefly';
				firefly.style.left = Math.random() * 100 + '%';
				firefly.style.top = Math.random() * 100 + '%';
				firefly.style.setProperty('--dx', Math.random() * 100 - 50 + 'px');
				firefly.style.setProperty('--dy', Math.random() * 100 - 50 + 'px');
				firefly.style.setProperty('--duration', 4 + Math.random() * 6 + 's');
				firefly.style.setProperty('--delay', Math.random() * 5 + 's');

				const size = 2 + Math.random() * 3;
				firefly.style.width = size + 'px';
				firefly.style.height = size + 'px';

				if (Math.random() > 0.5) {
					firefly.style.background = '#a7f3d0';
					firefly.style.boxShadow = '0 0 8px #34d399, 0 0 16px #10b981';
				} else {
					firefly.style.background = '#cffafe';
					firefly.style.boxShadow = '0 0 8px #22d3ee, 0 0 16px #06b6d4';
				}

				fragment.appendChild(firefly);
			}

			firefliesContainer.appendChild(fragment);
		}

		// 鼠标视差效果
		// const handleMouseMove = (e: MouseEvent) => {
		// 	if (!bannerImg) return;
		// 	const x = (e.clientX / window.innerWidth - 0.5) * 10;
		// 	const y = (e.clientY / window.innerHeight - 0.5) * 10;
		// 	bannerImg.style.transform = `translate(${x}px, ${y}px) scale(1.05)`;
		// };

    
		// document.addEventListener('mousemove', handleMouseMove);

		// return () => {
		// 	document.removeEventListener('mousemove', handleMouseMove);
		// 	if (animationFrameId) cancelAnimationFrame(animationFrameId);
		// };
	});
</script>

<div class="relative min-h-screen overflow-hidden bg-black text-white font-serif">
	<!-- Banner Background -->
	<div class="fixed inset-0 z-0 pointer-events-none">
		<img
			bind:this={bannerImg}
			src={bannerImgSrc}
			alt="Riftbound Banner"
			class="w-full h-full object-cover transition-transform duration-300 ease-out"
			style="transform: scale(1.05);"
		/>
		<div class="absolute inset-0 bg-gradient-to-b from-black/40 via-black/10 to-black/80"></div>
		<div class="absolute inset-0 vignette"></div>
	</div>

	<!-- Fireflies -->
	<div bind:this={firefliesContainer} class="fixed inset-0 z-[1] pointer-events-none blur-in"></div>

	<!-- Main Content -->
	<div class="relative z-10 min-h-screen flex flex-col">
		<!-- Center Title -->
		<div class="flex-1 flex flex-col items-center justify-center pointer-events-none">
			<h1
				class="text-5xl md:text-7xl lg:text-8xl font-bold tracking-[0.3em] shimmer-text animate-fade-in-up text-center px-4"
				style="animation-delay: 0.1s; animation-fill-mode: both;"
			>
				符文档案
			</h1>
			<p
				class="mt-4 text-lg md:text-xl tracking-[0.5em] text-cyan-200/70 animate-fade-in-up"
				style="animation-delay: 0.3s; animation-fill-mode: both;"
			>
				RUNE ARCHIEVE
			</p>
			<div
				class="mt-6 w-32 h-[1px] bg-gradient-to-r from-transparent via-cyan-400 to-transparent animate-pulse-glow"
			></div>
		</div>

		<!-- Floating Navigation -->
		<div class="flex items-center flex-col justify-around gap-6 md:px-12 lg:px-20 py-8 md:pb-10">
			<!-- Left Navigation -->
			<!-- <div class="flex flex-col gap-6 md:gap-8"> -->
			<a
				href="/library"
				class="group animate-fade-in-left"
				style="animation-delay: 0.5s; animation-fill-mode: both;"
			>
				<div
					class="nav-card bg-black/50 border border-cyan-500/40 rounded-xl px-6 md:px-8 py-4 md:py-5 text-cyan-100 cursor-pointer"
					style="color: #22d3ee;"
				>
					<div class="flex items-center gap-4">
						<svg class="nav-icon w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="1.5"
								d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
							/>
						</svg>
						<div>
							<div class="text-xs tracking-[0.3em] text-cyan-300/60 uppercase">Archive</div>
							<div class="text-lg md:text-xl font-bold tracking-wider">卡牌库</div>
						</div>
						<svg
							class="w-5 h-5 opacity-0 group-hover:opacity-100 group-hover:translate-x-1 transition-all ml-2"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M9 5l7 7-7 7"
							/>
						</svg>
					</div>
				</div>
			</a>

			<a
				href="/faq"
				class="group animate-fade-in-left"
				style="animation-delay: 0.8s; animation-fill-mode: both;"
			>
				<div
					class="nav-card bg-black/50 border border-purple-500/40 rounded-xl px-6 md:px-8 py-4 md:py-5 text-purple-100 cursor-pointer"
					style="color: #c084fc;"
				>
					<div class="flex items-center gap-4">
						<svg class="nav-icon w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="1.5"
								d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
							/>
						</svg>
						<div>
							<div class="text-xs tracking-[0.3em] text-purple-300/60 uppercase">Wisdom</div>
							<div class="text-lg md:text-xl font-bold tracking-wider">常见QA</div>
						</div>
						<svg
							class="w-5 h-5 opacity-0 group-hover:opacity-100 group-hover:translate-x-1 transition-all ml-2"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M9 5l7 7-7 7"
							/>
						</svg>
					</div>
				</div>
			</a>
			<!-- </div> -->

			<!-- Right Navigation -->
			<!-- <div class="flex flex-col gap-6 md:gap-8"> -->
			<a
				href="/deck-builder"
				class="group animate-fade-in-left"
				style="animation-delay: 0.6s; animation-fill-mode: both;"
			>
				<div
					class="nav-card bg-black/50 border border-emerald-500/40 rounded-xl px-6 md:px-8 py-4 md:py-5 text-emerald-100 cursor-pointer"
					style="color: #34d399;"
				>
					<div class="flex items-center gap-4">
						<svg class="nav-icon w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="1.5"
								d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z"
							/>
						</svg>
						<div>
							<div class="text-xs tracking-[0.3em] text-emerald-300/60 uppercase">Forge</div>
							<div class="text-lg md:text-xl font-bold tracking-wider">临时构筑</div>
						</div>

						<svg
							class="w-5 h-5 opacity-0 group-hover:opacity-100 group-hover:-translate-x-1 transition-all ml-2"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M9 5l7 7-7 7"
							/>
						</svg>
					</div>
				</div>
			</a>
			<!-- </div> -->
		</div>

		<!-- Footer -->
		<footer class="relative z-10">
			<div class="bg-gradient-to-t from-black via-black/80 to-transparent pt-12 pb-6">
				<div class="max-w-4xl mx-auto px-6 text-center">
					<div class="flex items-center justify-center gap-3 mb-3">
						<div class="w-12 h-[1px] bg-gradient-to-r from-transparent to-cyan-500/50"></div>
						<!-- <svg
							class="w-5 h-5 text-cyan-400 animate-pulse-glow"
							fill="currentColor"
							viewBox="0 0 24 24"
						>
							<path
								d="M12 2L9.19 8.63L2 9.24l5.46 4.73L5.82 21L12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61z"
							/>
						</svg> -->
                        <img src="https://assetcdn.rgpub.io/public/live/riot-shared/player-experiences/riot-glyphs/rb/latest/rune_rainbow.svg" alt="">
						<div class="w-12 h-[1px] bg-gradient-to-l from-transparent to-cyan-500/50"></div>
					</div>
					<!-- <p class="text-white/70 text-sm tracking-[0.2em]">符文战场 Riftbound 粉丝网页</p> -->
					<p class="text-white/40 text-xs mt-2 tracking-wider">
						非官方网站 · 仅供粉丝交流使用 · © 2026
					</p>
				</div>
			</div>
		</footer>
	</div>
</div>

<style>
	:global(body) {
		margin: 0;
		overflow-x: hidden;
		background: #000;
	}

	.font-serif {
		font-family: 'Cinzel', 'Georgia', serif;
	}

	/* 漂浮动画 */
	@keyframes floatLeft {
		0%,
		100% {
			transform: translateY(0px) translateX(0px);
		}
		50% {
			transform: translateY(-12px) translateX(-4px);
		}
	}
	@keyframes floatLeftDelayed {
		0%,
		100% {
			transform: translateY(0px) translateX(0px);
		}
		50% {
			transform: translateY(-10px) translateX(4px);
		}
	}
	@keyframes floatRight {
		0%,
		100% {
			transform: translateY(0px) translateX(0px);
		}
		50% {
			transform: translateY(-14px) translateX(4px);
		}
	}
	@keyframes fadeInLeft {
		from {
			opacity: 0;
			transform: translateX(-40px);
		}
		to {
			opacity: 1;
			transform: translateX(0);
		}
	}
	@keyframes fadeInRight {
		from {
			opacity: 0;
			transform: translateX(40px);
		}
		to {
			opacity: 1;
			transform: translateX(0);
		}
	}
	@keyframes fadeInUp {
		from {
			opacity: 0;
			transform: translateY(20px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}
	@keyframes pulseGlow {
		0%,
		100% {
			opacity: 0.4;
		}
		50% {
			opacity: 0.8;
		}
	}
	@keyframes shimmer {
		0% {
			background-position: -200% center;
		}
		100% {
			background-position: 200% center;
		}
	}
	@keyframes firefly {
		0%,
		100% {
			opacity: 0;
			transform: translate(0, 0);
		}
		10% {
			opacity: 1;
		}
		90% {
			opacity: 1;
		}
		100% {
			opacity: 0;
			transform: translate(var(--dx), var(--dy));
		}
	}

	@keyframes blur-in-animate {
		0% {
			backdrop-filter: blur(0);
		}
		100% {
			backdrop-filter: blur(0.8px);
		}
	}

	:global(.blur-in) {
		animation: blur-in-animate 1.5s ease-out forwards;
	}

	:global(.animate-float-left) {
		animation: floatLeft 5s ease-in-out infinite;
	}
	:global(.animate-float-left-delayed) {
		animation: floatLeftDelayed 5s ease-in-out infinite 1s;
	}
	:global(.animate-float-right) {
		animation: floatRight 5s ease-in-out infinite 0.5s;
	}
	:global(.animate-fade-in-left) {
		animation: fadeInLeft 1.2s ease-out forwards;
	}
	:global(.animate-fade-in-right) {
		animation: fadeInRight 1.2s ease-out forwards;
	}
	:global(.animate-fade-in-up) {
		animation: fadeInUp 1.5s ease-out forwards;
	}
	:global(.animate-pulse-glow) {
		animation: pulseGlow 3s ease-in-out infinite;
	}

	:global(.nav-card) {
		position: relative;
		backdrop-filter: blur(12px);
		-webkit-backdrop-filter: blur(12px);
		transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
	}
	:global(.nav-card::before) {
		content: '';
		position: absolute;
		inset: 0;
		border-radius: inherit;
		padding: 1px;
		background: linear-gradient(
			135deg,
			transparent 30%,
			rgba(255, 255, 255, 0.2) 50%,
			transparent 70%
		);
		-webkit-mask:
			linear-gradient(#fff 0 0) content-box,
			linear-gradient(#fff 0 0);
		-webkit-mask-composite: xor;
		mask-composite: exclude;
		opacity: 0;
		transition: opacity 0.4s;
		pointer-events: none;
	}
	:global(.nav-card:hover::before) {
		opacity: 1;
	}
	:global(.nav-card:hover) {
		transform: scale(1.05);
	}

	:global(.nav-icon) {
		filter: drop-shadow(0 0 6px currentColor);
	}

	/* :global(.shimmer-text) {
		background: linear-gradient(90deg, #fff 0%, #a5f3fc 25%, #fff 50%, #a5f3fc 75%, #fff 100%);
		background-size: 200% auto;
		-webkit-background-clip: text;
		background-clip: text;
		-webkit-text-fill-color: transparent;
		animation: shimmer 4s linear infinite;
	} */

	:global(.firefly) {
		position: absolute;
		border-radius: 50%;
		animation: firefly var(--duration) ease-in-out infinite;
		animation-delay: var(--delay);
	}

	:global(.vignette) {
		background: radial-gradient(ellipse at center, transparent 40%, rgba(0, 0, 0, 0.7) 100%);
	}
</style>
