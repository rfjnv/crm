import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface ProductData {
  name: string;
  sku: string;
  unit: string;
  format?: string;
  category: string;
  countryOfOrigin?: string;
  stock: number;
  minStock: number;
  salePrice?: number;
}

const products: ProductData[] = [
  // ==================== САМОКЛЕЮЩАЯСЯ БУМАГА (Китай) ====================
  { name: 'Самоклеющаяся бумага глянц с насечкой', sku: 'SK-CN-70x100', unit: 'лист', format: '70x100', category: 'Самоклеющаяся бумага', countryOfOrigin: 'Китай', stock: 109330, minStock: 5000, salePrice: 4000 },
  { name: 'Самоклеющаяся бумага глянц с насечкой', sku: 'SK-CN-50x70', unit: 'лист', format: '50x70', category: 'Самоклеющаяся бумага', countryOfOrigin: 'Китай', stock: 319450, minStock: 5000, salePrice: 2000 },
  { name: 'Самоклеющаяся бумага глянц без насечки', sku: 'SK-CN-70x100-BN', unit: 'лист', format: '70x100 б/н', category: 'Самоклеющаяся бумага', countryOfOrigin: 'Китай', stock: 78200, minStock: 5000, salePrice: 4000 },
  { name: 'Самоклеющаяся бумага глянц без насечки', sku: 'SK-CN-50x70-BN', unit: 'лист', format: '50x70 б/н', category: 'Самоклеющаяся бумага', countryOfOrigin: 'Китай', stock: 195600, minStock: 5000, salePrice: 2000 },
  { name: 'Самоклеющаяся бумага глянц с насечкой', sku: 'SK-CN-50x35', unit: 'лист', format: '50x35', category: 'Самоклеющаяся бумага', countryOfOrigin: 'Китай', stock: 158600, minStock: 5000, salePrice: 1000 },
  { name: 'Самоклеющаяся бумага глянц без насечки', sku: 'SK-CN-50x35-BN', unit: 'лист', format: '50x35 б/н', category: 'Самоклеющаяся бумага', countryOfOrigin: 'Китай', stock: 374000, minStock: 5000, salePrice: 1000 },
  { name: 'Самоклеющаяся бумага красная с насечкой', sku: 'SK-CN-RED-70x100', unit: 'лист', format: '70x100', category: 'Самоклеющаяся бумага', countryOfOrigin: 'Китай', stock: 655, minStock: 500 },
  { name: 'Самоклеющаяся бумага красная с насечкой', sku: 'SK-CN-RED-50x70', unit: 'лист', format: '50x70', category: 'Самоклеющаяся бумага', countryOfOrigin: 'Китай', stock: 1100, minStock: 500 },
  { name: 'Самоклеющаяся бумага красная без насечки', sku: 'SK-CN-RED-70x100-BN', unit: 'лист', format: '70x100 б/н', category: 'Самоклеющаяся бумага', countryOfOrigin: 'Китай', stock: 20000, minStock: 500 },
  { name: 'Самоклеющаяся бумага красная без насечки', sku: 'SK-CN-RED-50x70-BN', unit: 'лист', format: '50x70 б/н', category: 'Самоклеющаяся бумага', countryOfOrigin: 'Китай', stock: 0, minStock: 500 },

  // ==================== САМОКЛЕЮЩАЯСЯ БУМАГА (Турция) ====================
  { name: 'Самоклеющаяся бумага полуглянц с насечкой', sku: 'SK-TR-70x100', unit: 'лист', format: '70x100', category: 'Самоклеющаяся бумага', countryOfOrigin: 'Турция', stock: 23600, minStock: 2000, salePrice: 5400 },
  { name: 'Самоклеющаяся бумага полуглянц с насечкой', sku: 'SK-TR-50x70', unit: 'лист', format: '50x70', category: 'Самоклеющаяся бумага', countryOfOrigin: 'Турция', stock: 64497, minStock: 2000, salePrice: 2700 },

  // ==================== САМОКЛЕЮЩАЯСЯ БУМАГА В РУЛОНАХ ====================
  { name: 'Самоклеющаяся бумага в рулонах FASSON (акрил)', sku: 'SK-RUL-FASSON-A', unit: 'рулон', format: '1м x 2000м', category: 'Самоклеющаяся бумага', stock: 16, minStock: 3, salePrice: 4500 },
  { name: 'Самоклеющаяся бумага в рулонах FASSON (каучук)', sku: 'SK-RUL-FASSON-K', unit: 'рулон', format: '1м x 2000м', category: 'Самоклеющаяся бумага', stock: 7, minStock: 3, salePrice: 4500 },
  { name: 'Самоклеющаяся бумага в рулонах LIANG DU', sku: 'SK-RUL-LIANGDU', unit: 'рулон', format: '1м x 2000м', category: 'Самоклеющаяся бумага', countryOfOrigin: 'Китай', stock: 17, minStock: 3, salePrice: 4300 },
  { name: 'Самоклеющаяся бумага в рулонах ненси', sku: 'SK-RUL-NENSI', unit: 'рулон', format: '1м x 2000м', category: 'Самоклеющаяся бумага', countryOfOrigin: 'Китай', stock: 3, minStock: 2 },

  // ==================== ЦЕЛЛЮЛОЗНЫЙ КАРТОН ====================
  { name: 'Целлюлозный картон 210гр', sku: 'KART-IND-210-70x100', unit: 'лист', format: '70x100', category: 'Целлюлозный картон', countryOfOrigin: 'Индия', stock: 75, minStock: 50 },
  { name: 'Целлюлозный картон 250гр', sku: 'KART-IND-250-70x100', unit: 'лист', format: '70x100', category: 'Целлюлозный картон', countryOfOrigin: 'Индия', stock: 345, minStock: 100, salePrice: 2720 },
  { name: 'Целлюлозный картон 250гр', sku: 'KART-CN-250-70x100', unit: 'лист', format: '70x100', category: 'Целлюлозный картон', countryOfOrigin: 'Китай', stock: 500, minStock: 100, salePrice: 2720 },
  { name: 'Целлюлозный картон NINGBO FOLD 270гр в рулонах', sku: 'KART-CN-270-RUL-62', unit: 'рулон', format: '62см', category: 'Целлюлозный картон', countryOfOrigin: 'Китай', stock: 3, minStock: 1 },
  { name: 'Целлюлозный картон NINGBO FOLD 300гр в рулонах', sku: 'KART-CN-300-RUL-62', unit: 'рулон', format: '62см', category: 'Целлюлозный картон', countryOfOrigin: 'Китай', stock: 1, minStock: 1 },
  { name: 'Целлюлозный картон NINGBO FOLD 270гр в листах', sku: 'KART-CN-270-62x94', unit: 'лист', format: '62x94', category: 'Целлюлозный картон', countryOfOrigin: 'Китай', stock: 4080, minStock: 500, salePrice: 2280 },
  { name: 'Целлюлозный картон NINGBO FOLD 300гр в листах', sku: 'KART-CN-300-62x94', unit: 'лист', format: '62x94', category: 'Целлюлозный картон', countryOfOrigin: 'Китай', stock: 470, minStock: 100, salePrice: 2540 },

  // ==================== МЕЛОВАННАЯ БУМАГА ====================
  { name: 'Мелованная бумага HI-KOTE глянц 250гр', sku: 'MEL-HK-250-70x100', unit: 'лист', format: '70x100', category: 'Мелованная бумага', stock: 5375, minStock: 1000, salePrice: 2630 },
  { name: 'Мелованная бумага HI-KOTE глянц 170гр', sku: 'MEL-HK-170-70x100', unit: 'лист', format: '70x100', category: 'Мелованная бумага', stock: 8750, minStock: 1000, salePrice: 1790 },
  { name: 'Мелованная бумага HI-KOTE матт 105гр', sku: 'MEL-HK-105-MATT', unit: 'лист', format: '70x100', category: 'Мелованная бумага', stock: 22500, minStock: 2000, salePrice: 1120 },

  // ==================== ФОЛЬГА ДЛЯ ТИСНЕНИЯ ====================
  { name: 'Фольга для тиснения золото 120м', sku: 'FOIL-GOLD-120', unit: 'рулон', format: '64см x 120м', category: 'Фольга для тиснения', stock: 689, minStock: 50, salePrice: 150000 },
  { name: 'Фольга для тиснения золото 240м', sku: 'FOIL-GOLD-240', unit: 'рулон', format: '64см x 240м', category: 'Фольга для тиснения', stock: 348, minStock: 20, salePrice: 300000 },
  { name: 'Фольга для тиснения золото 360м', sku: 'FOIL-GOLD-360', unit: 'рулон', format: '64см x 360м', category: 'Фольга для тиснения', stock: 253, minStock: 10, salePrice: 450000 },
  { name: 'Фольга для тиснения серебро 120м', sku: 'FOIL-SILVER-120', unit: 'рулон', format: '64см x 120м', category: 'Фольга для тиснения', stock: 1294, minStock: 50, salePrice: 150000 },
  { name: 'Фольга для тиснения серебро 240м', sku: 'FOIL-SILVER-240', unit: 'рулон', format: '64см x 240м', category: 'Фольга для тиснения', stock: 579, minStock: 20, salePrice: 300000 },
  { name: 'Фольга для тиснения серебро 360м', sku: 'FOIL-SILVER-360', unit: 'рулон', format: '64см x 360м', category: 'Фольга для тиснения', stock: 476, minStock: 10, salePrice: 450000 },
  { name: 'Фольга для тиснения золото (ж.спина) 120м', sku: 'FOIL-GOLD-Y-120', unit: 'рулон', format: '64см x 120м', category: 'Фольга для тиснения', stock: 1971, minStock: 50, salePrice: 150000 },
  { name: 'Фольга для тиснения золото (ж.спина) 240м', sku: 'FOIL-GOLD-Y-240', unit: 'рулон', format: '64см x 240м', category: 'Фольга для тиснения', stock: 599, minStock: 20, salePrice: 300000 },
  { name: 'Фольга для тиснения золото (ж.спина) 360м', sku: 'FOIL-GOLD-Y-360', unit: 'рулон', format: '64см x 360м', category: 'Фольга для тиснения', stock: 300, minStock: 10, salePrice: 450000 },
  { name: 'Фольга для тиснения серебро (ж.спина) 120м', sku: 'FOIL-SILVER-Y-120', unit: 'рулон', format: '64см x 120м', category: 'Фольга для тиснения', stock: 500, minStock: 50, salePrice: 150000 },
  { name: 'Фольга для тиснения серебро (ж.спина) 240м', sku: 'FOIL-SILVER-Y-240', unit: 'рулон', format: '64см x 240м', category: 'Фольга для тиснения', stock: 200, minStock: 20, salePrice: 300000 },
  { name: 'Фольга для тиснения серебро (ж.спина) 360м', sku: 'FOIL-SILVER-Y-360', unit: 'рулон', format: '64см x 360м', category: 'Фольга для тиснения', stock: 200, minStock: 10, salePrice: 450000 },
  { name: 'Фольга для тиснения зелёная 120м', sku: 'FOIL-GREEN-120', unit: 'рулон', format: '64см x 120м', category: 'Фольга для тиснения', stock: 25, minStock: 5, salePrice: 230000 },
  { name: 'Фольга для тиснения красная 120м', sku: 'FOIL-RED-120', unit: 'рулон', format: '64см x 120м', category: 'Фольга для тиснения', stock: 215, minStock: 10, salePrice: 230000 },
  { name: 'Фольга для тиснения синяя 120м', sku: 'FOIL-BLUE-120', unit: 'рулон', format: '64см x 120м', category: 'Фольга для тиснения', stock: 51, minStock: 5, salePrice: 230000 },
  { name: 'Фольга для тиснения чёрная 120м', sku: 'FOIL-BLACK-120', unit: 'рулон', format: '64см x 120м', category: 'Фольга для тиснения', stock: 85, minStock: 5, salePrice: 230000 },
  { name: 'Фольга для тиснения фиолетовая 120м', sku: 'FOIL-VIOLET-120', unit: 'рулон', format: '64см x 120м', category: 'Фольга для тиснения', stock: 136, minStock: 5, salePrice: 230000 },
  { name: 'Фольга для тиснения белая 180м', sku: 'FOIL-WHITE-180', unit: 'рулон', format: '64см x 180м', category: 'Фольга для тиснения', stock: 56, minStock: 5, salePrice: 280000 },
  { name: 'Фольга для тиснения медная 120м', sku: 'FOIL-COPPER-120', unit: 'рулон', format: '64см x 120м', category: 'Фольга для тиснения', stock: 158, minStock: 5, salePrice: 230000 },
  { name: 'Фольга для тиснения голограмма 120м', sku: 'FOIL-HOLO-120', unit: 'рулон', format: '64см x 120м', category: 'Фольга для тиснения', stock: 116, minStock: 5, salePrice: 250000 },
  { name: 'Фольга для тиснения жемчужная 120м', sku: 'FOIL-PEARL-120', unit: 'рулон', format: '64см x 120м', category: 'Фольга для тиснения', stock: 98, minStock: 5 },

  // ==================== UV ЛАК LANER ====================
  { name: 'UV лак LANER PI-50 (для флексографии)', sku: 'UV-PI50', unit: 'кг', category: 'UV лак', countryOfOrigin: 'Турция', stock: 1050, minStock: 100, salePrice: 125000 },
  { name: 'UV лак LANER PI-125 (трафаретная)', sku: 'UV-PI125', unit: 'кг', category: 'UV лак', countryOfOrigin: 'Турция', stock: 1000, minStock: 100, salePrice: 180000 },
  { name: 'UV лак LANER PI-180', sku: 'UV-PI180', unit: 'кг', category: 'UV лак', countryOfOrigin: 'Турция', stock: 4089, minStock: 200, salePrice: 125000 },
  { name: 'UV лак LANER PI-180 Бельгия', sku: 'UV-PI180-BE', unit: 'кг', category: 'UV лак', countryOfOrigin: 'Бельгия', stock: 114, minStock: 10 },
  { name: 'UV лак LANER PI-250', sku: 'UV-PI250', unit: 'кг', category: 'UV лак', countryOfOrigin: 'Турция', stock: 3575, minStock: 200, salePrice: 125000 },
  { name: 'UV лак LANER PI-250 Бельгия', sku: 'UV-PI250-BE', unit: 'кг', category: 'UV лак', countryOfOrigin: 'Бельгия', stock: 12, minStock: 5 },
  { name: 'UV лак LANER PI-400A', sku: 'UV-PI400A', unit: 'кг', category: 'UV лак', countryOfOrigin: 'Турция', stock: 2675, minStock: 200, salePrice: 125000 },
  { name: 'UV лак LANER PI-400A Бельгия', sku: 'UV-PI400A-BE', unit: 'кг', category: 'UV лак', countryOfOrigin: 'Бельгия', stock: 25, minStock: 5 },
  { name: 'UV лак LANER 500 (Эмбос)', sku: 'UV-PI500', unit: 'кг', category: 'UV лак', countryOfOrigin: 'Турция', stock: 160, minStock: 20, salePrice: 200000 },

  // ==================== ЛАМИНАЦИОННАЯ ПЛЕНКА (ГЛЯНЦЕВАЯ) ====================
  { name: 'Ламинационная пленка глянц 84см', sku: 'LAM-GL-84', unit: 'кг', format: '84см', category: 'Ламинационная пленка', stock: 2230.5, minStock: 100, salePrice: 43000 },
  { name: 'Ламинационная пленка глянц 78см', sku: 'LAM-GL-78', unit: 'кг', format: '78см', category: 'Ламинационная пленка', stock: 1016, minStock: 100, salePrice: 43000 },
  { name: 'Ламинационная пленка глянц 74см', sku: 'LAM-GL-74', unit: 'кг', format: '74см', category: 'Ламинационная пленка', stock: 1213.1, minStock: 100, salePrice: 43000 },
  { name: 'Ламинационная пленка глянц 72см', sku: 'LAM-GL-72', unit: 'кг', format: '72см', category: 'Ламинационная пленка', stock: 0, minStock: 100, salePrice: 43000 },
  { name: 'Ламинационная пленка глянц 70см', sku: 'LAM-GL-70', unit: 'кг', format: '70см', category: 'Ламинационная пленка', stock: 0, minStock: 100, salePrice: 43000 },
  { name: 'Ламинационная пленка глянц 65см', sku: 'LAM-GL-65', unit: 'кг', format: '65см', category: 'Ламинационная пленка', stock: 534.9, minStock: 100, salePrice: 43000 },
  { name: 'Ламинационная пленка глянц 62см', sku: 'LAM-GL-62', unit: 'кг', format: '62см', category: 'Ламинационная пленка', stock: 0, minStock: 100, salePrice: 43000 },
  { name: 'Ламинационная пленка глянц 60см', sku: 'LAM-GL-60', unit: 'кг', format: '60см', category: 'Ламинационная пленка', stock: 1278.7, minStock: 100, salePrice: 43000 },
  { name: 'Ламинационная пленка глянц 55см', sku: 'LAM-GL-55', unit: 'кг', format: '55см', category: 'Ламинационная пленка', stock: 832.9, minStock: 100, salePrice: 43000 },
  { name: 'Ламинационная пленка глянц 50см', sku: 'LAM-GL-50', unit: 'кг', format: '50см', category: 'Ламинационная пленка', stock: 2023.1, minStock: 100, salePrice: 43000 },
  { name: 'Ламинационная пленка глянц 42см', sku: 'LAM-GL-42', unit: 'кг', format: '42см', category: 'Ламинационная пленка', stock: 0, minStock: 50, salePrice: 43000 },
  { name: 'Ламинационная пленка глянц 35см', sku: 'LAM-GL-35', unit: 'кг', format: '35см', category: 'Ламинационная пленка', stock: 17.1, minStock: 50, salePrice: 43000 },
  { name: 'Ламинационная пленка глянц 30см', sku: 'LAM-GL-30', unit: 'кг', format: '30см', category: 'Ламинационная пленка', stock: 72.8, minStock: 50, salePrice: 43000 },

  // ==================== ЛАМИНАЦИОННАЯ ПЛЕНКА (МАТОВАЯ) ====================
  { name: 'Ламинационная пленка матт 72см', sku: 'LAM-MT-72', unit: 'кг', format: '72см', category: 'Ламинационная пленка', stock: 623.4, minStock: 100, salePrice: 43000 },
  { name: 'Ламинационная пленка матт 68см', sku: 'LAM-MT-68', unit: 'кг', format: '68см', category: 'Ламинационная пленка', stock: 1003.2, minStock: 100, salePrice: 43000 },
  { name: 'Ламинационная пленка матт 62см', sku: 'LAM-MT-62', unit: 'кг', format: '62см', category: 'Ламинационная пленка', stock: 1632.4, minStock: 100, salePrice: 43000 },
  { name: 'Ламинационная пленка матт 60см', sku: 'LAM-MT-60', unit: 'кг', format: '60см', category: 'Ламинационная пленка', stock: 1934.2, minStock: 100, salePrice: 43000 },
  { name: 'Ламинационная пленка матт 50см', sku: 'LAM-MT-50', unit: 'кг', format: '50см', category: 'Ламинационная пленка', stock: 294, minStock: 100, salePrice: 43000 },
  { name: 'Ламинационная пленка матт 42см', sku: 'LAM-MT-42', unit: 'кг', format: '42см', category: 'Ламинационная пленка', stock: 20.6, minStock: 50, salePrice: 43000 },
  { name: 'Ламинационная пленка матт 35см', sku: 'LAM-MT-35', unit: 'кг', format: '35см', category: 'Ламинационная пленка', stock: 0, minStock: 20, salePrice: 43000 },

  // ==================== ЛАМИНАЦИОННАЯ ПЛЕНКА (МЕТАЛЛИЧЕСКАЯ / СПЕЦ) ====================
  { name: 'Ламинационная пленка золото 75см', sku: 'LAM-GOLD-75', unit: 'кг', format: '75см', category: 'Ламинационная пленка', stock: 835.1, minStock: 50, salePrice: 115000 },
  { name: 'Ламинационная пленка золото 62см', sku: 'LAM-GOLD-62', unit: 'кг', format: '62см', category: 'Ламинационная пленка', stock: 580.7, minStock: 50, salePrice: 115000 },
  { name: 'Ламинационная пленка золото 50см', sku: 'LAM-GOLD-50', unit: 'кг', format: '50см', category: 'Ламинационная пленка', stock: 403.9, minStock: 50, salePrice: 115000 },
  { name: 'Ламинационная пленка серебро 62см', sku: 'LAM-SILVER-62', unit: 'кг', format: '62см', category: 'Ламинационная пленка', stock: 337.4, minStock: 50, salePrice: 110000 },
  { name: 'Ламинационная пленка серебро 60см', sku: 'LAM-SILVER-60', unit: 'кг', format: '60см', category: 'Ламинационная пленка', stock: 309.8, minStock: 50, salePrice: 110000 },
  { name: 'Ламинационная пленка серебро 50см', sku: 'LAM-SILVER-50', unit: 'кг', format: '50см', category: 'Ламинационная пленка', stock: 106.6, minStock: 50, salePrice: 110000 },
  { name: 'Ламинационная пленка Голографик 50см', sku: 'LAM-HOLO-50', unit: 'кг', format: '50см', category: 'Ламинационная пленка', stock: 63, minStock: 10, salePrice: 200000 },
  { name: 'Ламинационная пленка Soft touch 50см', sku: 'LAM-SOFT-50', unit: 'кг', format: '50см', category: 'Ламинационная пленка', stock: 116.3, minStock: 20, salePrice: 200000 },

  // ==================== ХИМИЯ И ВСПОМОГАТЕЛЬНЫЕ СРЕДСТВА ====================
  { name: 'Смывка для валов WASH60/100 (TEKNOVA)', sku: 'CHEM-WASH60', unit: 'литр', category: 'Химия и расходники', stock: 2620, minStock: 200, salePrice: 50000 },
  { name: 'Добавка к увлажнению ALFA PLUS (TEKNOVA)', sku: 'CHEM-ALFA', unit: 'кг', category: 'Химия и расходники', stock: 1040, minStock: 100, salePrice: 50000 },
  { name: 'Смывка для ролевой печати Nova roll up', sku: 'CHEM-NOVA-ROLL', unit: 'литр', category: 'Химия и расходники', stock: 10, minStock: 5, salePrice: 50000 },
  { name: 'Очиститель для пластин NOVAFIX PLUS (TEKNOVA)', sku: 'CHEM-NOVAFIX', unit: 'литр', category: 'Химия и расходники', stock: 2440, minStock: 100, salePrice: 65000 },
  { name: 'Нова плюс', sku: 'CHEM-NOVAPLUS', unit: 'литр', category: 'Химия и расходники', stock: 1450, minStock: 100 },
  { name: 'Водно-дисперсионный лак глянцевый', sku: 'CHEM-VDL-GL', unit: 'кг', category: 'Химия и расходники', stock: 3270, minStock: 200, salePrice: 45000 },
  { name: 'Водно-дисперсионный лак матовый', sku: 'CHEM-VDL-MT', unit: 'кг', category: 'Химия и расходники', stock: 220, minStock: 100, salePrice: 55000 },
  { name: 'Водно-дисперсионный лак высоко глянцевый', sku: 'CHEM-VDL-HG', unit: 'кг', category: 'Химия и расходники', stock: 40, minStock: 20 },
  { name: 'Противоотмарывающий порошок (ТАЛЬК)', sku: 'CHEM-TALK', unit: 'кг', category: 'Химия и расходники', stock: 430, minStock: 50, salePrice: 70000 },
  { name: 'Вискозная губка', sku: 'CHEM-GUBKA', unit: 'шт', category: 'Химия и расходники', stock: 516, minStock: 50, salePrice: 25000 },
  { name: 'Проявитель для термальных пластин (TEKNOVA)', sku: 'CHEM-PROY-CTP', unit: 'литр', category: 'Химия и расходники', stock: 2300, minStock: 200, salePrice: 50000 },
  { name: 'Проявитель Нова 1+9 UV', sku: 'CHEM-PROY-UV', unit: 'литр', category: 'Химия и расходники', stock: 260, minStock: 50 },
  { name: 'Проявитель Hammond CTP', sku: 'CHEM-PROY-HAM', unit: 'литр', category: 'Химия и расходники', stock: 1000, minStock: 100 },
  { name: 'Фото проявитель TETANAL (Германия)', sku: 'CHEM-TETANAL', unit: 'литр', category: 'Химия и расходники', countryOfOrigin: 'Германия', stock: 0, minStock: 50, salePrice: 60000 },
  { name: 'Проявитель для пластин (порошок)', sku: 'CHEM-PROY-POWDER', unit: 'пачка', category: 'Химия и расходники', stock: 1082, minStock: 100, salePrice: 40000 },
  { name: 'Гум', sku: 'CHEM-GUM', unit: 'литр', category: 'Химия и расходники', stock: 270, minStock: 50 },

  // ==================== ТЕРМОКЛЕЙ ====================
  { name: 'Термоклей ELEPHANT', sku: 'GLUE-ELEPH', unit: 'кг', category: 'Термоклей', countryOfOrigin: 'Китай', stock: 500, minStock: 50, salePrice: 60000 },
  { name: 'Термоклей 6030', sku: 'GLUE-6030', unit: 'кг', category: 'Термоклей', countryOfOrigin: 'Китай', stock: 175, minStock: 50, salePrice: 55000 },
  { name: 'Термоклей в гранулах', sku: 'GLUE-GRAN', unit: 'кг', category: 'Термоклей', countryOfOrigin: 'Китай', stock: 645, minStock: 50 },

  // ==================== ОФСЕТНЫЕ КРАСКИ ====================
  { name: 'Офсетная краска POWER-BRANCHER (CMYK)', sku: 'INK-POWER-CMYK', unit: 'кг', category: 'Офсетные краски', stock: 95, minStock: 10, salePrice: 86000 },
  { name: 'Офсетная краска FOCUS-BRANCHER (CMYK)', sku: 'INK-FOCUS-CMYK', unit: 'кг', category: 'Офсетные краски', stock: 78, minStock: 10, salePrice: 82000 },
  { name: 'Офсетная краска INNAVTION CF (CMYK)', sku: 'INK-INNOV-CMYK', unit: 'кг', category: 'Офсетные краски', stock: 18, minStock: 5, salePrice: 90000 },
  { name: 'Офсетный лак глянцевый', sku: 'INK-LAK-GL', unit: 'кг', category: 'Офсетные краски', stock: 232.5, minStock: 20, salePrice: 100000 },

  // ==================== ПАНТОННЫЕ КРАСКИ ====================
  { name: 'Пантон OPAQUE WHITE (белый кроющий)', sku: 'PNT-OPAQ-WHITE', unit: 'кг', category: 'Пантонные краски', stock: 58.5, minStock: 5, salePrice: 140000 },
  { name: 'Пантон BLACK (чёрный)', sku: 'PNT-BLACK', unit: 'кг', category: 'Пантонные краски', stock: 70, minStock: 5, salePrice: 135000 },
  { name: 'Пантон WARM RED (тёплый красный)', sku: 'PNT-WARM-RED', unit: 'кг', category: 'Пантонные краски', stock: 73, minStock: 5, salePrice: 150000 },
  { name: 'Пантон BLUE 072 (синий)', sku: 'PNT-BLUE072', unit: 'кг', category: 'Пантонные краски', stock: 61, minStock: 5, salePrice: 155000 },
  { name: 'Пантон PROCESS BLUE (темно-лазурный)', sku: 'PNT-PROC-BLUE', unit: 'кг', category: 'Пантонные краски', stock: 10, minStock: 5, salePrice: 135000 },
  { name: 'Пантон RUBINE RED (рубиновый)', sku: 'PNT-RUBINE', unit: 'кг', category: 'Пантонные краски', stock: 6, minStock: 3, salePrice: 135000 },
  { name: 'Пантон YELLOW (жёлтый)', sku: 'PNT-YELLOW', unit: 'кг', category: 'Пантонные краски', stock: 40, minStock: 5, salePrice: 140000 },
  { name: 'Пантон GREEN (зелёный)', sku: 'PNT-GREEN', unit: 'кг', category: 'Пантонные краски', stock: 57, minStock: 5, salePrice: 165000 },
  { name: 'Пантон PURPLE (пурпурный)', sku: 'PNT-PURPLE', unit: 'кг', category: 'Пантонные краски', stock: 37, minStock: 3, salePrice: 280000 },
  { name: 'Пантон SILVER 877', sku: 'PNT-SILVER877', unit: 'кг', category: 'Пантонные краски', stock: 21, minStock: 5, salePrice: 170000 },
  { name: 'Пантон GOLD 871', sku: 'PNT-GOLD871', unit: 'кг', category: 'Пантонные краски', stock: 247, minStock: 10, salePrice: 300000 },
  { name: 'Пантон GOLD 875', sku: 'PNT-GOLD875', unit: 'кг', category: 'Пантонные краски', stock: 169, minStock: 10, salePrice: 300000 },

  // ==================== ОФСЕТНЫЕ ПЛАСТИНЫ ====================
  { name: 'Офсетная пластина CTP 1280x1060', sku: 'PLATE-1280x1060', unit: 'шт', format: '1280x1060', category: 'Офсетные пластины', stock: 0, minStock: 100 },
  { name: 'Офсетная пластина CTP 1050x795', sku: 'PLATE-1050x795', unit: 'шт', format: '1050x795', category: 'Офсетные пластины', stock: 800, minStock: 200 },
  { name: 'Офсетная пластина CTP 1030x790', sku: 'PLATE-1030x790', unit: 'шт', format: '1030x790', category: 'Офсетные пластины', stock: 1000, minStock: 200 },
  { name: 'Офсетная пластина CTP 890x608', sku: 'PLATE-890x608', unit: 'шт', format: '890x608', category: 'Офсетные пластины', stock: 2000, minStock: 200 },
  { name: 'Офсетная пластина CTP 745x605', sku: 'PLATE-745x605', unit: 'шт', format: '745x605', category: 'Офсетные пластины', stock: 950, minStock: 200 },
  { name: 'Офсетная пластина CTP 510x400 (0,15)', sku: 'PLATE-510x400-015', unit: 'шт', format: '510x400', category: 'Офсетные пластины', stock: 3000, minStock: 200 },

  // ==================== БИГОВАЛЬНЫЙ КАНАЛ ====================
  { name: 'Биговальный канал 0,3x1,3', sku: 'BIG-03x13', unit: 'пачка', format: '0,3x1,3', category: 'Биговальный канал', stock: 462, minStock: 30, salePrice: 400000 },
  { name: 'Биговальный канал 0,4x1,3', sku: 'BIG-04x13', unit: 'пачка', format: '0,4x1,3', category: 'Биговальный канал', stock: 192, minStock: 30, salePrice: 400000 },
  { name: 'Биговальный канал 0,4x1,4', sku: 'BIG-04x14', unit: 'пачка', format: '0,4x1,4', category: 'Биговальный канал', stock: 289, minStock: 30, salePrice: 400000 },
  { name: 'Биговальный канал 0,5x1,5', sku: 'BIG-05x15', unit: 'пачка', format: '0,5x1,5', category: 'Биговальный канал', stock: 321, minStock: 30, salePrice: 400000 },
  { name: 'Биговальный канал 0,7x2,3', sku: 'BIG-07x23', unit: 'пачка', format: '0,7x2,3', category: 'Биговальный канал', stock: 494, minStock: 30, salePrice: 400000 },
  { name: 'Биговальный канал 0,8x2,5', sku: 'BIG-08x25', unit: 'пачка', format: '0,8x2,5', category: 'Биговальный канал', stock: 39, minStock: 10, salePrice: 400000 },

  // ==================== ОФСЕТНАЯ РЕЗИНА / ПОЛОТНО ====================
  { name: 'Офсетная резина с планкой 520x440', sku: 'RUBBER-520x440', unit: 'шт', format: '520x440', category: 'Офсетная резина', stock: 157, minStock: 10, salePrice: 480000 },
  { name: 'Офсетная резина с планкой 772x627', sku: 'RUBBER-772x627', unit: 'шт', format: '772x627', category: 'Офсетная резина', stock: 52, minStock: 5, salePrice: 700000 },
  { name: 'Офсетная резина с планкой 791x665', sku: 'RUBBER-791x665', unit: 'шт', format: '791x665', category: 'Офсетная резина', stock: 45, minStock: 5, salePrice: 700000 },
  { name: 'Офсетная резина с планкой 1052x840', sku: 'RUBBER-1052x840', unit: 'шт', format: '1052x840', category: 'Офсетная резина', stock: 133, minStock: 10, salePrice: 850000 },
  { name: 'Офсетная резина с планкой 1060x860', sku: 'RUBBER-1060x860', unit: 'шт', format: '1060x860', category: 'Офсетная резина', stock: 43, minStock: 5, salePrice: 850000 },
  { name: 'Офсетная резина 490x415', sku: 'RUBBER-490x415', unit: 'шт', format: '490x415', category: 'Офсетная резина', stock: 124, minStock: 10, salePrice: 250000 },

  // ==================== КАЛИБРОВОЧНЫЙ КАРТОН ====================
  { name: 'Калибровочный картон 0,1мм', sku: 'KALIB-01', unit: 'лист', format: '1000x1400', category: 'Калибровочный картон', stock: 304, minStock: 30, salePrice: 35000 },
  { name: 'Калибровочный картон 0,2мм', sku: 'KALIB-02', unit: 'лист', format: '1000x1400', category: 'Калибровочный картон', stock: 861, minStock: 50, salePrice: 65000 },
  { name: 'Калибровочный картон 0,3мм', sku: 'KALIB-03', unit: 'лист', format: '1000x1400', category: 'Калибровочный картон', stock: 658, minStock: 50, salePrice: 75000 },
  { name: 'Калибровочный картон 0,4мм', sku: 'KALIB-04', unit: 'лист', format: '1000x1400', category: 'Калибровочный картон', stock: 441, minStock: 30, salePrice: 95000 },
  { name: 'Калибровочный картон 0,5мм', sku: 'KALIB-05', unit: 'лист', format: '1000x1400', category: 'Калибровочный картон', stock: 230, minStock: 30, salePrice: 115000 },

  // ==================== МЕТАЛЛИЧЕСКИЕ ГРЕБЕНКИ ====================
  { name: 'Металлическая гребёнка 1/4 (6,4мм) белая', sku: 'GREB-1-4-W', unit: 'шт', format: '1/4 (6,4мм)', category: 'Расходники для календарей', stock: 1, minStock: 1, salePrice: 1200000 },
  { name: 'Металлическая гребёнка 5/16 (7,9мм) белая', sku: 'GREB-5-16-W', unit: 'шт', format: '5/16 (7,9мм)', category: 'Расходники для календарей', stock: 170, minStock: 5, salePrice: 1200000 },
  { name: 'Металлическая гребёнка 3/8 (9,5мм) белая', sku: 'GREB-3-8-W', unit: 'шт', format: '3/8 (9,5мм)', category: 'Расходники для календарей', stock: 137, minStock: 5, salePrice: 1200000 },
  { name: 'Металлическая гребёнка 7/16 (11,1мм)', sku: 'GREB-7-16', unit: 'шт', format: '7/16 (11,1мм)', category: 'Расходники для календарей', stock: 13, minStock: 3, salePrice: 1200000 },
  { name: 'Металлическая гребёнка 1/2 (12,7мм)', sku: 'GREB-1-2', unit: 'шт', format: '1/2 (12,7мм)', category: 'Расходники для календарей', stock: 15, minStock: 3, salePrice: 1200000 },
  { name: 'Курсор для календарей', sku: 'CURSOR', unit: 'шт', category: 'Расходники для календарей', stock: 70305, minStock: 5000, salePrice: 1700 },
  { name: 'Ригель для календарей белая 32', sku: 'RIGEL-32-W', unit: 'шт', category: 'Расходники для календарей', stock: 9726, minStock: 500, salePrice: 3100 },
  { name: 'Ригель для календарей чёрная 12', sku: 'RIGEL-12-B', unit: 'шт', category: 'Расходники для календарей', stock: 1986, minStock: 200, salePrice: 1500 },
  { name: 'Ригель для календарей чёрная 32', sku: 'RIGEL-32-B', unit: 'шт', category: 'Расходники для календарей', stock: 1268, minStock: 200, salePrice: 3100 },

  // ==================== МАРЗАН ====================
  { name: 'Марзан 138см 10x5мм', sku: 'MARZ-138-10x5', unit: 'шт', format: '10мм x 5мм', category: 'Марзан', stock: 337, minStock: 20, salePrice: 45000 },
  { name: 'Марзан 95см 10x3мм', sku: 'MARZ-95-10x3', unit: 'шт', format: '10мм x 3мм', category: 'Марзан', stock: 34, minStock: 10, salePrice: 45000 },
  { name: 'Марзан 95см 10x5мм', sku: 'MARZ-95-10x5', unit: 'шт', format: '10мм x 5мм', category: 'Марзан', stock: 20, minStock: 10, salePrice: 45000 },
];

async function main() {
  console.log(`\n=== Product Import (остаток 23.02.2026) ===`);
  console.log(`Total products to process: ${products.length}\n`);

  let created = 0;
  let updated = 0;
  let errors = 0;

  for (const p of products) {
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
          minStock: p.minStock,
          salePrice: p.salePrice,
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
  console.log(`  Total:    ${products.length}\n`);
}

main()
  .catch((err) => {
    console.error('Import error:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
