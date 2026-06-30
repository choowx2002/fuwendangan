<!-- src/lib/components/cards/CardItem.svelte -->
<script lang="ts">
    import type { CardBase, CardPrint } from "$lib/db/types";

    interface Props {
        card: CardBase & { card_prints?: CardPrint[] };
    }

    let { card }: Props = $props();

    const defaultPrint = $derived(
        card.card_prints?.find((p) => p.is_default) || card.card_prints?.[0],
    );

    let currentSrc = $state(
        defaultPrint?.img_cdn ||
            defaultPrint?.tts_cdn ||
            "/placeholder-card.png",
    );
    let fallbackCount = $state(0);

    function handleError(e: Event) {
        const img = e.target as HTMLImageElement;
        if (
            fallbackCount === 0 &&
            defaultPrint?.tts_cdn &&
            currentSrc !== defaultPrint.tts_cdn
        ) {
            currentSrc = defaultPrint.tts_cdn;
            fallbackCount++;
        } else {
            currentSrc = "/placeholder-card.png";
            img.onerror = null;
        }
    }

    $effect(() => {
        currentSrc =
            defaultPrint?.img_cdn ||
            defaultPrint?.tts_cdn ||
            "/placeholder-card.png";
        fallbackCount = 0;
    });
</script>

<a
    href="/cards/{card.id}"
    class="card-item"
    title={card.card_name_cn || card.card_name_en}
>
    <img
        src={currentSrc}
        alt={card.card_name_cn || "Card"}
        loading="lazy"
        onerror={handleError}
    />
</a>

<style>
    .card-item {
        display: block;
        position: relative;
        aspect-ratio: 744 / 1039; /* TCG 标准比例 */
        border-radius: var(--radius-md);
        overflow: hidden;
        background: var(--bg-secondary);
        border: 1px solid transparent;
        transition: all 0.2s ease;
        cursor: pointer;
    }

    .card-item:hover {
        border-color: var(--accent-color);
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
        transform: translateY(-2px);
    }

    img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
    }
</style>
