<!-- src/routes/admin/cards/_TagInput.svelte -->
<script lang="ts">
	let { tags = $bindable<string[]>([]) } = $props();
	let inputValue = $state('');

	function addTag() {
		const val = inputValue.trim();
		if (val && !tags.includes(val)) {
			tags = [...tags, val];
		}
		inputValue = '';
	}

	function removeTag(index: number) {
		tags = tags.filter((_, i) => i !== index);
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' || e.key === ',') {
			e.preventDefault();
			addTag();
		}
		if (e.key === 'Backspace' && inputValue === '' && tags.length > 0) {
			tags = tags.slice(0, -1);
		}
	}
</script>

<div class="tag-input-wrapper">
	<div class="tags-container">
		{#each tags as tag, i}
			<span class="tag">
				{tag}
				<button type="button" class="tag-remove" on:click={() => removeTag(i)}>×</button>
			</span>
		{/each}
		<input
			type="text"
			bind:value={inputValue}
			on:keydown={handleKeydown}
			on:blur={addTag}
			placeholder={tags.length === 0 ? '输入后按回车添加...' : ''}
			class="tag-input"
		/>
	</div>
</div>

<style>
	.tag-input-wrapper {
		border: 1px solid #ddd;
		border-radius: 4px;
		padding: 0.3rem;
		min-height: 38px;
		background: white;
	}
	.tag-input-wrapper:focus-within {
		border-color: #1976d2;
		box-shadow: 0 0 0 2px rgba(25, 118, 210, 0.2);
	}
	.tags-container {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
		align-items: center;
	}
	.tag {
		display: inline-flex;
		align-items: center;
		gap: 0.2rem;
		background: #e3f2fd;
		color: #1565c0;
		padding: 0.15rem 0.5rem;
		border-radius: 12px;
		font-size: 0.8rem;
	}
	.tag-remove {
		background: none;
		border: none;
		color: #1565c0;
		cursor: pointer;
		font-size: 1rem;
		padding: 0;
		line-height: 1;
	}
	.tag-remove:hover {
		color: #c62828;
	}
	.tag-input {
		border: none;
		outline: none;
		flex: 1;
		min-width: 120px;
		padding: 0.2rem;
		font-size: 0.85rem;
	}
</style>
