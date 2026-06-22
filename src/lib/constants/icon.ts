// $lib/constants/iconConfig.ts
import redIcon from '$lib/assets/icon/red.svg';
import greenIcon from '$lib/assets/icon/green.svg';
import blueIcon from '$lib/assets/icon/blue.svg';
import orangeIcon from '$lib/assets/icon/orange.svg';
import purpleIcon from '$lib/assets/icon/purple.svg';
import yellowIcon from '$lib/assets/icon/yellow.svg';

import commonIcon from '$lib/assets/icon/Common.png';
import uncommonIcon from '$lib/assets/icon/Uncommon.png';
import rareIcon from '$lib/assets/icon/Rare.png';
import epicIcon from '$lib/assets/icon/Epic.png';
import overNumberedIcon from '$lib/assets/icon/OverNumbered.png';

export const iconMap = new Map<string, string>([
	['red', redIcon],
	['green', greenIcon],
	['blue', blueIcon],
	['orange', orangeIcon],
	['purple', purpleIcon],
	['yellow', yellowIcon],
	['普通', commonIcon],
	['不凡', uncommonIcon],
	['稀有', rareIcon],
	['史诗', epicIcon],
	['异画', overNumberedIcon]
]);
