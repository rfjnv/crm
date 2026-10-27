/**
 * Дополнения к date-holidays для календаря ВЭД:
 *  - русские названия праздников (библиотека по-русски знает лишь часть и отдаёт
 *    остальное на местном языке — китайском, фарси, грузинском);
 *  - праздники Казахстана, Кыргызстана и Туркменистана — их в библиотеке нет вовсе.
 *    Постоянные даты — из трудовых календарей стран; Курбан/Орозо айт берём по расчёту
 *    для Турции (тот же лунный календарь). Если поставщики фактически отдыхают иначе —
 *    правится здесь.
 */

/** Английское название из date-holidays → русское. Ключ — «КОД|название» или «*|название». */
const RU_NAMES: Record<string, string> = {
  "*|New Year's Day": 'Новый год',
  "*|International Women's Day": 'Международный женский день',
  '*|Victory Day': 'День Победы',
  '*|End of Ramadan (Eid al-Fitr)': 'Рамазан-байрам',
  '*|Feast of the Sacrifice (Eid al-Adha)': 'Курбан-байрам',
  '*|Independence Day': 'День независимости',
  // Китай
  'CN|Army Day': 'День армии',
  "CN|Children's Day": 'День защиты детей',
  'CN|Dragon Boat Festival': 'Праздник драконьих лодок',
  'CN|Labour Day': 'День труда',
  'CN|Mid-Autumn Festival': 'Праздник середины осени',
  'CN|National Day': 'День образования КНР',
  'CN|Qingming Festival': 'Цинмин',
  'CN|Spring Festival': 'Китайский Новый год',
  'CN|Youth Day': 'День молодёжи',
  // Грузия
  'GE|Bedoba': 'Бедоба',
  'GE|Easter Monday': 'Пасхальный понедельник',
  'GE|Easter Saturday': 'Великая суббота',
  'GE|Easter Sunday': 'Пасха',
  'GE|Good Friday': 'Страстная пятница',
  "GE|Mother's Day": 'День матери',
  'GE|National Unity Day': 'День национального единства',
  'GE|Orthodox Christmas': 'Рождество Христово',
  'GE|Orthodox Epiphany': 'Крещение',
  'GE|Saint Andrew the First-Called Day': 'День Андрея Первозванного',
  "GE|Saint George's Day": 'Гиоргоба (День Святого Георгия)',
  "GE|Saint Mary's Day": 'Мариамоба (Успение Богородицы)',
  'GE|Svetitskhovloba': 'Светицховлоба',
  // Иран
  'IR|Anniversary of Islamic Revolution': 'Годовщина Исламской революции',
  'IR|Arbaeen-e Hosseini': 'Арбаин',
  'IR|Ashoura': 'Ашура',
  'IR|Birthday of Imam Ali': 'Рождение имама Али',
  'IR|Birthday of Imam Mahdi': 'Рождение имама Махди',
  'IR|Birthday of Muhammad Prophet': 'Рождение пророка Мухаммада',
  'IR|Demise of Prophet Muhammad and Imam Hassan (Mujtaba)': 'Кончина пророка Мухаммада и имама Хасана',
  'IR|Eid al-Ghadeer': 'Гадир-Хум',
  'IR|Holyday for Fetr Eeid': 'Рамазан-байрам (второй день)',
  "IR|Imam Khomeini's Demise": 'Годовщина смерти имама Хомейни',
  'IR|Islamic Republic Day': 'День Исламской Республики',
  'IR|Mabaas of Muhammad': 'Мабас',
  'IR|Martyrdom of Fatima-Zahara': 'Мученичество Фатимы-Захры',
  'IR|Martyrdom of Imam Ali': 'Мученичество имама Али',
  'IR|Martyrdom of Imam Hassan': 'Мученичество имама Хасана',
  'IR|Martyrdom of Imam Jafar': 'Мученичество имама Джафара',
  'IR|Martyrdom of Imam Reza': 'Мученичество имама Резы',
  'IR|Nationalization of the Iranian oil industry': 'День национализации нефти',
  'IR|Nowruz': 'Навруз',
  'IR|Revolt of Khordad 15': 'Восстание 15 хордада',
  'IR|Sizdah Bedar': 'Сизде-бедар',
  'IR|Tasoua': 'Тасуа',
  // Россия
  'RU|Christmas Day': 'Рождество Христово',
  'RU|Defender of the Fatherland Day': 'День защитника Отечества',
  'RU|New Year Holiday': 'Новогодние каникулы',
  'RU|Russia Day': 'День России',
  'RU|Spring and Labour Day': 'Праздник Весны и Труда',
  'RU|Unity Day': 'День народного единства',
  // Турция
  'TR|Commemoration of Atatürk, Youth and Sports Day': 'День памяти Ататюрка, молодёжи и спорта',
  'TR|Democracy and National Unity Day': 'День демократии и национального единства',
  'TR|Labour and Solidarity Day': 'День труда и солидарности',
  "TR|National Sovereignty and Children's Day": 'День национального суверенитета и детей',
  'TR|Republic Day': 'День Республики',
  'TR|Victory Day': 'День Победы (30 августа)',
};

export function russianHolidayName(countryCode: string, name: string): string {
  return RU_NAMES[`${countryCode}|${name}`] ?? RU_NAMES[`*|${name}`] ?? name;
}

type FixedHoliday = { month: number; day: number; days?: number; name: string };
type LunarHoliday = { kind: 'fitr' | 'adha'; name: string };

export interface CustomCountryCalendar {
  fixed: FixedHoliday[];
  lunar: LunarHoliday[];
}

/** Страны, которых нет в date-holidays */
export const CUSTOM_CALENDARS: Record<string, CustomCountryCalendar> = {
  KZ: {
    fixed: [
      { month: 1, day: 1, days: 2, name: 'Новый год' },
      { month: 1, day: 7, name: 'Рождество Христово' },
      { month: 3, day: 8, name: 'Международный женский день' },
      { month: 3, day: 21, days: 3, name: 'Наурыз мейрамы' },
      { month: 5, day: 1, name: 'День единства народа Казахстана' },
      { month: 5, day: 7, name: 'День защитника Отечества' },
      { month: 5, day: 9, name: 'День Победы' },
      { month: 7, day: 6, name: 'День столицы' },
      { month: 8, day: 30, name: 'День Конституции' },
      { month: 10, day: 25, name: 'День Республики' },
      { month: 12, day: 16, name: 'День Независимости' },
    ],
    lunar: [{ kind: 'adha', name: 'Курбан айт' }],
  },
  KG: {
    fixed: [
      { month: 1, day: 1, name: 'Новый год' },
      { month: 1, day: 7, name: 'Рождество Христово' },
      { month: 2, day: 23, name: 'День защитника Отечества' },
      { month: 3, day: 8, name: 'Международный женский день' },
      { month: 3, day: 21, name: 'Нооруз' },
      { month: 4, day: 7, name: 'День народной Апрельской революции' },
      { month: 5, day: 1, name: 'Праздник труда' },
      { month: 5, day: 5, name: 'День Конституции' },
      { month: 5, day: 9, name: 'День Победы' },
      { month: 8, day: 31, days: 2, name: 'День независимости' },
      { month: 11, day: 7, days: 2, name: 'Дни истории и памяти предков' },
    ],
    lunar: [
      { kind: 'fitr', name: 'Орозо айт' },
      { kind: 'adha', name: 'Курман айт' },
    ],
  },
  TM: {
    fixed: [
      { month: 1, day: 1, name: 'Новый год' },
      { month: 3, day: 8, name: 'Международный женский день' },
      { month: 3, day: 21, days: 2, name: 'Новруз байрамы' },
      { month: 5, day: 9, name: 'День Победы' },
      { month: 5, day: 18, name: 'День Конституции и Государственного флага' },
      { month: 9, day: 27, name: 'День независимости' },
      { month: 10, day: 6, name: 'День памяти' },
      { month: 12, day: 12, name: 'День нейтралитета' },
    ],
    lunar: [
      { kind: 'fitr', name: 'Ораза байрам' },
      { kind: 'adha', name: 'Курбан байрам' },
    ],
  },
};

export const LUNAR_SOURCE_NAMES: Record<LunarHoliday['kind'], string> = {
  fitr: 'End of Ramadan (Eid al-Fitr)',
  adha: 'Feast of the Sacrifice (Eid al-Adha)',
};
