<!-- src/routes/admin/cards/[id]/+page.svelte -->
<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { supabase } from '$lib/database/supabaseClient';
	import type { CardBase } from '$lib/types/card';
	import TagInput from '$lib/components/TagInput.svelte';
	import { page } from '$app/state';

	let card: CardBase | null = null;
	let isLoading = true;
	let isSaving = false;
	let error = '';
	let successMsg = '';

	let form = {
		card_no: '',
		card_name_cn: '',
		card_name_en: '',
		sub_title_cn: '',
		sub_title_en: '',
		card_category: '',
		card_color_list: [] as string[],
		region: [] as string[],
		tag: [] as string[],
		keyword: [] as string[],
		advanced_tag: [] as string[],
		champion_tag: '',
		effect_cn: '',
		effect_en: '',
		energy: null as number | null,
		return_energy: null as number | null,
		power: null as number | null,
		rarity_name: '',
		series_name: '',
		flavor_text_cn: '',
		flavor_text_en: '',
		is_banned: false
	};

	const cardId = $page.params.id;

	onMount(async () => {
		await loadCard();
	});

	async function loadCard() {
		isLoading = true;
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
		populateForm(data);
		isLoading = false;
	}

	function populateForm(data: CardBase) {
		form.card_no = data.card_no || '';
		form.card_name_cn = data.card_name_cn || '';
		form.card_name_en = data.card_name_en || '';
		form.sub_title_cn = data.sub_title_cn || '';
		form.sub_title_en = data.sub_title_en || '';
		form.card_category = data.card_category || '';
		form.card_color_list = data.card_color_list || [];
		form.region = data.region || [];
		form.tag = data.tag || [];
		form.keyword = data.keyword || [];
		form.advanced_tag = data.advanced_tag || [];
		form.champion_tag = data.champion_tag || '';
		form.effect_cn = data.effect_cn || '';
		form.effect_en = data.effect_en || '';
		form.energy = data.energy;
		form.return_energy = data.return_energy;
		form.power = data.power;
		form.rarity_name = data.rarity_name || '';
		form.series_name = data.series_name || '';
		form.flavor_text_cn = data.flavor_text_cn || '';
		form.flavor_text_en = data.flavor_text_en || '';
		form.is_banned = data.is_banned || false;
	}

	function nullIfEmpty(val: string): string | null {
		return val.trim() === '' ? null : val.trim();
	}

	async function handleSubmit() {
		if (!form.card_no.trim()) {
			error = '卡牌编号不能为空';
			return;
		}

		isSaving = true;
		error = '';
		successMsg = '';

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
			successMsg = '✅ 保存成功！';
			await loadCard(); // Reload to reflect changes
		}
		isSaving = false;
	}
</script>

<div class="card-detail-page">
	<div class="page-header">
		<h1>✏️ 编辑卡牌</h1>
		<div class="header-actions">
			<a href="/admin/cards" class="btn btn-outline">← 返回列表</a>
		</div>
	</div>

	{#if error}
		<div class="error-banner">❌ {error}</div>
	{/if}
	{#if successMsg}
		<div class="success-banner">{successMsg}</div>
	{/if}

	{#if isLoading}
		<div class="loading-state">加载中...</div>
	{:else if card}
		<form on:submit|preventDefault={handleSubmit} class="card-form">
			<!-- Meta Info -->
			<div class="meta-info">
				<span>ID: <code>{card.id}</code></span>
				<span>创建: {new Date(card.created_at).toLocaleString('zh-CN')}</span>
				<span>更新: {new Date(card.updated_at).toLocaleString('zh-CN')}</span>
			</div>

			<!-- Basic Info -->
			<fieldset>
				<legend>基本信息</legend>
				<div class="form-grid">
					<div class="form-group required">
						<label for="card_no">卡牌编号</label>
						<input id="card_no" type="text" bind:value={form.card_no} required />
					</div>
					<div class="form-group">
						<label for="card_name_cn">中文名</label>
						<input id="card_name_cn" type="text" bind:value={form.card_name_cn} />
					</div>
					<div class="form-group">
						<label for="card_name_en">英文名</label>
						<input id="card_name_en" type="text" bind:value={form.card_name_en} />
					</div>
					<div class="form-group">
						<label for="sub_title_cn">副标题(中)</label>
						<input id="sub_title_cn" type="text" bind:value={form.sub_title_cn} />
					</div>
					<div class="form-group">
						<label for="sub_title_en">副标题(英)</label>
						<input id="sub_title_en" type="text" bind:value={form.sub_title_en} />
					</div>
				</div>
			</fieldset>

			<!-- Classification -->
			<fieldset>
				<legend>分类</legend>
				<div class="form-grid">
					<div class="form-group">
						<label for="card_category">类别</label>
						<input id="card_category" type="text" bind:value={form.card_category} />
					</div>
					<div class="form-group">
						<label for="rarity_name">稀有度</label>
						<input id="rarity_name" type="text" bind:value={form.rarity_name} />
					</div>
					<div class="form-group">
						<label for="series_name">系列</label>
						<input id="series_name" type="text" bind:value={form.series_name} />
					</div>
					<div class="form-group">
						<label for="champion_tag">冠军标签</label>
						<input id="champion_tag" type="text" bind:value={form.champion_tag} />
					</div>
				</div>
				<div class="form-grid">
					<div class="form-group full-width">
						<label>颜色列表</label>
						<TagInput bind:tags={form.card_color_list} />
					</div>
					<div class="form-group full-width">
						<label>地区</label>
						<TagInput bind:tags={form.region} />
					</div>
					<div class="form-group full-width">
						<label>标签</label>
						<TagInput bind:tags={form.tag} />
					</div>
					<div class="form-group full-width">
						<label>关键词</label>
						<TagInput bind:tags={form.keyword} />
					</div>
					<div class="form-group full-width">
						<label>高级标签</label>
						<TagInput bind:tags={form.advanced_tag} />
					</div>
				</div>
			</fieldset>

			<!-- Stats -->
			<fieldset>
				<legend>数值</legend>
				<div class="form-grid">
					<div class="form-group">
						<label for="energy">能量</label>
						<input id="energy" type="number" bind:value={form.energy} />
					</div>
					<div class="form-group">
						<label for="return_energy">回复能量</label>
						<input id="return_energy" type="number" bind:value={form.return_energy} />
					</div>
					<div class="form-group">
						<label for="power">战力</label>
						<input id="power" type="number" bind:value={form.power} />
					</div>
				</div>
			</fieldset>

			<!-- Text Fields -->
			<fieldset>
				<legend>效果与描述</legend>
				<div class="form-group">
					<label for="effect_cn">效果(中)</label>
					<textarea id="effect_cn" bind:value={form.effect_cn} rows="4"></textarea>
				</div>
				<div class="form-group">
					<label for="effect_en">效果(英)</label>
					<textarea id="effect_en" bind:value={form.effect_en} rows="4"></textarea>
				</div>
				<div class="form-group">
					<label for="flavor_text_cn">风味文本(中)</label>
					<textarea id="flavor_text_cn" bind:value={form.flavor_text_cn} rows="3"></textarea>
				</div>
				<div class="form-group">
					<label for="flavor_text_en">风味文本(英)</label>
					<textarea id="flavor_text_en" bind:value={form.flavor_text_en} rows="3"></textarea>
				</div>
			</fieldset>

			<!-- Status -->
			<fieldset>
				<legend>状态</legend>
				<div class="form-group checkbox-group">
					<label>
						<input type="checkbox" bind:checked={form.is_banned} />
						禁用此卡牌
					</label>
				</div>
			</fieldset>

			<div class="form-actions">
				<button type="submit" class="btn btn-primary" disabled={isSaving}>
					{isSaving ? '保存中...' : '💾 保存修改'}
				</button>
				<a href="/admin/cards" class="btn btn-outline">取消</a>
			</div>
		</form>
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
	.header-actions {
		display: flex;
		gap: 0.5rem;
	}
	.error-banner {
		background: #ffebee;
		color: #c62828;
		padding: 0.75rem 1rem;
		border-radius: 4px;
		margin-bottom: 1rem;
		border: 1px solid #ef9a9a;
	}
	.success-banner {
		background: #e8f5e9;
		color: #2e7d32;
		padding: 0.75rem 1rem;
		border-radius: 4px;
		margin-bottom: 1rem;
		border: 1px solid #a5d6a7;
	}
	.meta-info {
		display: flex;
		gap: 1.5rem;
		padding: 0.75rem 1rem;
		background: #f5f5f5;
		border-radius: 4px;
		margin-bottom: 1rem;
		font-size: 0.8rem;
		color: #666;
		flex-wrap: wrap;
	}
	.meta-info code {
		font-size: 0.75rem;
		background: #e0e0e0;
		padding: 0.1rem 0.3rem;
		border-radius: 2px;
	}
	.loading-state {
		text-align: center;
		padding: 2rem;
		color: #666;
	}
	.card-form {
		background: white;
		border-radius: 8px;
		padding: 1.5rem;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
	}
	fieldset {
		border: 1px solid #e0e0e0;
		border-radius: 8px;
		padding: 1rem 1.5rem;
		margin-bottom: 1.5rem;
	}
	legend {
		font-weight: 600;
		padding: 0 0.5rem;
		color: #333;
	}
	.form-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
		gap: 1rem;
		margin-bottom: 1rem;
	}
	.form-group {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
	}
	.form-group.full-width {
		grid-column: 1 / -1;
	}
	.form-group.required label::after {
		content: ' *';
		color: #e53935;
	}
	label {
		font-size: 0.85rem;
		font-weight: 500;
		color: #555;
	}
	input[type='text'],
	input[type='number'],
	textarea,
	select {
		padding: 0.5rem;
		border: 1px solid #ddd;
		border-radius: 4px;
		font-size: 0.9rem;
		font-family: inherit;
	}
	input:focus,
	textarea:focus,
	select:focus {
		outline: none;
		border-color: #1976d2;
		box-shadow: 0 0 0 2px rgba(25, 118, 210, 0.2);
	}
	.checkbox-group label {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		cursor: pointer;
	}
	.form-actions {
		display: flex;
		gap: 1rem;
		padding-top: 1rem;
		border-top: 1px solid #eee;
	}
	.btn {
		display: inline-block;
		padding: 0.6rem 1.2rem;
		border: none;
		border-radius: 4px;
		cursor: pointer;
		text-decoration: none;
		font-size: 0.9rem;
	}
	.btn-primary {
		background: #1976d2;
		color: white;
	}
	.btn-primary:hover {
		background: #1565c0;
	}
	.btn-primary:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}
	.btn-outline {
		background: white;
		color: #666;
		border: 1px solid #ddd;
	}
	.btn-outline:hover {
		background: #f5f5f5;
	}
</style>
