<script lang="ts">
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
	class="flex flex-wrap items-center gap-2 p-2 border border-gray-300 rounded-md min-h-10.5 focus-within:ring-1 focus-within:ring-cyan-500 focus-within:border-cyan-500 {disabled
		? 'bg-gray-100 opacity-60'
		: ''}"
>
	{#each tags as tag, i (i)}
		<span
			class="inline-flex items-center gap-1 px-2 py-1 bg-cyan-500/10 text-cyan-100 text-xs rounded-md"
		>
			{tag}
			{#if !disabled}
				<button
					type="button"
					onclick={() => removeTag(i)}
					class="text-blue-400 hover:text-cyan-600 leading-none"
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
		placeholder="输入后按回车添加..."
		class="w-full bg-transparent px-3 py-2 outline-none border-none focus:ring-0 text-sm focus:outline-none disabled:bg-gray-100 disabled:text-gray-400"
	/>
</div>
