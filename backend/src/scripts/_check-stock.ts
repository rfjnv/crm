/**
 * _check-stock.ts
 *
 * Reads "stock_03.xlsx" and compares product stock against CRM database.
 * Does NOT update anything — pure analysis/dry-run.
 *
 * Excel structure (multi-row header):
 *   Col 0 = date, Col 1 = product name, Col 2 = format/size ("Размер"),
 *   Col 3 = unit ("Ед.из"), Col 7 = final stock ("Остаток 02.03.26")
 *
 * Key challenges solved:
 *   - Excel duplicates: many products appear twice (two warehouse sections
 *     within one sheet). We deduplicate by name+format.
 *   - CRM has ~260 inactive IMPORT-xxx products (legacy). We prefer active
 *     products with proper SKUs for matching.
 *   - CRM product names were renamed since the import-stock.ts import.
 *     We use the import-stock.ts mapping as a bridge (original name/format -> SKU).
 *
 * Usage:
 *   npx tsx src/scripts/_check-stock.ts
 */

import { PrismaClient, Prisma } from '@prisma/client';
import * as XLSX from 'xlsx';
import * as path from 'path';

const prisma = new PrismaClient();

// ─── Types ───────────────────────────────────────────────────────────

interface ExcelProduct {
  rawName: string;
  format: string;
  unit: string;
  stock: number;
  row: number;
  sheet: string;
}

interface CrmProduct {
  id: string;
  name: string;
  sku: string;
  unit: string;
  format: string | null;
  category: string | null;
  stock: number;
  is_active: boolean;
}

type MatchQuality = 'sku-bridge' | 'exact' | 'name+format' | 'fuzzy' | 'none';

interface MatchResult {
  excelProduct: ExcelProduct;
  crmProduct: CrmProduct | null;
  quality: MatchQuality;
  detail?: string;
}

// ─── SKU Bridge (from import-stock.ts) ──────────────────────────────
// Maps (baseName, format) from the original Excel → CRM SKU.
// baseName is normalized lowercase. format is normalized lowercase.

interface BridgeEntry { name: string; format: string; sku: string; }

const SKU_BRIDGE: BridgeEntry[] = [
  // САМОКЛЕЮЩАЯСЯ БУМАГА
  { name: 'самоклеющаяся бумага ф:70*100 белая (китай)', format: '70*100', sku: 'SK-CN-70x100' },
  { name: 'самоклеющаяся бумага ф:50*70 белая (китай)', format: '50*70', sku: 'SK-CN-50x70' },
  { name: 'самоклеющаяся бумага ф:70*100 белая (китай)', format: '70*100 б/н', sku: 'SK-CN-70x100-BN' },
  { name: 'самоклеющаяся бумага ф:50*70 белая (китай)', format: '50*70 б/н', sku: 'SK-CN-50x70-BN' },
  { name: 'самоклеющаяся бумага ф:50*35 белая (китай)', format: '50*35', sku: 'SK-CN-50x35' },
  { name: 'самоклеющаяся бумага ф:50*35 белая (китай)', format: '50*35 б/н', sku: 'SK-CN-50x35-BN' },
  { name: 'самоклеющаяся бумага ф:70*100 красная (китай)', format: '70*100', sku: 'SK-CN-RED-70x100' },
  { name: 'самоклеющаяся бумага ф:50*70 красная (китай)', format: '50*70', sku: 'SK-CN-RED-50x70' },
  { name: 'самоклеющаяся бумага ф:70*100 красная (китай)', format: '70*100 б/н', sku: 'SK-CN-RED-70x100-BN' },
  { name: 'самоклеющаяся бумага ф:50*70 красная (китай)', format: '50*70 б/н', sku: 'SK-CN-RED-50x70-BN' },
  { name: 'самоклеющаяся бумага ф:70*100 (турция)', format: '70*100', sku: 'SK-TR-70x100' },
  { name: 'самоклеющаяся бумага ф:50*70 (турция)', format: '50*70', sku: 'SK-TR-50x70' },
  // Рулоны
  { name: 'самоклеющаяся бумага в рулонах 1м*2000м (акриловый клей)', format: 'bj 993', sku: 'SK-RUL-FASSON-A' },
  { name: 'самоклеющаяся бумага в рулонах 1м*2000м (каучуковый клей)', format: 'bj 995', sku: 'SK-RUL-FASSON-K' },
  { name: 'самоклеющаяся бумага в рулонах 1м*2000м', format: 'китай', sku: 'SK-RUL-LIANGDU' },
  { name: 'самоклеющаяся бумага в рулонах 1м*2000м ненси', format: 'китай', sku: 'SK-RUL-NENSI' },
  // ЦЕЛЛЮЛОЗНЫЙ КАРТОН
  { name: 'целлюлозный многослойный картон', format: 'индия 210гр', sku: 'KART-IND-210-70x100' },
  { name: 'целлюлозный многослойный картон', format: 'индия 250гр', sku: 'KART-IND-250-70x100' },
  { name: 'целлюлозный многослойный картон', format: 'китай 250гр', sku: 'KART-CN-250-70x100' },
  { name: 'целлюлозный многослойный картон', format: '270 рул 62', sku: 'KART-CN-270-RUL-62' },
  { name: 'целлюлозный многослойный картон', format: '300 рул 62', sku: 'KART-CN-300-RUL-62' },
  { name: 'целлюлозный многослойный картон', format: '270 62*94', sku: 'KART-CN-270-62x94' },
  { name: 'целлюлозный многослойный картон', format: '300 62*94', sku: 'KART-CN-300-62x94' },
  // МЕЛОВАННАЯ БУМАГА
  { name: 'мелованная бумага', format: '250гр', sku: 'MEL-HK-250-70x100' },
  { name: 'мелованная бумага', format: '170гр', sku: 'MEL-HK-170-70x100' },
  { name: 'мелованная бумага', format: '105гр', sku: 'MEL-HK-105-MATT' },
  // ФОЛЬГА (золото)
  { name: 'фольга для тиснения 64см*120м', format: 'золото', sku: 'FOIL-GOLD-120' },
  { name: 'фольга для тиснения 64см*240м', format: 'золото', sku: 'FOIL-GOLD-240' },
  { name: 'фольга для тиснения 64см*360м', format: 'золото', sku: 'FOIL-GOLD-360' },
  { name: 'фольга для тиснения 64см*120м', format: 'серебро', sku: 'FOIL-SILVER-120' },
  { name: 'фольга для тиснения 64см*240м', format: 'серебро', sku: 'FOIL-SILVER-240' },
  { name: 'фольга для тиснения 64см*360м', format: 'серебро', sku: 'FOIL-SILVER-360' },
  // ФОЛЬГА (сарик)
  { name: 'фольга для тиснения 64см*120м', format: 'золото (сарик)', sku: 'FOIL-GOLD-Y-120' },
  { name: 'фольга для тиснения 64см*240м', format: 'золото (сарик)', sku: 'FOIL-GOLD-Y-240' },
  { name: 'фольга для тиснения 64см*360м', format: 'золото (сарик)', sku: 'FOIL-GOLD-Y-360' },
  { name: 'фольга для тиснения 64см*120м', format: 'серебро (сарик)', sku: 'FOIL-SILVER-Y-120' },
  { name: 'фольга для тиснения 64см*240м', format: 'серебро (сарик)', sku: 'FOIL-SILVER-Y-240' },
  { name: 'фольга для тиснения 64см*360м', format: 'серебро (сарик)', sku: 'FOIL-SILVER-Y-360' },
  // ФОЛЬГА (цветная)
  { name: 'фольга для тиснения цветная 64см*120м', format: 'яшил', sku: 'FOIL-GREEN-120' },
  { name: 'фольга для тиснения переливающаяся 64см*120м', format: 'переливающий сер', sku: 'FOIL-HOLO-120' },
  { name: 'фольга галаграмма', format: 'песочный яшил', sku: 'FOIL-HOLO-SAND' },
  { name: 'фольга для тиснения цветная 64см*120м', format: 'кора', sku: 'FOIL-BLACK-120' },
  { name: 'фольга для тиснения цветная 64см*120м', format: 'кизил', sku: 'FOIL-RED-120' },
  { name: 'фольга для тиснения цветная 64см*120м', format: 'оч кук', sku: 'FOIL-BLUE-120' },
  { name: 'фольга для тиснения цветная 64см*180м', format: 'ок', sku: 'FOIL-WHITE-180' },
  { name: 'фольга для тиснения цветная 64см*120м', format: 'фиолет', sku: 'FOIL-VIOLET-120' },
  { name: 'фольга для тиснения цветная 64см*120м', format: 'медная', sku: 'FOIL-COPPER-120' },
  { name: 'фольга для тиснения цветная 64см*120м', format: 'жемчук', sku: 'FOIL-PEARL-120' },
  { name: 'фольга для тиснения цветная 64см*120м', format: 'цветная', sku: 'FOIL-COLOR-120' },
  // ФОТОПОЛИМЕРНАЯ
  { name: 'фотополимерная печатная пластина 610*860 мм', format: '610*860', sku: 'PHOTO-PLATE-610x860' },
  // UV ЛАК
  { name: 'полигр,бесцв,краска pi- 50', format: 'pi 50', sku: 'UV-PI50' },
  { name: 'полигр,бесцв,краска pi- 125', format: 'pi 125', sku: 'UV-PI125' },
  { name: 'полигр,бесцв,краска pi- 180', format: 'pi 180', sku: 'UV-PI180' },
  { name: 'полигр,бесцв,краска pi- 180', format: 'pi 180 белгия', sku: 'UV-PI180-BE' },
  { name: 'полигр,бесцв,краска pi- 250', format: 'pi 250', sku: 'UV-PI250' },
  { name: 'полигр,бесцв,краска pi- 250', format: 'pi 250 белгия', sku: 'UV-PI250-BE' },
  { name: 'полигр,бесцв,краска pi- 400а', format: 'pi 400а', sku: 'UV-PI400A' },
  { name: 'полигр,бесцв,краска pi- 400а', format: 'pi 400а белгия', sku: 'UV-PI400A-BE' },
  { name: 'полигр,бесцв,краска pi- 500', format: 'emboss', sku: 'UV-PI500' },
  // ЛАМИНАЦИОННАЯ ПЛЕНКА ГЛЯНЦЕВАЯ
  { name: 'ламинационная пленка ф:3000м (глянцевая)', format: '84', sku: 'LAM-GL-84' },
  { name: 'ламинационная пленка ф:3000м (глянцевая)', format: '78', sku: 'LAM-GL-78' },
  { name: 'ламинационная пленка ф:3000м (глянцевая)', format: '74', sku: 'LAM-GL-74' },
  { name: 'ламинационная пленка ф:3000м (глянцевая)', format: '72', sku: 'LAM-GL-72' },
  { name: 'ламинационная пленка ф:3000м (глянцевая)', format: '70', sku: 'LAM-GL-70' },
  { name: 'ламинационная пленка ф:3000м (глянцевая)', format: '68', sku: 'LAM-GL-68' },
  { name: 'ламинационная пленка ф:3000м (глянцевая)', format: '65', sku: 'LAM-GL-65' },
  { name: 'ламинационная пленка ф:3000м (глянцевая)', format: '62', sku: 'LAM-GL-62' },
  { name: 'ламинационная пленка ф:3000м (глянцевая)', format: '60', sku: 'LAM-GL-60' },
  { name: 'ламинационная пленка ф:3000м (глянцевая)', format: '58', sku: 'LAM-GL-58' },
  { name: 'ламинационная пленка ф:3000м (глянцевая)', format: '55', sku: 'LAM-GL-55' },
  { name: 'ламинационная пленка ф:3000м (глянцевая)', format: '50', sku: 'LAM-GL-50' },
  { name: 'ламинационная пленка ф:3000м (глянцевая)', format: '48', sku: 'LAM-GL-48' },
  { name: 'ламинационная пленка ф:3000м (глянцевая)', format: '42', sku: 'LAM-GL-42' },
  { name: 'ламинационная пленка ф:3000м (глянцевая)', format: '35', sku: 'LAM-GL-35' },
  { name: 'ламинационная пленка ф:3000м (глянцевая)', format: '30', sku: 'LAM-GL-30' },
  // ЛАМИНАЦИОННАЯ ПЛЕНКА МАТОВАЯ
  { name: 'ламинационная пленка ф:3000м (матовая)', format: '84мат', sku: 'LAM-MT-84' },
  { name: 'ламинационная пленка ф:3000м (матовая)', format: '70мат', sku: 'LAM-MT-70' },
  { name: 'ламинационная пленка ф:3000м (матовая)', format: '72мат', sku: 'LAM-MT-72' },
  { name: 'ламинационная пленка ф:3000м (матовая)', format: '68мат', sku: 'LAM-MT-68' },
  { name: 'ламинационная пленка ф:3000м (матовая)', format: '62мат', sku: 'LAM-MT-62' },
  { name: 'ламинационная пленка ф:3000м (матовая)', format: '60мат', sku: 'LAM-MT-60' },
  { name: 'ламинационная пленка ф:3000м (матовая)', format: '58мат', sku: 'LAM-MT-58' },
  { name: 'ламинационная пленка ф:3000м (матовая)', format: '50мат', sku: 'LAM-MT-50' },
  { name: 'ламинационная пленка ф:3000м (матовая)', format: '42мат', sku: 'LAM-MT-42' },
  { name: 'ламинационная пленка ф:3000м (матовая)', format: '35мат', sku: 'LAM-MT-35' },
  { name: 'ламинационная пленка ф:3000м (матовая)', format: '30мат', sku: 'LAM-MT-30' },
  // ЛАМИНАЦИОННАЯ МЕТАЛЛИЧЕСКАЯ
  { name: 'ламинационная пленка металлического ф:3000м', format: '75 gold', sku: 'LAM-GOLD-75' },
  { name: 'ламинационная пленка металлического ф:3000м', format: '70 gold', sku: 'LAM-GOLD-70' },
  { name: 'ламинационная пленка металлического ф:3000м', format: '62 gold', sku: 'LAM-GOLD-62' },
  { name: 'ламинационная пленка металлического ф:3000м', format: '60 gold', sku: 'LAM-GOLD-60' },
  { name: 'ламинационная пленка металлического ф:3000м', format: '50 gold', sku: 'LAM-GOLD-50' },
  { name: 'ламинационная пленка металлического ф:3000м', format: '70 silver', sku: 'LAM-SILVER-70' },
  { name: 'ламинационная пленка металлического ф:3000м', format: '62 silver', sku: 'LAM-SILVER-62' },
  { name: 'ламинационная пленка металлического ф:3000м', format: '60 silver', sku: 'LAM-SILVER-60' },
  { name: 'ламинационная пленка металлического ф:3000м', format: '50 silver', sku: 'LAM-SILVER-50' },
  // ЛАМИНАЦИОННАЯ СПЕЦ
  { name: 'ламинационная пленка soft touch', format: '50', sku: 'LAM-SOFT-50' },
  { name: 'ламинационная пленка голографик', format: '50', sku: 'LAM-HOLO-50' },
  { name: 'ламинационная пленка голографик', format: '70', sku: 'LAM-HOLO-70' },
  // ОФСЕТНАЯ ПЛАСТИНА UV СТР
  { name: 'офсетная пластина uv стр', format: '1280*1060', sku: 'PLATE-UV-1280x1060' },
  { name: 'офсетная пластина uv стр', format: '1050*820', sku: 'PLATE-UV-1050x820' },
  { name: 'офсетная пластина uv стр', format: '1050*795', sku: 'PLATE-UV-1050x795' },
  { name: 'офсетная пластина uv стр', format: '1030*820', sku: 'PLATE-UV-1030x820' },
  { name: 'офсетная пластина uv стр', format: '1030*790', sku: 'PLATE-UV-1030x790' },
  { name: 'офсетная пластина uv стр', format: '1030*770', sku: 'PLATE-UV-1030x770' },
  { name: 'офсетная пластина uv стр', format: '920*605', sku: 'PLATE-UV-920x605' },
  { name: 'офсетная пластина uv стр', format: '925*740', sku: 'PLATE-UV-925x740' },
  { name: 'офсетная пластина uv стр', format: '1050*811', sku: 'PLATE-UV-1050x811' },
  { name: 'офсетная пластина uv стр', format: '890*643', sku: 'PLATE-UV-890x643' },
  { name: 'офсетная пластина uv стр', format: '890*608', sku: 'PLATE-UV-890x608' },
  { name: 'офсетная пластина uv стр', format: '890*576', sku: 'PLATE-UV-890x576' },
  { name: 'офсетная пластина uv стр', format: '860*580', sku: 'PLATE-UV-860x580' },
  { name: 'офсетная пластина uv стр', format: '850*566', sku: 'PLATE-UV-850x566' },
  { name: 'офсетная пластина uv стр', format: '850*567', sku: 'PLATE-UV-850x567' },
  { name: 'офсетная пластина uv стр', format: '755*625', sku: 'PLATE-UV-755x625' },
  { name: 'офсетная пластина uv стр', format: '775*635', sku: 'PLATE-UV-775x635' },
  { name: 'офсетная пластина uv стр', format: '775*605', sku: 'PLATE-UV-775x605' },
  { name: 'офсетная пластина uv стр', format: '745*615', sku: 'PLATE-UV-745x615' },
  { name: 'офсетная пластина uv стр', format: '745*605', sku: 'PLATE-UV-745x605' },
  { name: 'офсетная пластина uv стр', format: '650*550', sku: 'PLATE-UV-650x550' },
  { name: 'офсетная пластина uv стр', format: '525*459', sku: 'PLATE-UV-525x459' },
  { name: 'офсетная пластина uv стр', format: '510*400(0,15)', sku: 'PLATE-UV-510x400-015' },
  { name: 'офсетная пластина uv стр', format: '510*400(0,3)', sku: 'PLATE-UV-510x400-030' },
  { name: 'офсетная пластина uv стр', format: '490*370', sku: 'PLATE-UV-490x370' },
  { name: 'офсетная пластина uv стр', format: '450*370', sku: 'PLATE-UV-450x370' },
  // ОФСЕТНАЯ ПЛАСТИНА СТР (без UV)
  { name: 'офсетная пластина стр', format: '1050*795', sku: 'PLATE-CTP-1050x795' },
  { name: 'офсетная пластина стр', format: '1030*790', sku: 'PLATE-CTP-1030x790' },
  { name: 'офсетная пластина стр', format: '890*608', sku: 'PLATE-CTP-890x608' },
  { name: 'офсетная пластина стр', format: '745*605', sku: 'PLATE-CTP-745x605' },
  { name: 'офсетная пластина стр', format: '510*400 (0,15)', sku: 'PLATE-CTP-510x400-015' },
  // Also match CTP variants
  { name: 'офсетная пластина ctp', format: '1050*795', sku: 'PLATE-CTP-1050x795' },
  { name: 'офсетная пластина ctp', format: '1030*790', sku: 'PLATE-CTP-1030x790' },
  { name: 'офсетная пластина ctp', format: '1280*1060', sku: 'PLATE-UV-1280x1060' },
  { name: 'офсетная пластина ctp', format: '890*608', sku: 'PLATE-CTP-890x608' },
  { name: 'офсетная пластина ctp', format: '745*605', sku: 'PLATE-CTP-745x605' },
  { name: 'офсетная пластина ctp', format: '510*400 (0,15)', sku: 'PLATE-CTP-510x400-015' },
  { name: 'офсетная пластина ctp', format: '510*400(0,15)', sku: 'PLATE-CTP-510x400-015' },
  // МАРЗАН
  { name: 'марзан', format: '25*25*720мм', sku: 'MARZ-720-25x25' },
  { name: 'марзан', format: '10*5*1380мм', sku: 'MARZ-138-10x5' },
  { name: 'марзан', format: '10*5*950мм', sku: 'MARZ-95-10x5-950' },
  { name: 'марзан', format: '95*0,3', sku: 'MARZ-95-03' },
  { name: 'марзан', format: '95*0,5', sku: 'MARZ-95-05' },
  // ХИМИЯ
  { name: 'смывка для валов turquoise 60 wm', format: '', sku: 'CHEM-WASH60' },
  { name: 'добавка к увлажнению alfa plus 3300', format: '', sku: 'CHEM-ALFA' },
  { name: 'смывка для валов nova roll up', format: '', sku: 'CHEM-NOVA-ROLL' },
  { name: 'очиститель для пластин novafix', format: 'novafix', sku: 'CHEM-NOVAFIX' },
  { name: 'нова плюс', format: '', sku: 'CHEM-NOVAPLUS' },
  // ВД ЛАК
  { name: 'водно-дисперсионный лак глянцевый', format: '30кг/20кг', sku: 'CHEM-VDL-GL' },
  { name: 'водно-дисперсионный лак матт', format: '20кг', sku: 'CHEM-VDL-MT' },
  { name: 'водно-дисперсионный лак высоко глянцевый', format: '20кг', sku: 'CHEM-VDL-HG' },
  // ТЕРМОКЛЕЙ
  { name: 'термоклей в гранулах 6092', format: '6092', sku: 'GLUE-6092' },
  { name: 'термоклей в гранулах 6030', format: '6030', sku: 'GLUE-6030' },
  { name: 'термоклей в гранулах', format: '', sku: 'GLUE-GRAN' },
  // РАСХОДНИКИ
  { name: 'противоотмарывающий порошок spray powder', format: '', sku: 'CHEM-TALK' },
  { name: 'вискозная губка', format: '', sku: 'CHEM-GUBKA' },
  { name: 'пробойник', format: '0.5', sku: 'MISC-PUNCH-05' },
  { name: 'копировальная бумага', format: 'а3', sku: 'MISC-COPY-A3' },
  // КАЛИБРОВОЧНЫЙ КАРТОН
  { name: 'калибровочный картон 1000*1400', format: '0.1', sku: 'KALIB-01' },
  { name: 'калибровочный картон 1000*1400', format: '0.15', sku: 'KALIB-015' },
  { name: 'калибровочный картон 1000*1400', format: '0.2', sku: 'KALIB-02' },
  { name: 'калибровочный картон 1000*1400', format: '0.3', sku: 'KALIB-03' },
  { name: 'калибровочный картон 1000*1400', format: '0.4', sku: 'KALIB-04' },
  { name: 'калибровочный картон 1000*1400', format: '0.5', sku: 'KALIB-05' },
  // КУРСОР И РИГЕЛЬ
  { name: 'курсор для календ.', format: '', sku: 'CURSOR' },
  { name: 'ригель для календарей (белая)', format: '32', sku: 'RIGEL-32-W' },
  { name: 'ригель для календарей (черная)', format: '12', sku: 'RIGEL-12-B' },
  { name: 'ригель для календарей (черная)', format: '32', sku: 'RIGEL-32-B' },
  // ОФСЕТНЫЕ КРАСКИ
  { name: 'офсетный лак', format: 'глянц', sku: 'INK-LAK-GL' },
  { name: 'офсетный краска power proces', format: 'кизил', sku: 'INK-POWER-RED' },
  { name: 'офсетный краска focus proces', format: 'кизил', sku: 'INK-FOCUS-RED' },
  { name: 'офсетный краска innovation', format: 'кизил', sku: 'INK-INNOV-RED' },
  { name: 'офсетный краска innovation', format: 'кора', sku: 'INK-INNOV-BLACK' },
  // ПАНТОН
  { name: 'полиграфическая краска цветная пантон', format: 'opaque white', sku: 'PNT-OPAQ-WHITE' },
  { name: 'полиграфическая краска цветная пантон', format: 'transparent white', sku: 'PNT-TRANS-WHITE' },
  { name: 'полиграфическая краска цветная пантон', format: 'orange 021', sku: 'PNT-ORANGE021' },
  { name: 'полиграфическая краска цветная пантон', format: 'black', sku: 'PNT-BLACK' },
  { name: 'полиграфическая краска цветная пантон', format: 'rhodamine red', sku: 'PNT-RHODAMINE' },
  { name: 'полиграфическая краска цветная пантон', format: 'warm red', sku: 'PNT-WARM-RED' },
  { name: 'полиграфическая краска цветная пантон', format: 'violet', sku: 'PNT-VIOLET' },
  { name: 'полиграфическая краска цветная пантон', format: 'blue 072', sku: 'PNT-BLUE072' },
  { name: 'полиграфическая краска цветная пантон', format: 'process blue', sku: 'PNT-PROC-BLUE' },
  { name: 'полиграфическая краска цветная пантон', format: 'rubin red', sku: 'PNT-RUBINE' },
  { name: 'полиграфическая краска цветная пантон', format: 'yellow', sku: 'PNT-YELLOW' },
  { name: 'полиграфическая краска цветная пантон', format: 'purple', sku: 'PNT-PURPLE' },
  { name: 'полиграфическая краска цветная пантон', format: 'reflex blue', sku: 'PNT-REFLEX-BLUE' },
  { name: 'полиграфическая краска цветная пантон', format: 'red 032', sku: 'PNT-RED032' },
  { name: 'полиграфическая краска цветная пантон', format: 'green', sku: 'PNT-GREEN' },
  { name: 'полиграфическая краска цветная пантон', format: 'silver 877', sku: 'PNT-SILVER877' },
  { name: 'полиграфическая краска цветная пантон', format: 'gold 871', sku: 'PNT-GOLD871' },
  { name: 'полиграфическая краска цветная пантон', format: 'gold 873', sku: 'PNT-GOLD873' },
  { name: 'полиграфическая краска цветная пантон', format: 'gold 875', sku: 'PNT-GOLD875' },
  // ПРОЯВИТЕЛЬ
  { name: 'проявитель', format: 'hammond 1+9', sku: 'CHEM-PROY-HAM-19' },
  { name: 'проявитель', format: 'hammond стр', sku: 'CHEM-PROY-HAM' },
  { name: 'проявитель', format: 'нова 1+9 uv', sku: 'CHEM-PROY-UV' },
  { name: 'проявитель', format: 'стр(teknova)', sku: 'CHEM-PROY-CTP' },
  { name: 'проявитель для пластин (порошок, 200гр)', format: '', sku: 'CHEM-PROY-POWDER' },
  // БИГОВАЛЬНЫЙ КАНАЛ
  { name: 'биговальный канал ф:', format: '0,3*1,3', sku: 'BIG-03x13' },
  { name: 'биговальный канал ф:', format: '0,4*1,2', sku: 'BIG-04x12' },
  { name: 'биговальный канал ф:', format: '0,4*1,4', sku: 'BIG-04x14' },
  { name: 'биговальный канал ф:', format: '0,5*1,5', sku: 'BIG-05x15' },
  { name: 'биговальный канал ф:', format: '0,4*1,3', sku: 'BIG-04x13' },
  { name: 'биговальный канал ф:', format: '0,7*2,3', sku: 'BIG-07x23' },
  { name: 'биговальный канал ф:', format: '0,8*2,5', sku: 'BIG-08x25' },
  // Also handle "0<4x1,2" typo variant
  { name: 'биговальный канал ф:', format: '0<4*1,2', sku: 'BIG-04x12' },
  // ОФСЕТНОЕ ПОЛОТНО
  { name: 'офсетное полотно(из текстильного материала)', format: '520*440', sku: 'RUBBER-520x440' },
  { name: 'офсетное полотно (из текстильного материала)', format: '520*440', sku: 'RUBBER-520x440' },
  { name: 'офсетное полотно(из текстильного материала)', format: '772*627', sku: 'RUBBER-772x627' },
  { name: 'офсетное полотно (из текстильного материала)', format: '772*627', sku: 'RUBBER-772x627' },
  { name: 'офсетное полотно(из текстильного материала)', format: '791*665', sku: 'RUBBER-791x665' },
  { name: 'офсетное полотно (из текстильного материала)', format: '791*665', sku: 'RUBBER-791x665' },
  { name: 'офсетное полотно(из текстильного материала)', format: '1052*840', sku: 'RUBBER-1052x840' },
  { name: 'офсетное полотно (из текстильного материала)', format: '1052*840', sku: 'RUBBER-1052x840' },
  { name: 'офсетное полотно(из текстильного материала)', format: '1060*860', sku: 'RUBBER-1060x860' },
  { name: 'офсетное полотно (из текстильного материала)', format: '1060*860', sku: 'RUBBER-1060x860' },
  { name: 'офсетное полотно(из текстильного материала)', format: '49', sku: 'RUBBER-490x415' },
  { name: 'офсетное полотно (из текстильного материала)', format: '49', sku: 'RUBBER-490x415' },
  { name: 'офсетное полотно(из текстильного материала)', format: '1450', sku: 'RUBBER-RUL-1450' },
  { name: 'офсетное полотно (из текстильного материала)', format: '1450', sku: 'RUBBER-RUL-1450' },
  { name: 'офсетное полотно(из текстильного материала)', format: '1350', sku: 'RUBBER-RUL-1350' },
  { name: 'офсетное полотно (из текстильного материала)', format: '1350', sku: 'RUBBER-RUL-1350' },
  { name: 'офсетное полотно(из текстильного материала)', format: '106', sku: 'RUBBER-RUL-106' },
  { name: 'офсетное полотно (из текстильного материала)', format: '106', sku: 'RUBBER-RUL-106' },
  { name: 'офсетное полотно(из текстильного материала)', format: '78', sku: 'RUBBER-RUL-78' },
  { name: 'офсетное полотно (из текстильного материала)', format: '78', sku: 'RUBBER-RUL-78' },
  // ЧЕХОЛ
  { name: 'чехол для валов', format: '64', sku: 'SLEEVE-64' },
  { name: 'чехол для валов', format: '44', sku: 'SLEEVE-44' },
  // УФ ЛАМПА
  { name: 'уф лампа', format: '', sku: 'UV-LAMP' },
  // ГРЕБЁНКА
  { name: 'металлическая грибенка', format: '1*4(ок)', sku: 'GREB-1-4-W' },
  { name: 'металлическая грибенка', format: '3*8(ок)', sku: 'GREB-3-8-W' },
  { name: 'металлическая грибенка', format: '3*8(кора)', sku: 'GREB-3-8-B' },
  { name: 'металлическая грибенка', format: '5*16(ок)', sku: 'GREB-5-16-W' },
  { name: 'металлическая грибенка', format: '5*8(ок)', sku: 'GREB-5-8' },
  { name: 'металлическая грибенка', format: '3*4(ок)', sku: 'GREB-3-4' },
  { name: 'металлическая грибенка', format: '9*16(ок)', sku: 'GREB-9-16' },
  { name: 'металлическая грибенка', format: '5*16(кора)', sku: 'GREB-5-16-B' },
  { name: 'металлическая грибенка', format: '1*2(ок)', sku: 'GREB-1-2' },
  { name: 'металлическая грибенка', format: '7*16(ок)', sku: 'GREB-7-16' },
  { name: 'металлическая грибенка', format: '1*4(кора)', sku: 'GREB-1-4-B' },
  // ВД ЛАК МАТОВЫЙ (variant name)
  { name: 'водно-дисперсионный лак матовый', format: '', sku: 'CHEM-VDL-MT' },
  // КОПИРОВАЛЬНАЯ (variant)
  { name: 'копировальгая бумага', format: 'а3', sku: 'MISC-COPY-A3' },
  // ГУМ
  { name: 'гум', format: '', sku: 'CHEM-NOVAFIX' },
];

// ─── Helpers ─────────────────────────────────────────────────────────

function norm(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, ' ');
}

function pad(s: string, len: number): string {
  if (s.length >= len) return s.substring(0, len);
  return s + ' '.repeat(len - s.length);
}

function rpad(s: string, len: number): string {
  if (s.length >= len) return s.substring(0, len);
  return ' '.repeat(len - s.length) + s;
}

// ─── Excel reading ───────────────────────────────────────────────────

function readExcelFile(filePath: string): ExcelProduct[] {
  const wb = XLSX.readFile(filePath);
  const products: ExcelProduct[] = [];

  console.log(`\n${'='.repeat(70)}`);
  console.log(`  EXCEL FILE STRUCTURE: ${path.basename(filePath)}`);
  console.log(`${'='.repeat(70)}`);
  console.log(`  Sheets: ${wb.SheetNames.join(', ')}\n`);

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    const data: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

    console.log(`  --- Sheet: "${sheetName}" (${data.length} rows) ---`);

    for (let i = 0; i < Math.min(8, data.length); i++) {
      const row = data[i];
      const cols = row.map((c: any, idx: number) => `[${idx}]=${String(c).substring(0, 45)}`).join(' | ');
      console.log(`    Row ${i + 1}: ${cols}`);
    }

    // Detect columns
    let nameCol = -1, formatCol = -1, unitCol = -1, stockCol = -1, headerEndRow = -1;

    for (let i = 0; i < Math.min(10, data.length); i++) {
      const row = data[i];
      for (let j = 0; j < row.length; j++) {
        const cell = norm(String(row[j]));
        if (cell.includes('ед.') || cell.includes('ед.изм') || cell === 'ед') { unitCol = j; headerEndRow = Math.max(headerEndRow, i); }
        if (cell.includes('остаток')) { stockCol = j; headerEndRow = Math.max(headerEndRow, i); }
        if (cell.includes('размер')) { formatCol = j; headerEndRow = Math.max(headerEndRow, i); }
        if (cell.includes('приход') || cell.includes('расход') || cell.includes('кол-во')) { headerEndRow = Math.max(headerEndRow, i); }
      }
    }

    const dataStart = headerEndRow + 1;
    for (let i = dataStart; i < Math.min(dataStart + 5, data.length); i++) {
      const row = data[i];
      for (let j = 0; j < row.length; j++) {
        if (String(row[j]).length > 15 && /[а-яА-Я]/.test(String(row[j]))) { nameCol = j; break; }
      }
      if (nameCol >= 0) break;
    }

    console.log(`\n    Detected: headerEndRow=${headerEndRow}, nameCol=${nameCol}, formatCol=${formatCol}, unitCol=${unitCol}, stockCol=${stockCol}`);
    console.log(`    Data starts at row ${dataStart + 1}\n`);

    if (nameCol < 0) { console.log(`    => Could not detect name column, skipping.\n`); continue; }

    for (let i = dataStart; i < data.length; i++) {
      const row = data[i];
      const name = String(row[nameCol] ?? '').trim();
      if (!name || name.length < 3) continue;
      const nameLower = norm(name);
      if (nameLower === 'итого' || nameLower === 'всего' || nameLower.startsWith('итого ') || nameLower.startsWith('всего ')) continue;
      if (stockCol >= 0) {
        const sv = row[stockCol];
        if ((sv === '' || sv === undefined || sv === null) &&
            (unitCol < 0 || row[unitCol] === '' || row[unitCol] === undefined)) continue;
      }

      const format = formatCol >= 0 ? String(row[formatCol] ?? '').trim() : '';
      const unit = unitCol >= 0 ? String(row[unitCol] ?? '').trim() : '';
      let stock = 0;
      if (stockCol >= 0) {
        const rawVal = row[stockCol];
        if (typeof rawVal === 'number') stock = rawVal;
        else { const cleaned = String(rawVal).replace(/\s/g, '').replace(',', '.'); stock = parseFloat(cleaned) || 0; }
      }

      products.push({ rawName: name, format, unit, stock, row: i + 1, sheet: sheetName });
    }

    console.log(`    => Parsed ${products.length} raw products.\n`);
  }

  return products;
}

function deduplicateExcel(products: ExcelProduct[]): ExcelProduct[] {
  // Deduplicate by (normalized name, normalized format), keep last occurrence
  const map = new Map<string, ExcelProduct>();
  for (const ep of products) {
    const key = `${norm(ep.rawName)}|||${norm(ep.format)}`;
    map.set(key, ep); // overrides previous — keeps last
  }
  const deduped = Array.from(map.values());
  console.log(`  Deduplicated: ${products.length} raw -> ${deduped.length} unique (by name+format)`);
  return deduped;
}

// ─── Matching ────────────────────────────────────────────────────────

function findSkuViaBridge(excelName: string, excelFormat: string): string | null {
  const normName = norm(excelName);
  const normFmt = norm(excelFormat);

  // Try exact match on name+format first
  for (const b of SKU_BRIDGE) {
    if (normName === b.name && normFmt === b.format) return b.sku;
  }
  // Try exact name with format substring match
  for (const b of SKU_BRIDGE) {
    if (normName === b.name && b.format && normFmt.includes(b.format)) return b.sku;
  }
  // Try substring name match + exact format
  for (const b of SKU_BRIDGE) {
    if (b.format && normFmt === b.format && (normName.includes(b.name) || b.name.includes(normName))) return b.sku;
  }
  // Try name contains + format contains
  for (const b of SKU_BRIDGE) {
    if ((normName.includes(b.name) || b.name.includes(normName)) && normFmt && b.format &&
        (normFmt.includes(b.format) || b.format.includes(normFmt))) {
      return b.sku;
    }
  }
  // For products with empty format in bridge, match just by name
  for (const b of SKU_BRIDGE) {
    if (b.format === '' && normName === b.name) return b.sku;
  }
  for (const b of SKU_BRIDGE) {
    if (b.format === '' && (normName.includes(b.name) || b.name.includes(normName))) return b.sku;
  }
  return null;
}

function matchProducts(excelProducts: ExcelProduct[], crmProducts: CrmProduct[]): MatchResult[] {
  const results: MatchResult[] = [];
  const usedCrmIds = new Set<string>();
  const usedExcelKeys = new Set<string>();
  const excelKey = (ep: ExcelProduct) => `${ep.sheet}:${ep.row}`;

  // Build CRM lookup by SKU
  const crmBySku = new Map<string, CrmProduct>();
  for (const cp of crmProducts) {
    crmBySku.set(cp.sku, cp);
  }

  // --- Pass 1: SKU Bridge ---
  for (const ep of excelProducts) {
    if (usedExcelKeys.has(excelKey(ep))) continue;
    const sku = findSkuViaBridge(ep.rawName, ep.format);
    if (sku) {
      const cp = crmBySku.get(sku);
      if (cp && !usedCrmIds.has(cp.id)) {
        results.push({ excelProduct: ep, crmProduct: cp, quality: 'sku-bridge', detail: sku });
        usedCrmIds.add(cp.id);
        usedExcelKeys.add(excelKey(ep));
      }
    }
  }

  // --- Pass 2: Exact name match (unique name in both) ---
  const crmByNorm = new Map<string, CrmProduct[]>();
  for (const cp of crmProducts) {
    if (usedCrmIds.has(cp.id)) continue;
    const key = norm(cp.name);
    if (!crmByNorm.has(key)) crmByNorm.set(key, []);
    crmByNorm.get(key)!.push(cp);
  }

  for (const ep of excelProducts) {
    if (usedExcelKeys.has(excelKey(ep))) continue;
    const candidates = crmByNorm.get(norm(ep.rawName));
    if (candidates && candidates.length === 1 && !usedCrmIds.has(candidates[0].id)) {
      const sameNameCount = excelProducts.filter(e => !usedExcelKeys.has(excelKey(e)) && norm(e.rawName) === norm(ep.rawName)).length;
      if (sameNameCount === 1) {
        results.push({ excelProduct: ep, crmProduct: candidates[0], quality: 'exact' });
        usedCrmIds.add(candidates[0].id);
        usedExcelKeys.add(excelKey(ep));
      }
    }
  }

  // --- Pass 3: Name+Format matching (CRM format vs Excel format) ---
  for (const ep of excelProducts) {
    if (usedExcelKeys.has(excelKey(ep))) continue;
    const normExcelName = norm(ep.rawName);
    const normExcelFmt = norm(ep.format);

    let bestMatch: CrmProduct | null = null;
    let bestScore = 0;

    for (const cp of crmProducts) {
      if (usedCrmIds.has(cp.id)) continue;
      const normCrmName = norm(cp.name);
      const normCrmFmt = norm(cp.format ?? '');
      // Name relationship
      const nameContains = normCrmName.includes(normExcelName) || normExcelName.includes(normCrmName);
      if (!nameContains) continue;
      if (!normExcelFmt || !normCrmFmt) continue;
      const fa = normExcelFmt.replace(/\s/g, '');
      const fb = normCrmFmt.replace(/\s/g, '');
      if (fa === fb || fa.includes(fb) || fb.includes(fa)) {
        const score = 100 + normExcelName.length;
        if (score > bestScore) { bestScore = score; bestMatch = cp; }
      }
    }

    if (bestMatch) {
      results.push({ excelProduct: ep, crmProduct: bestMatch, quality: 'name+format' });
      usedCrmIds.add(bestMatch.id);
      usedExcelKeys.add(excelKey(ep));
    }
  }

  // --- Pass 4: Fuzzy word overlap (name + format combined) ---
  for (const ep of excelProducts) {
    if (usedExcelKeys.has(excelKey(ep))) continue;
    const fullExcel = norm(ep.rawName + ' ' + ep.format).replace(/[()\/\\,;:]/g, ' ').replace(/\s+/g, ' ');
    const wordsExcel = new Set(fullExcel.split(/\s+/).filter(w => w.length > 1));
    let bestMatch: CrmProduct | null = null;
    let bestScore = 0;

    for (const cp of crmProducts) {
      if (usedCrmIds.has(cp.id)) continue;
      // Skip IMPORT-xxx products in fuzzy pass (too noisy)
      if (cp.sku.startsWith('IMPORT-')) continue;
      const fullCrm = norm(cp.name).replace(/[()\/\\,;:]/g, ' ').replace(/\s+/g, ' ');
      const wordsCrm = new Set(fullCrm.split(/\s+/).filter(w => w.length > 1));
      let overlap = 0;
      for (const w of wordsExcel) if (wordsCrm.has(w)) overlap++;
      const total = Math.max(wordsExcel.size, wordsCrm.size);
      const score = total > 0 ? overlap / total : 0;
      if (score > bestScore && score >= 0.5) { bestScore = score; bestMatch = cp; }
    }

    if (bestMatch) {
      results.push({ excelProduct: ep, crmProduct: bestMatch, quality: 'fuzzy', detail: `${Math.round(bestScore * 100)}%` });
      usedCrmIds.add(bestMatch.id);
      usedExcelKeys.add(excelKey(ep));
    } else {
      results.push({ excelProduct: ep, crmProduct: null, quality: 'none' });
      usedExcelKeys.add(excelKey(ep));
    }
  }

  return results;
}

// ─── Main ────────────────────────────────────────────────────────────

async function main() {
  const excelPath = path.resolve(__dirname, '../../../stock_03.xlsx');
  console.log(`\nReading Excel: ${excelPath}`);
  const rawExcel = readExcelFile(excelPath);
  const excelProducts = deduplicateExcel(rawExcel);

  console.log(`\n${'='.repeat(86)}`);
  console.log(`  ALL EXCEL PRODUCTS (${excelProducts.length} unique)`);
  console.log(`${'='.repeat(86)}`);
  console.log(`  ${pad('#', 4)} ${pad('Product Name', 48)} ${pad('Format', 20)} ${pad('Unit', 6)} ${rpad('Stock', 12)}`);
  console.log(`  ${'-'.repeat(4)} ${'-'.repeat(48)} ${'-'.repeat(20)} ${'-'.repeat(6)} ${'-'.repeat(12)}`);
  for (let i = 0; i < excelProducts.length; i++) {
    const ep = excelProducts[i];
    console.log(`  ${pad(String(i + 1), 4)} ${pad(ep.rawName, 48)} ${pad(ep.format, 20)} ${pad(ep.unit, 6)} ${rpad(String(ep.stock), 12)}`);
  }

  // Fetch CRM products
  console.log(`\nFetching CRM products...`);
  const crmRows = await prisma.$queryRaw<CrmProduct[]>(
    Prisma.sql`SELECT id, name, sku, unit, format, category, stock::text, is_active FROM products ORDER BY name`
  );
  const crmProducts: CrmProduct[] = crmRows.map(r => ({
    ...r,
    stock: parseFloat(String(r.stock)) || 0,
    is_active: Boolean(r.is_active),
  }));
  console.log(`  CRM total: ${crmProducts.length} (active: ${crmProducts.filter(c => c.is_active).length})`);

  // Match
  const results = matchProducts(excelProducts, crmProducts);
  const matched = results.filter(r => r.quality !== 'none');
  const unmatched = results.filter(r => r.quality === 'none');

  matched.sort((a, b) => (a.crmProduct?.name ?? '').localeCompare(b.crmProduct?.name ?? '', 'ru'));

  // Print matched table
  console.log(`\n${'='.repeat(145)}`);
  console.log(`  MATCHED PRODUCTS (${matched.length})`);
  console.log(`${'='.repeat(145)}`);
  console.log(
    `  ${pad('#', 4)} ${pad('CRM Name', 50)} ${rpad('CRM Stk', 10)} ${rpad('XLS Stk', 10)} ${rpad('Diff', 10)} ${pad('Quality', 16)} ${pad('Excel [format]', 45)}`
  );
  console.log(
    `  ${'-'.repeat(4)} ${'-'.repeat(50)} ${'-'.repeat(10)} ${'-'.repeat(10)} ${'-'.repeat(10)} ${'-'.repeat(16)} ${'-'.repeat(45)}`
  );

  let totalCrmStock = 0, totalExcelStock = 0, totalDiff = 0;
  let positiveChanges = 0, negativeChanges = 0, noChanges = 0;

  for (let i = 0; i < matched.length; i++) {
    const r = matched[i];
    const cp = r.crmProduct!;
    const ep = r.excelProduct;
    const diff = ep.stock - cp.stock;
    totalCrmStock += cp.stock; totalExcelStock += ep.stock; totalDiff += diff;
    if (diff > 0) positiveChanges++; else if (diff < 0) negativeChanges++; else noChanges++;

    const diffStr = diff > 0 ? `+${diff}` : diff === 0 ? '0' : String(diff);
    const qualityStr = r.quality + (r.detail ? ` ${r.detail}` : '');
    const excelInfo = norm(ep.rawName) !== norm(cp.name)
      ? `${ep.rawName} [${ep.format}]`
      : ep.format ? `[${ep.format}]` : '';

    console.log(
      `  ${pad(String(i + 1), 4)} ${pad(cp.name, 50)} ${rpad(String(cp.stock), 10)} ${rpad(String(ep.stock), 10)} ${rpad(diffStr, 10)} ${pad(qualityStr, 16)} ${pad(excelInfo, 45)}`
    );
  }

  // Print unmatched from Excel
  if (unmatched.length > 0) {
    console.log(`\n${'='.repeat(100)}`);
    console.log(`  UNMATCHED EXCEL PRODUCTS (${unmatched.length} items not found in CRM)`);
    console.log(`${'='.repeat(100)}`);
    console.log(`  ${pad('#', 4)} ${pad('Excel Name', 48)} ${pad('Format', 20)} ${pad('Unit', 6)} ${rpad('Stock', 12)}`);
    console.log(`  ${'-'.repeat(4)} ${'-'.repeat(48)} ${'-'.repeat(20)} ${'-'.repeat(6)} ${'-'.repeat(12)}`);
    for (let i = 0; i < unmatched.length; i++) {
      const ep = unmatched[i].excelProduct;
      console.log(`  ${pad(String(i + 1), 4)} ${pad(ep.rawName, 48)} ${pad(ep.format, 20)} ${pad(ep.unit, 6)} ${rpad(String(ep.stock), 12)}`);
    }
  }

  // CRM products not in Excel
  const matchedCrmIds = new Set(matched.map(r => r.crmProduct!.id));
  const crmNotInExcel = crmProducts.filter(cp => !matchedCrmIds.has(cp.id));
  // Split into active and inactive
  const crmNotInExcelActive = crmNotInExcel.filter(c => c.is_active);
  const crmNotInExcelInactive = crmNotInExcel.filter(c => !c.is_active);

  if (crmNotInExcelActive.length > 0) {
    console.log(`\n${'='.repeat(110)}`);
    console.log(`  ACTIVE CRM PRODUCTS NOT IN EXCEL (${crmNotInExcelActive.length} items)`);
    console.log(`${'='.repeat(110)}`);
    console.log(`  ${pad('#', 4)} ${pad('CRM Name', 50)} ${pad('SKU', 28)} ${pad('Format', 18)} ${rpad('Stock', 10)}`);
    console.log(`  ${'-'.repeat(4)} ${'-'.repeat(50)} ${'-'.repeat(28)} ${'-'.repeat(18)} ${'-'.repeat(10)}`);
    for (let i = 0; i < crmNotInExcelActive.length; i++) {
      const cp = crmNotInExcelActive[i];
      console.log(`  ${pad(String(i + 1), 4)} ${pad(cp.name, 50)} ${pad(cp.sku, 28)} ${pad(cp.format ?? '', 18)} ${rpad(String(cp.stock), 10)}`);
    }
  }

  // Summary
  console.log(`\n${'='.repeat(70)}`);
  console.log(`  SUMMARY`);
  console.log(`${'='.repeat(70)}`);
  console.log(`  Excel raw rows:                ${rawExcel.length}`);
  console.log(`  Excel unique (deduplicated):   ${excelProducts.length}`);
  console.log(`  CRM total (active/inactive):   ${crmProducts.length} (${crmProducts.filter(c => c.is_active).length}/${crmProducts.filter(c => !c.is_active).length})`);
  console.log(`  ---`);
  console.log(`  Matched:                       ${matched.length}`);
  console.log(`    - SKU bridge:                ${matched.filter(r => r.quality === 'sku-bridge').length}`);
  console.log(`    - Exact name:                ${matched.filter(r => r.quality === 'exact').length}`);
  console.log(`    - Name+format:               ${matched.filter(r => r.quality === 'name+format').length}`);
  console.log(`    - Fuzzy:                     ${matched.filter(r => r.quality === 'fuzzy').length}`);
  console.log(`  Unmatched Excel products:      ${unmatched.length}`);
  console.log(`  Active CRM not in Excel:       ${crmNotInExcelActive.length}`);
  console.log(`  Inactive CRM not in Excel:     ${crmNotInExcelInactive.length}`);
  console.log(`  ---`);
  console.log(`  Stock changes (matched only):`);
  console.log(`    Increases:       ${positiveChanges}`);
  console.log(`    Decreases:       ${negativeChanges}`);
  console.log(`    No change:       ${noChanges}`);
  console.log(`    Total CRM stock: ${Math.round(totalCrmStock * 100) / 100}`);
  console.log(`    Total Excel:     ${Math.round(totalExcelStock * 100) / 100}`);
  console.log(`    Net diff:        ${totalDiff > 0 ? '+' : ''}${Math.round(totalDiff * 100) / 100}`);
  console.log(`\n  *** READ-ONLY analysis. No changes were made. ***\n`);
}

main()
  .catch((err) => { console.error('Error:', err); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
