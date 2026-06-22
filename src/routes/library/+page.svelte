<script lang="ts">
	import { searchCards } from '$lib/database/cards';
	import type {
		CardFilterOptions,
		CardSearchParams,
		ArrayFilter,
		CardListItem
	} from '$lib/types/card';
	import bannerImgSrc from '$lib/assets/home_bg.jpg';
	import { onMount } from 'svelte';
	import mainLogo from '$lib/assets/fuwendangan_logo_zn.webp';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import CardDetailModal from '$lib/components/CardDetailModal.svelte';
	import { processFilterConfig } from '$lib/helpers/filterConfig';
	import { iconMap } from '$lib/constants/icon';
	import RangeSlider from '$lib/components/RangeSlider.svelte';

	// ================= 状态定义 =================
	let options = $state<CardFilterOptions | null>(null);
	let loadingOptions = $state(true);
	let imageStates = $state<Record<string, 'loading' | 'loaded' | 'error'>>({});

	// 搜索与分页
	let searchText = $state('');
	let searchResults = $state<CardListItem[]>([]);
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

	let selectedCard = $state<CardListItem | null>(null);
	let isFilterClose = $state(false);
	let isMobile = $state(false);

	// ================= 生命周期 =================
	onMount(() => {
		const media = window.matchMedia('(max-width: 640px)');
		const update = () => {
			isMobile = media.matches;
			isFilterClose = media.matches;
		};

		const init = async () => {
			try {
				update(); // 立即执行一次
				media.addEventListener('change', update);

				options = await processFilterConfig();
				if (options) {
					energyRange = [options.energy_range.min, options.energy_range.max];
					powerRange = [options.power_range.min, options.power_range.max];
					returnEnergyRange = [options.return_energy_range.min, options.return_energy_range.max];
				}
				await handleSearch(1);

				const searchForm: HTMLElement | null = document.getElementById('searchForm');
				const searchInput: HTMLElement | null = document.getElementById('searchInput');

				if (searchForm) {
					searchForm.addEventListener('submit', function (event) {
						event.preventDefault();
						handleSearch(1);
						if (searchInput) searchInput.blur();
					});
				}
			} catch (e) {
				console.error('Init error:', e);
			} finally {
				loadingOptions = false;
			}
		};

		// 3. 调用异步函数
		init();

		// 4. 返回清理函数 (现在 TS 能正确识别 media 和 update 了)
		return () => {
			media.removeEventListener('change', update);
		};
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

	function openCardDetail(card: CardListItem) {
		selectedCard = card;
	}

	function closeCardDetail() {
		selectedCard = null;
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
	}
)}
	<div class="space-y-2">
		<div class="flex justify-between items-end">
			<h3
				class="text-cyan-400 font-semibold text-xs uppercase tracking-wider border-b border-cyan-500/20 pb-1 flex-1"
			>
				{title}
			</h3>
			<span class="text-[10px] text-cyan-700 ml-2 italic hidden md:block"
				>依次点击：包含 → 必须包含 → 排除</span
			>
		</div>
		<div class="flex flex-wrap gap-1.5">
			{#each items as item, i (i)}
				{@const mode = filters[item]}
				{@const iconUrl = iconMap.get(item)}
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
					oncontextmenu={(ev) => {
						ev.preventDefault();
						delete filters[item];
					}}
					class="px-2.5 py-1 text-sm rounded-md transition-all duration-200 border flex items-center gap-1 {buttonClass}"
				>
					{#if iconUrl}
						<!-- 添加 shrink-0 防止图片被挤压变形，w-4 h-4 控制大小 -->
						<img src={iconUrl} alt={item} class="w-6 h-6 shrink-0 object-contain" />
					{:else}
						{item}
					{/if}
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
	selectedItems: string | string[],
	toggleFn: {
		(v: string): string[];
		(v: string): string[];
		(v: string): string[];
	}
)}
	<div class="space-y-2">
		<h3
			class="text-cyan-400 font-semibold text-xs uppercase tracking-wider border-b border-cyan-500/20 pb-1"
		>
			{title}
		</h3>
		<div class="flex flex-wrap gap-1.5">
			{#each items as item, i (i)}
				{@const iconUrl = iconMap.get(item)}
				<button
					onclick={() => toggleFn(item)}
					oncontextmenu={(ev) => {
						ev.preventDefault();
						toggleFn(item);
					}}
					class="px-2.5 py-1 text-sm rounded-md transition-all duration-200 border
						   {selectedItems.includes(item)
						? 'bg-cyan-500 text-black border-cyan-400'
						: 'bg-cyan-950/40 text-cyan-400 border-cyan-500/30 hover:border-cyan-400 hover:bg-cyan-900/40'}"
				>
					{#if iconUrl}
						<!-- 添加 shrink-0 防止图片被挤压变形，w-4 h-4 控制大小 -->
						<img src={iconUrl} alt={item} class="w-6 h-6 shrink-0 object-contain" />
					{:else}
						{item}
					{/if}
				</button>
			{/each}
		</div>
	</div>
{/snippet}

{#snippet rangeSection(title: string, range: [number, number], min: number, max: number)}
	<div class="space-y-2">
		<h3
			class="text-cyan-400 font-semibold text-xs uppercase tracking-wider border-b border-cyan-500/20 pb-1"
		>
			{title}
			{range[0]} - {range[1]}
		</h3>

		<RangeSlider {range} {min} {max} />
	</div>
{/snippet}

<!-- ================= 主布局 ================= -->
<div class="relative h-screen w-screen overflow-hidden bg-black text-white font-sans">
	<div class="fixed inset-0 z-0">
		<img src={bannerImgSrc} alt="Bg" class="w-full h-full object-cover blur-xs" />
	</div>

	<div class="relative z-10 flex h-full">
		<!-- ================= 左侧：卡牌展示区 ================= -->
		<div class="flex-7 flex flex-col h-full border-r border-cyan-500/20 bg-black/20">
			<div
				class="px-6 py-4 border-b border-cyan-500/20 bg-black/40 backdrop-blur-md flex justify-between items-center"
			>
				<div class="flex items-center gap-5">
					<a href={resolve('/')}>
						<img src={mainLogo} alt="main logo" class="h-16 object-containe" />
					</a>
					<h5>
						<a
							aria-current={page.url.pathname === '/library' ? 'page' : undefined}
							href={resolve('/library')}
							class="text-lg font-bold tracking-wider hover:text-cyan-300 {page.url.pathname ===
							'/library'
								? 'text-cyan-300'
								: ''}">卡牌库</a
						>
					</h5>
				</div>
			</div>

			<div class="flex-1 overflow-y-auto p-6">
				{#if loadingOptions}
					<div class="flex items-center justify-center h-full">
						<div
							class="w-8 h-8 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin"
						></div>
					</div>
				{:else if searchResults.length > 0}
					<div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-4">
						{#each searchResults as card, i (card.id)}
							{@const cardId = card.id}
							{@const print = card.card_prints?.[0]}
							{@const imgUrl = print?.img_cdn}
							{@const state = imageStates[cardId] || 'loading'}

							<!-- 卡牌容器 (固定宽高比防止布局抖动) -->
							<!-- svelte-ignore a11y_click_events_have_key_events -->
							<div
								role="button"
								tabindex={i}
								aria-label={card.card_name_cn}
								class="group relative w-full aspect-744/1040 rounded-lg overflow-hidden
                            border border-cyan-500/20 hover:border-cyan-400/50
                            hover:shadow-[0_0_20px_rgba(34,211,238,0.2)] transition-all duration-300"
								onclick={() => openCardDetail(card)}
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

								<!-- 3. 悬浮时的卡牌信息遮罩 (可选，提升交互体验)
								<div
									class="absolute inset-x-0 bottom-0 p-3 bg-linear-to-t from-black/90 via-black/50 to-transparent
                                opacity-0 group-hover:opacity-100 transition-opacity duration-300"
								>
									<h3 class="text-cyan-100 font-bold text-sm truncate">
										{card.card_name_cn}{' '}{card.card_name_en}
									</h3>
									<p class="text-cyan-400 text-xs truncate">
										{card.sub_title_cn}{' '}
										{card.sub_title_en}
									</p>
								</div> -->
							</div>
						{/each}
					</div>
				{:else}
					<div class="flex flex-col items-center justify-center h-full text-cyan-600/50">
						<p class="text-lg tracking-wider">抱歉! 没搜索到任何卡牌。QAQ</p>
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
					<span class="text-cyan-400 text-sm tracking-widest">{currentPage} / {totalPages}</span>
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
		<div
			class="flex-3 flex flex-col h-full bg-black/60 backdrop-blur-md min-w-75 sm:relative fixed {isMobile
				? isFilterClose
					? 'hidden'
					: ''
				: ''}"
		>
			<div class="px-4 py-4 border-b border-cyan-500/20 flex justify-between items-center">
				<h2 class="text-lg font-bold text-cyan-400 tracking-[0.2em]">
					筛选 <span class="tracking-normal text-xs">{totalResults} 张卡</span>
				</h2>
				<div class="flex items-center-safe gap-4">
					<button
						onclick={clearFilters}
						class="text-xs text-cyan-500 hover:text-cyan-300 transition tracking-wider">清除</button
					>
					<button
						onclick={() => {
							isFilterClose = true;
						}}
						class="sm:hidden text-xs text-red-500 hover:text-red-300 transition tracking-wider"
						>关闭</button
					>
				</div>
			</div>

			<div class="flex-1 overflow-y-auto p-4 space-y-5">
				<div class="relative">
					<form id="searchForm">
						<input
							id="searchInput"
							type="text"
							bind:value={searchText}
							placeholder="搜索名字或者效果……"
							class="w-full px-4 py-2.5 pl-10 bg-cyan-950/30 border border-cyan-500/30 rounded-md text-cyan-100 placeholder-cyan-700 focus:outline-none focus:border-cyan-400 transition-all text-sm"
						/>
						<button type="submit" class="hidden">submit</button>
					</form>

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
					<!-- 文本字段 (普通多选) -->
					{@render simpleFilterSection(
						'卡牌类型',
						options.categories,
						selectedCategories,
						toggleCategory
					)}
					{@render simpleFilterSection('稀有度', options.rarities, selectedRarities, toggleRarity)}

					<!-- 数值范围 -->
					{@render rangeSection(
						'法力',
						energyRange,
						options.energy_range.min,
						options.energy_range.max
					)}
					{@render rangeSection(
						'战力',
						powerRange,
						options.power_range.min,
						options.power_range.max
					)}
					{@render rangeSection(
						'符能',
						returnEnergyRange,
						options.return_energy_range.min,
						options.return_energy_range.max
					)}
					<!-- 数组字段 (3态切换) -->
					{@render advancedFilterSection('符文特性', options.colors, colorFilters, cycleColor)}

					{@render advancedFilterSection('关键词', options.keywords, keywordFilters, cycleKeyword)}
					{@render advancedFilterSection(
						'高级标签',
						options.advanced_tags,
						advancedTagFilters,
						cycleAdvTag
					)}

					{@render simpleFilterSection('系列', options.series, selectedSeries, toggleSeries)}
					{@render advancedFilterSection('标签', options.tags, tagFilters, cycleTag)}
					{@render advancedFilterSection('区域', options.regions, regionFilters, cycleRegion)}
				{/if}
			</div>

			<div class="p-4 border-t border-cyan-500/20 bg-black/80">
				<button
					onclick={() => {
						handleSearch(1);
						if (isMobile) isFilterClose = !isFilterClose;
					}}
					disabled={isSearching}
					class="w-full py-3 bg-cyan-500 text-black font-bold rounded hover:bg-cyan-400 shadow-[0_0_15px_rgba(34,211,238,0.4)] disabled:opacity-50 transition-all duration-300 tracking-widest text-sm"
				>
					{isSearching ? '搜索中...' : '搜索'}
				</button>
			</div>
		</div>
	</div>
	<button
		aria-label="搜索"
		onclick={() => {
			isFilterClose = false;
		}}
		class="{isMobile
			? !isFilterClose
				? 'hidden'
				: ''
			: 'hidden'} z-50 fixed right-3 bottom-3 p-5 rounded-full bg-cyan-500 text-black"
	>
		<svg
			class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-black"
			fill="none"
			stroke="currentColor"
			viewBox="0 0 24 24"
		>
			<path
				stroke-linecap="round"
				stroke-linejoin="round"
				stroke-width="3"
				d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
			/>
		</svg>
	</button>
	<CardDetailModal card={selectedCard} onClose={closeCardDetail} />
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
		appearance: textfield;
	}
</style>
