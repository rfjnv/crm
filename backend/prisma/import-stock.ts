import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * import-stock.ts
 *
 * Stock import script for the CRM warehouse module.
 * Data source: "остаток 02 (3).xlsx" (inventory balance, last section).
 *
 * All 219 products are hardcoded below so the script can run
 * on production (Render) without needing the Excel file.
 *
 * Behavior:
 *   - If a product with the given SKU already exists => UPDATE its stock.
 *   - If the product does NOT exist => CREATE it with the stock value from Excel.
 *
 * Usage:
 *   npx tsx prisma/import-stock.ts
 *   npm run db:import-stock
 */

interface StockProduct {
  name: string;
  sku: string;
  unit: string;
  format: string | null;
  category: string;
  countryOfOrigin: string | null;
  stock: number;
}

const PRODUCTS: StockProduct[] = [
  // ==================== САМОКЛЕЮЩАЯСЯ БУМАГА (Китай, белая) ====================
  { name: 'Самоклеющаяся бумага Ф:70*100 белая (Китай)', sku: 'SK-CN-70x100', unit: 'лист', format: '70*100', category: 'Самоклеющаяся бумага', countryOfOrigin: 'Китай', stock: 108930 },
  { name: 'Самоклеющаяся бумага Ф:50*70 белая (Китай)', sku: 'SK-CN-50x70', unit: 'лист', format: '50*70', category: 'Самоклеющаяся бумага', countryOfOrigin: 'Китай', stock: 299250 },
  { name: 'Самоклеющаяся бумага Ф:70*100 белая б/н (Китай)', sku: 'SK-CN-70x100-BN', unit: 'лист', format: '70*100 б/н', category: 'Самоклеющаяся бумага', countryOfOrigin: 'Китай', stock: 78200 },
  { name: 'Самоклеющаяся бумага Ф:50*70 белая б/н (Китай)', sku: 'SK-CN-50x70-BN', unit: 'лист', format: '50*70 б/н', category: 'Самоклеющаяся бумага', countryOfOrigin: 'Китай', stock: 195600 },
  { name: 'Самоклеющаяся бумага Ф:50*35 белая (Китай)', sku: 'SK-CN-50x35', unit: 'лист', format: '50*35', category: 'Самоклеющаяся бумага', countryOfOrigin: 'Китай', stock: 158600 },
  { name: 'Самоклеющаяся бумага Ф:50*35 белая б/н (Китай)', sku: 'SK-CN-50x35-BN', unit: 'лист', format: '50*35 б/н', category: 'Самоклеющаяся бумага', countryOfOrigin: 'Китай', stock: 373400 },

  // ==================== САМОКЛЕЮЩАЯСЯ БУМАГА (Китай, красная) ====================
  { name: 'Самоклеющаяся бумага Ф:70*100 красная (Китай)', sku: 'SK-CN-RED-70x100', unit: 'лист', format: '70*100', category: 'Самоклеющаяся бумага', countryOfOrigin: 'Китай', stock: 655 },
  { name: 'Самоклеющаяся бумага Ф:50*70 красная (Китай)', sku: 'SK-CN-RED-50x70', unit: 'лист', format: '50*70', category: 'Самоклеющаяся бумага', countryOfOrigin: 'Китай', stock: 1100 },
  { name: 'Самоклеющаяся бумага Ф:70*100 красная б/н (Китай)', sku: 'SK-CN-RED-70x100-BN', unit: 'лист', format: '70*100 б/н', category: 'Самоклеющаяся бумага', countryOfOrigin: 'Китай', stock: 20000 },
  { name: 'Самоклеющаяся бумага Ф:50*70 красная б/н (Китай)', sku: 'SK-CN-RED-50x70-BN', unit: 'лист', format: '50*70 б/н', category: 'Самоклеющаяся бумага', countryOfOrigin: 'Китай', stock: 0 },

  // ==================== САМОКЛЕЮЩАЯСЯ БУМАГА (Турция) ====================
  { name: 'Самоклеющаяся бумага Ф:70*100 (Турция)', sku: 'SK-TR-70x100', unit: 'лист', format: '70*100', category: 'Самоклеющаяся бумага', countryOfOrigin: 'Турция', stock: 23600 },
  { name: 'Самоклеющаяся бумага Ф:50*70 (Турция)', sku: 'SK-TR-50x70', unit: 'лист', format: '50*70', category: 'Самоклеющаяся бумага', countryOfOrigin: 'Турция', stock: 64297 },

  // ==================== САМОКЛЕЮЩАЯСЯ БУМАГА В РУЛОНАХ ====================
  { name: 'Самоклеющаяся бумага в рулонах 1м*2000м (акриловый клей)', sku: 'SK-RUL-FASSON-A', unit: 'рул', format: 'BJ 993', category: 'Самоклеющаяся бумага', countryOfOrigin: null, stock: 16 },
  { name: 'Самоклеющаяся бумага в рулонах 1м*2000м (каучуковый клей)', sku: 'SK-RUL-FASSON-K', unit: 'рул', format: 'BJ 995', category: 'Самоклеющаяся бумага', countryOfOrigin: null, stock: 7 },
  { name: 'Самоклеющаяся бумага в рулонах 1м*2000м', sku: 'SK-RUL-LIANGDU', unit: 'рул', format: 'Китай', category: 'Самоклеющаяся бумага', countryOfOrigin: 'Китай', stock: 17 },
  { name: 'Самоклеющаяся бумага в рулонах 1м*2000м ненси', sku: 'SK-RUL-NENSI', unit: 'рул', format: 'Китай', category: 'Самоклеющаяся бумага', countryOfOrigin: 'Китай', stock: 3 },

  // ==================== ЦЕЛЛЮЛОЗНЫЙ КАРТОН ====================
  { name: 'Целлюлозный многослойный картон 210гр/м2 70*100', sku: 'KART-IND-210-70x100', unit: 'лист', format: 'Индия 210гр (70*100)', category: 'Целлюлозный картон', countryOfOrigin: 'Индия', stock: 75 },
  { name: 'Целлюлозный многослойный картон 250гр/м2 70*100 (Индия)', sku: 'KART-IND-250-70x100', unit: 'лист', format: 'Индия 250гр (70*100)', category: 'Целлюлозный картон', countryOfOrigin: 'Индия', stock: 345 },
  { name: 'Целлюлозный многослойный картон 250гр/м2 70*100 (Китай)', sku: 'KART-CN-250-70x100', unit: 'лист', format: 'Китай 250гр (70*100)', category: 'Целлюлозный картон', countryOfOrigin: 'Китай', stock: 500 },
  { name: 'Целлюлозный многослойный картон 270гр рулон 62см (Китай)', sku: 'KART-CN-270-RUL-62', unit: 'рул', format: 'Китай 270гр (62)', category: 'Целлюлозный картон', countryOfOrigin: 'Китай', stock: 3 },
  { name: 'Целлюлозный многослойный картон 300гр рулон 62см (Китай)', sku: 'KART-CN-300-RUL-62', unit: 'рул', format: 'Китай 300гр (62)', category: 'Целлюлозный картон', countryOfOrigin: 'Китай', stock: 1 },
  { name: 'Целлюлозный многослойный картон 270гр 62*94 (Китай)', sku: 'KART-CN-270-62x94', unit: 'лист', format: '62*94', category: 'Целлюлозный картон', countryOfOrigin: 'Китай', stock: 4080 },
  { name: 'Целлюлозный многослойный картон 300гр 62*94 (Китай)', sku: 'KART-CN-300-62x94', unit: 'лист', format: '62*94', category: 'Целлюлозный картон', countryOfOrigin: 'Китай', stock: 470 },

  // ==================== МЕЛОВАННАЯ БУМАГА ====================
  { name: 'Мелованная бумага 250гр/м2 70*100', sku: 'MEL-HK-250-70x100', unit: 'лист', format: '250гр (70*100)', category: 'Мелованная бумага', countryOfOrigin: null, stock: 5375 },
  { name: 'Мелованная бумага 170гр/м2 70*100', sku: 'MEL-HK-170-70x100', unit: 'лист', format: '170гр (70*100)', category: 'Мелованная бумага', countryOfOrigin: null, stock: 8750 },
  { name: 'Мелованная бумага 105гр/м2 70*100 МАТТ', sku: 'MEL-HK-105-MATT', unit: 'лист', format: '105гр (70*100) матт', category: 'Мелованная бумага', countryOfOrigin: null, stock: 22500 },

  // ==================== ФОЛЬГА ДЛЯ ТИСНЕНИЯ (золото / серебро) ====================
  { name: 'Фольга для тиснения 64см*120м золото', sku: 'FOIL-GOLD-120', unit: 'рул', format: 'золото', category: 'Фольга для тиснения', countryOfOrigin: null, stock: 689 },
  { name: 'Фольга для тиснения 64см*240м золото', sku: 'FOIL-GOLD-240', unit: 'рул', format: 'золото', category: 'Фольга для тиснения', countryOfOrigin: null, stock: 345 },
  { name: 'Фольга для тиснения 64см*360м золото', sku: 'FOIL-GOLD-360', unit: 'рул', format: 'золото', category: 'Фольга для тиснения', countryOfOrigin: null, stock: 253 },
  { name: 'Фольга для тиснения 64см*120м серебро', sku: 'FOIL-SILVER-120', unit: 'рул', format: 'серебро', category: 'Фольга для тиснения', countryOfOrigin: null, stock: 1292 },
  { name: 'Фольга для тиснения 64см*240м серебро', sku: 'FOIL-SILVER-240', unit: 'рул', format: 'серебро', category: 'Фольга для тиснения', countryOfOrigin: null, stock: 579 },
  { name: 'Фольга для тиснения 64см*360м серебро', sku: 'FOIL-SILVER-360', unit: 'рул', format: 'серебро', category: 'Фольга для тиснения', countryOfOrigin: null, stock: 476 },

  // ==================== ФОЛЬГА (золото / серебро, жёлтая спина) ====================
  { name: 'Фольга для тиснения 64см*120м золото (сарик)', sku: 'FOIL-GOLD-Y-120', unit: 'рул', format: 'золото (сарик)', category: 'Фольга для тиснения', countryOfOrigin: null, stock: 1958 },
  { name: 'Фольга для тиснения 64см*240м золото (сарик)', sku: 'FOIL-GOLD-Y-240', unit: 'рул', format: 'золото (сарик)', category: 'Фольга для тиснения', countryOfOrigin: null, stock: 599 },
  { name: 'Фольга для тиснения 64см*360м золото (сарик)', sku: 'FOIL-GOLD-Y-360', unit: 'рул', format: 'золото (сарик)', category: 'Фольга для тиснения', countryOfOrigin: null, stock: 300 },
  { name: 'Фольга для тиснения 64см*120м серебро (сарик)', sku: 'FOIL-SILVER-Y-120', unit: 'рул', format: 'серебро (сарик)', category: 'Фольга для тиснения', countryOfOrigin: null, stock: 500 },
  { name: 'Фольга для тиснения 64см*240м серебро (сарик)', sku: 'FOIL-SILVER-Y-240', unit: 'рул', format: 'серебро (сарик)', category: 'Фольга для тиснения', countryOfOrigin: null, stock: 200 },
  { name: 'Фольга для тиснения 64см*360м серебро (сарик)', sku: 'FOIL-SILVER-Y-360', unit: 'рул', format: 'серебро (сарик)', category: 'Фольга для тиснения', countryOfOrigin: null, stock: 200 },

  // ==================== ФОЛЬГА (цветная) ====================
  { name: 'Фольга для тиснения цветная 64см*120м зелёная', sku: 'FOIL-GREEN-120', unit: 'рул', format: 'яшил', category: 'Фольга для тиснения', countryOfOrigin: null, stock: 24 },
  { name: 'Фольга для тиснения переливающаяся 64см*120м серебро', sku: 'FOIL-HOLO-120', unit: 'рул', format: 'переливающий сер', category: 'Фольга для тиснения', countryOfOrigin: null, stock: 116 },
  { name: 'Фольга галаграмма песочная зелёная', sku: 'FOIL-HOLO-SAND', unit: 'рул', format: 'песочный яшил', category: 'Фольга для тиснения', countryOfOrigin: null, stock: 3 },
  { name: 'Фольга для тиснения цветная 64см*120м чёрная', sku: 'FOIL-BLACK-120', unit: 'рул', format: 'кора', category: 'Фольга для тиснения', countryOfOrigin: null, stock: 85 },
  { name: 'Фольга для тиснения цветная 64см*120м красная', sku: 'FOIL-RED-120', unit: 'рул', format: 'кизил', category: 'Фольга для тиснения', countryOfOrigin: null, stock: 215 },
  { name: 'Фольга для тиснения цветная 64см*120м синяя', sku: 'FOIL-BLUE-120', unit: 'рул', format: 'оч кук', category: 'Фольга для тиснения', countryOfOrigin: null, stock: 51 },
  { name: 'Фольга для тиснения цветная 64см*180м белая', sku: 'FOIL-WHITE-180', unit: 'рул', format: 'ок', category: 'Фольга для тиснения', countryOfOrigin: null, stock: 56 },
  { name: 'Фольга для тиснения цветная 64см*120м фиолетовая', sku: 'FOIL-VIOLET-120', unit: 'рул', format: 'фиолет', category: 'Фольга для тиснения', countryOfOrigin: null, stock: 136 },
  { name: 'Фольга для тиснения цветная 64см*120м медная', sku: 'FOIL-COPPER-120', unit: 'рул', format: 'медная', category: 'Фольга для тиснения', countryOfOrigin: null, stock: 158 },
  { name: 'Фольга для тиснения цветная 64см*120м жемчужная', sku: 'FOIL-PEARL-120', unit: 'рул', format: 'жемчук', category: 'Фольга для тиснения', countryOfOrigin: null, stock: 98 },
  { name: 'Фольга для тиснения цветная 64см*120м ассорти', sku: 'FOIL-COLOR-120', unit: 'рул', format: 'Цветная', category: 'Фольга для тиснения', countryOfOrigin: null, stock: 20 },

  // ==================== ФОТОПОЛИМЕРНАЯ ПЛАСТИНА ====================
  { name: 'Фотополимерная печатная пластина 610*860 ММ', sku: 'PHOTO-PLATE-610x860', unit: 'шт', format: '610*860', category: 'Фотополимерная пластина', countryOfOrigin: null, stock: 12 },

  // ==================== UV ЛАК (ПОЛИГР. БЕСЦВЕТНАЯ КРАСКА) ====================
  { name: 'Полигр. бесцв. краска PI-50', sku: 'UV-PI50', unit: 'кг', format: 'PI 50', category: 'UV лак', countryOfOrigin: 'Турция', stock: 750 },
  { name: 'Полигр. бесцв. краска PI-125', sku: 'UV-PI125', unit: 'кг', format: 'PI 125', category: 'UV лак', countryOfOrigin: 'Турция', stock: 1025 },
  { name: 'Полигр. бесцв. краска PI-180', sku: 'UV-PI180', unit: 'кг', format: 'PI 180', category: 'UV лак', countryOfOrigin: 'Турция', stock: 4064 },
  { name: 'Полигр. бесцв. краска PI-180 Бельгия', sku: 'UV-PI180-BE', unit: 'кг', format: 'PI 180 Белгия', category: 'UV лак', countryOfOrigin: 'Бельгия', stock: 114 },
  { name: 'Полигр. бесцв. краска PI-250', sku: 'UV-PI250', unit: 'кг', format: 'PI 250', category: 'UV лак', countryOfOrigin: 'Турция', stock: 3575 },
  { name: 'Полигр. бесцв. краска PI-250 Бельгия', sku: 'UV-PI250-BE', unit: 'кг', format: 'PI 250 Белгия', category: 'UV лак', countryOfOrigin: 'Бельгия', stock: 12 },
  { name: 'Полигр. бесцв. краска PI-400А', sku: 'UV-PI400A', unit: 'кг', format: 'PI 400А', category: 'UV лак', countryOfOrigin: 'Турция', stock: 2650 },
  { name: 'Полигр. бесцв. краска PI-400А Бельгия', sku: 'UV-PI400A-BE', unit: 'кг', format: 'PI 400А Белгия', category: 'UV лак', countryOfOrigin: 'Бельгия', stock: 25 },
  { name: 'Полигр. бесцв. краска PI-500 (emboss)', sku: 'UV-PI500', unit: 'кг', format: 'emboss', category: 'UV лак', countryOfOrigin: 'Турция', stock: 170 },

  // ==================== ЛАМИНАЦИОННАЯ ПЛЕНКА (ГЛЯНЦЕВАЯ) ====================
  { name: 'Ламинационная пленка ф:3000м глянцевая 84см', sku: 'LAM-GL-84', unit: 'рул', format: '84', category: 'Ламинационная пленка', countryOfOrigin: null, stock: 56 },
  { name: 'Ламинационная пленка ф:3000м глянцевая 78см', sku: 'LAM-GL-78', unit: 'рул', format: '78', category: 'Ламинационная пленка', countryOfOrigin: null, stock: 26 },
  { name: 'Ламинационная пленка ф:3000м глянцевая 74см', sku: 'LAM-GL-74', unit: 'рул', format: '74', category: 'Ламинационная пленка', countryOfOrigin: null, stock: 34 },
  { name: 'Ламинационная пленка ф:3000м глянцевая 72см', sku: 'LAM-GL-72', unit: 'рул', format: '72', category: 'Ламинационная пленка', countryOfOrigin: null, stock: 0 },
  { name: 'Ламинационная пленка ф:3000м глянцевая 70см', sku: 'LAM-GL-70', unit: 'рул', format: '70', category: 'Ламинационная пленка', countryOfOrigin: null, stock: 0 },
  { name: 'Ламинационная пленка ф:3000м глянцевая 68см', sku: 'LAM-GL-68', unit: 'рул', format: '68', category: 'Ламинационная пленка', countryOfOrigin: null, stock: 20 },
  { name: 'Ламинационная пленка ф:3000м глянцевая 65см', sku: 'LAM-GL-65', unit: 'рул', format: '65', category: 'Ламинационная пленка', countryOfOrigin: null, stock: 16 },
  { name: 'Ламинационная пленка ф:3000м глянцевая 62см', sku: 'LAM-GL-62', unit: 'рул', format: '62', category: 'Ламинационная пленка', countryOfOrigin: null, stock: 0 },
  { name: 'Ламинационная пленка ф:3000м глянцевая 60см', sku: 'LAM-GL-60', unit: 'рул', format: '60', category: 'Ламинационная пленка', countryOfOrigin: null, stock: 44 },
  { name: 'Ламинационная пленка ф:3000м глянцевая 58см', sku: 'LAM-GL-58', unit: 'рул', format: '58', category: 'Ламинационная пленка', countryOfOrigin: null, stock: 46 },
  { name: 'Ламинационная пленка ф:3000м глянцевая 55см', sku: 'LAM-GL-55', unit: 'рул', format: '55', category: 'Ламинационная пленка', countryOfOrigin: null, stock: 18 },
  { name: 'Ламинационная пленка ф:3000м глянцевая 50см', sku: 'LAM-GL-50', unit: 'рул', format: '50', category: 'Ламинационная пленка', countryOfOrigin: null, stock: 79 },
  { name: 'Ламинационная пленка ф:3000м глянцевая 48см', sku: 'LAM-GL-48', unit: 'рул', format: '48', category: 'Ламинационная пленка', countryOfOrigin: null, stock: 59 },
  { name: 'Ламинационная пленка ф:3000м глянцевая 42см', sku: 'LAM-GL-42', unit: 'рул', format: '42', category: 'Ламинационная пленка', countryOfOrigin: null, stock: 0 },
  { name: 'Ламинационная пленка ф:3000м глянцевая 35см', sku: 'LAM-GL-35', unit: 'рул', format: '35', category: 'Ламинационная пленка', countryOfOrigin: null, stock: 0 },
  { name: 'Ламинационная пленка ф:3000м глянцевая 30см', sku: 'LAM-GL-30', unit: 'рул', format: '30', category: 'Ламинационная пленка', countryOfOrigin: null, stock: 3 },

  // ==================== ЛАМИНАЦИОННАЯ ПЛЕНКА (МАТОВАЯ) ====================
  { name: 'Ламинационная пленка ф:3000м матовая 84см', sku: 'LAM-MT-84', unit: 'рул', format: '84мат', category: 'Ламинационная пленка', countryOfOrigin: null, stock: 7 },
  { name: 'Ламинационная пленка ф:3000м матовая 70см', sku: 'LAM-MT-70', unit: 'рул', format: '70мат', category: 'Ламинационная пленка', countryOfOrigin: null, stock: 5 },
  { name: 'Ламинационная пленка ф:3000м матовая 72см', sku: 'LAM-MT-72', unit: 'рул', format: '72мат', category: 'Ламинационная пленка', countryOfOrigin: null, stock: 18 },
  { name: 'Ламинационная пленка ф:3000м матовая 68см', sku: 'LAM-MT-68', unit: 'рул', format: '68мат', category: 'Ламинационная пленка', countryOfOrigin: null, stock: 28 },
  { name: 'Ламинационная пленка ф:3000м матовая 62см', sku: 'LAM-MT-62', unit: 'рул', format: '62мат', category: 'Ламинационная пленка', countryOfOrigin: null, stock: 54 },
  { name: 'Ламинационная пленка ф:3000м матовая 60см', sku: 'LAM-MT-60', unit: 'рул', format: '60мат', category: 'Ламинационная пленка', countryOfOrigin: null, stock: 66 },
  { name: 'Ламинационная пленка ф:3000м матовая 58см', sku: 'LAM-MT-58', unit: 'рул', format: '58мат', category: 'Ламинационная пленка', countryOfOrigin: null, stock: 37 },
  { name: 'Ламинационная пленка ф:3000м матовая 50см', sku: 'LAM-MT-50', unit: 'рул', format: '50мат', category: 'Ламинационная пленка', countryOfOrigin: null, stock: 4 },
  { name: 'Ламинационная пленка ф:3000м матовая 42см', sku: 'LAM-MT-42', unit: 'рул', format: '42мат', category: 'Ламинационная пленка', countryOfOrigin: null, stock: 1 },
  { name: 'Ламинационная пленка ф:3000м матовая 35см', sku: 'LAM-MT-35', unit: 'рул', format: '35мат', category: 'Ламинационная пленка', countryOfOrigin: null, stock: 0 },
  { name: 'Ламинационная пленка ф:3000м матовая 30см', sku: 'LAM-MT-30', unit: 'рул', format: '30мат', category: 'Ламинационная пленка', countryOfOrigin: null, stock: 1 },

  // ==================== ЛАМИНАЦИОННАЯ ПЛЕНКА (МЕТАЛЛИЧЕСКАЯ - GOLD) ====================
  { name: 'Ламинационная пленка металлическая ф:3000м золото 75см', sku: 'LAM-GOLD-75', unit: 'рул', format: '75 Gold', category: 'Ламинационная пленка', countryOfOrigin: null, stock: 15 },
  { name: 'Ламинационная пленка металлическая ф:3000м золото 70см', sku: 'LAM-GOLD-70', unit: 'рул', format: '70 Gold', category: 'Ламинационная пленка', countryOfOrigin: null, stock: 0 },
  { name: 'Ламинационная пленка металлическая ф:3000м золото 62см', sku: 'LAM-GOLD-62', unit: 'рул', format: '62 Gold', category: 'Ламинационная пленка', countryOfOrigin: null, stock: 9 },
  { name: 'Ламинационная пленка металлическая ф:3000м золото 60см', sku: 'LAM-GOLD-60', unit: 'рул', format: '60 Gold', category: 'Ламинационная пленка', countryOfOrigin: null, stock: 0 },
  { name: 'Ламинационная пленка металлическая ф:3000м золото 50см', sku: 'LAM-GOLD-50', unit: 'рул', format: '50 Gold', category: 'Ламинационная пленка', countryOfOrigin: null, stock: 10 },

  // ==================== ЛАМИНАЦИОННАЯ ПЛЕНКА (МЕТАЛЛИЧЕСКАЯ - SILVER) ====================
  { name: 'Ламинационная пленка металлическая ф:3000м серебро 70см', sku: 'LAM-SILVER-70', unit: 'рул', format: '70 Silver', category: 'Ламинационная пленка', countryOfOrigin: null, stock: 0 },
  { name: 'Ламинационная пленка металлическая ф:3000м серебро 62см', sku: 'LAM-SILVER-62', unit: 'рул', format: '62 Silver', category: 'Ламинационная пленка', countryOfOrigin: null, stock: 8 },
  { name: 'Ламинационная пленка металлическая ф:3000м серебро 60см', sku: 'LAM-SILVER-60', unit: 'рул', format: '60 Silver', category: 'Ламинационная пленка', countryOfOrigin: null, stock: 7 },
  { name: 'Ламинационная пленка металлическая ф:3000м серебро 50см', sku: 'LAM-SILVER-50', unit: 'рул', format: '50 Silver', category: 'Ламинационная пленка', countryOfOrigin: null, stock: 1 },

  // ==================== ЛАМИНАЦИОННАЯ ПЛЕНКА (СПЕЦ) ====================
  { name: 'Ламинационная пленка Soft touch 50см', sku: 'LAM-SOFT-50', unit: 'рул', format: '50', category: 'Ламинационная пленка', countryOfOrigin: null, stock: 9 },
  { name: 'Ламинационная пленка голографик 50см', sku: 'LAM-HOLO-50', unit: 'рул', format: '50', category: 'Ламинационная пленка', countryOfOrigin: null, stock: 6 },
  { name: 'Ламинационная пленка голографик 70см', sku: 'LAM-HOLO-70', unit: 'рул', format: '70', category: 'Ламинационная пленка', countryOfOrigin: null, stock: 6 },

  // ==================== ОФСЕТНАЯ ПЛАСТИНА UV СТР ====================
  { name: 'Офсетная пластина UV СТР 1280*1060', sku: 'PLATE-UV-1280x1060', unit: 'шт', format: '1280*1060', category: 'Офсетные пластины', countryOfOrigin: null, stock: 450 },
  { name: 'Офсетная пластина UV СТР 1050*820', sku: 'PLATE-UV-1050x820', unit: 'шт', format: '1050*820', category: 'Офсетные пластины', countryOfOrigin: null, stock: 0 },
  { name: 'Офсетная пластина UV СТР 1050*795', sku: 'PLATE-UV-1050x795', unit: 'шт', format: '1050*795', category: 'Офсетные пластины', countryOfOrigin: null, stock: 1000 },
  { name: 'Офсетная пластина UV СТР 1030*820', sku: 'PLATE-UV-1030x820', unit: 'шт', format: '1030*820', category: 'Офсетные пластины', countryOfOrigin: null, stock: 0 },
  { name: 'Офсетная пластина UV СТР 1030*790', sku: 'PLATE-UV-1030x790', unit: 'шт', format: '1030*790', category: 'Офсетные пластины', countryOfOrigin: null, stock: 1000 },
  { name: 'Офсетная пластина UV СТР 1030*770', sku: 'PLATE-UV-1030x770', unit: 'шт', format: '1030*770', category: 'Офсетные пластины', countryOfOrigin: null, stock: 0 },
  { name: 'Офсетная пластина UV СТР 920*605', sku: 'PLATE-UV-920x605', unit: 'шт', format: '920*605', category: 'Офсетные пластины', countryOfOrigin: null, stock: 0 },
  { name: 'Офсетная пластина UV СТР 925*740', sku: 'PLATE-UV-925x740', unit: 'шт', format: '925*740', category: 'Офсетные пластины', countryOfOrigin: null, stock: 0 },
  { name: 'Офсетная пластина UV СТР 1050*811', sku: 'PLATE-UV-1050x811', unit: 'шт', format: '1050*811', category: 'Офсетные пластины', countryOfOrigin: null, stock: 0 },
  { name: 'Офсетная пластина UV СТР 890*643', sku: 'PLATE-UV-890x643', unit: 'шт', format: '890*643', category: 'Офсетные пластины', countryOfOrigin: null, stock: 0 },
  { name: 'Офсетная пластина UV СТР 890*608', sku: 'PLATE-UV-890x608', unit: 'шт', format: '890*608', category: 'Офсетные пластины', countryOfOrigin: null, stock: 1000 },
  { name: 'Офсетная пластина UV СТР 890*576', sku: 'PLATE-UV-890x576', unit: 'шт', format: '890*576', category: 'Офсетные пластины', countryOfOrigin: null, stock: 0 },
  { name: 'Офсетная пластина UV СТР 860*580', sku: 'PLATE-UV-860x580', unit: 'шт', format: '860*580', category: 'Офсетные пластины', countryOfOrigin: null, stock: 0 },
  { name: 'Офсетная пластина UV СТР 850*566', sku: 'PLATE-UV-850x566', unit: 'шт', format: '850*566', category: 'Офсетные пластины', countryOfOrigin: null, stock: 0 },
  { name: 'Офсетная пластина UV СТР 850*567', sku: 'PLATE-UV-850x567', unit: 'шт', format: '850*567', category: 'Офсетные пластины', countryOfOrigin: null, stock: 0 },
  { name: 'Офсетная пластина UV СТР 755*625', sku: 'PLATE-UV-755x625', unit: 'шт', format: '755*625', category: 'Офсетные пластины', countryOfOrigin: null, stock: 0 },
  { name: 'Офсетная пластина UV СТР 775*635', sku: 'PLATE-UV-775x635', unit: 'шт', format: '775*635', category: 'Офсетные пластины', countryOfOrigin: null, stock: 0 },
  { name: 'Офсетная пластина UV СТР 775*605', sku: 'PLATE-UV-775x605', unit: 'шт', format: '775*605', category: 'Офсетные пластины', countryOfOrigin: null, stock: 0 },
  { name: 'Офсетная пластина UV СТР 745*615', sku: 'PLATE-UV-745x615', unit: 'шт', format: '745*615', category: 'Офсетные пластины', countryOfOrigin: null, stock: 0 },
  { name: 'Офсетная пластина UV СТР 745*605', sku: 'PLATE-UV-745x605', unit: 'шт', format: '745*605', category: 'Офсетные пластины', countryOfOrigin: null, stock: 1000 },
  { name: 'Офсетная пластина UV СТР 650*550', sku: 'PLATE-UV-650x550', unit: 'шт', format: '650*550', category: 'Офсетные пластины', countryOfOrigin: null, stock: 0 },
  { name: 'Офсетная пластина UV СТР 525*459', sku: 'PLATE-UV-525x459', unit: 'шт', format: '525*459', category: 'Офсетные пластины', countryOfOrigin: null, stock: 0 },
  { name: 'Офсетная пластина UV СТР 510*400 (0,15)', sku: 'PLATE-UV-510x400-015', unit: 'шт', format: '510*400(0,15)', category: 'Офсетные пластины', countryOfOrigin: null, stock: 2000 },
  { name: 'Офсетная пластина UV СТР 510*400 (0,3)', sku: 'PLATE-UV-510x400-030', unit: 'шт', format: '510*400(0,3)', category: 'Офсетные пластины', countryOfOrigin: null, stock: 0 },
  { name: 'Офсетная пластина UV СТР 490*370', sku: 'PLATE-UV-490x370', unit: 'шт', format: '490*370', category: 'Офсетные пластины', countryOfOrigin: null, stock: 0 },
  { name: 'Офсетная пластина UV СТР 450*370', sku: 'PLATE-UV-450x370', unit: 'шт', format: '450*370', category: 'Офсетные пластины', countryOfOrigin: null, stock: 0 },

  // ==================== ОФСЕТНАЯ ПЛАСТИНА СТР (без UV) ====================
  { name: 'Офсетная пластина СТР 1050*795', sku: 'PLATE-CTP-1050x795', unit: 'шт', format: '1050*795', category: 'Офсетные пластины', countryOfOrigin: null, stock: 800 },
  { name: 'Офсетная пластина СТР 1030*790', sku: 'PLATE-CTP-1030x790', unit: 'шт', format: '1030*790', category: 'Офсетные пластины', countryOfOrigin: null, stock: 1000 },
  { name: 'Офсетная пластина СТР 890*608', sku: 'PLATE-CTP-890x608', unit: 'шт', format: '890*608', category: 'Офсетные пластины', countryOfOrigin: null, stock: 2000 },
  { name: 'Офсетная пластина СТР 745*605', sku: 'PLATE-CTP-745x605', unit: 'шт', format: '745*605', category: 'Офсетные пластины', countryOfOrigin: null, stock: 350 },
  { name: 'Офсетная пластина СТР 510*400 (0,15)', sku: 'PLATE-CTP-510x400-015', unit: 'шт', format: '510*400 (0,15)', category: 'Офсетные пластины', countryOfOrigin: null, stock: 1000 },

  // ==================== МАРЗАН ====================
  { name: 'Марзан 25*25*720мм', sku: 'MARZ-720-25x25', unit: 'шт', format: '25*25*720мм', category: 'Марзан', countryOfOrigin: null, stock: 0 },
  { name: 'Марзан 10*5*1380мм', sku: 'MARZ-138-10x5', unit: 'шт', format: '10*5*1380мм', category: 'Марзан', countryOfOrigin: null, stock: 331 },
  { name: 'Марзан 10*5*950мм', sku: 'MARZ-95-10x5-950', unit: 'шт', format: '10*5*950мм', category: 'Марзан', countryOfOrigin: null, stock: 0 },
  { name: 'Марзан 95см (0,3мм)', sku: 'MARZ-95-03', unit: 'шт', format: '95*0,3', category: 'Марзан', countryOfOrigin: null, stock: 34 },
  { name: 'Марзан 95см (0,5мм)', sku: 'MARZ-95-05', unit: 'шт', format: '95*0,5', category: 'Марзан', countryOfOrigin: null, stock: 20 },

  // ==================== ХИМИЯ И РАСХОДНИКИ ====================
  { name: 'Смывка для валов Turquoise 60 WM', sku: 'CHEM-WASH60', unit: 'литр', format: null, category: 'Химия и расходники', countryOfOrigin: null, stock: 2600 },
  { name: 'Добавка к увлажнению Alfa plus 3300', sku: 'CHEM-ALFA', unit: 'кг', format: null, category: 'Химия и расходники', countryOfOrigin: null, stock: 1030 },
  { name: 'Смывка для валов Nova roll up', sku: 'CHEM-NOVA-ROLL', unit: 'литр', format: null, category: 'Химия и расходники', countryOfOrigin: null, stock: 10 },
  { name: 'Очиститель для пластин Novafix', sku: 'CHEM-NOVAFIX', unit: 'литр', format: 'Novafix', category: 'Химия и расходники', countryOfOrigin: null, stock: 2364 },
  { name: 'Нова плюс', sku: 'CHEM-NOVAPLUS', unit: 'литр', format: null, category: 'Химия и расходники', countryOfOrigin: null, stock: 1450 },

  // ==================== ВОДНО-ДИСПЕРСИОННЫЙ ЛАК ====================
  { name: 'Водно-дисперсионный лак глянцевый', sku: 'CHEM-VDL-GL', unit: 'кг', format: '30кг/20кг', category: 'Химия и расходники', countryOfOrigin: null, stock: 3270 },
  { name: 'Водно-дисперсионный лак матт', sku: 'CHEM-VDL-MT', unit: 'кг', format: '20кг', category: 'Химия и расходники', countryOfOrigin: null, stock: 0 },
  { name: 'Водно-дисперсионный лак высоко глянцевый', sku: 'CHEM-VDL-HG', unit: 'кг', format: '20кг', category: 'Химия и расходники', countryOfOrigin: null, stock: 40 },

  // ==================== ТЕРМОКЛЕЙ ====================
  { name: 'Термоклей в гранулах 6092', sku: 'GLUE-6092', unit: 'кг', format: '6092', category: 'Термоклей', countryOfOrigin: null, stock: 500 },
  { name: 'Термоклей в гранулах 6030', sku: 'GLUE-6030', unit: 'кг', format: '6030', category: 'Термоклей', countryOfOrigin: null, stock: 175 },
  { name: 'Термоклей в гранулах', sku: 'GLUE-GRAN', unit: 'кг', format: null, category: 'Термоклей', countryOfOrigin: null, stock: 645 },

  // ==================== ПРОЧИЕ РАСХОДНИКИ ====================
  { name: 'Противоотмарывающий порошок Spray Powder', sku: 'CHEM-TALK', unit: 'кг', format: null, category: 'Химия и расходники', countryOfOrigin: null, stock: 420 },
  { name: 'Вискозная губка', sku: 'CHEM-GUBKA', unit: 'шт', format: null, category: 'Химия и расходники', countryOfOrigin: null, stock: 516 },
  { name: 'Пробойник 0.5', sku: 'MISC-PUNCH-05', unit: 'шт', format: '0.5', category: 'Расходники', countryOfOrigin: null, stock: 1118 },
  { name: 'Копировальная бумага А3', sku: 'MISC-COPY-A3', unit: 'пач', format: 'А3', category: 'Расходники', countryOfOrigin: null, stock: 26 },

  // ==================== КАЛИБРОВОЧНЫЙ КАРТОН ====================
  { name: 'Калибровочный картон 1000*1400 (0.1мм)', sku: 'KALIB-01', unit: 'шт', format: '0.1', category: 'Калибровочный картон', countryOfOrigin: null, stock: 304 },
  { name: 'Калибровочный картон 1000*1400 (0.15мм)', sku: 'KALIB-015', unit: 'шт', format: '0.15', category: 'Калибровочный картон', countryOfOrigin: null, stock: 0 },
  { name: 'Калибровочный картон 1000*1400 (0.2мм)', sku: 'KALIB-02', unit: 'шт', format: '0.2', category: 'Калибровочный картон', countryOfOrigin: null, stock: 861 },
  { name: 'Калибровочный картон 1000*1400 (0.3мм)', sku: 'KALIB-03', unit: 'шт', format: '0.3', category: 'Калибровочный картон', countryOfOrigin: null, stock: 653 },
  { name: 'Калибровочный картон 1000*1400 (0.4мм)', sku: 'KALIB-04', unit: 'шт', format: '0.4', category: 'Калибровочный картон', countryOfOrigin: null, stock: 436 },
  { name: 'Калибровочный картон 1000*1400 (0.5мм)', sku: 'KALIB-05', unit: 'шт', format: '0.5', category: 'Калибровочный картон', countryOfOrigin: null, stock: 230 },

  // ==================== КУРСОР И РИГЕЛЬ (ДЛЯ КАЛЕНДАРЕЙ) ====================
  { name: 'Курсор для календарей', sku: 'CURSOR', unit: 'шт', format: null, category: 'Расходники для календарей', countryOfOrigin: null, stock: 70305 },
  { name: 'Ригель для календарей (белая) 32', sku: 'RIGEL-32-W', unit: 'шт', format: '32', category: 'Расходники для календарей', countryOfOrigin: null, stock: 9726 },
  { name: 'Ригель для календарей (черная) 12', sku: 'RIGEL-12-B', unit: 'шт', format: '12', category: 'Расходники для календарей', countryOfOrigin: null, stock: 1986 },
  { name: 'Ригель для календарей (черная) 32', sku: 'RIGEL-32-B', unit: 'шт', format: '32', category: 'Расходники для календарей', countryOfOrigin: null, stock: 1268 },

  // ==================== ОФСЕТНЫЙ ЛАК И КРАСКИ ====================
  { name: 'Офсетный лак глянцевый', sku: 'INK-LAK-GL', unit: 'кг', format: 'глянц', category: 'Офсетные краски', countryOfOrigin: null, stock: 232.5 },
  { name: 'Офсетная краска Power Process красная', sku: 'INK-POWER-RED', unit: 'кг', format: 'кизил', category: 'Офсетные краски', countryOfOrigin: null, stock: 92.5 },
  { name: 'Офсетная краска Focus Process красная', sku: 'INK-FOCUS-RED', unit: 'кг', format: 'кизил', category: 'Офсетные краски', countryOfOrigin: null, stock: 77.5 },
  { name: 'Офсетная краска INNOVATION красная', sku: 'INK-INNOV-RED', unit: 'кг', format: 'кизил', category: 'Офсетные краски', countryOfOrigin: null, stock: 15 },
  { name: 'Офсетная краска INNOVATION чёрная', sku: 'INK-INNOV-BLACK', unit: 'кг', format: 'кора', category: 'Офсетные краски', countryOfOrigin: null, stock: 2.5 },

  // ==================== ПАНТОННЫЕ КРАСКИ ====================
  { name: 'Пантон Opaque white', sku: 'PNT-OPAQ-WHITE', unit: 'кг', format: 'Opaque white', category: 'Пантонные краски', countryOfOrigin: null, stock: 58.5 },
  { name: 'Пантон Transparent white', sku: 'PNT-TRANS-WHITE', unit: 'кг', format: 'Transparent white', category: 'Пантонные краски', countryOfOrigin: null, stock: 0 },
  { name: 'Пантон Orange 021', sku: 'PNT-ORANGE021', unit: 'кг', format: 'Orange 021', category: 'Пантонные краски', countryOfOrigin: null, stock: 0 },
  { name: 'Пантон Black', sku: 'PNT-BLACK', unit: 'кг', format: 'Black', category: 'Пантонные краски', countryOfOrigin: null, stock: 70 },
  { name: 'Пантон Rhodamine red', sku: 'PNT-RHODAMINE', unit: 'кг', format: 'Rhodamine red', category: 'Пантонные краски', countryOfOrigin: null, stock: 0 },
  { name: 'Пантон Warm red', sku: 'PNT-WARM-RED', unit: 'кг', format: 'Warm red', category: 'Пантонные краски', countryOfOrigin: null, stock: 73 },
  { name: 'Пантон Violet', sku: 'PNT-VIOLET', unit: 'кг', format: 'Violet', category: 'Пантонные краски', countryOfOrigin: null, stock: 0 },
  { name: 'Пантон Blue 072', sku: 'PNT-BLUE072', unit: 'кг', format: 'Blue 072', category: 'Пантонные краски', countryOfOrigin: null, stock: 61 },
  { name: 'Пантон Process blue', sku: 'PNT-PROC-BLUE', unit: 'кг', format: 'Process blue', category: 'Пантонные краски', countryOfOrigin: null, stock: 10 },
  { name: 'Пантон Rubin red', sku: 'PNT-RUBINE', unit: 'кг', format: 'Rubin red', category: 'Пантонные краски', countryOfOrigin: null, stock: 7 },
  { name: 'Пантон Yellow', sku: 'PNT-YELLOW', unit: 'кг', format: 'Yellow', category: 'Пантонные краски', countryOfOrigin: null, stock: 40 },
  { name: 'Пантон Purple', sku: 'PNT-PURPLE', unit: 'кг', format: 'Purple', category: 'Пантонные краски', countryOfOrigin: null, stock: 37 },
  { name: 'Пантон Reflex blue', sku: 'PNT-REFLEX-BLUE', unit: 'кг', format: 'Reflex blue', category: 'Пантонные краски', countryOfOrigin: null, stock: 0 },
  { name: 'Пантон Red 032', sku: 'PNT-RED032', unit: 'кг', format: 'Red 032', category: 'Пантонные краски', countryOfOrigin: null, stock: 0 },
  { name: 'Пантон Green', sku: 'PNT-GREEN', unit: 'кг', format: 'Green', category: 'Пантонные краски', countryOfOrigin: null, stock: 57 },
  { name: 'Пантон Silver 877', sku: 'PNT-SILVER877', unit: 'кг', format: 'Silver 877', category: 'Пантонные краски', countryOfOrigin: null, stock: 20 },
  { name: 'Пантон Gold 871', sku: 'PNT-GOLD871', unit: 'кг', format: 'Gold 871', category: 'Пантонные краски', countryOfOrigin: null, stock: 247 },
  { name: 'Пантон Gold 873', sku: 'PNT-GOLD873', unit: 'кг', format: 'Gold 873', category: 'Пантонные краски', countryOfOrigin: null, stock: 0 },
  { name: 'Пантон Gold 875', sku: 'PNT-GOLD875', unit: 'кг', format: 'Gold 875', category: 'Пантонные краски', countryOfOrigin: null, stock: 169 },

  // ==================== ПРОЯВИТЕЛЬ ====================
  { name: 'Проявитель Hammond 1+9', sku: 'CHEM-PROY-HAM-19', unit: 'литр', format: 'Hammond 1+9', category: 'Химия и расходники', countryOfOrigin: null, stock: 0 },
  { name: 'Проявитель Hammond СТР', sku: 'CHEM-PROY-HAM', unit: 'литр', format: 'Hammond СТР', category: 'Химия и расходники', countryOfOrigin: null, stock: 1000 },
  { name: 'Проявитель Нова 1+9 UV', sku: 'CHEM-PROY-UV', unit: 'литр', format: 'Нова 1+9 UV', category: 'Химия и расходники', countryOfOrigin: null, stock: 260 },
  { name: 'Проявитель СТР (teknova)', sku: 'CHEM-PROY-CTP', unit: 'литр', format: 'СТР(teknova)', category: 'Химия и расходники', countryOfOrigin: null, stock: 2260 },
  { name: 'Проявитель для пластин (порошок, 200гр)', sku: 'CHEM-PROY-POWDER', unit: 'пач', format: null, category: 'Химия и расходники', countryOfOrigin: null, stock: 1082 },

  // ==================== БИГОВАЛЬНЫЙ КАНАЛ ====================
  { name: 'Биговальный канал 0,3*1,3', sku: 'BIG-03x13', unit: 'пач', format: '0,3*1,3', category: 'Биговальный канал', countryOfOrigin: null, stock: 462 },
  { name: 'Биговальный канал 0,4*1,2', sku: 'BIG-04x12', unit: 'пач', format: '0,4*1,2', category: 'Биговальный канал', countryOfOrigin: null, stock: 0 },
  { name: 'Биговальный канал 0,4*1,4', sku: 'BIG-04x14', unit: 'пач', format: '0,4*1,4', category: 'Биговальный канал', countryOfOrigin: null, stock: 280 },
  { name: 'Биговальный канал 0,5*1,5', sku: 'BIG-05x15', unit: 'пач', format: '0,5*1,5', category: 'Биговальный канал', countryOfOrigin: null, stock: 320 },
  { name: 'Биговальный канал 0,4*1,3', sku: 'BIG-04x13', unit: 'пач', format: '0,4*1,3', category: 'Биговальный канал', countryOfOrigin: null, stock: 189 },
  { name: 'Биговальный канал 0,7*2,3', sku: 'BIG-07x23', unit: 'пач', format: '0,7*2,3', category: 'Биговальный канал', countryOfOrigin: null, stock: 494 },
  { name: 'Биговальный канал 0,8*2,5', sku: 'BIG-08x25', unit: 'пач', format: '0,8*2,5', category: 'Биговальный канал', countryOfOrigin: null, stock: 39 },

  // ==================== ОФСЕТНОЕ ПОЛОТНО (РЕЗИНА) ====================
  { name: 'Офсетное полотно 520*440', sku: 'RUBBER-520x440', unit: 'шт', format: '520*440', category: 'Офсетная резина', countryOfOrigin: null, stock: 154 },
  { name: 'Офсетное полотно 772*627', sku: 'RUBBER-772x627', unit: 'шт', format: '772*627', category: 'Офсетная резина', countryOfOrigin: null, stock: 52 },
  { name: 'Офсетное полотно 791*665', sku: 'RUBBER-791x665', unit: 'шт', format: '791*665', category: 'Офсетная резина', countryOfOrigin: null, stock: 45 },
  { name: 'Офсетное полотно 1052*840', sku: 'RUBBER-1052x840', unit: 'шт', format: '1052*840', category: 'Офсетная резина', countryOfOrigin: null, stock: 133 },
  { name: 'Офсетное полотно 1060*860', sku: 'RUBBER-1060x860', unit: 'шт', format: '1060*860', category: 'Офсетная резина', countryOfOrigin: null, stock: 43 },
  { name: 'Офсетное полотно 490*415 (листовое)', sku: 'RUBBER-490x415', unit: 'шт', format: '49', category: 'Офсетная резина', countryOfOrigin: null, stock: 123 },
  { name: 'Офсетное полотно рулонное 1450мм', sku: 'RUBBER-RUL-1450', unit: 'м', format: '1450', category: 'Офсетная резина', countryOfOrigin: null, stock: 41.17 },
  { name: 'Офсетное полотно рулонное 1350мм', sku: 'RUBBER-RUL-1350', unit: 'м', format: '1350', category: 'Офсетная резина', countryOfOrigin: null, stock: 27.59 },
  { name: 'Офсетное полотно рулонное 1060мм', sku: 'RUBBER-RUL-106', unit: 'м', format: '106', category: 'Офсетная резина', countryOfOrigin: null, stock: 118.29 },
  { name: 'Офсетное полотно рулонное 780мм', sku: 'RUBBER-RUL-78', unit: 'м', format: '78', category: 'Офсетная резина', countryOfOrigin: null, stock: 70.16 },

  // ==================== ЧЕХОЛ ДЛЯ ВАЛОВ ====================
  { name: 'Чехол для валов 64', sku: 'SLEEVE-64', unit: 'м', format: '64', category: 'Расходники', countryOfOrigin: null, stock: 0 },
  { name: 'Чехол для валов 44', sku: 'SLEEVE-44', unit: 'м', format: '44', category: 'Расходники', countryOfOrigin: null, stock: 0 },

  // ==================== УФ ЛАМПА ====================
  { name: 'УФ лампа', sku: 'UV-LAMP', unit: 'шт', format: null, category: 'Расходники', countryOfOrigin: null, stock: 1 },

  // ==================== МЕТАЛЛИЧЕСКАЯ ГРЕБЁНКА ====================
  { name: 'Металлическая гребёнка 1/4 (6,4мм) белая', sku: 'GREB-1-4-W', unit: 'бабина', format: '1*4(ок)', category: 'Расходники для календарей', countryOfOrigin: null, stock: 1 },
  { name: 'Металлическая гребёнка 3/8 (9,5мм) белая', sku: 'GREB-3-8-W', unit: 'бабина', format: '3*8(ок)', category: 'Расходники для календарей', countryOfOrigin: null, stock: 134 },
  { name: 'Металлическая гребёнка 3/8 (9,5мм) чёрная', sku: 'GREB-3-8-B', unit: 'бабина', format: '3*8(кора)', category: 'Расходники для календарей', countryOfOrigin: null, stock: 0 },
  { name: 'Металлическая гребёнка 5/16 (7,9мм) белая', sku: 'GREB-5-16-W', unit: 'бабина', format: '5*16(ок)', category: 'Расходники для календарей', countryOfOrigin: null, stock: 170 },
  { name: 'Металлическая гребёнка 5/8 (16мм) белая', sku: 'GREB-5-8', unit: 'бабина', format: '5*8(ок)', category: 'Расходники для календарей', countryOfOrigin: null, stock: 0 },
  { name: 'Металлическая гребёнка 3/4 (19мм) белая', sku: 'GREB-3-4', unit: 'бабина', format: '3*4(ок)', category: 'Расходники для календарей', countryOfOrigin: null, stock: 0 },
  { name: 'Металлическая гребёнка 9/16 (14,3мм) белая', sku: 'GREB-9-16', unit: 'бабина', format: '9*16(ок)', category: 'Расходники для календарей', countryOfOrigin: null, stock: 0 },
  { name: 'Металлическая гребёнка 5/16 (7,9мм) чёрная', sku: 'GREB-5-16-B', unit: 'бабина', format: '5*16(кора)', category: 'Расходники для календарей', countryOfOrigin: null, stock: 10 },
  { name: 'Металлическая гребёнка 1/2 (12,7мм)', sku: 'GREB-1-2', unit: 'бабина', format: '1*2(ок)', category: 'Расходники для календарей', countryOfOrigin: null, stock: 15 },
  { name: 'Металлическая гребёнка 7/16 (11,1мм)', sku: 'GREB-7-16', unit: 'бабина', format: '7*16(ок)', category: 'Расходники для календарей', countryOfOrigin: null, stock: 13 },
  { name: 'Металлическая гребёнка 1/4 (6,4мм) чёрная', sku: 'GREB-1-4-B', unit: 'бабина', format: '1*4(кора)', category: 'Расходники для календарей', countryOfOrigin: null, stock: 9 },
];

async function main() {
  console.log(`\n=== Stock Import (остаток 23.02.2026) ===`);
  console.log(`Total products to process: ${PRODUCTS.length}\n`);

  let created = 0;
  let updated = 0;
  let errors = 0;

  for (const p of PRODUCTS) {
    try {
      await prisma.product.upsert({
        where: { sku: p.sku },
        update: {
          stock: p.stock,
        },
        create: {
          name: p.name,
          sku: p.sku,
          unit: p.unit,
          format: p.format,
          category: p.category,
          countryOfOrigin: p.countryOfOrigin,
          stock: p.stock,
          minStock: 0,
        },
      });

      const existing = await prisma.product.findUnique({ where: { sku: p.sku } });
      if (existing && existing.createdAt.getTime() === existing.updatedAt.getTime()) {
        created++;
        console.log(`  + Created: ${p.sku} => ${p.name} (stock: ${p.stock})`);
      } else {
        updated++;
        console.log(`  ~ Updated: ${p.sku} => stock: ${p.stock}`);
      }
    } catch (err) {
      errors++;
      console.error(`  ! Error for ${p.sku}: ${(err as Error).message}`);
    }
  }

  console.log(`\n=== Import Complete ===`);
  console.log(`  Created:  ${created}`);
  console.log(`  Updated:  ${updated}`);
  if (errors > 0) {
    console.log(`  Errors:   ${errors}`);
  }
  console.log(`  Total:    ${PRODUCTS.length}\n`);
}

main()
  .catch((err) => {
    console.error('Import error:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
