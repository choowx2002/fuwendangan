import type { ArrayFilter, NumberRange } from "$lib/types/card"

// 处理数组过滤
// export function applyArrayFilter(query: any, column: string, filter?: ArrayFilter) {
//     if (!filter) return query
//     if (filter.all && filter.all.length > 0) query = query.cs(column, filter.all)
//     if (filter.any && filter.any.length > 0) query = query.or(column, filter.any)
//     if (filter.none && filter.none.length > 0) {
//         // 排除逻辑：不能包含A 且 不能包含B
//         filter.none.forEach(val => {
//             query = query.not(column, 'cs', `{${val}}`)
//         })
//     }
//     return query
// }

export function applyArrayFilter(
    query: any,
    column: string,
    filter?: ArrayFilter
) {
    if (!filter) return query

    if (filter.all?.length) {
        query = query.contains(column, filter.all)
        // 或 query.cs(column, filter.all)
    }

    if (filter.any?.length) {
        const conditions = filter.any
            .map(v => `${column}.cs.{${v}}`)
            .join(',')

        query = query.or(conditions)
    }

    if (filter.none?.length) {
        filter.none.forEach(v => {
            query = query.not(column, 'cs', `{${v}}`)
        })
    }

    return query
}

// 处理文本过滤 (支持单值 eq 和 多值 in)
export function applyTextFilter(query: any, column: string, value?: string | string[]) {
    if (!value) return query
    if (Array.isArray(value)) {
        if (value.length > 0) query = query.in(column, value)
    } else {
        query = query.eq(column, value)
    }
    return query
}

// 处理数值范围过滤
export function applyNumberFilter(query: any, column: string, range?: NumberRange) {
    if (!range) return query
    if (range.eq !== undefined) {
        query = query.eq(column, range.eq)
    } else {
        if (range.gte !== undefined) query = query.gte(column, range.gte)
        if (range.lte !== undefined) query = query.lte(column, range.lte)
    }
    return query
}