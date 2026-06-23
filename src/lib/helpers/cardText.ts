import { cardEffectIconMap } from '$lib/constants/icon';
import { ICON_URL } from '$lib/constants/url';

interface ReplaceResult {
	text: string;
	hasImages: boolean;
}

/**
 * 提取文本中的 {{关键词}} 并调用 API 获取图像替换
 */
export async function replaceKeywordsWithImages(text: string): Promise<ReplaceResult> {
	if (!text) {
		return { text: '', hasImages: false };
	}

	// 匹配所有 {{关键词}} 格式
	const pattern = /\{\{([^}]+)\}\}/g;
	const matches = [...text.matchAll(pattern)];

	if (matches.length === 0) {
		return { text, hasImages: false };
	}

	let resultText = text;
	let hasImages = false;

	// 处理所有匹配项（从后往前替换，避免索引偏移）
	for (let i = matches.length - 1; i >= 0; i--) {
		const match = matches[i];
		const fullMatch = match[0];
		const keyword = match[1].trim();

		try {
			const url = cardEffectIconMap.get(keyword);
			if (url) {
				// 替换为 img 标签
				const imgTag = `<img src="${url}" alt="${keyword}" class="h-3.5 mx-1 inline cover" />`;
				resultText =
					resultText.substring(0, match.index) +
					imgTag +
					resultText.substring(match.index! + fullMatch.length);
				hasImages = true;
			}
		} catch (error) {
			console.error(`获取关键词 "${keyword}" 的图像失败:`, error);
			// 失败时保持原文本
		}
	}

	return { text: resultText, hasImages };
}

/**
 * 批量处理，返回 Promise.all 结果
 */
export async function replaceKeywordsWithImagesParallel(text: string): Promise<ReplaceResult> {
	if (!text) {
		return { text: '', hasImages: false };
	}

	const pattern = /\{\{([^}]+)\}\}/g;
	const matches = [...text.matchAll(pattern)];

	if (matches.length === 0) {
		return { text, hasImages: false };
	}

	// 并行获取所有图像
	const fetchPromises = matches.map(async (match) => {
		const keyword = match[1].trim();
		try {
			const response = await fetch(`${ICON_URL}${encodeURIComponent(keyword)}`);
			if (response.ok) {
				const result = await response.json();
				if (result && Object.keys(result).length > 0) {
					const imageUrl = result.imageUrl || result.image || result.url;
					return { keyword, imageUrl, fullMatch: match[0] };
				}
			}
		} catch (error) {
			console.error(`获取关键词 "${keyword}" 的图像失败:`, error);
		}
		return { keyword, imageUrl: null, fullMatch: match[0] };
	});

	const results = await Promise.all(fetchPromises);

	let resultText = text;
	let hasImages = false;

	// 从后往前替换
	for (let i = matches.length - 1; i >= 0; i--) {
		const result = results[i];
		const match = matches[i];

		if (result.imageUrl) {
			const imgTag = `<img src="${result.imageUrl}" alt="${result.keyword}" class="card-icon" />`;
			resultText =
				resultText.substring(0, match.index) +
				imgTag +
				resultText.substring(match.index! + result.fullMatch.length);
			hasImages = true;
		}
	}

	return { text: resultText, hasImages };
}
