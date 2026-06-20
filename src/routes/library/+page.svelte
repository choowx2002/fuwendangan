<script lang="ts">
	import { getCardFilterOptions, searchCards } from '$lib/database/cards';
	import type { CardFilterOptions, CardSearchParams, ArrayFilter } from '$lib/types/card';
	import bannerImgSrc from '$lib/assets/home_bg.jpg';
	import { onMount } from 'svelte';
	import mainLogo from '$lib/assets/fuwendangan_logo_zn.webp';

	// ================= 状态定义 =================
	let options = $state<CardFilterOptions | null>(null);
	let loadingOptions = $state(true);
	let imageStates = $state<Record<string, 'loading' | 'loaded' | 'error'>>({});

	// 搜索与分页
	let searchText = $state('');
	let searchResults = $state<any[]>([]);
	let totalResults = $state(0);
	let currentPage = $state(1);
	let pageSize = $state(20);
	let isSearching = $state(false);
	let totalPages = $derived(Math.ceil(totalResults / pageSize));

	// 1. 数组字段过滤 (支持 3 态: any/all/none)
	let tagFilters = $state<Record<string, 'any' | 'all' | 'none'>>({});
	let regionFilters = $state<Record<string, 'any' | 'all' | 'none'>>({});
	let keywordFilters = $state<Record<string, 'any' | 'all' | 'none'>>({});
	let advancedTagFilters = $state<Record<string, 'any' | 'all' | 'none'>>({});
	let colorFilters = $state<Record<string, 'any' | 'all' | 'none'>>({});

	// 2. 文本字段过滤 (仅支持多选 in)
	let selectedCategories = $state<string[]>([]);
	let selectedSeries = $state<string[]>([]);
	let selectedRarities = $state<string[]>([]);

	// 3. 数值范围过滤
	let energyRange = $state<[number, number]>([0, 0]);
	let powerRange = $state<[number, number]>([0, 0]);
	let returnEnergyRange = $state<[number, number]>([0, 0]);

	// ================= 生命周期 =================
	onMount(async () => {
		try {
			options = await getCardFilterOptions();
			if (options) {
				energyRange = [options.energy_range.min, options.energy_range.max];
				powerRange = [options.power_range.min, options.power_range.max];
				returnEnergyRange = [options.return_energy_range.min, options.return_energy_range.max];
			}
			await handleSearch(1);
		} catch (e) {
			console.error('Init error:', e);
		} finally {
			loadingOptions = false;
		}
	});

	// ================= 核心交互逻辑 =================

	// 三态切换逻辑：无 -> any -> all -> none -> 无
	function cycleArrayFilter(filters: Record<string, 'any' | 'all' | 'none'>, value: string) {
		const current = filters[value];
		if (!current) filters[value] = 'any';
		else if (current === 'any') filters[value] = 'all';
		else if (current === 'all') filters[value] = 'none';
		else delete filters[value];
	}

	// 普通多选切换
	function toggleSimpleArray(arr: string[], value: string): string[] {
		return arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value];
	}

	// 绑定到 Snippet 的回调函数
	const cycleTag = (v: string) => cycleArrayFilter(tagFilters, v);
	const cycleRegion = (v: string) => cycleArrayFilter(regionFilters, v);
	const cycleKeyword = (v: string) => cycleArrayFilter(keywordFilters, v);
	const cycleAdvTag = (v: string) => cycleArrayFilter(advancedTagFilters, v);
	const cycleColor = (v: string) => cycleArrayFilter(colorFilters, v);

	const toggleCategory = (v: string) =>
		(selectedCategories = toggleSimpleArray(selectedCategories, v));
	const toggleSeries = (v: string) => (selectedSeries = toggleSimpleArray(selectedSeries, v));
	const toggleRarity = (v: string) => (selectedRarities = toggleSimpleArray(selectedRarities, v));

	// ================= 构建查询参数 =================
	function buildArrayFilter(
		filters: Record<string, 'any' | 'all' | 'none'>
	): ArrayFilter | undefined {
		const result: ArrayFilter = {};
		let hasAny = false;
		for (const [key, mode] of Object.entries(filters)) {
			if (mode === 'any') {
				result.any = [...(result.any || []), key];
				hasAny = true;
			} else if (mode === 'all') {
				result.all = [...(result.all || []), key];
				hasAny = true;
			} else if (mode === 'none') {
				result.none = [...(result.none || []), key];
				hasAny = true;
			}
		}
		return hasAny ? result : undefined;
	}

	function isRangeActive(range: [number, number], optRange?: { min: number; max: number }) {
		if (!optRange) return false;
		return range[0] !== optRange.min || range[1] !== optRange.max;
	}

	async function handleSearch(page = 1) {
		isSearching = true;
		currentPage = page;
		try {
			const params: CardSearchParams = {
				page: currentPage,
				pageSize: pageSize,
				searchText: searchText.trim() || undefined,

				// 数组过滤 (3态)
				tag: buildArrayFilter(tagFilters),
				region: buildArrayFilter(regionFilters),
				keyword: buildArrayFilter(keywordFilters),
				advanced_tag: buildArrayFilter(advancedTagFilters),
				card_color_list: buildArrayFilter(colorFilters),

				// 文本过滤 (多选)
				card_category: selectedCategories.length > 0 ? selectedCategories : undefined,
				series_name: selectedSeries.length > 0 ? selectedSeries : undefined,
				rarity_name: selectedRarities.length > 0 ? selectedRarities : undefined,

				// 数值过滤
				energy: isRangeActive(energyRange, options?.energy_range)
					? { gte: energyRange[0], lte: energyRange[1] }
					: undefined,
				power: isRangeActive(powerRange, options?.power_range)
					? { gte: powerRange[0], lte: powerRange[1] }
					: undefined,
				return_energy: isRangeActive(returnEnergyRange, options?.return_energy_range)
					? { gte: returnEnergyRange[0], lte: returnEnergyRange[1] }
					: undefined
			};

			const result = await searchCards(params);
			searchResults = result.data;
			totalResults = result.total;
		} catch (e) {
			console.error('Search error:', e);
		} finally {
			isSearching = false;
		}
	}

	function clearFilters() {
		searchText = '';
		tagFilters = {};
		regionFilters = {};
		keywordFilters = {};
		advancedTagFilters = {};
		colorFilters = {};
		selectedCategories = [];
		selectedSeries = [];
		selectedRarities = [];
		if (options) {
			energyRange = [options.energy_range.min, options.energy_range.max];
			powerRange = [options.power_range.min, options.power_range.max];
			returnEnergyRange = [options.return_energy_range.min, options.return_energy_range.max];
		}
		handleSearch(1);
	}

	function handleImageLoad(cardId: string) {
		imageStates[cardId] = 'loaded';
	}

	function handleImageError(cardId: string) {
		imageStates[cardId] = 'error';
	}
</script>

<!-- ================= Svelte 5 Snippets ================= -->

{#snippet advancedFilterSection(
	title: string,
	items: string[],
	filters: Record<string, 'any' | 'all' | 'none'>,
	toggleFn: {
		(v: string): void;
		(v: string): void;
		(v: string): void;
		(v: string): void;
		(v: string): void;
		(arg0: any): any;
	}
)}
	<div class="space-y-2">
		<div class="flex justify-between items-end">
			<h3
				class="text-cyan-400 font-semibold text-xs uppercase tracking-wider border-b border-cyan-500/20 pb-1 flex-1"
			>
				{title}
			</h3>
			<span class="text-[9px] text-cyan-700 ml-2 italic hidden md:block"
				>Click: Include → Must → Exclude</span
			>
		</div>
		<div class="flex flex-wrap gap-1.5">
			{#each items as item}
				{@const mode = filters[item]}
				{@const buttonClass =
					mode === 'all'
						? 'bg-cyan-300 text-cyan-950 border-cyan-100 font-bold shadow-[0_0_8px_rgba(165,243,252,0.6)]'
						: mode === 'none'
							? 'bg-red-950/60 text-red-400 border-red-500/60 line-through'
							: mode === 'any'
								? 'bg-cyan-500 text-black border-cyan-400'
								: 'bg-cyan-950/40 text-cyan-400 border-cyan-500/30 hover:border-cyan-400 hover:bg-cyan-900/40'}
				<button
					onclick={() => toggleFn(item)}
					class="px-2.5 py-1 text-xs rounded-md transition-all duration-200 border flex items-center gap-1 {buttonClass}"
				>
					{item}
					{#if mode === 'all'}<span class="text-[10px] font-bold">✓</span>{/if}
					{#if mode === 'none'}<span class="text-[10px] font-bold">✕</span>{/if}
				</button>
			{/each}
		</div>
	</div>
{/snippet}

{#snippet simpleFilterSection(
	title: string,
	items: string[],
	selectedItems: string | any[],
	toggleFn: {
		(v: string): string[];
		(v: string): string[];
		(v: string): string[];
		(arg0: any): any;
	}
)}
	<div class="space-y-2">
		<h3
			class="text-cyan-400 font-semibold text-xs uppercase tracking-wider border-b border-cyan-500/20 pb-1"
		>
			{title}
		</h3>
		<div class="flex flex-wrap gap-1.5">
			{#each items as item}
				<button
					onclick={() => toggleFn(item)}
					class="px-2.5 py-1 text-xs rounded-md transition-all duration-200 border
						   {selectedItems.includes(item)
						? 'bg-cyan-500 text-black border-cyan-400'
						: 'bg-cyan-950/40 text-cyan-400 border-cyan-500/30 hover:border-cyan-400 hover:bg-cyan-900/40'}"
				>
					{item}
				</button>
			{/each}
		</div>
	</div>
{/snippet}

{#snippet rangeSection(title: string, range: any[], min: number, max: number)}
	<div class="space-y-2">
		<h3
			class="text-cyan-400 font-semibold text-xs uppercase tracking-wider border-b border-cyan-500/20 pb-1"
		>
			{title}
		</h3>
		<div class="flex items-center gap-2">
			<input
				type="number"
				bind:value={range[0]}
				{min}
				{max}
				class="w-full px-3 py-2 bg-cyan-950/30 border border-cyan-500/30 rounded-md text-cyan-100 text-sm focus:outline-none focus:border-cyan-400 transition"
			/>
			<span class="text-cyan-500 font-bold">-</span>
			<input
				type="number"
				bind:value={range[1]}
				{min}
				{max}
				class="w-full px-3 py-2 bg-cyan-950/30 border border-cyan-500/30 rounded-md text-cyan-100 text-sm focus:outline-none focus:border-cyan-400 transition"
			/>
		</div>
	</div>
{/snippet}

<!-- ================= 主布局 ================= -->
<div class="relative h-screen w-screen overflow-hidden bg-black text-white font-sans">
	<div class="fixed inset-0 z-0">
		<img src={bannerImgSrc} alt="Bg" class="w-full h-full object-cover blur-xs" />
	</div>

	<div class="relative z-10 flex h-full">
		<!-- ================= 左侧：卡牌展示区 ================= -->
		<div class="flex-[7] flex flex-col h-full border-r border-cyan-500/20 bg-black/20">
			<div
				class="px-6 py-4 border-b border-cyan-500/20 bg-black/40 backdrop-blur-md flex justify-between items-center"
			>
				<h2
					class="text-xl font-bold text-cyan-400 tracking-[0.2em] drop-shadow-[0_0_10px_rgba(34,211,238,0.3)]"
				>
					DATABASE
				</h2>
				<span class="text-cyan-300 text-sm font-mono">
					{#if isSearching}<span class="animate-pulse">SEARCHING...</span>
					{:else}{totalResults} RESULTS{/if}
				</span>
			</div>

			<div class="flex-1 overflow-y-auto p-6">
				{#if loadingOptions}
					<div class="flex items-center justify-center h-full">
						<div
							class="w-8 h-8 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin"
						></div>
					</div>
				{:else if searchResults.length > 0}
					<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
						{#each searchResults as card}
							{@const cardId = card.id}
							{@const print = card.card_prints?.[0]}
							{@const imgUrl = print?.img_cdn}
							{@const state = imageStates[cardId] || 'loading'}

							<!-- 卡牌容器 (固定宽高比防止布局抖动) -->
							<div
								class="group relative w-full aspect-[744/1040] rounded-lg overflow-hidden
                            border border-cyan-500/20 hover:border-cyan-400/50
                            hover:shadow-[0_0_20px_rgba(34,211,238,0.2)] transition-all duration-300"
							>
								<!-- 1. 底层：Placeholder (始终存在) -->
								<!-- 带有微光动画，提示正在加载 -->
								<div
									class="absolute inset-0 w-full h-full bg-cyan-950/30 flex items-center justify-center
                                transition-opacity duration-500 ease-out
                                {state === 'loaded'
										? 'opacity-0 pointer-events-none'
										: 'opacity-100'}"
								>
									<!-- 如果你有具体的 placeholder 图片，用 <img> 替换下面的 span
									<img src={mainLogo} class="w-full h-full object-cover" alt="" /> -->

									<!-- 这里用文字+图标模拟一个赛博风的占位符 -->
									<div class="flex flex-col items-center gap-2 animate-pulse">
										<svg
											class="w-10 h-10 text-cyan-800"
											fill="none"
											stroke="currentColor"
											viewBox="0 0 24 24"
										>
											<path
												stroke-linecap="round"
												stroke-linejoin="round"
												stroke-width="1"
												d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
											/>
										</svg>
										<span class="text-cyan-800 text-xs tracking-widest">LOADING</span>
									</div>
								</div>

								<!-- 2. 上层：真实图片 -->
								{#if imgUrl}
									<img
										src={imgUrl}
										alt={card.card_name_cn || 'Card'}
										class="absolute inset-0 w-full h-full object-contain
                                   transition-opacity duration-500 ease-out
                                   {state === 'loaded' ? 'opacity-100' : 'opacity-0'}"
										onload={() => handleImageLoad(cardId)}
										onerror={() => handleImageError(cardId)}
									/>
								{:else}
									<!-- 如果数据库里根本没有 CDN 链接，直接标记为 error 显示占位图 -->
									{handleImageError(cardId)}
								{/if}

								<!-- 3. 悬浮时的卡牌信息遮罩 (可选，提升交互体验) -->
								<div
									class="absolute inset-x-0 bottom-0 p-3 bg-gradient-to-t from-black/90 via-black/50 to-transparent
                                opacity-0 group-hover:opacity-100 transition-opacity duration-300"
								>
									<h3 class="text-cyan-100 font-bold text-sm truncate">
										{card.card_name_cn}{' '}{card.card_name_en}
									</h3>
									<p class="text-cyan-400 text-xs truncate">
										{card.sub_title_cn}{' '}
										{card.sub_title_en}
									</p>
								</div>
							</div>
						{/each}
					</div>
				{:else}
					<div class="flex flex-col items-center justify-center h-full text-cyan-600/50">
						<p class="text-lg tracking-wider">NO CARDS FOUND</p>
					</div>
				{/if}
			</div>

			{#if totalPages > 1}
				<div
					class="px-6 py-3 border-t border-cyan-500/20 bg-black/60 backdrop-blur-md flex justify-center items-center gap-4"
				>
					<button
						onclick={() => handleSearch(currentPage - 1)}
						disabled={currentPage === 1 || isSearching}
						class="px-4 py-1.5 bg-cyan-950/50 border border-cyan-500/30 rounded text-cyan-300 text-sm disabled:opacity-30 hover:bg-cyan-900/50 transition"
						>PREV</button
					>
					<span class="text-cyan-400 text-sm font-mono tracking-widest"
						>{currentPage} / {totalPages}</span
					>
					<button
						onclick={() => handleSearch(currentPage + 1)}
						disabled={currentPage === totalPages || isSearching}
						class="px-4 py-1.5 bg-cyan-950/50 border border-cyan-500/30 rounded text-cyan-300 text-sm disabled:opacity-30 hover:bg-cyan-900/50 transition"
						>NEXT</button
					>
				</div>
			{/if}
		</div>

		<!-- ================= 右侧：筛选控制台 ================= -->
		<div class="flex-[3] flex flex-col h-full bg-black/60 backdrop-blur-md min-w-[300px]">
			<div class="px-4 py-4 border-b border-cyan-500/20 flex justify-between items-center">
				<h2 class="text-lg font-bold text-cyan-400 tracking-[0.2em]">FILTERS</h2>
				<button
					onclick={clearFilters}
					class="text-xs text-cyan-500 hover:text-cyan-300 transition tracking-wider"
					>CLEAR ALL</button
				>
			</div>

			<div class="flex-1 overflow-y-auto p-4 space-y-5">
				<div class="relative">
					<input
						type="text"
						bind:value={searchText}
						placeholder="Search name or effect..."
						class="w-full px-4 py-2.5 pl-10 bg-cyan-950/30 border border-cyan-500/30 rounded-md text-cyan-100 placeholder-cyan-700 focus:outline-none focus:border-cyan-400 transition-all text-sm"
					/>
					<svg
						class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-cyan-600"
						fill="none"
						stroke="currentColor"
						viewBox="0 0 24 24"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
						/>
					</svg>
				</div>

				{#if options}
					<!-- 数组字段 (3态切换) -->
					{@render advancedFilterSection('Tags', options.tags, tagFilters, cycleTag)}
					{@render advancedFilterSection('Regions', options.regions, regionFilters, cycleRegion)}
					{@render advancedFilterSection('Colors', options.colors, colorFilters, cycleColor)}
					{@render advancedFilterSection(
						'Keywords',
						options.keywords,
						keywordFilters,
						cycleKeyword
					)}
					{@render advancedFilterSection(
						'Advanced Tags',
						options.advanced_tags,
						advancedTagFilters,
						cycleAdvTag
					)}

					<!-- 文本字段 (普通多选) -->
					{@render simpleFilterSection(
						'Categories',
						options.categories,
						selectedCategories,
						toggleCategory
					)}
					{@render simpleFilterSection('Series', options.series, selectedSeries, toggleSeries)}
					{@render simpleFilterSection(
						'Rarities',
						options.rarities,
						selectedRarities,
						toggleRarity
					)}

					<!-- 数值范围 -->
					{@render rangeSection(
						'Energy',
						energyRange,
						options.energy_range.min,
						options.energy_range.max
					)}
					{@render rangeSection(
						'Power',
						powerRange,
						options.power_range.min,
						options.power_range.max
					)}
					{@render rangeSection(
						'Return Energy',
						returnEnergyRange,
						options.return_energy_range.min,
						options.return_energy_range.max
					)}
				{/if}
			</div>

			<div class="p-4 border-t border-cyan-500/20 bg-black/80">
				<button
					onclick={() => handleSearch(1)}
					disabled={isSearching}
					class="w-full py-3 bg-cyan-500 text-black font-bold rounded hover:bg-cyan-400 shadow-[0_0_15px_rgba(34,211,238,0.4)] disabled:opacity-50 transition-all duration-300 tracking-widest text-sm"
				>
					{isSearching ? 'SEARCHING...' : 'APPLY FILTERS'}
				</button>
			</div>
		</div>
	</div>
</div>

<style>
	:global(::-webkit-scrollbar) {
		width: 6px;
		height: 6px;
	}
	:global(::-webkit-scrollbar-track) {
		background: rgba(0, 0, 0, 0.2);
	}
	:global(::-webkit-scrollbar-thumb) {
		background: rgba(34, 211, 238, 0.3);
		border-radius: 3px;
	}
	:global(::-webkit-scrollbar-thumb:hover) {
		background: rgba(34, 211, 238, 0.6);
	}
	:global(input[type='number']::-webkit-inner-spin-button),
	:global(input[type='number']::-webkit-outer-spin-button) {
		-webkit-appearance: none;
		margin: 0;
	}
	:global(input[type='number']) {
		-moz-appearance: textfield;
	}
</style>
