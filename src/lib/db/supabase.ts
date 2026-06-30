import type { AppVersion, CardBase, CardPrint } from './types';
import { createClient } from '@supabase/supabase-js';
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export const supabase = createClient(supabaseUrl, supabaseKey);

export async function fetchLatestVersion(): Promise<AppVersion | null> {
    const { data, error } = await supabase
        .from('version')
        .select('*')
        .order('id', { ascending: false })
        .limit(1)
        .single();

    if (error) throw new Error(`获取版本失败: ${error.message}`);
    return data;
}

export async function fetchAllCards(): Promise<CardBase[]> {
    // 注意：如果卡牌数量极大（>5000），这里需要改为分页拉取 (Range)
    const { data, error } = await supabase.from('cards_base').select('*');
    if (error) throw new Error(`获取卡牌失败: ${error.message}`);
    return data || [];
}

export async function fetchAllPrints(): Promise<CardPrint[]> {
    const { data, error } = await supabase.from('card_prints').select('*');
    if (error) throw new Error(`获取卡图失败: ${error.message}`);
    return data || [];
}