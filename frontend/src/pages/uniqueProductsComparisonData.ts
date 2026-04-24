export type Competitor = 'Yann' | 'Bit Trade' | 'Avanta Trade' | 'Foil Trading';

export type TheirOnlyRow = {
  key: string;
  competitor: Competitor;
  category: string;
  name: string;
  price: number | null;
};

export type OurOnlyRow = {
  key: string;
  category: string;
  name: string;
  price: string;
  note?: string;
};

const THEIR_ONLY_RAW: Array<Omit<TheirOnlyRow, 'key'>> = [
  { competitor: 'Yann', category: 'Бумага и картон', name: 'Мелованная бумага HiKote C2S Art Paper (глянцевая), 90 г, 62×88', price: 776 },
  { competitor: 'Yann', category: 'Бумага и картон', name: 'Мелованная бумага HiKote C2S Art Paper (глянцевая), 150 г, 70×100', price: 1628 },
  { competitor: 'Yann', category: 'Офсетные краски и лаки', name: 'RAPIDPLATINUM краска CMYK, 2,5 кг', price: 91000 },
  { competitor: 'Yann', category: 'Пантонные краски', name: 'PANTONE Reflex blue', price: 170000 },
  { competitor: 'Yann', category: 'Офсетная резина и картон', name: 'Офсетная резина 4-слойная 1052×840×1,95 мм (9600A)', price: 1450000 },
  { competitor: 'Yann', category: 'Пленки для ламинации', name: 'Softtouch 28 мкрн, 2000 м, 35 см', price: 190000 },
  { competitor: 'Bit Trade', category: 'Офсетные краски', name: 'Dong Yang Ink ZEUS PROCESS CMYK', price: 95000 },
  { competitor: 'Bit Trade', category: 'Пантонные краски', name: 'COMAX P.T RHODAMINE RED', price: 250000 },
  { competitor: 'Bit Trade', category: 'Ролевые краски', name: 'Huber INTENSIVE NEWS BLACK', price: 46000 },
  { competitor: 'Bit Trade', category: 'Препресс химия', name: 'Chembyo CTP Dev PRIMA GOLD, 20 л', price: 32000 },
  { competitor: 'Bit Trade', category: 'УФ лаки', name: 'ATLAS RX GLOSS 50', price: 77000 },
  { competitor: 'Bit Trade', category: 'Офсетное полотно', name: 'OF. BLANKET ADVANTAGE PLUS 1060×1,95 мм', price: 1621000 },
  { competitor: 'Avanta Trade', category: 'Фольга', name: 'avaFOIL Золотая 68 см × 120 м', price: 160000 },
  { competitor: 'Avanta Trade', category: 'Пленки для ламинации', name: 'Серебро металлизированная 3000 м (50/62/70 см)', price: 73000 },
  { competitor: 'Avanta Trade', category: 'Офсетная краска', name: 'GLOBY CMYK (Китай), 2,5 кг', price: 88000 },
  { competitor: 'Avanta Trade', category: 'Переплетные материалы', name: 'Металлическая пружина 3/16" (4,7), шаг 3:1', price: null },
  { competitor: 'Foil Trading', category: 'Фольга', name: 'Горячего тиснения Золотистая (на пластик), 64 см × 120 м', price: 160000 },
  { competitor: 'Foil Trading', category: 'Холодная фольга', name: 'Холодного тиснения Gold/Silver 128 см × 6000 м', price: 19500000 },
  { competitor: 'Foil Trading', category: 'Офсетные пластины', name: 'Термальные (CTP) и Аналоговые (PS) 775×605', price: null },
  { competitor: 'Foil Trading', category: 'Химия', name: 'MARK Ротоваш/смывка, 20 л', price: 50000 },
];

const OUR_ONLY_RAW: Array<Omit<OurOnlyRow, 'key'>> = [
  { category: 'Самоклеящаяся бумага', name: 'FASSON (акрил), полуглянец, рулон 1 м', price: '4 500 за п/м²', note: 'Рулонная, нет у конкурентов' },
  { category: 'Самоклеящаяся бумага', name: 'LIANG DU (хот мелт), полуглянец, рулон 1 м', price: '4 300 за п/м²', note: 'Рулонная, нет у конкурентов' },
  { category: 'Мелованная бумага', name: 'ИНДИЯ 70×100, 250 г/м²', price: '2 720 за лист', note: 'Индийское производство' },
  { category: 'Мелованная бумага', name: 'КИТАЙ NINGBO FOLD 62×94, 300 г/м²', price: '2 540 за лист', note: 'Складной картон' },
  { category: 'Фольга для горячего тиснения', name: 'ЗОЛОТАЯ (спина жёлтая), 64×120 м', price: '150 000 за рулон', note: 'Специфический вариант, нет у конкурентов' },
  { category: 'Химия', name: 'Добавка для ролевой печати for high speed (TEKNOVA), 1 л', price: '50 000', note: 'Специфика ролевой печати' },
  { category: 'Химия', name: 'Проявитель для термальных пластин (порошок)', price: '40 000 за пачку', note: 'Порошковый вариант' },
  { category: 'Термоклей', name: 'Термоклей ELEPHANT (Китай), 20 кг', price: '60 000 за кг', note: 'Марка ELEPHANT' },
  { category: 'UV лак LANER', name: 'LANER PI-50 (для флексографии), глянц, 25 кг', price: '125 000 за кг', note: 'Флексография' },
  { category: 'Офсетные краски BRANCHER', name: 'POWER-BRANCHER CMYK, 2,5 кг', price: '86 000 за кг', note: 'Марка POWER-BRANCHER' },
  { category: 'Пантонные краски BRANCHER', name: 'YELLOW, за кг', price: '140 000 за кг', note: 'Нет аналога у конкурентов' },
  { category: 'Гребенки и расходники', name: 'Курсоры, 100 шт.', price: '1 700 за шт.', note: 'Нет у конкурентов' },
  { category: 'Вспомогательные материалы', name: 'Биговальный канал (разные размеры), 50 шт.', price: '400 000 за пачку', note: 'Нет у конкурентов в прайсе' },
  { category: 'Офсетные пластины CTP и PS', name: '1280×1060', price: 'договорная', note: 'Нет у конкурентов' },
];

export const THEIR_ONLY_ROWS: TheirOnlyRow[] = THEIR_ONLY_RAW.map((row, index) => ({
  key: `t-${index + 1}`,
  ...row,
}));

export const OUR_ONLY_ROWS: OurOnlyRow[] = OUR_ONLY_RAW.map((row, index) => ({
  key: `o-${index + 1}`,
  ...row,
}));

