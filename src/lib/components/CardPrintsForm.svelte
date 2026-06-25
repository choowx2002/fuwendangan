<script lang="ts">
	import type { CardPrint } from '$lib/types/card'; // 调整为你的实际路径

	interface Props {
		initialPrints?: CardPrint[];
		cardId: string;
	}

	let { initialPrints = [], cardId }: Props = $props();

	// 本地表单状态
	let prints = $state<CardPrint[]>(initialPrints.length > 0 ? [...initialPrints] : []);

	// 用于管理单选按钮组，存储当前默认 print 的 id
	let defaultPrintId = $state<string | null>(initialPrints.find((p) => p.is_default)?.id || null);

	function createEmptyPrint(): CardPrint {
		return {
			id: crypto.randomUUID(), // 临时 ID，提交时由后端处理或保留
			artist: '',
			card_id: cardId,
			img_cdn: '',
			tts_cdn: '',
			back_image: '',
			language: 'zh-CN',
			created_at: new Date().toISOString(),
			is_default: false,
			print_order: prints.length + 1,
			rarity_name: '',
			card_no_extend: '',
			extend_rarity_name: ''
		};
	}

	function addPrint() {
		const newPrint = createEmptyPrint();
		prints.push(newPrint);

		// 如果是第一个，自动设为默认
		if (prints.length === 1) {
			defaultPrintId = newPrint.id;
		}
	}

	function removePrint(index: number) {
		const removed = prints.splice(index, 1)[0];
		// 如果删除的是默认项，将默认项转移给第一项
		if (removed.id === defaultPrintId) {
			defaultPrintId = prints.length > 0 ? prints[0].id : null;
		}
	}

	// 在提交给 Supabase 前调用，将 defaultPrintId 同步回 is_default 字段
	export function getFinalPrints(): CardPrint[] {
		return prints.map((p) => ({
			...p,
			is_default: p.id === defaultPrintId
		}));
	}
</script>

<div class="rounded-xl shadow-sm space-y-3 font-extrabold bg-black/80 p-6">
	<div class="flex items-center justify-between">
		<h3 class="text-lg font-semibold">卡图</h3>
		<button type="button" onclick={addPrint}> + 添加版本 </button>
	</div>

	{#if prints.length === 0}
		<div class="text-center py-8 rounded-lg border border-dashed border-gray-300">
			暂无卡图版本，请点击“添加版本”
		</div>
	{/if}

	{#each prints as print, index (print.id)}
		<div class="relative rounded-lg p-4 shadow-sm space-y-4">
			<!-- 头部：序号与删除 -->
			<div class="flex items-center justify-between pb-2">
				<span class="text-sm font-medium">版本 #{index + 1}</span>
				<button
					type="button"
					onclick={() => removePrint(index)}
					class="text-red-500 hover:text-red-700 text-sm font-medium"
				>
					删除
				</button>
			</div>

			<!-- 基础信息网格 -->
			<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
				<div class="flex flex-col gap-1">
					<label class="text-xs font-medium">扩展编号</label>
					<input
						type="text"
						bind:value={print.card_no_extend}
						class="px-2 py-1.5 border border-gray-300 rounded text-sm focus:ring-0 focus:outline-none bg-transparent"
					/>
				</div>
				<div class="flex flex-col gap-1">
					<label class="text-xs font-medium">稀有度</label>
					<input
						type="text"
						bind:value={print.rarity_name}
						class="px-2 py-1.5 border border-gray-300 rounded text-sm focus:ring-0 focus:outline-none bg-transparent"
					/>
				</div>
				<div class="flex flex-col gap-1">
					<label class="text-xs font-medium">扩展稀有度</label>
					<input
						type="text"
						bind:value={print.extend_rarity_name}
						class="px-2 py-1.5 border border-gray-300 rounded text-sm focus:ring-0 focus:outline-none bg-transparent"
					/>
				</div>
				<div class="flex flex-col gap-1">
					<label class="text-xs font-medium">语言</label>
					<input
						type="text"
						bind:value={print.language}
						class="px-2 py-1.5 border border-gray-300 rounded text-sm focus:ring-0 focus:outline-none bg-transparent"
					/>
				</div>
			</div>

			<!-- 图片与画师 -->
			<div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
				<div class="flex flex-col gap-1">
					<label class="text-xs font-medium">画师 (Artist)</label>
					<input
						type="text"
						bind:value={print.artist}
						class="px-2 py-1.5 border border-gray-300 rounded text-sm focus:ring-0 focus:outline-none bg-transparent"
					/>
				</div>
				<div class="flex flex-col gap-1">
					<label class="text-xs font-medium">排序 (Order)</label>
					<input
						type="number"
						bind:value={print.print_order}
						class="px-2 py-1.5 border border-gray-300 rounded text-sm focus:ring-0 focus:outline-none bg-transparent"
					/>
				</div>
				<div class="flex flex-col gap-1 sm:col-span-2">
					<label class="text-xs font-medium">卡图 CDN (img_cdn)</label>
					<div class="gap-3 grid grid-cols-12 items-baseline">
						<input
							type="url"
							bind:value={print.img_cdn}
							placeholder="https://..."
							class="h-fit px-2 py-1.5 border border-gray-300 rounded text-sm focus:ring-0 focus:outline-none bg-transparent col-span-9"
						/>
						<img src={print.img_cdn} alt="" class="col-span-3" />
					</div>
				</div>
				<div class="flex flex-col gap-1 sm:col-span-2">
					<label class="text-xs font-medium">背面图 CDN (back_image)</label>

					<div class="gap-3 grid grid-cols-12 items-baseline">
						<input
							type="url"
							bind:value={print.back_image}
							placeholder="https://..."
							class="h-fit px-2 py-1.5 border border-gray-300 rounded text-sm focus:ring-0 focus:outline-none bg-transparent col-span-9"
						/>
						<img src={print.back_image} alt="" class="col-span-3" />
					</div>
				</div>
			</div>

			<!-- 默认选项 (Radio) -->
			<div class="pt-2 border-t border-gray-100">
				<label class="inline-flex items-center gap-2 cursor-pointer">
					<input
						type="radio"
						name="default_print"
						bind:group={defaultPrintId}
						value={print.id}
						class="h-4 w-4 text-blue-600 border-gray-300 focus:ring-blue-500"
					/>
					<span class="text-sm font-medium text-gray-700">设为默认卡图</span>
				</label>
			</div>
		</div>
	{/each}
</div>
