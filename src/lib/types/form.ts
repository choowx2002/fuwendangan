export interface FormState {
	card_no: string;
	card_name_cn: string;
	card_name_en: string;
	sub_title_cn: string;
	sub_title_en: string;
	card_category: string;
	card_color_list: string[];
	region: string[];
	tag: string[];
	keyword: string[];
	advanced_tag: string[];
	champion_tag: string;
	effect_cn: string;
	effect_en: string;
	energy: number | null;
	return_energy: number | null;
	power: number | null;
	rarity_name: string;
	series_name: string;
	flavor_text_cn: string;
	flavor_text_en: string;
	is_banned: boolean;
}
