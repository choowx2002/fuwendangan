<script lang="ts">
	import { onMount } from 'svelte';
	import type { CardBase } from '$lib/types/card';
	import { resolve } from '$app/paths';
	import { goto } from '$app/navigation';
	import { getAdminCardList } from '$lib/database/cards';

	let cards: CardBase[] = $state([]);
	let isLoading = $state(true);
	let searchQuery = $state('');
	let filterBanned = $state('');
	let currentPage = $state(1);
	const pageSize = 30;
	let totalCount = $state(0);

	onMount(async () => {
		await loadCards();
	});

	async function loadCards() {
		isLoading = true;
		const result = await getAdminCardList(searchQuery, filterBanned, pageSize, currentPage);
		cards = result.data;
		console.log(result);
		totalCount = result.total;
		isLoading = false;
	}

	function handleSearch() {
		currentPage = 1;
		loadCards();
	}

	function resetFilters() {
		searchQuery = '';
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

<div class="max-w-7xl w-full mt-2.5 mx-auto">
	<!-- Filters -->
	<div class="filters">
		<div class="my-4">
			<input
				type="text"
				placeholder="搜索编号/名称..."
				bind:value={searchQuery}
				onkeydown={(e) => e.key === 'Enter' && handleSearch()}
				class=" px-3 py-2 bg-transparent border border-gray-300 rounded text-sm shadow-sm placeholder-white
           focus:outline-none focus:border-cyan-300 focus:ring-1 focus:ring-cyan-300
           disabled:bg-gray-50 disabled:text-gray-500 disabled:border-gray-200 disabled:shadow-none"
			/>
			<select
				bind:value={filterBanned}
				class="px-3 py-2 bg-transparent border border-gray-300 rounded text-sm focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 focus:outline-none"
			>
				<option value="">全部状态</option>
				<option value="false">正常</option>
				<option value="true">已禁用</option>
			</select>
			<button
				onclick={handleSearch}
				class="border-cyan-100 border rounded mx-2 px-2 py-1 cursor-pointer hover:bg-cyan-500 hover:border-cyan-500 hover:text-cyan-950 hover:font-bold"
				>搜索</button
			>
			<button
				onclick={resetFilters}
				class="border-cyan-100 border rounded mx-2 px-2 py-1 cursor-pointer hover:bg-cyan-500 hover:border-cyan-500 hover:text-cyan-950 hover:font-bold"
				>重置</button
			>
			<button
				onclick={() => goto(resolve('/admin/cards/new'))}
				class="border-cyan-100 border rounded mx-2 px-2 py-1 cursor-pointer hover:bg-cyan-500 hover:border-cyan-500 hover:text-cyan-950 hover:font-bold"
				>+ 新建卡牌</button
			>
		</div>
	</div>

	<!-- Table -->
	{#if isLoading}
		<div class="flex items-center justify-center h-full min-h-[70vh]">
			<div
				class="w-8 h-8 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin"
			></div>
		</div>
	{:else}
		<div class="table-wrapper">
			<table class="w-full">
				<thead>
					<tr class="text-left *:px-2.5">
						<th>编号</th>
						<th>中文名</th>
						<th>英文名</th>
						<th>颜色</th>
						<th>类别</th>
						<th>系列</th>
					</tr>
				</thead>
				<tbody>
					{#each cards as card, i (i)}
						<tr
							class="*:px-2.5 hover:bg-gray-400/30 {card.is_banned ? 'bg-red-400/90' : ''}"
							onclick={() => goto(resolve(`/admin/cards/${card.id}`))}
							title="点击编辑"
						>
							<td class="mono">{card.card_no}</td>
							<td>{card.card_name_cn || '-'}</td>
							<td>{card.card_name_en || '-'}</td>
							<td>{card.card_color_list || '-'}</td>
							<td>
								{#if card.card_category}
									<span class="badge">{card.card_category}</span>
								{:else}
									-
								{/if}
							</td>
							<td>{card.series_name || '-'}</td>
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
	{/if}

	{#if totalPages > 1}
		<div class="text-right mt-3 px-10">
			<button
				class="cursor-pointer hover:font-extrabold"
				onclick={() => goToPage(currentPage - 1)}
				disabled={currentPage <= 1}>上一页</button
			>
			<span class="mx-2">第 {currentPage} / {totalPages} 页 ({totalCount}张)</span>
			<button
				class="cursor-pointer hover:font-extrabold"
				onclick={() => goToPage(currentPage + 1)}
				disabled={currentPage >= totalPages}>下一页</button
			>
		</div>
	{/if}
</div>

<style>
</style>
