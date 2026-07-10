import type { CardWithPrint } from '$lib/db'

export function deckToString(deck: CardWithPrint[]): string {
  return deck
    .map((card) => {
      const encode = (str: any) =>
        String(str ?? '')
          .replace(/\r/g, '')

          .replace(/\n/g, '\\n')

          .replace(/\|/g, '｜')

      const fullName = [
        card.card_prints.card_no_extend ?? '',

        card.card_name_cn ?? '无名',

        card.sub_title_cn ? `- ${card.sub_title_cn}` : '',
      ]
        .filter(Boolean)
        .join(' ')

      const parts = [
        fullName,

        encode(card.effect_cn ?? card.flavor_text_cn ?? '无效果'),

        card.card_prints.back_image ?? '',

        card.card_prints.tts_cdn
          ? card.card_prints.tts_cdn
          : card.card_prints.img_cdn
            ? card.card_prints.img_cdn
            : '',

        card.quantity ?? 1,
      ]

      return ['###CARD###', parts.join('|')].join('\n')
    })
    .join('\n')
}
