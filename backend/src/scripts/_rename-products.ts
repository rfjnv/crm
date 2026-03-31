import { PrismaClient } from '@prisma/client';

/**
 * Updates IMPORT product names and SKUs to proper readable values.
 * Maps IMPORT DB name (format string) → full product name + readable SKU
 * from import-stock.ts PRODUCTS array.
 *
 * This preserves stock values and movement history.
 */

const prisma = new PrismaClient();

// Mapping: IMPORT product name (lowercase) → { fullName, sku, unit, format, category, countryOfOrigin }
// Built from import-stock.ts PRODUCTS array, keyed by what update-stock.ts matched
const MAPPING: Record<string, { name: string; sku: string; unit: string; format: string | null; category: string; countryOfOrigin: string | null }> = {
  // === САМОКЛЕЮЩАЯСЯ БУМАГА ===
  '70*100': { name: 'Самоклеющаяся бумага Ф:70*100 белая (Китай)', sku: 'SK-CN-70x100', unit: 'лист', format: '70*100', category: 'Самоклеющаяся бумага', countryOfOrigin: 'Китай' },
  '50*70': { name: 'Самоклеющаяся бумага Ф:50*70 белая (Китай)', sku: 'SK-CN-50x70', unit: 'лист', format: '50*70', category: 'Самоклеющаяся бумага', countryOfOrigin: 'Китай' },
  '70*100 б/н': { name: 'Самоклеющаяся бумага Ф:70*100 белая б/н (Китай)', sku: 'SK-CN-70x100-BN', unit: 'лист', format: '70*100 б/н', category: 'Самоклеющаяся бумага', countryOfOrigin: 'Китай' },
  '50*70 б/н': { name: 'Самоклеющаяся бумага Ф:50*70 белая б/н (Китай)', sku: 'SK-CN-50x70-BN', unit: 'лист', format: '50*70 б/н', category: 'Самоклеющаяся бумага', countryOfOrigin: 'Китай' },
  '50*35': { name: 'Самоклеющаяся бумага Ф:50*35 белая (Китай)', sku: 'SK-CN-50x35', unit: 'лист', format: '50*35', category: 'Самоклеющаяся бумага', countryOfOrigin: 'Китай' },
  '50*35 б/н': { name: 'Самоклеющаяся бумага Ф:50*35 белая б/н (Китай)', sku: 'SK-CN-50x35-BN', unit: 'лист', format: '50*35 б/н', category: 'Самоклеющаяся бумага', countryOfOrigin: 'Китай' },
  '70*100 ок': { name: 'Самоклеющаяся бумага Ф:70*100 красная (Китай)', sku: 'SK-CN-RED-70x100', unit: 'лист', format: '70*100', category: 'Самоклеющаяся бумага', countryOfOrigin: 'Китай' },
  '50*70 ок': { name: 'Самоклеющаяся бумага Ф:50*70 красная (Китай)', sku: 'SK-CN-RED-50x70', unit: 'лист', format: '50*70', category: 'Самоклеющаяся бумага', countryOfOrigin: 'Китай' },
  '70*100 ок б/н': { name: 'Самоклеющаяся бумага Ф:70*100 красная б/н (Китай)', sku: 'SK-CN-RED-70x100-BN', unit: 'лист', format: '70*100 б/н', category: 'Самоклеющаяся бумага', countryOfOrigin: 'Китай' },
  '50*70 ок б/н': { name: 'Самоклеющаяся бумага Ф:50*70 красная б/н (Китай)', sku: 'SK-CN-RED-50x70-BN', unit: 'лист', format: '50*70 б/н', category: 'Самоклеющаяся бумага', countryOfOrigin: 'Китай' },
  '70*100 турк': { name: 'Самоклеющаяся бумага Ф:70*100 (Турция)', sku: 'SK-TR-70x100', unit: 'лист', format: '70*100', category: 'Самоклеющаяся бумага', countryOfOrigin: 'Турция' },
  '50*70 турк': { name: 'Самоклеющаяся бумага Ф:50*70 (Турция)', sku: 'SK-TR-50x70', unit: 'лист', format: '50*70', category: 'Самоклеющаяся бумага', countryOfOrigin: 'Турция' },
  'самоклей рулон фассон': { name: 'Самоклеющаяся бумага в рулонах 1м*2000м (акриловый клей)', sku: 'SK-RUL-FASSON-A', unit: 'рул', format: 'BJ 993', category: 'Самоклеющаяся бумага', countryOfOrigin: null },
  'самоклей рулон кауч': { name: 'Самоклеющаяся бумага в рулонах 1м*2000м (каучуковый клей)', sku: 'SK-RUL-FASSON-K', unit: 'рул', format: 'BJ 995', category: 'Самоклеющаяся бумага', countryOfOrigin: null },
  'самоклей рулон лянгду': { name: 'Самоклеющаяся бумага в рулонах 1м*2000м', sku: 'SK-RUL-LIANGDU', unit: 'рул', format: 'Китай', category: 'Самоклеющаяся бумага', countryOfOrigin: 'Китай' },
  'самоклей рулон ненси': { name: 'Самоклеющаяся бумага в рулонах 1м*2000м ненси', sku: 'SK-RUL-NENSI', unit: 'рул', format: 'Китай', category: 'Самоклеющаяся бумага', countryOfOrigin: 'Китай' },

  // === ЦЕЛЛЮЛОЗНЫЙ КАРТОН ===
  'целл 210гр 70*100': { name: 'Целлюлозный многослойный картон 210гр/м2 70*100', sku: 'KART-IND-210-70x100', unit: 'лист', format: 'Индия 210гр (70*100)', category: 'Целлюлозный картон', countryOfOrigin: 'Индия' },
  'целл 250гр 70*100': { name: 'Целлюлозный многослойный картон 250гр/м2 70*100 (Индия)', sku: 'KART-IND-250-70x100', unit: 'лист', format: 'Индия 250гр (70*100)', category: 'Целлюлозный картон', countryOfOrigin: 'Индия' },
  'целл 250 кит 70*100': { name: 'Целлюлозный многослойный картон 250гр/м2 70*100 (Китай)', sku: 'KART-CN-250-70x100', unit: 'лист', format: 'Китай 250гр (70*100)', category: 'Целлюлозный картон', countryOfOrigin: 'Китай' },
  'картон рул 270*62': { name: 'Целлюлозный многослойный картон 270гр рулон 62см (Китай)', sku: 'KART-CN-270-RUL-62', unit: 'рул', format: 'Китай 270гр (62)', category: 'Целлюлозный картон', countryOfOrigin: 'Китай' },
  'картон рул 300*62': { name: 'Целлюлозный многослойный картон 300гр рулон 62см (Китай)', sku: 'KART-CN-300-RUL-62', unit: 'рул', format: 'Китай 300гр (62)', category: 'Целлюлозный картон', countryOfOrigin: 'Китай' },
  'целл 270гр 62*94': { name: 'Целлюлозный многослойный картон 270гр 62*94 (Китай)', sku: 'KART-CN-270-62x94', unit: 'лист', format: '62*94', category: 'Целлюлозный картон', countryOfOrigin: 'Китай' },
  'целл 300гр 62*94': { name: 'Целлюлозный многослойный картон 300гр 62*94 (Китай)', sku: 'KART-CN-300-62x94', unit: 'лист', format: '62*94', category: 'Целлюлозный картон', countryOfOrigin: 'Китай' },

  // === МЕЛОВАННАЯ БУМАГА ===
  'мел250': { name: 'Мелованная бумага 250гр/м2 70*100', sku: 'MEL-HK-250-70x100', unit: 'лист', format: '250гр (70*100)', category: 'Мелованная бумага', countryOfOrigin: null },
  'мел170': { name: 'Мелованная бумага 170гр/м2 70*100', sku: 'MEL-HK-170-70x100', unit: 'лист', format: '170гр (70*100)', category: 'Мелованная бумага', countryOfOrigin: null },
  'мел105 матт': { name: 'Мелованная бумага 105гр/м2 70*100 МАТТ', sku: 'MEL-HK-105-MATT', unit: 'лист', format: '105гр (70*100) матт', category: 'Мелованная бумага', countryOfOrigin: null },

  // === ФОЛЬГА ===
  'фольга зол 120': { name: 'Фольга для тиснения 64см*120м золото', sku: 'FOIL-GOLD-120', unit: 'рул', format: 'золото', category: 'Фольга для тиснения', countryOfOrigin: null },
  'фольга зол 240': { name: 'Фольга для тиснения 64см*240м золото', sku: 'FOIL-GOLD-240', unit: 'рул', format: 'золото', category: 'Фольга для тиснения', countryOfOrigin: null },
  'фольга зол 360': { name: 'Фольга для тиснения 64см*360м золото', sku: 'FOIL-GOLD-360', unit: 'рул', format: 'золото', category: 'Фольга для тиснения', countryOfOrigin: null },
  'фольга сер 120': { name: 'Фольга для тиснения 64см*120м серебро', sku: 'FOIL-SILVER-120', unit: 'рул', format: 'серебро', category: 'Фольга для тиснения', countryOfOrigin: null },
  'фольга сер 240': { name: 'Фольга для тиснения 64см*240м серебро', sku: 'FOIL-SILVER-240', unit: 'рул', format: 'серебро', category: 'Фольга для тиснения', countryOfOrigin: null },
  'фольга сер 360': { name: 'Фольга для тиснения 64см*360м серебро', sku: 'FOIL-SILVER-360', unit: 'рул', format: 'серебро', category: 'Фольга для тиснения', countryOfOrigin: null },
  'фольга сарик зол 120': { name: 'Фольга для тиснения 64см*120м золото (сарик)', sku: 'FOIL-GOLD-Y-120', unit: 'рул', format: 'золото (сарик)', category: 'Фольга для тиснения', countryOfOrigin: null },
  'фольга сарик зол 240': { name: 'Фольга для тиснения 64см*240м золото (сарик)', sku: 'FOIL-GOLD-Y-240', unit: 'рул', format: 'золото (сарик)', category: 'Фольга для тиснения', countryOfOrigin: null },
  'фольга сарик зол 360': { name: 'Фольга для тиснения 64см*360м золото (сарик)', sku: 'FOIL-GOLD-Y-360', unit: 'рул', format: 'золото (сарик)', category: 'Фольга для тиснения', countryOfOrigin: null },
  'фольга сарик сер 120': { name: 'Фольга для тиснения 64см*120м серебро (сарик)', sku: 'FOIL-SILVER-Y-120', unit: 'рул', format: 'серебро (сарик)', category: 'Фольга для тиснения', countryOfOrigin: null },
  'фольга сарик сер 240': { name: 'Фольга для тиснения 64см*240м серебро (сарик)', sku: 'FOIL-SILVER-Y-240', unit: 'рул', format: 'серебро (сарик)', category: 'Фольга для тиснения', countryOfOrigin: null },
  'фольга сарик сер 360': { name: 'Фольга для тиснения 64см*360м серебро (сарик)', sku: 'FOIL-SILVER-Y-360', unit: 'рул', format: 'серебро (сарик)', category: 'Фольга для тиснения', countryOfOrigin: null },
  'фольга яшил 120': { name: 'Фольга для тиснения цветная 64см*120м зелёная', sku: 'FOIL-GREEN-120', unit: 'рул', format: 'яшил', category: 'Фольга для тиснения', countryOfOrigin: null },
  'фольга перелив сер 120': { name: 'Фольга для тиснения переливающаяся 64см*120м серебро', sku: 'FOIL-HOLO-120', unit: 'рул', format: 'переливающий сер', category: 'Фольга для тиснения', countryOfOrigin: null },
  'фольга песоч яшил': { name: 'Фольга галаграмма песочная зелёная', sku: 'FOIL-HOLO-SAND', unit: 'рул', format: 'песочный яшил', category: 'Фольга для тиснения', countryOfOrigin: null },
  'фольга кора 120': { name: 'Фольга для тиснения цветная 64см*120м чёрная', sku: 'FOIL-BLACK-120', unit: 'рул', format: 'кора', category: 'Фольга для тиснения', countryOfOrigin: null },
  'фольга кизил 120': { name: 'Фольга для тиснения цветная 64см*120м красная', sku: 'FOIL-RED-120', unit: 'рул', format: 'кизил', category: 'Фольга для тиснения', countryOfOrigin: null },
  'фольга оч кук 120': { name: 'Фольга для тиснения цветная 64см*120м синяя', sku: 'FOIL-BLUE-120', unit: 'рул', format: 'оч кук', category: 'Фольга для тиснения', countryOfOrigin: null },
  'фольга ок 180': { name: 'Фольга для тиснения цветная 64см*180м белая', sku: 'FOIL-WHITE-180', unit: 'рул', format: 'ок', category: 'Фольга для тиснения', countryOfOrigin: null },
  'фольга фиолет 120': { name: 'Фольга для тиснения цветная 64см*120м фиолетовая', sku: 'FOIL-VIOLET-120', unit: 'рул', format: 'фиолет', category: 'Фольга для тиснения', countryOfOrigin: null },
  'фольга медная 120': { name: 'Фольга для тиснения цветная 64см*120м медная', sku: 'FOIL-COPPER-120', unit: 'рул', format: 'медная', category: 'Фольга для тиснения', countryOfOrigin: null },
  'фольга жемчук 120': { name: 'Фольга для тиснения цветная 64см*120м жемчужная', sku: 'FOIL-PEARL-120', unit: 'рул', format: 'жемчук', category: 'Фольга для тиснения', countryOfOrigin: null },
  'фольга цветная 120': { name: 'Фольга для тиснения цветная 64см*120м ассорти', sku: 'FOIL-COLOR-120', unit: 'рул', format: 'Цветная', category: 'Фольга для тиснения', countryOfOrigin: null },

  // === UV ЛАК ===
  'pi 50': { name: 'Полигр. бесцв. краска PI-50', sku: 'UV-PI50', unit: 'кг', format: 'PI 50', category: 'UV лак', countryOfOrigin: 'Турция' },
  'pi 125': { name: 'Полигр. бесцв. краска PI-125', sku: 'UV-PI125', unit: 'кг', format: 'PI 125', category: 'UV лак', countryOfOrigin: 'Турция' },
  'pi 180': { name: 'Полигр. бесцв. краска PI-180', sku: 'UV-PI180', unit: 'кг', format: 'PI 180', category: 'UV лак', countryOfOrigin: 'Турция' },
  'pi 180 белг': { name: 'Полигр. бесцв. краска PI-180 Бельгия', sku: 'UV-PI180-BE', unit: 'кг', format: 'PI 180 Белгия', category: 'UV лак', countryOfOrigin: 'Бельгия' },
  'pi 250': { name: 'Полигр. бесцв. краска PI-250', sku: 'UV-PI250', unit: 'кг', format: 'PI 250', category: 'UV лак', countryOfOrigin: 'Турция' },
  'pi 250 белг': { name: 'Полигр. бесцв. краска PI-250 Бельгия', sku: 'UV-PI250-BE', unit: 'кг', format: 'PI 250 Белгия', category: 'UV лак', countryOfOrigin: 'Бельгия' },
  'pi 400а': { name: 'Полигр. бесцв. краска PI-400А', sku: 'UV-PI400A', unit: 'кг', format: 'PI 400А', category: 'UV лак', countryOfOrigin: 'Турция' },
  'pi 400а белг': { name: 'Полигр. бесцв. краска PI-400А Бельгия', sku: 'UV-PI400A-BE', unit: 'кг', format: 'PI 400А Белгия', category: 'UV лак', countryOfOrigin: 'Бельгия' },
  'emboss': { name: 'Полигр. бесцв. краска PI-500 (emboss)', sku: 'UV-PI500', unit: 'кг', format: 'emboss', category: 'UV лак', countryOfOrigin: 'Турция' },

  // === ЛАМИНАЦИОННАЯ ПЛЕНКА (ГЛЯНЦ) ===
  'лам84': { name: 'Ламинационная пленка ф:3000м глянцевая 84см', sku: 'LAM-GL-84', unit: 'рул', format: '84', category: 'Ламинационная пленка', countryOfOrigin: null },
  'лам78': { name: 'Ламинационная пленка ф:3000м глянцевая 78см', sku: 'LAM-GL-78', unit: 'рул', format: '78', category: 'Ламинационная пленка', countryOfOrigin: null },
  'лам74': { name: 'Ламинационная пленка ф:3000м глянцевая 74см', sku: 'LAM-GL-74', unit: 'рул', format: '74', category: 'Ламинационная пленка', countryOfOrigin: null },
  'лам72': { name: 'Ламинационная пленка ф:3000м глянцевая 72см', sku: 'LAM-GL-72', unit: 'рул', format: '72', category: 'Ламинационная пленка', countryOfOrigin: null },
  'лам70': { name: 'Ламинационная пленка ф:3000м глянцевая 70см', sku: 'LAM-GL-70', unit: 'рул', format: '70', category: 'Ламинационная пленка', countryOfOrigin: null },
  'лам68': { name: 'Ламинационная пленка ф:3000м глянцевая 68см', sku: 'LAM-GL-68', unit: 'рул', format: '68', category: 'Ламинационная пленка', countryOfOrigin: null },
  'лам65': { name: 'Ламинационная пленка ф:3000м глянцевая 65см', sku: 'LAM-GL-65', unit: 'рул', format: '65', category: 'Ламинационная пленка', countryOfOrigin: null },
  'лам62': { name: 'Ламинационная пленка ф:3000м глянцевая 62см', sku: 'LAM-GL-62', unit: 'рул', format: '62', category: 'Ламинационная пленка', countryOfOrigin: null },
  'лам60': { name: 'Ламинационная пленка ф:3000м глянцевая 60см', sku: 'LAM-GL-60', unit: 'рул', format: '60', category: 'Ламинационная пленка', countryOfOrigin: null },
  'лам58': { name: 'Ламинационная пленка ф:3000м глянцевая 58см', sku: 'LAM-GL-58', unit: 'рул', format: '58', category: 'Ламинационная пленка', countryOfOrigin: null },
  'лам55': { name: 'Ламинационная пленка ф:3000м глянцевая 55см', sku: 'LAM-GL-55', unit: 'рул', format: '55', category: 'Ламинационная пленка', countryOfOrigin: null },
  'лам50': { name: 'Ламинационная пленка ф:3000м глянцевая 50см', sku: 'LAM-GL-50', unit: 'рул', format: '50', category: 'Ламинационная пленка', countryOfOrigin: null },
  'лам48': { name: 'Ламинационная пленка ф:3000м глянцевая 48см', sku: 'LAM-GL-48', unit: 'рул', format: '48', category: 'Ламинационная пленка', countryOfOrigin: null },
  'лам42': { name: 'Ламинационная пленка ф:3000м глянцевая 42см', sku: 'LAM-GL-42', unit: 'рул', format: '42', category: 'Ламинационная пленка', countryOfOrigin: null },
  'лам35': { name: 'Ламинационная пленка ф:3000м глянцевая 35см', sku: 'LAM-GL-35', unit: 'рул', format: '35', category: 'Ламинационная пленка', countryOfOrigin: null },
  'лам30': { name: 'Ламинационная пленка ф:3000м глянцевая 30см', sku: 'LAM-GL-30', unit: 'рул', format: '30', category: 'Ламинационная пленка', countryOfOrigin: null },

  // === ЛАМИНАЦИОННАЯ ПЛЕНКА (МАТТ) ===
  'лам84 матт': { name: 'Ламинационная пленка ф:3000м матовая 84см', sku: 'LAM-MT-84', unit: 'рул', format: '84мат', category: 'Ламинационная пленка', countryOfOrigin: null },
  'лам70 матт': { name: 'Ламинационная пленка ф:3000м матовая 70см', sku: 'LAM-MT-70', unit: 'рул', format: '70мат', category: 'Ламинационная пленка', countryOfOrigin: null },
  'лам72 матт': { name: 'Ламинационная пленка ф:3000м матовая 72см', sku: 'LAM-MT-72', unit: 'рул', format: '72мат', category: 'Ламинационная пленка', countryOfOrigin: null },
  'лам68 матт': { name: 'Ламинационная пленка ф:3000м матовая 68см', sku: 'LAM-MT-68', unit: 'рул', format: '68мат', category: 'Ламинационная пленка', countryOfOrigin: null },
  'лам62 матт': { name: 'Ламинационная пленка ф:3000м матовая 62см', sku: 'LAM-MT-62', unit: 'рул', format: '62мат', category: 'Ламинационная пленка', countryOfOrigin: null },
  'лам60 матт': { name: 'Ламинационная пленка ф:3000м матовая 60см', sku: 'LAM-MT-60', unit: 'рул', format: '60мат', category: 'Ламинационная пленка', countryOfOrigin: null },
  'лам58 матт': { name: 'Ламинационная пленка ф:3000м матовая 58см', sku: 'LAM-MT-58', unit: 'рул', format: '58мат', category: 'Ламинационная пленка', countryOfOrigin: null },
  'лам50 матт': { name: 'Ламинационная пленка ф:3000м матовая 50см', sku: 'LAM-MT-50', unit: 'рул', format: '50мат', category: 'Ламинационная пленка', countryOfOrigin: null },
  'лам42 матт': { name: 'Ламинационная пленка ф:3000м матовая 42см', sku: 'LAM-MT-42', unit: 'рул', format: '42мат', category: 'Ламинационная пленка', countryOfOrigin: null },
  'лам35 матт': { name: 'Ламинационная пленка ф:3000м матовая 35см', sku: 'LAM-MT-35', unit: 'рул', format: '35мат', category: 'Ламинационная пленка', countryOfOrigin: null },
  'лам30 матт': { name: 'Ламинационная пленка ф:3000м матовая 30см', sku: 'LAM-MT-30', unit: 'рул', format: '30мат', category: 'Ламинационная пленка', countryOfOrigin: null },

  // === ЛАМИНАЦИОННАЯ ПЛЕНКА (GOLD/SILVER) ===
  'лам 75 голд': { name: 'Ламинационная пленка металлическая ф:3000м золото 75см', sku: 'LAM-GOLD-75', unit: 'рул', format: '75 Gold', category: 'Ламинационная пленка', countryOfOrigin: null },
  'лам 70 голд': { name: 'Ламинационная пленка металлическая ф:3000м золото 70см', sku: 'LAM-GOLD-70', unit: 'рул', format: '70 Gold', category: 'Ламинационная пленка', countryOfOrigin: null },
  'лам 62 голд': { name: 'Ламинационная пленка металлическая ф:3000м золото 62см', sku: 'LAM-GOLD-62', unit: 'рул', format: '62 Gold', category: 'Ламинационная пленка', countryOfOrigin: null },
  'лам 60 голд': { name: 'Ламинационная пленка металлическая ф:3000м золото 60см', sku: 'LAM-GOLD-60', unit: 'рул', format: '60 Gold', category: 'Ламинационная пленка', countryOfOrigin: null },
  'лам 50 голд': { name: 'Ламинационная пленка металлическая ф:3000м золото 50см', sku: 'LAM-GOLD-50', unit: 'рул', format: '50 Gold', category: 'Ламинационная пленка', countryOfOrigin: null },
  'лам 70 силвер': { name: 'Ламинационная пленка металлическая ф:3000м серебро 70см', sku: 'LAM-SILVER-70', unit: 'рул', format: '70 Silver', category: 'Ламинационная пленка', countryOfOrigin: null },
  'лам 62 силвер': { name: 'Ламинационная пленка металлическая ф:3000м серебро 62см', sku: 'LAM-SILVER-62', unit: 'рул', format: '62 Silver', category: 'Ламинационная пленка', countryOfOrigin: null },
  'лам 60 силвер': { name: 'Ламинационная пленка металлическая ф:3000м серебро 60см', sku: 'LAM-SILVER-60', unit: 'рул', format: '60 Silver', category: 'Ламинационная пленка', countryOfOrigin: null },
  'лам 50 силвер': { name: 'Ламинационная пленка металлическая ф:3000м серебро 50см', sku: 'LAM-SILVER-50', unit: 'рул', format: '50 Silver', category: 'Ламинационная пленка', countryOfOrigin: null },
  'лам софт 50': { name: 'Ламинационная пленка Soft touch 50см', sku: 'LAM-SOFT-50', unit: 'рул', format: '50', category: 'Ламинационная пленка', countryOfOrigin: null },
  'лам голо 50': { name: 'Ламинационная пленка голографик 50см', sku: 'LAM-HOLO-50', unit: 'рул', format: '50', category: 'Ламинационная пленка', countryOfOrigin: null },
  'лам голо 70': { name: 'Ламинационная пленка голографик 70см', sku: 'LAM-HOLO-70', unit: 'рул', format: '70', category: 'Ламинационная пленка', countryOfOrigin: null },

  // === ОФСЕТНЫЕ ПЛАСТИНЫ ===
  '1280*1060': { name: 'Офсетная пластина UV СТР 1280*1060', sku: 'PLATE-UV-1280x1060', unit: 'шт', format: '1280*1060', category: 'Офсетные пластины', countryOfOrigin: null },
  '1050*795': { name: 'Офсетная пластина UV СТР 1050*795', sku: 'PLATE-UV-1050x795', unit: 'шт', format: '1050*795', category: 'Офсетные пластины', countryOfOrigin: null },
  '1050*795 стр': { name: 'Офсетная пластина СТР 1050*795', sku: 'PLATE-CTP-1050x795', unit: 'шт', format: '1050*795', category: 'Офсетные пластины', countryOfOrigin: null },
  '890*608': { name: 'Офсетная пластина UV СТР 890*608', sku: 'PLATE-UV-890x608', unit: 'шт', format: '890*608', category: 'Офсетные пластины', countryOfOrigin: null },
  '890*608 стр': { name: 'Офсетная пластина СТР 890*608', sku: 'PLATE-CTP-890x608', unit: 'шт', format: '890*608', category: 'Офсетные пластины', countryOfOrigin: null },
  '1030*790': { name: 'Офсетная пластина UV СТР 1030*790', sku: 'PLATE-UV-1030x790', unit: 'шт', format: '1030*790', category: 'Офсетные пластины', countryOfOrigin: null },
  '1030*790 стр': { name: 'Офсетная пластина СТР 1030*790', sku: 'PLATE-CTP-1030x790', unit: 'шт', format: '1030*790', category: 'Офсетные пластины', countryOfOrigin: null },
  '745*605': { name: 'Офсетная пластина UV СТР 745*605', sku: 'PLATE-UV-745x605', unit: 'шт', format: '745*605', category: 'Офсетные пластины', countryOfOrigin: null },
  '745*605 стр': { name: 'Офсетная пластина СТР 745*605', sku: 'PLATE-CTP-745x605', unit: 'шт', format: '745*605', category: 'Офсетные пластины', countryOfOrigin: null },
  '510*400 0.15': { name: 'Офсетная пластина UV СТР 510*400 (0,15)', sku: 'PLATE-UV-510x400-015', unit: 'шт', format: '510*400(0,15)', category: 'Офсетные пластины', countryOfOrigin: null },
  '510*400 0.15 стр': { name: 'Офсетная пластина СТР 510*400 (0,15)', sku: 'PLATE-CTP-510x400-015', unit: 'шт', format: '510*400 (0,15)', category: 'Офсетные пластины', countryOfOrigin: null },
  '610*860': { name: 'Фотополимерная печатная пластина 610*860 ММ', sku: 'PHOTO-PLATE-610x860', unit: 'шт', format: '610*860', category: 'Фотополимерная пластина', countryOfOrigin: null },

  // === ПРОЧЕЕ ===
  'смывка': { name: 'Смывка для валов Turquoise 60 WM', sku: 'CHEM-WASH60', unit: 'литр', format: null, category: 'Химия и расходники', countryOfOrigin: null },
  'увлажнение': { name: 'Добавка к увлажнению Alfa plus 3300', sku: 'CHEM-ALFA', unit: 'кг', format: null, category: 'Химия и расходники', countryOfOrigin: null },
  'нова ролл ап': { name: 'Смывка для валов Nova roll up', sku: 'CHEM-NOVA-ROLL', unit: 'литр', format: null, category: 'Химия и расходники', countryOfOrigin: null },
  'новафикс': { name: 'Очиститель для пластин Novafix', sku: 'CHEM-NOVAFIX', unit: 'литр', format: 'Novafix', category: 'Химия и расходники', countryOfOrigin: null },
  'нова плюс': { name: 'Нова плюс', sku: 'CHEM-NOVAPLUS', unit: 'литр', format: null, category: 'Химия и расходники', countryOfOrigin: null },
  'вдл глянц': { name: 'Водно-дисперсионный лак глянцевый', sku: 'CHEM-VDL-GL', unit: 'кг', format: '30кг/20кг', category: 'Химия и расходники', countryOfOrigin: null },
  'вдл матт': { name: 'Водно-дисперсионный лак матт', sku: 'CHEM-VDL-MT', unit: 'кг', format: '20кг', category: 'Химия и расходники', countryOfOrigin: null },
  'вдл выс глянц': { name: 'Водно-дисперсионный лак высоко глянцевый', sku: 'CHEM-VDL-HG', unit: 'кг', format: '20кг', category: 'Химия и расходники', countryOfOrigin: null },
  'термоклей 6092': { name: 'Термоклей в гранулах 6092', sku: 'GLUE-6092', unit: 'кг', format: '6092', category: 'Термоклей', countryOfOrigin: null },
  'термоклей 6030': { name: 'Термоклей в гранулах 6030', sku: 'GLUE-6030', unit: 'кг', format: '6030', category: 'Термоклей', countryOfOrigin: null },
  'термоклей': { name: 'Термоклей в гранулах', sku: 'GLUE-GRAN', unit: 'кг', format: null, category: 'Термоклей', countryOfOrigin: null },
  'тальк': { name: 'Противоотмарывающий порошок Spray Powder', sku: 'CHEM-TALK', unit: 'кг', format: null, category: 'Химия и расходники', countryOfOrigin: null },
  'губка': { name: 'Вискозная губка', sku: 'CHEM-GUBKA', unit: 'шт', format: null, category: 'Химия и расходники', countryOfOrigin: null },
  'пробойник': { name: 'Пробойник 0.5', sku: 'MISC-PUNCH-05', unit: 'шт', format: '0.5', category: 'Расходники', countryOfOrigin: null },
  'копир а3': { name: 'Копировальная бумага А3', sku: 'MISC-COPY-A3', unit: 'пач', format: 'А3', category: 'Расходники', countryOfOrigin: null },

  // === БИГОВАЛЬНЫЙ КАНАЛ ===
  '0,3*1,3': { name: 'Биговальный канал 0,3*1,3', sku: 'BIG-03x13', unit: 'пач', format: '0,3*1,3', category: 'Биговальный канал', countryOfOrigin: null },
  '0,4*1,2': { name: 'Биговальный канал 0,4*1,2', sku: 'BIG-04x12', unit: 'пач', format: '0,4*1,2', category: 'Биговальный канал', countryOfOrigin: null },
  '0,4*1,4': { name: 'Биговальный канал 0,4*1,4', sku: 'BIG-04x14', unit: 'пач', format: '0,4*1,4', category: 'Биговальный канал', countryOfOrigin: null },
  '0,5*1,5': { name: 'Биговальный канал 0,5*1,5', sku: 'BIG-05x15', unit: 'пач', format: '0,5*1,5', category: 'Биговальный канал', countryOfOrigin: null },
  '0,4*1,3': { name: 'Биговальный канал 0,4*1,3', sku: 'BIG-04x13', unit: 'пач', format: '0,4*1,3', category: 'Биговальный канал', countryOfOrigin: null },
  '0,7*2,3': { name: 'Биговальный канал 0,7*2,3', sku: 'BIG-07x23', unit: 'пач', format: '0,7*2,3', category: 'Биговальный канал', countryOfOrigin: null },
  '0,8*2,5': { name: 'Биговальный канал 0,8*2,5', sku: 'BIG-08x25', unit: 'пач', format: '0,8*2,5', category: 'Биговальный канал', countryOfOrigin: null },
  '0,6*2,1': { name: 'Биговальный канал 0,6*2,1', sku: 'BIG-06x21', unit: 'пач', format: '0,6*2,1', category: 'Биговальный канал', countryOfOrigin: null },

  // === ОФСЕТНОЕ ПОЛОТНО ===
  'резина 520*440': { name: 'Офсетное полотно 520*440', sku: 'RUBBER-520x440', unit: 'шт', format: '520*440', category: 'Офсетная резина', countryOfOrigin: null },
  'резина 772*627': { name: 'Офсетное полотно 772*627', sku: 'RUBBER-772x627', unit: 'шт', format: '772*627', category: 'Офсетная резина', countryOfOrigin: null },
  'резина 791*665': { name: 'Офсетное полотно 791*665', sku: 'RUBBER-791x665', unit: 'шт', format: '791*665', category: 'Офсетная резина', countryOfOrigin: null },
  'резина 1052*840': { name: 'Офсетное полотно 1052*840', sku: 'RUBBER-1052x840', unit: 'шт', format: '1052*840', category: 'Офсетная резина', countryOfOrigin: null },
  'резина 1060*860': { name: 'Офсетное полотно 1060*860', sku: 'RUBBER-1060x860', unit: 'шт', format: '1060*860', category: 'Офсетная резина', countryOfOrigin: null },
  'резина 490*415': { name: 'Офсетное полотно 490*415 (листовое)', sku: 'RUBBER-490x415', unit: 'шт', format: '49', category: 'Офсетная резина', countryOfOrigin: null },
  'резина рулон 1450': { name: 'Офсетное полотно рулонное 1450мм', sku: 'RUBBER-RUL-1450', unit: 'м', format: '1450', category: 'Офсетная резина', countryOfOrigin: null },
  'резина рулон 1350': { name: 'Офсетное полотно рулонное 1350мм', sku: 'RUBBER-RUL-1350', unit: 'м', format: '1350', category: 'Офсетная резина', countryOfOrigin: null },
  'резина рулон 1060': { name: 'Офсетное полотно рулонное 1060мм', sku: 'RUBBER-RUL-106', unit: 'м', format: '106', category: 'Офсетная резина', countryOfOrigin: null },
  'резина рулон 780': { name: 'Офсетное полотно рулонное 780мм', sku: 'RUBBER-RUL-78', unit: 'м', format: '78', category: 'Офсетная резина', countryOfOrigin: null },

  // === КАЛИБРОВОЧНЫЙ КАРТОН ===
  'калибр 0.1': { name: 'Калибровочный картон 1000*1400 (0.1мм)', sku: 'KALIB-01', unit: 'шт', format: '0.1', category: 'Калибровочный картон', countryOfOrigin: null },
  'калибр 0.15': { name: 'Калибровочный картон 1000*1400 (0.15мм)', sku: 'KALIB-015', unit: 'шт', format: '0.15', category: 'Калибровочный картон', countryOfOrigin: null },
  'калибр 0.2': { name: 'Калибровочный картон 1000*1400 (0.2мм)', sku: 'KALIB-02', unit: 'шт', format: '0.2', category: 'Калибровочный картон', countryOfOrigin: null },
  'калибр 0.3': { name: 'Калибровочный картон 1000*1400 (0.3мм)', sku: 'KALIB-03', unit: 'шт', format: '0.3', category: 'Калибровочный картон', countryOfOrigin: null },
  'калибр 0.4': { name: 'Калибровочный картон 1000*1400 (0.4мм)', sku: 'KALIB-04', unit: 'шт', format: '0.4', category: 'Калибровочный картон', countryOfOrigin: null },
  'калибр 0.5': { name: 'Калибровочный картон 1000*1400 (0.5мм)', sku: 'KALIB-05', unit: 'шт', format: '0.5', category: 'Калибровочный картон', countryOfOrigin: null },

  // === ПРОЧИЕ ===
  'курсор': { name: 'Курсор для календарей', sku: 'CURSOR', unit: 'шт', format: null, category: 'Расходники для календарей', countryOfOrigin: null },
  'ригель ок 32': { name: 'Ригель для календарей (белая) 32', sku: 'RIGEL-32-W', unit: 'шт', format: '32', category: 'Расходники для календарей', countryOfOrigin: null },
  'ригель кора 12': { name: 'Ригель для календарей (черная) 12', sku: 'RIGEL-12-B', unit: 'шт', format: '12', category: 'Расходники для календарей', countryOfOrigin: null },
  'ригель кора 32': { name: 'Ригель для календарей (черная) 32', sku: 'RIGEL-32-B', unit: 'шт', format: '32', category: 'Расходники для календарей', countryOfOrigin: null },
  'офсетный лак глянц': { name: 'Офсетный лак глянцевый', sku: 'INK-LAK-GL', unit: 'кг', format: 'глянц', category: 'Офсетные краски', countryOfOrigin: null },
  'марзан 25*25*720': { name: 'Марзан 25*25*720мм', sku: 'MARZ-720-25x25', unit: 'шт', format: '25*25*720мм', category: 'Марзан', countryOfOrigin: null },
  'марзан 10*5*1380': { name: 'Марзан 10*5*1380мм', sku: 'MARZ-138-10x5', unit: 'шт', format: '10*5*1380мм', category: 'Марзан', countryOfOrigin: null },
  'марзан 10*5*950': { name: 'Марзан 10*5*950мм', sku: 'MARZ-95-10x5-950', unit: 'шт', format: '10*5*950мм', category: 'Марзан', countryOfOrigin: null },
  'марзан 95*0.3': { name: 'Марзан 95см (0,3мм)', sku: 'MARZ-95-03', unit: 'шт', format: '95*0,3', category: 'Марзан', countryOfOrigin: null },
  'марзан 95*0.5': { name: 'Марзан 95см (0,5мм)', sku: 'MARZ-95-05', unit: 'шт', format: '95*0,5', category: 'Марзан', countryOfOrigin: null },
  'чехол 64': { name: 'Чехол для валов 64', sku: 'SLEEVE-64', unit: 'м', format: '64', category: 'Расходники', countryOfOrigin: null },
  'чехол 44': { name: 'Чехол для валов 44', sku: 'SLEEVE-44', unit: 'м', format: '44', category: 'Расходники', countryOfOrigin: null },
  'уф лампа': { name: 'УФ лампа', sku: 'UV-LAMP', unit: 'шт', format: null, category: 'Расходники', countryOfOrigin: null },

  // === ГРЕБЁНКА ===
  'гребёнка 1*4 ок': { name: 'Металлическая гребёнка 1/4 (6,4мм) белая', sku: 'GREB-1-4-W', unit: 'бабина', format: '1*4(ок)', category: 'Расходники для календарей', countryOfOrigin: null },
  'гребёнка 3*8 ок': { name: 'Металлическая гребёнка 3/8 (9,5мм) белая', sku: 'GREB-3-8-W', unit: 'бабина', format: '3*8(ок)', category: 'Расходники для календарей', countryOfOrigin: null },
  'гребёнка 3*8 кора': { name: 'Металлическая гребёнка 3/8 (9,5мм) чёрная', sku: 'GREB-3-8-B', unit: 'бабина', format: '3*8(кора)', category: 'Расходники для календарей', countryOfOrigin: null },
  'гребёнка 5*16 ок': { name: 'Металлическая гребёнка 5/16 (7,9мм) белая', sku: 'GREB-5-16-W', unit: 'бабина', format: '5*16(ок)', category: 'Расходники для календарей', countryOfOrigin: null },
  'гребёнка 5*8 ок': { name: 'Металлическая гребёнка 5/8 (16мм) белая', sku: 'GREB-5-8', unit: 'бабина', format: '5*8(ок)', category: 'Расходники для календарей', countryOfOrigin: null },
  'гребёнка 3*4 ок': { name: 'Металлическая гребёнка 3/4 (19мм) белая', sku: 'GREB-3-4', unit: 'бабина', format: '3*4(ок)', category: 'Расходники для календарей', countryOfOrigin: null },
  'гребёнка 9*16 ок': { name: 'Металлическая гребёнка 9/16 (14,3мм) белая', sku: 'GREB-9-16', unit: 'бабина', format: '9*16(ок)', category: 'Расходники для календарей', countryOfOrigin: null },
  'гребёнка 5*16 кора': { name: 'Металлическая гребёнка 5/16 (7,9мм) чёрная', sku: 'GREB-5-16-B', unit: 'бабина', format: '5*16(кора)', category: 'Расходники для календарей', countryOfOrigin: null },
  'гребёнка 1*2 ок': { name: 'Металлическая гребёнка 1/2 (12,7мм)', sku: 'GREB-1-2', unit: 'бабина', format: '1*2(ок)', category: 'Расходники для календарей', countryOfOrigin: null },
  'гребёнка 7*16 ок': { name: 'Металлическая гребёнка 7/16 (11,1мм)', sku: 'GREB-7-16', unit: 'бабина', format: '7*16(ок)', category: 'Расходники для календарей', countryOfOrigin: null },
  'гребёнка 1*4 кора': { name: 'Металлическая гребёнка 1/4 (6,4мм) чёрная', sku: 'GREB-1-4-B', unit: 'бабина', format: '1*4(кора)', category: 'Расходники для календарей', countryOfOrigin: null },

  // === КРАСКИ И ПАНТОНЫ ===
  'краска power кизил': { name: 'Офсетная краска Power Process красная', sku: 'INK-POWER-RED', unit: 'кг', format: 'кизил', category: 'Офсетные краски', countryOfOrigin: null },
  'краска фокус кизил': { name: 'Офсетная краска Focus Process красная', sku: 'INK-FOCUS-RED', unit: 'кг', format: 'кизил', category: 'Офсетные краски', countryOfOrigin: null },
  'краска иннов кизил': { name: 'Офсетная краска INNOVATION красная', sku: 'INK-INNOV-RED', unit: 'кг', format: 'кизил', category: 'Офсетные краски', countryOfOrigin: null },
  'краска иннов кора': { name: 'Офсетная краска INNOVATION чёрная', sku: 'INK-INNOV-BLACK', unit: 'кг', format: 'кора', category: 'Офсетные краски', countryOfOrigin: null },

  // === ПРОЯВИТЕЛИ ===
  'проявитель хаммонд 1+9': { name: 'Проявитель Hammond 1+9', sku: 'CHEM-PROY-HAM-19', unit: 'литр', format: 'Hammond 1+9', category: 'Химия и расходники', countryOfOrigin: null },
  'проявитель хаммонд стр': { name: 'Проявитель Hammond СТР', sku: 'CHEM-PROY-HAM', unit: 'литр', format: 'Hammond СТР', category: 'Химия и расходники', countryOfOrigin: null },
  'проявитель нова uv': { name: 'Проявитель Нова 1+9 UV', sku: 'CHEM-PROY-UV', unit: 'литр', format: 'Нова 1+9 UV', category: 'Химия и расходники', countryOfOrigin: null },
  'проявитель стр текнова': { name: 'Проявитель СТР (teknova)', sku: 'CHEM-PROY-CTP', unit: 'литр', format: 'СТР(teknova)', category: 'Химия и расходники', countryOfOrigin: null },
  'проявитель порошок': { name: 'Проявитель для пластин (порошок, 200гр)', sku: 'CHEM-PROY-POWDER', unit: 'пач', format: null, category: 'Химия и расходники', countryOfOrigin: null },
};

async function main() {
  const imports = await prisma.product.findMany({
    where: { sku: { startsWith: 'IMPORT-' } },
    select: { id: true, name: true, sku: true, stock: true },
    orderBy: { name: 'asc' },
  });

  console.log(`Found ${imports.length} IMPORT products\n`);

  let updated = 0;
  let notFound = 0;
  const unmapped: string[] = [];

  for (const p of imports) {
    const key = p.name.trim().toLowerCase();
    const mapping = MAPPING[key];

    if (mapping) {
      await prisma.product.update({
        where: { id: p.id },
        data: {
          name: mapping.name,
          sku: mapping.sku,
          unit: mapping.unit,
          format: mapping.format,
          category: mapping.category,
          countryOfOrigin: mapping.countryOfOrigin,
        },
      });
      console.log(`  OK  ${p.sku} "${p.name}" → "${mapping.name}" (${mapping.sku})`);
      updated++;
    } else {
      unmapped.push(`${p.sku} "${p.name}" stock=${Number(p.stock)}`);
      notFound++;
    }
  }

  console.log(`\n=== Result ===`);
  console.log(`Updated: ${updated}`);
  console.log(`Not mapped: ${notFound}`);

  if (unmapped.length > 0) {
    console.log(`\n=== Unmapped products ===`);
    unmapped.forEach(u => console.log(`  ${u}`));
  }

  await prisma.$disconnect();
}

main().catch(console.error);
