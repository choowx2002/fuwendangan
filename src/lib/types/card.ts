export interface ArrayFilter {
	all?: string[]; // 必须同时包含 (AND) -> PostgREST: cs
	any?: string[]; // 包含任意一个 (OR) -> PostgREST: ov
	none?: string[]; // 不能包含其中任何一个 (AND NOT) -> PostgREST: 逐个 not.cs
}

// 数值字段过滤模型 (适用于 power, energy, return_energy)
export interface NumberRange {
	eq?: number; // 精确等于
	gte?: number; // 大于等于 (>=)
	lte?: number; // 小于等于 (<=)
}

// 综合查询参数
export interface CardSearchParams {
	page?: number;
	pageSize?: number;
	searchText?: string; // 模糊搜索：中英文名称、效果

	// 1. 数组字段过滤
	region?: ArrayFilter;
	tag?: ArrayFilter;
	keyword?: ArrayFilter; // 注意：这是表里的 keyword 数组字段，不是搜索词
	advanced_tag?: ArrayFilter;
	card_color_list?: ArrayFilter;

	// 2. 文本/枚举字段过滤 (支持单选或多选 IN)
	card_category?: string | string[];
	series_name?: string | string[];
	rarity_name?: string | string[];

	// 3. 数值范围过滤
	power?: NumberRange;
	energy?: NumberRange;
	return_energy?: NumberRange;

	// 4. 其他
	is_banned?: boolean; // 默认建议过滤掉 banned 卡
}

export interface CardListItem {
	id: string;
	card_no: string;
	card_name_cn: string;
	card_name_en: string | null;
	sub_title_cn: string | null;
	sub_title_en: string | null;

	card_category: string;
	card_color_list: string[];

	region: string[];
	tag: string[];

	keyword: string[];
	advanced_tag: string | null;

	champion_tag: string | null;

	effect_cn: string;
	effect_en: string | null;

	energy: number;
	return_energy: number;
	power: number;

	rarity_name: string;
	series_name: string;

	flavor_text_cn: string | null;
	flavor_text_en: string | null;

	is_banned: boolean;

	created_at: string;
	updated_at: string;

	card_prints: CardPrint[];
}

export interface CardPrint {
	id: string;
	artist: string;
	card_id: string;

	img_cdn: string;
	tts_cdn: string;
	back_image: string;

	language: string;

	created_at: string;
	is_default: boolean;

	print_order: number;

	rarity_name: string;
	card_no_extend: string;
	extend_rarity_name: string;
}

export type CardListResponse = CardListItem[];

export interface CardSearchResult {
	data: CardListItem[];
	total: number;
	page: number;
	pageSize: number;
	totalPages: number;
}

export interface NumberRangeOption {
	min: number;
	max: number;
}

export interface CardFilterOptions {
	regions: string[];
	tags: string[];
	keywords: string[];
	advanced_tags: string[];
	colors: string[];
	categories: string[];
	series: string[];
	rarities: string[];
	champions: string[];
	energy_range: NumberRangeOption;
	power_range: NumberRangeOption;
	return_energy_range: NumberRangeOption;
}

// src/lib/types.ts
export interface CardBase {
	id: string;
	card_no: string;
	card_name_cn: string | null;
	card_name_en: string | null;
	sub_title_cn: string | null;
	sub_title_en: string | null;
	card_category: string | null;
	card_color_list: string[] | null;
	region: string[] | null;
	tag: string[] | null;
	keyword: string[] | null;
	advanced_tag: string[] | null;
	champion_tag: string | null;
	effect_cn: string | null;
	effect_en: string | null;
	energy: number | null;
	return_energy: number | null;
	power: number | null;
	rarity_name: string | null;
	series_name: string | null;
	flavor_text_cn: string | null;
	flavor_text_en: string | null;
	is_banned: boolean;
	created_at: string;
	updated_at: string;
}

export type CardFormData = Omit<CardBase, 'id' | 'created_at' | 'updated_at'>;