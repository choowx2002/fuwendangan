export function deckToString(deck: any[]): string {
  return deck
    .map((card) => {
      const encode = (str: any) =>
        String(str ?? '')
          .replace(/\r/g, '')

          .replace(/\n/g, '\\n')

          .replace(/\|/g, '｜')

      const fullName = [
        card.card_no ?? '',

        card.card_name ?? '无名',

        card.sub_title ? `- ${card.sub_title}` : '',
      ]
        .filter(Boolean)
        .join(' ')

      const parts = [
        fullName,

        encode(card.card_effect ?? card.flavor_text ?? '无效果'),

        card.back_image ?? '',

        card.front_image_en ?? '',

        card.quantity ?? 1,
      ]

      return ['###CARD###', parts.join('|')].join('\n')
    })
    .join('\n')
}
