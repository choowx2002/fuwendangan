<script lang="ts">
	// ✅ 必须用 $bindable()，否则 bind:tags 无效
	interface Props {
		tags: string[];
		disabled?: boolean;
	}

	let { tags = $bindable([]), disabled = false }: Props = $props();

	let inputValue = $state('');

	function addTag() {
		const val = inputValue.trim();
		if (val && !tags.includes(val)) {
			tags = [...tags, val]; // 整体赋值触发响应式
		}
		inputValue = '';
	}

	function removeTag(index: number) {
		tags = tags.filter((_, i) => i !== index);
	}

	function handleKeydown(ev: KeyboardEvent) {
		if (ev.key === 'Enter') {
			ev.preventDefault();
			addTag();
		}
	}
</script>

<div
	class="flex flex-wrap items-center gap-2 p-2 border border-gray-300 rounded-md min-h-[42px] focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-blue-500 {disabled
		? 'bg-gray-100 opacity-60'
		: ''}"
>
	{#each tags as tag, i}
		<span
			class="inline-flex items-center gap-1 px-2 py-1 bg-blue-100 text-blue-800 text-xs rounded-md"
		>
			{tag}
			{#if !disabled}
				<button
					type="button"
					onclick={() => removeTag(i)}
					class="text-blue-400 hover:text-blue-600 leading-none"
				>
					&times;
				</button>
			{/if}
		</span>
	{/each}
	<input
		type="text"
		bind:value={inputValue}
		onkeydown={handleKeydown}
		onblur={addTag}
		{disabled}
		placeholder={tags.length === 0 ? '输入后按回车添加...' : ''}
		class="flex-1 min-w-[120px] text-sm outline-none bg-transparent"
	/>
</div>
