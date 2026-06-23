<script lang="ts">
	import { colorDICT } from '$lib/constants/filterConfig';
	import { iconMap } from '$lib/constants/icon';
	import type { CardListItem, CardPrint } from '$lib/types/card';
	import CardText from './CardText.svelte';

	let { card, onClose }: { card: CardListItem | null; onClose: () => void } = $props();

	// 1. 按 card_no_extend 对 prints 进行分组
	let versionGroups = $derived.by(() => {
		if (!card?.card_prints) return [];
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const groups = new Map<string, CardPrint[]>();
		for (const print of card.card_prints) {
			if (!groups.has(print.card_no_extend)) {
				groups.set(print.card_no_extend, []);
			}
			groups.get(print.card_no_extend)!.push(print);
		}
		// 返回分组数组，并按 print_order 排序
		return Array.from(groups.entries()).map(([version, prints]) => ({
			version,
			prints: prints.sort((a, b) => a.print_order - b.print_order)
		}));
	});

	// 2. 状态管理
	let selectedVersionIdx = $state(0);
	let selectedLangIdx = $state(0);

	// 3. 计算当前选中的 Print
	let currentPrint = $derived.by(() => {
		const group = versionGroups[selectedVersionIdx];
		if (!group) return null;
		return group.prints[selectedLangIdx] || group.prints[0];
	});

	// 4. 交互函数
	function selectVersion(idx: number) {
		selectedVersionIdx = idx;
		selectedLangIdx = 0; // 切换版本时，默认选中第一种语言
	}

	function selectLanguage(idx: number) {
		selectedLangIdx = idx;
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			selectedLangIdx = 0;
			selectedVersionIdx = 0;
			onClose();
		}
	}

	function handleBackdropClick(e: MouseEvent) {
		if (e.target === e.currentTarget) {
			selectedLangIdx = 0;
			selectedVersionIdx = 0;
			onClose();
		}
	}
</script>

<svelte:window onkeydown={handleKeydown} />

{#if card}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in"
		onclick={handleBackdropClick}
		role="presentation"
	>
		<div
			class="relative w-full overflow-y-auto sm:overflow-y-hidden max-w-5xl h-[85vh] flex flex-col md:flex-row bg-gray-950 border border-cyan-500/30 rounded-xl shadow-[0_0_50px_rgba(34,211,238,0.15)] overflow-hidden animate-scale-in"
		>
			<!-- 关闭按钮 -->
			<button
				aria-label="close modal"
				onclick={() => {
					selectedLangIdx = 0;
					selectedVersionIdx = 0;
					onClose();
				}}
				class="absolute top-4 right-4 z-20 w-10 h-10 flex items-center justify-center rounded-full bg-black/50 border border-cyan-500/30 text-cyan-400 hover:bg-cyan-500 hover:text-black transition-all"
			>
				<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"
					><path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="2"
						d="M6 18L18 6M6 6l12 12"
					/></svg
				>
			</button>

			<!-- ================= 左侧：卡图与版本/语言切换 ================= -->
			<div class="md:w-2/5 h-full flex flex-col bg-black/40 border-r border-cyan-500/20 p-6">
				<!-- 主图展示区 -->
				<div class="flex-1 flex items-center justify-center relative group mb-4 min-h-0">
					{#if currentPrint?.img_cdn}
						<img
							src={currentPrint.img_cdn}
							alt={card.card_name_cn}
							class="max-h-full max-w-full object-contain drop-shadow-[0_0_15px_rgba(34,211,238,0.3)] transition-transform duration-500"
						/>
					{:else}
						<div
							class="w-full aspect-3/4 bg-cyan-950/20 border-2 border-dashed border-cyan-500/30 rounded-lg flex items-center justify-center"
						>
							<span class="text-cyan-700 text-lg tracking-widest">NO IMAGE</span>
						</div>
					{/if}
				</div>

				<!-- 语言切换器 (仅当当前版本有多个语言时显示) -->
				{#if versionGroups[selectedVersionIdx]?.prints.length > 1}
					<div class="flex justify-center gap-2 mb-4">
						{#each versionGroups[selectedVersionIdx].prints as print, i (i)}
							<button
								onclick={() => selectLanguage(i)}
								class="px-3 py-1 text-xs font-bold rounded-full border transition-all tracking-wider
									   {i === selectedLangIdx
									? 'bg-cyan-500 text-black border-cyan-400 shadow-[0_0_10px_rgba(34,211,238,0.5)]'
									: 'bg-cyan-950/50 text-cyan-400 border-cyan-500/30 hover:border-cyan-400 hover:bg-cyan-900/50'}"
							>
								{print.language.toUpperCase()}
							</button>
						{/each}
					</div>
				{/if}

				<!-- 画师信息 -->
				{#if currentPrint?.artist}
					<div class="text-center text-cyan-600 text-xs italic mb-4">
						画师： <span class="text-cyan-400 not-italic">{currentPrint.artist}</span>
					</div>
				{/if}

				<!-- 版本切换缩略图 (不同 card_no_extend) -->
				{#if versionGroups.length > 1}
					<div
						class="flex gap-2 overflow-x-auto pb-2 justify-center border-t border-cyan-500/20 pt-4 custom-scrollbar"
					>
						{#each versionGroups as group, i (i)}
							{@const firstPrint = group.prints[0]}
							<button
								onclick={() => selectVersion(i)}
								class="shrink-0 w-12 h-16 rounded border-2 transition-all overflow-hidden relative
									   {i === selectedVersionIdx
									? 'border-cyan-400 shadow-[0_0_10px_rgba(34,211,238,0.5)] scale-110'
									: 'border-cyan-900/50 opacity-50 hover:opacity-80 hover:border-cyan-500/50'}"
							>
								{#if firstPrint.img_cdn}
									<img
										src={firstPrint.img_cdn}
										alt={group.version}
										title={group.version}
										class="w-full h-full object-cover"
									/>
								{:else}
									<div class="w-full h-full bg-cyan-950/50"></div>
								{/if}
								<!-- 版本角标 -->
								<div
									class="absolute bottom-0 left-0 right-0 bg-black/80 text-[9px] text-cyan-300 text-center truncate px-1 font-mono"
								>
									{group.version}
								</div>
							</button>
						{/each}
					</div>
				{/if}
			</div>

			<!-- ================= 右侧：详细信息区 ================= -->
			<div class="md:w-3/5 h-full flex flex-col sm:overflow-y-auto custom-scrollbar p-6 space-y-6">
				<!-- 头部：名称与基础标识 -->
				<header class="space-y-2 border-b border-cyan-500/20 pb-4">
					<div class="flex items-start justify-between gap-4">
						<div>
							<h2
								class="text-3xl font-bold text-cyan-100 leading-tight drop-shadow-[0_0_10px_rgba(34,211,238,0.3)]"
							>
								{card.card_name_cn}
								{#if card.card_name_en}
									<span class="text-sm">{card.card_name_en}</span>
								{/if}
							</h2>
						</div>
						{#if card.is_banned}
							<span
								class="px-3 py-1 bg-red-950/80 border border-red-500 text-red-400 text-xs font-bold rounded tracking-widest animate-pulse"
							>
								BANNED
							</span>
						{/if}
					</div>

					{#if card.sub_title_cn || card.sub_title_en}
						<p class="text-cyan-300 text-sm font-medium">
							{card.sub_title_cn || ''}
							{#if card.sub_title_en}<span class="font-normal italic ml-2">{card.sub_title_en}</span
								>{/if}
						</p>
					{/if}

					<div class="flex flex-wrap gap-2 text-xs text-cyan-400 font-mono">
						<span class="px-2 py-1 bg-cyan-950/50 rounded border border-cyan-500/20"
							>卡牌编号：{currentPrint?.card_no_extend || card.card_no}</span
						>
						<span class="px-2 py-1 bg-cyan-950/50 rounded border border-cyan-500/20 flex"
							>卡牌罕度:
							{#if iconMap.get(currentPrint?.rarity_name as string)}
								<img
									src={iconMap.get(currentPrint?.rarity_name as string)}
									alt={currentPrint?.rarity_name}
									class="mx-1 w-3.5 h-3.5 shrink-0 object-contain"
								/>
								{currentPrint?.rarity_name}
							{/if}
						</span>
					</div>
				</header>

				<!-- 核心属性面板 -->
				<div class="grid grid-cols-3 gap-4">
					<div
						class="bg-cyan-950/20 border border-cyan-500/20 rounded-lg p-3 text-center hover:border-cyan-400/50 transition"
					>
						<div class="text-cyan-600 text-xs uppercase tracking-wider mb-1">法力</div>
						<div class="text-2xl font-bold text-cyan-300">{card.energy ?? '-'}</div>
					</div>
					<div
						class="bg-cyan-950/20 border border-cyan-500/20 rounded-lg p-3 text-center hover:border-cyan-400/50 transition"
					>
						<div class="text-cyan-600 text-xs uppercase tracking-wider mb-1">符能</div>
						<div class="text-2xl font-bold text-cyan-300">{card.return_energy ?? '-'}</div>
					</div>
					{#if card.card_category.includes('单位')}
						<div
							class="bg-cyan-950/20 border border-cyan-500/20 rounded-lg p-3 text-center hover:border-cyan-400/50 transition"
						>
							<div class="text-cyan-600 text-xs uppercase tracking-wider mb-1">战力</div>
							<div class="text-2xl font-bold text-cyan-300">{card.power ?? '-'}</div>
						</div>
					{/if}
				</div>

				<!-- 标签与分类 -->
				<div class="space-y-4">
					<div class="flex flex-wrap gap-2 items-center">
						{#if card.card_category}
							<span
								class="px-3 py-1 bg-cyan-500/10 border border-cyan-400/50 text-cyan-400 text-sm font-semibold rounded-full"
							>
								{card.card_category}
							</span>
						{/if}
						{#if card.card_color_list?.length}
							{#each card.card_color_list as color (color)}
								{@const iconUrl = iconMap.get(color)}
								<span
									class="px-3 py-1 bg-cyan-500/10 border border-cyan-400/50 text-cyan-400 text-[1.5rem] rounded-full"
								>
									{#if iconUrl}
										<img src={iconUrl} alt={color} class="w-5 h-5 shrink-0 object-contain" />
									{:else}
										{colorDICT.get(color) || '无色'}
									{/if}
								</span>
							{/each}
						{/if}
					</div>

					<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
						{#if card.region?.length}
							<div>
								<h4 class="text-cyan-500 text-xs uppercase tracking-wider mb-2">区域</h4>
								<div class="flex flex-wrap gap-1.5">
									{#each card.region as r (r)}
										<span class="px-2 py-0.5 bg-cyan-950/50 text-cyan-300 text-xs rounded">{r}</span
										>
									{/each}
								</div>
							</div>
						{/if}
						{#if card.tag?.length}
							<div>
								<h4 class="text-cyan-500 text-xs uppercase tracking-wider mb-2">标签</h4>
								<div class="flex flex-wrap gap-1.5">
									{#each card.tag as t (t)}
										<span class="px-2 py-0.5 bg-cyan-950/50 text-cyan-300 text-xs rounded">{t}</span
										>
									{/each}
								</div>
							</div>
						{/if}
					</div>

					<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
						{#if card.keyword?.length}
							<div>
								<h4 class="text-cyan-500 text-xs uppercase tracking-wider mb-2">关键词</h4>
								<div class="flex flex-wrap gap-1.5">
									{#each card.keyword as k (k)}
										<span
											class="px-2 py-0.5 bg-cyan-950/50 text-cyan-300 text-xs rounded border border-cyan-500/20"
											>{k}</span
										>
									{/each}
								</div>
							</div>
						{/if}
						{#if card.champion_tag}
							<div>
								<h4 class="text-cyan-500 text-xs uppercase tracking-wider mb-2">英雄标签</h4>
								<div class="flex flex-wrap gap-1.5">
									<span
										class="px-2 py-0.5 bg-amber-950/50 border border-amber-500/30 text-amber-300 text-xs rounded"
										>{card.champion_tag}</span
									>
								</div>
							</div>
						{/if}
					</div>
				</div>

				<!-- 效果文本 -->
				<div class="space-y-3">
					<h4
						class="text-cyan-400 font-bold text-sm uppercase tracking-wider border-l-4 border-cyan-500 pl-3"
					>
						效果文本
					</h4>
					<div class="bg-black/40 border border-cyan-500/20 rounded-lg p-4 space-y-3">
						<p class="text-cyan-100 text-sm leading-relaxed whitespace-pre-line">
							<CardText text={card.effect_cn} />
						</p>
						{#if card.effect_en}
							<p class="text-cyan-100 text-xs leading-relaxed whitespace-pre-line pt-3">
								<!-- eslint-disable-next-line svelte/no-at-html-tags -->
								{@html card.effect_en}
							</p>
						{/if}
					</div>
				</div>

				<!-- 风味文本 -->
				{#if card.flavor_text_cn || card.flavor_text_en}
					<div class="space-y-2 pt-2 border-t border-cyan-500/10 pb-4">
						<h4 class="text-cyan-600 font-semibold text-xs uppercase tracking-wider">风味文本</h4>
						<div class="italic text-cyan-400/60 text-sm leading-relaxed space-y-1">
							{#if card.flavor_text_cn}
								<p>{card.flavor_text_cn}</p>
							{/if}
							{#if card.flavor_text_en}
								<p class="text-xs text-cyan-500/40">{card.flavor_text_en}</p>
							{/if}
						</div>
					</div>
				{/if}
			</div>
		</div>
	</div>
{/if}

<style>
	.animate-fade-in {
		animation: fadeIn 0.2s ease-out forwards;
	}
	.animate-scale-in {
		animation: scaleIn 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards;
	}

	@keyframes fadeIn {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}
	@keyframes scaleIn {
		from {
			opacity: 0;
			transform: scale(0.95) translateY(10px);
		}
		to {
			opacity: 1;
			transform: scale(1) translateY(0);
		}
	}

	.custom-scrollbar::-webkit-scrollbar {
		width: 4px;
		height: 4px;
	}
	.custom-scrollbar::-webkit-scrollbar-track {
		background: rgba(0, 0, 0, 0.2);
	}
	.custom-scrollbar::-webkit-scrollbar-thumb {
		background: rgba(34, 211, 238, 0.3);
		border-radius: 2px;
	}
	.custom-scrollbar::-webkit-scrollbar-thumb:hover {
		background: rgba(34, 211, 238, 0.6);
	}
</style>
