<script lang="ts">
    import type { CardBase, CardPrint } from "$lib/db/types";

    interface Props {
        card: CardBase & { card_prints?: CardPrint[] };
    }

    let { card }: Props = $props();

    const defaultPrint = $derived(
        card.card_prints?.find((p) => p.is_default) ?? card.card_prints?.[0],
    );

    let currentSrc = $state("/blue.jpg");
    let fallbackCount = $state(0);

    $effect(() => {
        currentSrc =
            defaultPrint?.img_cdn ?? defaultPrint?.tts_cdn ?? "/blue.jpg";

        fallbackCount = 0;
    });

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
            currentSrc = "/blue.jpg";
            img.onerror = null;
        }
    }
</script>

<a
    href="/cards/{card.id}"
    class="card-item"
    title={card.card_name_cn || card.card_name_en}
>
    <img
        src={currentSrc}
        alt={card.card_name_cn || ""}
        loading="lazy"
        onerror={handleError}
    />
</a>

<style>
    .card-item {
        display: block;
        position: relative;
        aspect-ratio: 744 / 1040;
        border-radius: var(--radius-md);
        overflow: hidden;
        background: var(--bg-secondary);
        transition: all 0.2s ease;
        cursor: pointer;
    }

    .card-item:hover {
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.353);
        transform: translateY(-1px);
    }

    img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
        overflow: visible;
    }
</style>
