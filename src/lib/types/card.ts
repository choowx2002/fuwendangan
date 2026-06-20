export interface ArrayFilter {
    all?: string[];  // 必须同时包含 (AND) -> PostgREST: cs
    any?: string[];  // 包含任意一个 (OR) -> PostgREST: ov
    none?: string[]; // 不能包含其中任何一个 (AND NOT) -> PostgREST: 逐个 not.cs
}

// 数值字段过滤模型 (适用于 power, energy, return_energy)
export interface NumberRange {
    eq?: number;  // 精确等于
    gte?: number; // 大于等于 (>=)
    lte?: number; // 小于等于 (<=)
}

// 综合查询参数
export interface CardSearchParams {
    page?: number
    pageSize?: number
    searchText?: string       // 模糊搜索：中英文名称、效果

    // 1. 数组字段过滤
    region?: ArrayFilter
    tag?: ArrayFilter
    keyword?: ArrayFilter     // 注意：这是表里的 keyword 数组字段，不是搜索词
    advanced_tag?: ArrayFilter
    card_color_list?: ArrayFilter

    // 2. 文本/枚举字段过滤 (支持单选或多选 IN)
    card_category?: string | string[]
    series_name?: string | string[]
    rarity_name?: string | string[]

    // 3. 数值范围过滤
    power?: NumberRange
    energy?: NumberRange
    return_energy?: NumberRange

    // 4. 其他
    is_banned?: boolean       // 默认建议过滤掉 banned 卡
}

export interface CardSearchResult {
    data: any[]
    total: number
    page: number
    pageSize: number
    totalPages: number
}

export interface NumberRangeOption { min: number; max: number; }

export interface CardFilterOptions {
    regions: string[]; tags: string[]; keywords: string[]; advanced_tags: string[]; colors: string[];
    categories: string[]; series: string[]; rarities: string[]; champions: string[];
    energy_range: NumberRangeOption;
    power_range: NumberRangeOption;
    return_energy_range: NumberRangeOption;
}
