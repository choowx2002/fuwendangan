import type { CardFilterOptions, CardSearchParams, CardSearchResult } from '$lib/types/card';
import { applyArrayFilter, applyTextFilter, applyNumberFilter } from './helpers';
import { supabase } from './supabaseClient';

export async function searchCards(params: CardSearchParams): Promise<CardSearchResult> {
	const {
		page = 1,
		pageSize = 20,
		searchText,
		is_banned = false, // 默认不展示禁卡
		...filters
	} = params;

	const from = (page - 1) * pageSize;
	const to = from + pageSize - 1;

	let query = supabase
		.from('cards_base')
		.select('*, card_prints(*)', { count: 'exact' })
		.range(from, to);

	// 1. 模糊搜索 (中英文名称、效果)
	if (searchText && searchText.trim() !== '') {
		const safeText = searchText.trim().replace(/[%_]/g, '\\$&');
		query = query.or(
			`card_name_cn.ilike.%${safeText}%,` +
				`card_name_en.ilike.%${safeText}%,` +
				`effect_cn.ilike.%${safeText}%,` +
				`champion_tag.ilike.%${safeText}%,` +
				`effect_en.ilike.%${safeText}%`
		);
	}

	// 2. 应用数组字段过滤
	query = applyArrayFilter(query, 'region', filters.region);
	query = applyArrayFilter(query, 'tag', filters.tag);
	query = applyArrayFilter(query, 'keyword', filters.keyword);
	query = applyArrayFilter(query, 'advanced_tag', filters.advanced_tag);
	query = applyArrayFilter(query, 'card_color_list', filters.card_color_list);

	// 3. 应用文本字段过滤
	query = applyTextFilter(query, 'card_category', filters.card_category);
	query = applyTextFilter(query, 'series_name', filters.series_name);
	query = applyTextFilter(query, 'rarity_name', filters.rarity_name);

	// 4. 应用数值范围过滤
	query = applyNumberFilter(query, 'power', filters.power);
	query = applyNumberFilter(query, 'energy', filters.energy);
	query = applyNumberFilter(query, 'return_energy', filters.return_energy);

	// 5. 默认排序
	query = query
		.order('print_order', { foreignTable: 'card_prints', ascending: true })
		.order('card_no', { ascending: true });

	const { data, error, count } = await query;

	if (error) throw error;

	return {
		data: data || [],
		total: count || 0,
		page,
		pageSize,
		totalPages: Math.ceil((count || 0) / pageSize)
	};
}

export async function getCardFilterOptions(): Promise<CardFilterOptions> {
	// 直接查询物理表，获取 id=1 的那唯一一行数据
	const { data, error } = await supabase
		.from('card_filter_options')
		.select('*')
		.eq('id', 1)
		.single(); // 确保只返回一条记录

	if (error) {
		console.error('Fetch filter options error:', error);
		throw error;
	}

	// 因为表字段名和前端类型完全一致，直接返回即可
	return data as unknown as CardFilterOptions;
}
