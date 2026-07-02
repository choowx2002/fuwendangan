import type { CardPrint } from "$lib/db/types";

export const combineCardPrints = (prints: CardPrint[]): Map<string, CardPrint[]> => {
    const printsMap = new Map<string, CardPrint[]>();

    prints.forEach((p) => {
        const group = printsMap.get(p.card_no_extend) ?? [];
        group.push({ ...p });
        printsMap.set(p.card_no_extend, group);
    });

    return printsMap;
};

export const sortCardPrints = (prints: CardPrint[]): CardPrint[] => {
    const sortedList = prints.toSorted((a, b) => {
        if (a.print_order !== b.print_order) {
            return (b.print_order ?? 0) - (a.print_order ?? 0);
        }

        if (a.card_no_extend !== b.card_no_extend) {
            return a.card_no_extend.localeCompare(b.card_no_extend)
        }

        if (a.language !== b.language) {
            const aIsSc = a.language.toLowerCase() === "sc";
            const bIsSc = b.language.toLowerCase() === "sc";

            if (aIsSc !== bIsSc) {
                return aIsSc ? -1 : 1;
            }

            return a.language.localeCompare(b.language);
        }


        return 0;
    });

    return sortedList;
};