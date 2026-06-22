import { colorDICT, needArrangeList } from '$lib/constants/filterConfig';
import { getCardFilterOptions } from '$lib/database/cards';

export const processFilterConfig = async () => {
	try {
		const options = await getCardFilterOptions();
		if (!options) return null;

		// colors成中文
		if (options.colors) {
			options.colors = options.colors.map((c: string) => colorDICT.get(c) || c).filter(Boolean);
		}

		// 将 options 断言为 Record 类型，允许使用 string 索引
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const optionsDict = options as Record<string, any>;

		for (const key in needArrangeList) {
			// 检查 options 中是否有这个 key
			if (!Object.hasOwn(optionsDict, key)) continue;

			// 直接排序并赋值，TS 不会再报错
			optionsDict[key] = sortByCustomOrder(optionsDict[key], needArrangeList[key]);
		}

		return options;
	} catch (error) {
		console.error(error);
		return null;
	}
};

/**
 * 按照自定义顺序对数组进行排序
 * @param arr 需要排序的原始数组 (如 options.regions)
 * @param orderList
 * @param key
 * @returns 排序后的新数组
 */
export function sortByCustomOrder<T>(
	arr: T[] | undefined | null,
	orderList: string[] | undefined | null,
	key?: keyof T
): T[] {
	// 1. 如果没有原数组，直接 pass (返回空数组)
	if (!arr || !Array.isArray(arr)) return [];

	// 2. 如果没有定义顺序，直接 pass (返回原数组的浅拷贝)
	if (!orderList || !Array.isArray(orderList) || orderList.length === 0) {
		return [...arr];
	}

	// 3. 使用 Map 缓存顺序索引，提高查找性能
	const orderMap = new Map<string, number>();
	orderList.forEach((item, index) => {
		orderMap.set(String(item), index);
	});

	// 4. 获取元素在自定义顺序中的索引
	const getOrderIndex = (item: T): number => {
		// 如果是对象则取 key 的值，否则取 item 本身
		const val = key !== undefined ? String(item[key]) : String(item);
		// 如果不在自定义顺序中，返回 Infinity，确保它们被排到最后
		return orderMap.has(val) ? orderMap.get(val)! : Infinity;
	};

	// 5. 执行排序
	return [...arr].sort((a, b) => {
		const indexA = getOrderIndex(a);
		const indexB = getOrderIndex(b);

		if (indexA !== indexB) {
			return indexA - indexB;
		}
		// 如果都不在自定义顺序中，保持它们原有的相对顺序 (稳定排序)
		return 0;
	});
}
