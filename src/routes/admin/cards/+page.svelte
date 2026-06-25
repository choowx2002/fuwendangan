<script lang="ts">
	import { onMount } from 'svelte';
	import { supabase } from '$lib/database/supabaseClient';
	import type { CardBase } from '$lib/types/card';
	import { resolve } from '$app/paths';
	import { goto } from '$app/navigation';

	let cards: CardBase[] = $state([]);
	let isLoading = $state(true);
	let searchQuery = $state('');
	let filterRarity = $state('');
	let filterCategory = $state('');
	let filterBanned = $state('');
	let currentPage = $state(1);
	const pageSize = 50;
	let totalCount = $state(0);

	// Distinct values for filters
	let rarityOptions: string[] = $state([]);
	let categoryOptions: string[] = $state([]);

	onMount(async () => {
		await loadFilters();
		await loadCards();
	});

	async function loadFilters() {
		const { data: rarityData } = await supabase
			.from('cards_base')
			.select('rarity_name')
			.not('rarity_name', 'is', null);
		rarityOptions = [...new Set(rarityData?.map((r) => r.rarity_name).filter(Boolean))] as string[];

		const { data: categoryData } = await supabase
			.from('cards_base')
			.select('card_category')
			.not('card_category', 'is', null);
		categoryOptions = [
			...new Set(categoryData?.map((c) => c.card_category).filter(Boolean))
		] as string[];
	}

	async function loadCards() {
		isLoading = true;
		let query = supabase.from('cards_base').select('*', { count: 'exact' });

		if (searchQuery) {
			query = query.or(
				`card_no.ilike.%${searchQuery}%,card_name_cn.ilike.%${searchQuery}%,card_name_en.ilike.%${searchQuery}%`
			);
		}
		if (filterRarity) {
			query = query.eq('rarity_name', filterRarity);
		}
		if (filterCategory) {
			query = query.eq('card_category', filterCategory);
		}
		if (filterBanned === 'true') {
			query = query.eq('is_banned', true);
		} else if (filterBanned === 'false') {
			query = query.eq('is_banned', false);
		}

		query = query
			.order('card_no', { ascending: true })
			.range((currentPage - 1) * pageSize, currentPage * pageSize - 1);

		const { data, count, error } = await query;

		if (error) {
			console.error('Error loading cards:', error);
		} else {
			cards = data || [];
			totalCount = count || 0;
		}
		isLoading = false;
	}

	function handleSearch() {
		currentPage = 1;
		loadCards();
	}

	function resetFilters() {
		searchQuery = '';
		filterRarity = '';
		filterCategory = '';
		filterBanned = '';
		currentPage = 1;
		loadCards();
	}

	let totalPages = $derived(Math.ceil(totalCount / pageSize));

	function goToPage(page: number) {
		if (page >= 1 && page <= totalPages) {
			currentPage = page;
			loadCards();
		}
	}
</script>

<div class="cards-admin">
	<div class="page-header">
		<h1>卡牌管理</h1>
		<a href={resolve('/admin/cards/new')} class="btn btn-primary">+ 新建卡牌</a>
	</div>

	<!-- Filters -->
	<div class="filters">
		<div class="filter-row">
			<input
				type="text"
				placeholder="搜索编号/名称..."
				bind:value={searchQuery}
				onkeydown={(e) => e.key === 'Enter' && handleSearch()}
				class="search-input"
			/>
			<select bind:value={filterRarity}>
				<option value="">全部稀有度</option>
				{#each rarityOptions as r (r)}
					<option value={r}>{r}</option>
				{/each}
			</select>
			<select bind:value={filterCategory}>
				<option value="">全部类别</option>
				{#each categoryOptions as c (c)}
					<option value={c}>{c}</option>
				{/each}
			</select>
			<select bind:value={filterBanned}>
				<option value="">全部状态</option>
				<option value="false">正常</option>
				<option value="true">已禁用</option>
			</select>
			<button onclick={handleSearch} class="btn btn-secondary">搜索</button>
			<button onclick={resetFilters} class="btn btn-outline">重置</button>
		</div>
		<div class="filter-info">
			共 {totalCount} 条记录
		</div>
	</div>

	<!-- Table -->
	{#if isLoading}
		<div class="loading-state">加载中...</div>
	{:else}
		<div class="table-wrapper text-black">
			<table class="cards-table">
				<thead>
					<tr>
						<th>编号</th>
						<th>中文名</th>
						<th>英文名</th>
						<th>类别</th>
						<th>能量</th>
						<th>战力</th>
						<th>稀有度</th>
						<th>系列</th>
						<th>状态</th>
						<th>操作</th>
					</tr>
				</thead>
				<tbody>
					{#each cards as card, i (i)}
						<tr class:is-banned={card.is_banned}>
							<td class="mono">{card.card_no}</td>
							<td>{card.card_name_cn || '-'}</td>
							<td>{card.card_name_en || '-'}</td>
							<td>
								{#if card.card_category}
									<span class="badge">{card.card_category}</span>
								{:else}
									-
								{/if}
							</td>
							<td>{card.energy ?? '-'}</td>
							<td>{card.power ?? '-'}</td>
							<td>
								{#if card.rarity_name}
									<span class="badge rarity">{card.rarity_name}</span>
								{:else}
									-
								{/if}
							</td>
							<td>{card.series_name || '-'}</td>
							<td>
								{#if card.is_banned}
									<span class="status-banned">禁用</span>
								{:else}
									<span class="status-active">正常</span>
								{/if}
							</td>
							<td>
								<button onclick={() => goto(resolve(`/admin/cards/${card.id}`))} class="btn btn-sm"
									>编辑</button
								>
							</td>
						</tr>
					{:else}
						<tr>
							<td colspan="10" class="empty-state">暂无数据</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>

		<!-- Pagination -->
		{#if totalPages > 1}
			<div class="pagination text-black">
				<button onclick={() => goToPage(currentPage - 1)} disabled={currentPage <= 1}>上一页</button
				>
				<span class="page-info">第 {currentPage} / {totalPages} 页</span>
				<button onclick={() => goToPage(currentPage + 1)} disabled={currentPage >= totalPages}
					>下一页</button
				>
			</div>
		{/if}
	{/if}
</div>

<style>
	.page-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 1.5rem;
	}
	.page-header h1 {
		margin: 0;
		font-size: 1.5rem;
	}
	.filters {
		background: white;
		padding: 1rem;
		border-radius: 8px;
		margin-bottom: 1rem;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
	}
	.filter-row {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
		align-items: center;
	}
	.search-input {
		min-width: 200px;
		padding: 0.5rem;
		border: 1px solid #ddd;
		border-radius: 4px;
	}
	select {
		padding: 0.5rem;
		border: 1px solid #ddd;
		border-radius: 4px;
		background: white;
	}
	.filter-info {
		margin-top: 0.5rem;
		color: #666;
		font-size: 0.85rem;
	}
	.table-wrapper {
		background: white;
		border-radius: 8px;
		overflow-x: auto;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
	}
	.cards-table {
		width: 100%;
		border-collapse: collapse;
	}
	.cards-table th,
	.cards-table td {
		padding: 0.75rem 0.5rem;
		text-align: left;
		border-bottom: 1px solid #eee;
		font-size: 0.9rem;
		white-space: nowrap;
	}
	.cards-table th {
		background: #f8f9fa;
		font-weight: 600;
		position: sticky;
		top: 0;
	}
	.cards-table tr:hover {
		background: #f0f7ff;
	}
	.cards-table tr.is-banned {
		background: #fff5f5;
	}
	.mono {
		font-family: monospace;
		font-weight: 600;
	}
	.badge {
		display: inline-block;
		padding: 0.15rem 0.5rem;
		background: #e8f4fd;
		color: #1976d2;
		border-radius: 12px;
		font-size: 0.8rem;
	}
	.badge.rarity {
		background: #fff3e0;
		color: #e65100;
	}
	.status-active {
		color: #2e7d32;
		font-weight: 500;
	}
	.status-banned {
		color: #c62828;
		font-weight: 500;
	}
	.empty-state {
		text-align: center;
		padding: 2rem;
		color: #999;
	}
	.loading-state {
		text-align: center;
		padding: 2rem;
		color: #666;
	}
	.pagination {
		display: flex;
		justify-content: center;
		align-items: center;
		gap: 1rem;
		margin-top: 1rem;
		padding: 1rem;
	}
	.page-info {
		color: #666;
	}

	/* Buttons */
	.btn {
		display: inline-block;
		padding: 0.5rem 1rem;
		border: none;
		border-radius: 4px;
		cursor: pointer;
		text-decoration: none;
		font-size: 0.9rem;
		transition: background 0.2s;
	}
	.btn-primary {
		background: #1976d2;
		color: white;
	}
	.btn-primary:hover {
		background: #1565c0;
	}
	.btn-secondary {
		background: #455a64;
		color: white;
	}
	.btn-secondary:hover {
		background: #37474f;
	}
	.btn-outline {
		background: white;
		color: #666;
		border: 1px solid #ddd;
	}
	.btn-outline:hover {
		background: #f5f5f5;
	}
	.btn-sm {
		padding: 0.3rem 0.6rem;
		font-size: 0.8rem;
		background: #1976d2;
		color: white;
		border-radius: 4px;
	}
	.btn-sm:hover {
		background: #1565c0;
	}
	button:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
</style>
