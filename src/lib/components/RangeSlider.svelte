<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import noUiSlider from 'nouislider';
	import 'nouislider/dist/nouislider.css';

	let {
		range,
		min,
		max,
		step = 1
	}: {
		range: [number, number];
		min: number;
		max: number;
		step?: number;
	} = $props();

	let container: HTMLDivElement;
	let slider: noUiSlider.API;

	onMount(() => {
		slider = noUiSlider.create(container, {
			start: [range[0], range[1]],
			connect: true,
			range: { min, max },
			step,
			format: {
				to: (value) => Math.round(value),
				from: (value) => Number(value)
			},
			cssPrefix: 'noUi-'
		});

		// 当滑块拖动时，同步更新传入的 range 数组
		slider.on('update', (values: any[]) => {
			range[0] = Number(values[0]);
			range[1] = Number(values[1]);
		});
	});

	onDestroy(() => {
		if (slider) slider.destroy();
	});
</script>

<div bind:this={container} class="h-2 my-2 px-2 w-full"></div>

<style>
	:global(.noUi-target) {
		background: rgba(8, 51, 68, 0.3); /* cyan-950/30 */
		border-color: rgba(34, 211, 238, 0.3); /* cyan-500/30 */
		box-shadow: none;
	}
	:global(.noUi-connect) {
		background: #22d3ee; /* cyan-400 */
	}
	:global(.noUi-handle) {
		background: #083344; /* cyan-950 */
		border-color: #22d3ee; /* cyan-400 */
		box-shadow: 0 0 8px rgba(34, 211, 238, 0.4);
		cursor: pointer;
	}
	:global(.noUi-handle:before),
	:global(.noUi-handle:after) {
		background: #22d3ee; /* cyan-400 */
	}
</style>
