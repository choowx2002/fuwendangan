<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { supabase } from '$lib/database/supabaseClient';
	import type { CardBase } from '$lib/types/card';
	import TagInput from '$lib/components/TagInput.svelte';
	import { resolve } from '$app/paths';
	import type { PageProps } from './$types';

	// ─── Types ───────────────────────────────────────────────
	interface FormState {
		card_no: string;
		card_name_cn: string;
		card_name_en: string;
		sub_title_cn: string;
		sub_title_en: string;
		card_category: string;
		card_color_list: string[];
		region: string[];
		tag: string[];
		keyword: string[];
		advanced_tag: string[];
		champion_tag: string;
		effect_cn: string;
		effect_en: string;
		energy: number | null;
		return_energy: number | null;
		power: number | null;
		rarity_name: string;
		series_name: string;
		flavor_text_cn: string;
		flavor_text_en: string;
		is_banned: boolean;
	}

	// ─── Props ───────────────────────────────────────────────
	let { params }: PageProps = $props();
	const cardId = params.id;

	// ─── State ───────────────────────────────────────────────
	let card = $state<CardBase | null>(null);
	let isLoading = $state(true);
	let isSaving = $state(false);
	let error = $state('');
	let successMsg = $state('');

	let form = $state<FormState>(createEmptyForm());

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

	function formFromData(data: CardBase): FormState {
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

		const { data, error: fetchError } = await supabase
			.from('cards_base')
			.select('*')
			.eq('id', cardId)
			.single();

		if (fetchError || !data) {
			error = '卡牌未找到或加载失败';
			isLoading = false;
			return;
		}

		card = data;
		// ✅ 整体赋值，触发 Svelte 5 完整响应式更新
		form = formFromData(data);
		isLoading = false;

		// 确保 DOM 更新完成
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

<div class="max-w-5xl mx-auto px-4 py-8 text-black">
	<!-- Header -->
	<div class="flex items-center justify-between mb-6">
		<h1 class="text-2xl font-bold text-gray-900">✏️ 编辑卡牌</h1>
		<a
			href={resolve('/admin/cards')}
			class="inline-flex items-center gap-1 px-4 py-2 text-sm font-medium text-gray-600 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
		>
			← 返回列表
		</a>
	</div>

	<!-- Messages -->
	{#if error}
		<div
			class="flex items-center justify-between mb-4 px-4 py-3 bg-red-50 text-red-800 border border-red-200 rounded-md"
		>
			<span>❌ {error}</span>
			<button onclick={dismissMessage} class="text-red-400 hover:text-red-600 text-lg leading-none"
				>&times;</button
			>
		</div>
	{/if}
	{#if successMsg}
		<div
			class="mb-4 px-4 py-3 bg-green-50 text-green-800 border border-green-200 rounded-md animate-fade-in"
		>
			{successMsg}
		</div>
	{/if}

	<!-- Loading -->
	{#if isLoading}
		<div class="flex items-center justify-center py-20">
			<div class="flex items-center gap-3 text-gray-500">
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
			class="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-6"
		>
			<!-- Meta -->
			<div class="flex flex-wrap gap-6 px-4 py-3 bg-gray-50 rounded-lg text-xs text-gray-500">
				<span
					>ID: <code class="px-1.5 py-0.5 bg-gray-200 rounded text-[11px] font-mono">{card.id}</code
					></span
				>
				<span>创建: {new Date(card.created_at).toLocaleString('zh-CN')}</span>
				<span>更新: {new Date(card.updated_at).toLocaleString('zh-CN')}</span>
			</div>

			<!-- 基本信息 -->
			<fieldset class="border border-gray-200 rounded-lg p-5">
				<legend class="px-2 text-sm font-semibold text-gray-700">基本信息</legend>
				<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-2">
					<div class="flex flex-col gap-1">
						<label for="card_no" class="text-sm font-medium text-gray-600">
							卡牌编号 <span class="text-red-500">*</span>
						</label>
						<input
							id="card_no"
							type="text"
							bind:value={form.card_no}
							required
							disabled={isSaving}
							class="px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100 disabled:text-gray-400"
						/>
					</div>
					<div class="flex flex-col gap-1">
						<label for="card_name_cn" class="text-sm font-medium text-gray-600">中文名</label>
						<input
							id="card_name_cn"
							type="text"
							bind:value={form.card_name_cn}
							disabled={isSaving}
							class="px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100"
						/>
					</div>
					<div class="flex flex-col gap-1">
						<label for="card_name_en" class="text-sm font-medium text-gray-600">英文名</label>
						<input
							id="card_name_en"
							type="text"
							bind:value={form.card_name_en}
							disabled={isSaving}
							class="px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100"
						/>
					</div>
					<div class="flex flex-col gap-1">
						<label for="sub_title_cn" class="text-sm font-medium text-gray-600">副标题(中)</label>
						<input
							id="sub_title_cn"
							type="text"
							bind:value={form.sub_title_cn}
							disabled={isSaving}
							class="px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100"
						/>
					</div>
					<div class="flex flex-col gap-1">
						<label for="sub_title_en" class="text-sm font-medium text-gray-600">副标题(英)</label>
						<input
							id="sub_title_en"
							type="text"
							bind:value={form.sub_title_en}
							disabled={isSaving}
							class="px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100"
						/>
					</div>
				</div>
			</fieldset>

			<!-- 分类 -->
			<fieldset class="border border-gray-200 rounded-lg p-5">
				<legend class="px-2 text-sm font-semibold text-gray-700">分类</legend>
				<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-2">
					<div class="flex flex-col gap-1">
						<label for="card_category" class="text-sm font-medium text-gray-600">类别</label>
						<input
							id="card_category"
							type="text"
							bind:value={form.card_category}
							disabled={isSaving}
							class="px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100"
						/>
					</div>
					<div class="flex flex-col gap-1">
						<label for="rarity_name" class="text-sm font-medium text-gray-600">稀有度</label>
						<input
							id="rarity_name"
							type="text"
							bind:value={form.rarity_name}
							disabled={isSaving}
							class="px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100"
						/>
					</div>
					<div class="flex flex-col gap-1">
						<label for="series_name" class="text-sm font-medium text-gray-600">系列</label>
						<input
							id="series_name"
							type="text"
							bind:value={form.series_name}
							disabled={isSaving}
							class="px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100"
						/>
					</div>
					<div class="flex flex-col gap-1">
						<label for="champion_tag" class="text-sm font-medium text-gray-600">冠军标签</label>
						<input
							id="champion_tag"
							type="text"
							bind:value={form.champion_tag}
							disabled={isSaving}
							class="px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100"
						/>
					</div>
				</div>

				<!-- Tags -->
				<div class="grid grid-cols-1 gap-4 mt-4">
					<div class="flex flex-col gap-1">
						<label class="text-sm font-medium text-gray-600">颜色列表</label>
						<TagInput bind:tags={form.card_color_list} disabled={isSaving} />
					</div>
					<div class="flex flex-col gap-1">
						<label class="text-sm font-medium text-gray-600">地区</label>
						<TagInput bind:tags={form.region} disabled={isSaving} />
					</div>
					<div class="flex flex-col gap-1">
						<label class="text-sm font-medium text-gray-600">标签</label>
						<TagInput bind:tags={form.tag} disabled={isSaving} />
					</div>
					<div class="flex flex-col gap-1">
						<label class="text-sm font-medium text-gray-600">关键词</label>
						<TagInput bind:tags={form.keyword} disabled={isSaving} />
					</div>
					<div class="flex flex-col gap-1">
						<label class="text-sm font-medium text-gray-600">高级标签</label>
						<TagInput bind:tags={form.advanced_tag} disabled={isSaving} />
					</div>
				</div>
			</fieldset>

			<!-- 数值 -->
			<fieldset class="border border-gray-200 rounded-lg p-5">
				<legend class="px-2 text-sm font-semibold text-gray-700">数值</legend>
				<div class="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-2">
					<div class="flex flex-col gap-1">
						<label for="energy" class="text-sm font-medium text-gray-600">能量</label>
						<input
							id="energy"
							type="number"
							bind:value={form.energy}
							disabled={isSaving}
							class="px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100"
						/>
					</div>
					<div class="flex flex-col gap-1">
						<label for="return_energy" class="text-sm font-medium text-gray-600">回复能量</label>
						<input
							id="return_energy"
							type="number"
							bind:value={form.return_energy}
							disabled={isSaving}
							class="px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100"
						/>
					</div>
					<div class="flex flex-col gap-1">
						<label for="power" class="text-sm font-medium text-gray-600">战力</label>
						<input
							id="power"
							type="number"
							bind:value={form.power}
							disabled={isSaving}
							class="px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100"
						/>
					</div>
				</div>
			</fieldset>

			<!-- 效果与描述 -->
			<fieldset class="border border-gray-200 rounded-lg p-5">
				<legend class="px-2 text-sm font-semibold text-gray-700">效果与描述</legend>
				<div class="space-y-4 mt-2">
					<div class="flex flex-col gap-1">
						<label for="effect_cn" class="text-sm font-medium text-gray-600">效果(中)</label>
						<textarea
							id="effect_cn"
							bind:value={form.effect_cn}
							rows="4"
							disabled={isSaving}
							class="px-3 py-2 border border-gray-300 rounded-md text-sm font-family-inherit resize-y focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100"
						/>
					</div>
					<div class="flex flex-col gap-1">
						<label for="effect_en" class="text-sm font-medium text-gray-600">效果(英)</label>
						<textarea
							id="effect_en"
							bind:value={form.effect_en}
							rows="4"
							disabled={isSaving}
							class="px-3 py-2 border border-gray-300 rounded-md text-sm font-family-inherit resize-y focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100"
						/>
					</div>
					<div class="flex flex-col gap-1">
						<label for="flavor_text_cn" class="text-sm font-medium text-gray-600"
							>风味文本(中)</label
						>
						<textarea
							id="flavor_text_cn"
							bind:value={form.flavor_text_cn}
							rows="3"
							disabled={isSaving}
							class="px-3 py-2 border border-gray-300 rounded-md text-sm font-family-inherit resize-y focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100"
						/>
					</div>
					<div class="flex flex-col gap-1">
						<label for="flavor_text_en" class="text-sm font-medium text-gray-600"
							>风味文本(英)</label
						>
						<textarea
							id="flavor_text_en"
							bind:value={form.flavor_text_en}
							rows="3"
							disabled={isSaving}
							class="px-3 py-2 border border-gray-300 rounded-md text-sm font-family-inherit resize-y focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100"
						/>
					</div>
				</div>
			</fieldset>

			<!-- 状态 -->
			<fieldset class="border border-gray-200 rounded-lg p-5">
				<legend class="px-2 text-sm font-semibold text-gray-700">状态</legend>
				<label class="inline-flex items-center gap-2 mt-2 cursor-pointer select-none">
					<input
						type="checkbox"
						bind:checked={form.is_banned}
						disabled={isSaving}
						class="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
					/>
					<span class="text-sm text-gray-700">禁用此卡牌</span>
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
				<a
					href={resolve('/admin/cards')}
					class="inline-flex items-center px-5 py-2.5 text-sm font-medium text-gray-600 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
				>
					取消
				</a>
			</div>
		</form>
	{/if}
</div>
