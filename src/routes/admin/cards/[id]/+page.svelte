<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { supabase } from '$lib/database/supabaseClient';
	import type { CardListItem } from '$lib/types/card';
	import TagInput from '$lib/components/TagInput.svelte';
	import { resolve } from '$app/paths';
	import type { PageProps } from './$types';
	import type { FormState } from '$lib/types/form';
	import { getCardById } from '$lib/database/cards';
	import CardPrintsForm from '$lib/components/CardPrintsForm.svelte';

	// ─── Props ───────────────────────────────────────────────
	let { params }: PageProps = $props();
	const cardId = params.id;

	// ─── State ───────────────────────────────────────────────
	let card = $state<CardListItem | null>(null);
	let isLoading = $state(true);
	let isSaving = $state(false);
	let error = $state('');
	let successMsg = $state('');

	let form = $state<FormState>(createEmptyForm());
	let printsForm: CardPrintsForm;

	// ─── Factories ───────────────────────────────────────────
	function createEmptyForm(): FormState {
		return {
			card_no: '',
			card_name_cn: '',
			card_name_en: '',
			sub_title_cn: '',
			sub_title_en: '',
			card_category: '',
			card_color_list: [],
			region: [],
			tag: [],
			keyword: [],
			advanced_tag: [],
			champion_tag: '',
			effect_cn: '',
			effect_en: '',
			energy: null,
			return_energy: null,
			power: null,
			rarity_name: '',
			series_name: '',
			flavor_text_cn: '',
			flavor_text_en: '',
			is_banned: false
		};
	}

	function formFromData(data: CardListItem): FormState {
		return {
			card_no: data.card_no ?? '',
			card_name_cn: data.card_name_cn ?? '',
			card_name_en: data.card_name_en ?? '',
			sub_title_cn: data.sub_title_cn ?? '',
			sub_title_en: data.sub_title_en ?? '',
			card_category: data.card_category ?? '',
			card_color_list: data.card_color_list ?? [],
			region: data.region ?? [],
			tag: data.tag ?? [],
			keyword: data.keyword ?? [],
			advanced_tag: data.advanced_tag ?? [],
			champion_tag: data.champion_tag ?? '',
			effect_cn: data.effect_cn ?? '',
			effect_en: data.effect_en ?? '',
			energy: data.energy ?? null,
			return_energy: data.return_energy ?? null,
			power: data.power ?? null,
			rarity_name: data.rarity_name ?? '',
			series_name: data.series_name ?? '',
			flavor_text_cn: data.flavor_text_cn ?? '',
			flavor_text_en: data.flavor_text_en ?? '',
			is_banned: data.is_banned ?? false
		};
	}

	// ─── Data Loading ────────────────────────────────────────
	onMount(async () => {
		await loadCard();
	});

	async function loadCard() {
		isLoading = true;
		error = '';

		try {
			const data = await getCardById(cardId);
			card = data;
			form = formFromData(data);
		} catch (e) {
			error = '卡牌未找到或加载失败';
			return;
		} finally {
			setTimeout(() => (isLoading = false), 800);
		}
		await tick();
	}

	// ─── Helpers ─────────────────────────────────────────────
	function nullIfEmpty(val: string): string | null {
		const trimmed = val.trim();
		return trimmed === '' ? null : trimmed;
	}

	function dismissMessage() {
		error = '';
		successMsg = '';
	}

	function showSuccess(msg: string) {
		successMsg = msg;
		setTimeout(() => {
			if (successMsg === msg) successMsg = '';
		}, 3000);
	}

	// ─── Submit ──────────────────────────────────────────────
	async function handleSubmit(ev: SubmitEvent) {
		ev.preventDefault();
		dismissMessage();

		if (!form.card_no.trim()) {
			error = '卡牌编号不能为空';
			return;
		}

		isSaving = true;

		const payload = {
			card_no: form.card_no.trim(),
			card_name_cn: nullIfEmpty(form.card_name_cn),
			card_name_en: nullIfEmpty(form.card_name_en),
			sub_title_cn: nullIfEmpty(form.sub_title_cn),
			sub_title_en: nullIfEmpty(form.sub_title_en),
			card_category: nullIfEmpty(form.card_category),
			card_color_list: form.card_color_list.length > 0 ? form.card_color_list : null,
			region: form.region.length > 0 ? form.region : null,
			tag: form.tag.length > 0 ? form.tag : null,
			keyword: form.keyword.length > 0 ? form.keyword : null,
			advanced_tag: form.advanced_tag.length > 0 ? form.advanced_tag : null,
			champion_tag: nullIfEmpty(form.champion_tag),
			effect_cn: nullIfEmpty(form.effect_cn),
			effect_en: nullIfEmpty(form.effect_en),
			energy: form.energy,
			return_energy: form.return_energy,
			power: form.power,
			rarity_name: nullIfEmpty(form.rarity_name),
			series_name: nullIfEmpty(form.series_name),
			flavor_text_cn: nullIfEmpty(form.flavor_text_cn),
			flavor_text_en: nullIfEmpty(form.flavor_text_en),
			is_banned: form.is_banned,
			updated_at: new Date().toISOString()
		};

		const { error: updateError } = await supabase
			.from('cards_base')
			.update(payload)
			.eq('id', cardId);

		if (updateError) {
			error = updateError.message;
		} else {
			showSuccess('✅ 保存成功！');
			await loadCard();
		}

		isSaving = false;
	}
</script>

<div class="max-w-5xl w-full mx-auto px-4 py-8">
	<!-- Header -->
	<div class="flex items-center justify-between mb-6">
		<h1 class="text-2xl font-bold">编辑卡牌</h1>
		<a
			href={resolve('/admin/cards')}
			class="mx-2 px-2 py-1 cursor-pointer hover:text-cyan-500 hover:font-bold"
		>
			← 返回列表
		</a>
	</div>

	<!-- Messages -->
	{#if error}
		<div
			class="group flex items-center font-extrabold justify-between mb-4 px-4 py-3 text-white border border-cyan-500 rounded-md bg-cyan-800"
		>
			<span>好像有问题！{error || 'Test'}</span>
			<button
				onclick={dismissMessage}
				class="text-red-400 group-hover:text-white text-lg leading-none">&times;</button
			>
		</div>
	{/if}
	{#if successMsg}
		<div
			class="mb-4 px-4 py-3 border border-cyan-500 rounded-md bg-cyan-800 text-white animate-fade-in"
		>
			好消息！{successMsg}
		</div>
	{/if}

	<!-- Loading -->
	{#if isLoading}
		<div class="flex items-center justify-center py-20">
			<div class="flex items-center gap-3">
				<svg class="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none">
					<circle
						class="opacity-25"
						cx="12"
						cy="12"
						r="10"
						stroke="currentColor"
						stroke-width="4"
					/>
					<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
				</svg>
				<span>加载中...</span>
			</div>
		</div>

		<!-- Form -->
	{:else if card}
		<form
			onsubmit={handleSubmit}
			class="rounded-xl shadow-sm space-y-3 font-extrabold bg-black/80 p-6"
		>
			<!-- Meta -->
			<div class="flex flex-wrap items-center gap-6 px-4 py-3 rounded-lg text-sm text-gray-50">
				<span
					>ID: <code class="px-1.5 py-0.5 bg-cyan-500/80 rounded text-[11px] font-mono cursor-copy"
						>{card.id}</code
					></span
				>
				<span>创建: {new Date(card.created_at).toLocaleString('zh-CN')}</span>
				<span>更新: {new Date(card.updated_at).toLocaleString('zh-CN')}</span>
			</div>

			<!-- 基本信息 -->
			<fieldset class="rounded-lg p-5">
				<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-2">
					<div class="flex flex-col gap-1">
						<label for="card_no" class="font-medium">
							卡牌编号 <span class="text-red-500">*</span>
						</label>
						<input
							id="card_no"
							type="text"
							bind:value={form.card_no}
							required
							disabled={isSaving}
							class="bg-transparent px-3 py-2 border border-gray-300 rounded-md text-md focus:outline-none focus:ring-1 focus:ring-cyan-500 focus:border-cyan-500 disabled:bg-gray-100 disabled:text-gray-400"
						/>
					</div>
					<div class="flex flex-col gap-1">
						<label for="card_name_cn" class="text-md font-medium">中文名</label>
						<input
							id="card_name_cn"
							type="text"
							bind:value={form.card_name_cn}
							disabled={isSaving}
							class="bg-transparent px-3 py-2 border border-gray-300 rounded-md text-md focus:outline-none focus:ring-1 focus:ring-cyan-500 focus:border-cyan-500 disabled:bg-gray-100 disabled:text-gray-400"
						/>
					</div>
					<div class="flex flex-col gap-1">
						<label for="card_name_en" class="text-md font-medium">英文名</label>
						<input
							id="card_name_en"
							type="text"
							bind:value={form.card_name_en}
							disabled={isSaving}
							class="bg-transparent px-3 py-2 border border-gray-300 rounded-md text-md focus:outline-none focus:ring-1 focus:ring-cyan-500 focus:border-cyan-500 disabled:bg-gray-100 disabled:text-gray-400"
						/>
					</div>
					<div class="flex flex-col gap-1">
						<label for="sub_title_cn" class="text-md font-medium">副标题(中)</label>
						<input
							id="sub_title_cn"
							type="text"
							bind:value={form.sub_title_cn}
							disabled={isSaving}
							class="bg-transparent px-3 py-2 border border-gray-300 rounded-md text-md focus:outline-none focus:ring-1 focus:ring-cyan-500 focus:border-cyan-500 disabled:bg-gray-100 disabled:text-gray-400"
						/>
					</div>
					<div class="flex flex-col gap-1">
						<label for="sub_title_en" class="text-md font-medium">副标题(英)</label>
						<input
							id="sub_title_en"
							type="text"
							bind:value={form.sub_title_en}
							disabled={isSaving}
							class="bg-transparent px-3 py-2 border border-gray-300 rounded-md text-md focus:outline-none focus:ring-1 focus:ring-cyan-500 focus:border-cyan-500 disabled:bg-gray-100 disabled:text-gray-400"
						/>
					</div>
				</div>
			</fieldset>

			<!-- 分类 -->
			<fieldset class="rounded-lg p-5">
				<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-2">
					<div class="flex flex-col gap-1">
						<label for="card_category" class="text-md font-medium">类别</label>
						<input
							id="card_category"
							type="text"
							bind:value={form.card_category}
							disabled={isSaving}
							class="bg-transparent px-3 py-2 border border-gray-300 rounded-md text-md focus:outline-none focus:ring-1 focus:ring-cyan-500 focus:border-cyan-500 disabled:bg-gray-100 disabled:text-gray-400"
						/>
					</div>
					<div class="flex flex-col gap-1">
						<label for="rarity_name" class="text-md font-medium">稀有度</label>
						<input
							id="rarity_name"
							type="text"
							bind:value={form.rarity_name}
							disabled={isSaving}
							class="bg-transparent px-3 py-2 border border-gray-300 rounded-md text-md focus:outline-none focus:ring-1 focus:ring-cyan-500 focus:border-cyan-500 disabled:bg-gray-100 disabled:text-gray-400"
						/>
					</div>
					<div class="flex flex-col gap-1">
						<label for="series_name" class="text-md font-medium">系列</label>
						<input
							id="series_name"
							type="text"
							bind:value={form.series_name}
							disabled={isSaving}
							class="bg-transparent px-3 py-2 border border-gray-300 rounded-md text-md focus:outline-none focus:ring-1 focus:ring-cyan-500 focus:border-cyan-500 disabled:bg-gray-100 disabled:text-gray-400"
						/>
					</div>
					<div class="flex flex-col gap-1">
						<label for="champion_tag" class="text-md font-medium">英雄标签</label>
						<input
							id="champion_tag"
							type="text"
							bind:value={form.champion_tag}
							disabled={isSaving}
							class="bg-transparent px-3 py-2 border border-gray-300 rounded-md text-md focus:outline-none focus:ring-1 focus:ring-cyan-500 focus:border-cyan-500 disabled:bg-gray-100 disabled:text-gray-400"
						/>
					</div>
				</div>

				<!-- Tags -->
				<div class="grid grid-cols-1 gap-4 mt-4">
					<div class="flex flex-col gap-1">
						<label for="color" class="text-md font-medium">颜色列表</label>
						<TagInput bind:tags={form.card_color_list} disabled={isSaving} />
					</div>
					<div class="flex flex-col gap-1">
						<label for="region" class="text-md font-medium">地区</label>
						<TagInput bind:tags={form.region} disabled={isSaving} />
					</div>
					<div class="flex flex-col gap-1">
						<label for="tag" class="text-md font-medium">标签</label>
						<TagInput bind:tags={form.tag} disabled={isSaving} />
					</div>
					<div class="flex flex-col gap-1">
						<label for="keyword" class="text-md font-medium">关键词</label>
						<TagInput bind:tags={form.keyword} disabled={isSaving} />
					</div>
					<div class="flex flex-col gap-1">
						<label for="advanced_tag" class="text-md font-medium">高级标签</label>
						<TagInput bind:tags={form.advanced_tag} disabled={isSaving} />
					</div>
				</div>
			</fieldset>

			<!-- 数值 -->
			<fieldset class="rounded-lg p-5">
				<div class="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-2">
					<div class="flex flex-col gap-1">
						<label for="energy" class="text-md font-medium">法力</label>
						<input
							id="energy"
							type="number"
							bind:value={form.energy}
							disabled={isSaving}
							class="bg-transparent px-3 py-2 border border-gray-300 rounded-md text-md focus:outline-none focus:ring-1 focus:ring-cyan-500 focus:border-cyan-500 disabled:bg-gray-100 disabled:text-gray-400"
						/>
					</div>
					<div class="flex flex-col gap-1">
						<label for="return_energy" class="text-md font-medium">符能</label>
						<input
							id="return_energy"
							type="number"
							bind:value={form.return_energy}
							disabled={isSaving}
							class="bg-transparent px-3 py-2 border border-gray-300 rounded-md text-md focus:outline-none focus:ring-1 focus:ring-cyan-500 focus:border-cyan-500 disabled:bg-gray-100 disabled:text-gray-400"
						/>
					</div>
					<div class="flex flex-col gap-1">
						<label for="power" class="text-md font-medium">战力</label>
						<input
							id="power"
							type="number"
							bind:value={form.power}
							disabled={isSaving}
							class="bg-transparent px-3 py-2 border border-gray-300 rounded-md text-md focus:outline-none focus:ring-1 focus:ring-cyan-500 focus:border-cyan-500 disabled:bg-gray-100 disabled:text-gray-400"
						/>
					</div>
				</div>
			</fieldset>

			<!-- 效果与描述 -->
			<fieldset class="rounded-lg p-5">
				<div class="space-y-4 mt-2">
					<div class="flex flex-col gap-1">
						<label for="effect_cn" class="text-md font-medium">效果(中)</label>
						<textarea
							id="effect_cn"
							bind:value={form.effect_cn}
							rows="4"
							disabled={isSaving}
							class="bg-transparent px-3 py-2 border border-gray-300 rounded-md text-md focus:outline-none focus:ring-1 focus:ring-cyan-500 focus:border-cyan-500 disabled:bg-gray-100 disabled:text-gray-400"
						></textarea>
					</div>
					<div class="flex flex-col gap-1">
						<label for="effect_en" class="text-md font-medium">效果(英)</label>
						<textarea
							id="effect_en"
							bind:value={form.effect_en}
							rows="4"
							disabled={isSaving}
							class="bg-transparent px-3 py-2 border border-gray-300 rounded-md text-md focus:outline-none focus:ring-1 focus:ring-cyan-500 focus:border-cyan-500 disabled:bg-gray-100 disabled:text-gray-400"
						></textarea>
					</div>
					<div class="flex flex-col gap-1">
						<label for="flavor_text_cn" class="text-md font-medium">风味文本(中)</label>
						<textarea
							id="flavor_text_cn"
							bind:value={form.flavor_text_cn}
							rows="3"
							disabled={isSaving}
							class="bg-transparent px-3 py-2 border border-gray-300 rounded-md text-md focus:outline-none focus:ring-1 focus:ring-cyan-500 focus:border-cyan-500 disabled:bg-gray-100 disabled:text-gray-400"
						></textarea>
					</div>
					<div class="flex flex-col gap-1">
						<label for="flavor_text_en" class="text-md font-medium">风味文本(英)</label>
						<textarea
							id="flavor_text_en"
							bind:value={form.flavor_text_en}
							rows="3"
							disabled={isSaving}
							class="bg-transparent px-3 py-2 border border-gray-300 rounded-md text-md focus:outline-none focus:ring-1 focus:ring-cyan-500 focus:border-cyan-500 disabled:bg-gray-100 disabled:text-gray-400"
						></textarea>
					</div>
				</div>
			</fieldset>

			<!-- 状态 -->
			<fieldset class="rounded-lg p-5">
				<label class="inline-flex items-center gap-2 mt-2 cursor-pointer select-none">
					<input
						type="checkbox"
						bind:checked={form.is_banned}
						disabled={isSaving}
						class="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
					/>
					<span class="text-sm">禁用此卡牌</span>
				</label>
			</fieldset>

			<!-- Actions -->
			<div class="flex items-center gap-3 pt-4 border-t border-gray-200">
				<button
					type="submit"
					disabled={isSaving}
					class="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
				>
					{#if isSaving}
						<svg class="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
							<circle
								class="opacity-25"
								cx="12"
								cy="12"
								r="10"
								stroke="currentColor"
								stroke-width="4"
							/>
							<path
								class="opacity-75"
								fill="currentColor"
								d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
							/>
						</svg>
						保存中...
					{:else}
						保存修改
					{/if}
				</button>
				<a href={resolve('/admin/cards')} class="text-sm"> 取消 </a>
			</div>
		</form>

		<div class="mt-2">
			<!-- ✅ 绑定组件实例 -->
			<CardPrintsForm bind:this={printsForm} initialPrints={card?.card_prints || []} {cardId} />
		</div>
	{/if}
</div>
