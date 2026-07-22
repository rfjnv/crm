import { DealStatus } from '@prisma/client';

export type Lang = 'ru' | 'uz';

export const LANG_LABELS: Record<Lang, string> = {
  ru: '🇷🇺 Русский',
  uz: "🇺🇿 O'zbek tili",
};

const STRINGS: Record<Lang, Record<string, string>> = {
  ru: {
    'lang.prompt': 'Выберите язык общения с ботом:',
    'lang.saved': 'Язык сохранён: {lang}',

    'start.title': 'Polygraph Business Bot',
    'start.greeting.named': 'Здравствуйте, {name}. Через этого бота можно оформить заказ, выбрать менеджера и оставить отзыв.',
    'start.greeting.anon': 'Через этого бота можно оформить заказ, выбрать менеджера и оставить отзыв.',
    'start.hoursHeader': 'Заказы принимаются:',
    'start.hours.monFri': 'Пн-Пт: 09:00-18:00',
    'start.hours.sat': 'Сб: 10:00-18:00',
    'start.hours.sun': 'Вс: выходной',

    'menu.order': '🛒 Оформить заказ',
    'menu.orders': '📦 Мои заказы',
    'menu.review': '⭐ Оставить отзыв',
    'menu.hours': '🕒 Часы работы',
    'menu.home': '🏠 Главное меню',
    'menu.language': "🌐 Язык / Til",
    'menu.manager': '👤 Менеджер',
    'menu.cart': '🧺 Корзина ({count})',

    'hours.title': 'Часы работы',
    'hours.open': 'Сейчас мы принимаем заказы.',
    'hours.closed': 'Сейчас мы не принимаем заказы. {reason}',
    'hours.currentTime': 'Текущее время: {time}',
    'hours.reason.sunday': 'воскресенье — выходной',
    'hours.reason.saturday': 'по субботам заказы принимаются с 10:00 до 18:00',
    'hours.reason.weekday': 'заказы принимаются с 09:00 до 18:00',

    'manager.title': 'Выберите менеджера',
    'manager.subtitle': 'Заказ будет сразу закреплён за выбранным менеджером.',
    'manager.empty': 'Сейчас нет активных менеджеров для выбора. Попробуйте позже.',
    'manager.selected': 'Менеджер выбран. Теперь добавьте товары в заказ.',
    'manager.updated': 'Менеджер обновлён.',
    'manager.unavailable': 'Выбранный менеджер сейчас недоступен. Пожалуйста, выберите другого.',
    'manager.label': 'Менеджер: {name}',
    'manager.notSelected': 'Менеджер пока не выбран.',
    'manager.crmSuffix': ' (CRM)',
    'manager.changeButton': 'Сменить менеджера',

    'catalog.categoriesTitle': 'Выберите категорию',
    'catalog.empty': 'Каталог пока пуст. Загляните позже.',
    'catalog.categoryEmptied': 'В этой категории не осталось товаров.',
    'catalog.uncategorized': 'Без категории',
    'catalog.productsTitle': 'Категория: {category}',
    'catalog.inStock': 'В наличии',
    'catalog.chooseButtonHint': 'Выберите номер товара из кнопок ниже:',
    'catalog.backToCategories': '◀ К категориям',
    'catalog.photoButton': '🖼',
    'catalog.detail.price': 'Цена: {price}',
    'catalog.detail.stock': 'В наличии: {stock} {unit}',
    'catalog.detail.addToCart': '➕ В корзину',
    'catalog.detail.back': '◀ Назад к списку',
    'catalog.detail.notFound': 'Товар не найден или больше недоступен.',
    'catalog.detail.noDescription': 'Описание пока не добавлено.',

    'cart.title': 'Ваша корзина',
    'cart.empty': 'Корзина пуста.',
    'cart.itemLine': '{name} — {qty} {unit} × {price} = {total}',
    'cart.total': 'Итого: {total}',
    'cart.updated': 'Корзина обновлена.',
    'cart.cleared': 'Корзина очищена.',
    'cart.addMore': '➕ Добавить ещё',
    'cart.clearButton': '🗑 Очистить',
    'cart.checkoutButton': '✅ Оформить заказ',
    'cart.removeButton': '❌',
    'cart.itemRemoved': 'Товар удалён из корзины.',

    'qty.ask': 'Введите количество ({unit}) для товара «{name}». В наличии: {stock}.',
    'qty.invalid': 'Не понял количество. Введите число, например 5 или 2.5.',
    'qty.outOfStock': 'К сожалению, товара «{name}» больше нет в наличии в нужном количестве. Доступно: {stock}.',
    'qty.productUnavailable': 'Этот товар сейчас недоступен для заказа.',
    'qty.added': 'Добавлено в корзину: {name} — {qty} {unit}.',

    'checkout.needManager': 'Сначала выберите менеджера.',
    'checkout.askName': 'Как к вам обращаться? Отправьте, пожалуйста, имя.',
    'checkout.askPhone': 'Теперь отправьте номер телефона, чтобы менеджер мог связаться с вами.',
    'checkout.askPhoneReview': 'Отправьте номер телефона, чтобы менеджер мог с вами связаться.',
    'checkout.phoneSaved': 'Номер сохранён: {phone}',
    'checkout.phoneInvalid': 'Не понял номер. Отправьте его в формате +998901234567 или через кнопку "Отправить номер".',
    'checkout.phoneInvalidContact': 'Не удалось распознать номер телефона. Отправьте номер в формате +998901234567.',
    'checkout.missingData': 'Для оформления заказа не хватает данных. Проверьте корзину, менеджера и контакты.',
    'checkout.closed': 'Сейчас мы не принимаем заказы. {reason} Ваш заказ можно оформить, когда мы снова будем на связи.',
    'checkout.success.title': 'Заказ принят!',
    'checkout.success.manager': 'Менеджер: {name}',
    'checkout.success.status': 'Статус: {status}',
    'checkout.success.note': 'Мы уже передали заказ менеджеру. Он свяжется с вами в рабочее время.',
    'checkout.inProgress': 'Заказ уже отправляется, подождите немного.',

    'orders.title': 'Мои заказы',
    'orders.empty': 'По номеру {phone} пока нет заказов в CRM.',
    'orders.askPhone': 'Отправьте номер телефона, чтобы найти ваши заказы.',
    'orders.searching': 'Ищу ваши заказы по номеру {phone}.',
    'orders.line': '{date} • {count} тов. • {total}',
    'orders.reviewButton': '⭐ Оставить отзыв',

    'status.PROCESSING': '🆕 В обработке',
    'status.PREPARING': '📦 Готовится к отправке',
    'status.IN_DELIVERY': '🚚 В пути',
    'status.COMPLETED': '✅ Завершён',
    'status.CANCELED': '❌ Отменён',

    'review.askPhone': 'Отправьте номер телефона, чтобы найти заказ для отзыва.',
    'review.phoneInvalid': 'Для поиска заказов нужен корректный номер телефона: +998901234567.',
    'review.noOrders': 'Заказы не найдены',
    'review.noOrdersBody': 'По номеру {phone} пока нет заказов в CRM.',
    'review.pickTitle': 'Выберите заказ для отзыва',
    'review.pickSubtitle': 'Сохраним отзыв прямо в карточке сделки.',
    'review.notAllowed': 'Этот заказ недоступен для отзыва.',
    'review.askRating': 'Оцените заказ от 1 до 5:',
    'review.askText': 'Расскажите подробнее о вашем опыте (или отправьте "-", чтобы пропустить).',
    'review.saveFailed': 'Не удалось сохранить отзыв в CRM. Попробуйте позже или обратитесь к менеджеру.',
    'review.thanks': 'Спасибо. Отзыв сохранён и передан менеджеру.',

    'common.back': 'Назад в меню',
    'common.cancelHint': 'Действие можно отменить, написав "отмена".',
    'common.cancelled': 'Текущее действие отменено.',
    'common.fallback': 'Используйте меню ниже, чтобы оформить заказ или оставить отзыв.',
    'common.sendPhoneButton': '📱 Отправить номер',
    'common.cancelButton': 'Отмена',
  },
  uz: {
    'lang.prompt': "Bot bilan muloqot tilini tanlang:",
    'lang.saved': 'Til saqlandi: {lang}',

    'start.title': 'Polygraph Business Bot',
    'start.greeting.named': "Assalomu alaykum, {name}. Ushbu bot orqali buyurtma berishingiz, menejer tanlashingiz va fikr qoldirishingiz mumkin.",
    'start.greeting.anon': 'Ushbu bot orqali buyurtma berishingiz, menejer tanlashingiz va fikr qoldirishingiz mumkin.',
    'start.hoursHeader': 'Buyurtmalar qabul qilinadi:',
    'start.hours.monFri': 'Dush-Juma: 09:00-18:00',
    'start.hours.sat': 'Shanba: 10:00-18:00',
    'start.hours.sun': 'Yakshanba: dam olish kuni',

    'menu.order': "🛒 Buyurtma berish",
    'menu.orders': '📦 Buyurtmalarim',
    'menu.review': '⭐ Fikr qoldirish',
    'menu.hours': '🕒 Ish vaqti',
    'menu.home': '🏠 Bosh menyu',
    'menu.language': '🌐 Til / Язык',
    'menu.manager': '👤 Menejer',
    'menu.cart': '🧺 Savat ({count})',

    'hours.title': 'Ish vaqti',
    'hours.open': "Hozir buyurtmalarni qabul qilyapmiz.",
    'hours.closed': "Hozir buyurtmalar qabul qilinmayapti. {reason}",
    'hours.currentTime': 'Hozirgi vaqt: {time}',
    'hours.reason.sunday': 'yakshanba — dam olish kuni',
    'hours.reason.saturday': "shanba kunlari buyurtmalar 10:00 dan 18:00 gacha qabul qilinadi",
    'hours.reason.weekday': "buyurtmalar 09:00 dan 18:00 gacha qabul qilinadi",

    'manager.title': 'Menejerni tanlang',
    'manager.subtitle': "Buyurtma darhol tanlangan menejerga biriktiriladi.",
    'manager.empty': "Hozircha faol menejerlar yo'q. Birozdan so'ng urinib ko'ring.",
    'manager.selected': 'Menejer tanlandi. Endi savatga mahsulot qo\'shing.',
    'manager.updated': 'Menejer yangilandi.',
    'manager.unavailable': "Tanlangan menejer hozircha band. Iltimos, boshqasini tanlang.",
    'manager.label': 'Menejer: {name}',
    'manager.notSelected': "Menejer hali tanlanmagan.",
    'manager.crmSuffix': ' (CRM)',
    'manager.changeButton': "Menejerni almashtirish",

    'catalog.categoriesTitle': 'Kategoriyani tanlang',
    'catalog.empty': "Katalog hozircha bo'sh. Keyinroq qayting.",
    'catalog.categoryEmptied': "Bu kategoriyada mahsulot qolmadi.",
    'catalog.uncategorized': 'Kategoriyasiz',
    'catalog.productsTitle': 'Kategoriya: {category}',
    'catalog.inStock': 'Mavjud',
    'catalog.chooseButtonHint': 'Quyidagi tugmalardan mahsulot raqamini tanlang:',
    'catalog.priceLine': '{name} — {price}',
    'catalog.backToCategories': '◀ Kategoriyalarga',
    'catalog.photoButton': '🖼',
    'catalog.detail.price': 'Narxi: {price}',
    'catalog.detail.stock': 'Mavjud: {stock} {unit}',
    'catalog.detail.addToCart': '➕ Savatga',
    'catalog.detail.back': "◀ Ro'yxatga qaytish",
    'catalog.detail.notFound': "Mahsulot topilmadi yoki endi mavjud emas.",
    'catalog.detail.noDescription': "Tavsif hali qo'shilmagan.",

    'cart.title': 'Savatingiz',
    'cart.empty': "Savat bo'sh.",
    'cart.itemLine': '{name} — {qty} {unit} × {price} = {total}',
    'cart.total': 'Jami: {total}',
    'cart.updated': 'Savat yangilandi.',
    'cart.cleared': 'Savat tozalandi.',
    'cart.addMore': "➕ Yana qo'shish",
    'cart.clearButton': '🗑 Tozalash',
    'cart.checkoutButton': '✅ Buyurtma berish',
    'cart.removeButton': '❌',
    'cart.itemRemoved': "Mahsulot savatdan o'chirildi.",

    'qty.ask': "«{name}» mahsuloti uchun miqdorni ({unit}) kiriting. Mavjud: {stock}.",
    'qty.invalid': "Miqdor tushunarsiz. Raqam kiriting, masalan 5 yoki 2.5.",
    'qty.outOfStock': "Afsuski, «{name}» mahsuloti kerakli miqdorda mavjud emas. Mavjud: {stock}.",
    'qty.productUnavailable': "Bu mahsulot hozircha buyurtma uchun mavjud emas.",
    'qty.added': "Savatga qo'shildi: {name} — {qty} {unit}.",

    'checkout.needManager': 'Avval menejerni tanlang.',
    'checkout.askName': "Sizga qanday murojaat qilsak bo'ladi? Ismingizni yuboring.",
    'checkout.askPhone': "Endi telefon raqamingizni yuboring, menejer siz bilan bog'lanishi uchun.",
    'checkout.askPhoneReview': "Telefon raqamingizni yuboring, menejer siz bilan bog'lanishi uchun.",
    'checkout.phoneSaved': 'Raqam saqlandi: {phone}',
    'checkout.phoneInvalid': 'Raqam tushunarsiz. +998901234567 formatida yuboring yoki "Raqamni yuborish" tugmasidan foydalaning.',
    'checkout.phoneInvalidContact': "Telefon raqami aniqlanmadi. +998901234567 formatida yuboring.",
    'checkout.missingData': "Buyurtma berish uchun ma'lumot yetarli emas. Savat, menejer va kontaktlarni tekshiring.",
    'checkout.closed': "Hozir buyurtmalar qabul qilinmayapti. {reason} Biz yana aloqada bo'lganimizda buyurtma bera olasiz.",
    'checkout.success.title': 'Buyurtma qabul qilindi!',
    'checkout.success.manager': 'Menejer: {name}',
    'checkout.success.status': 'Holat: {status}',
    'checkout.success.note': "Buyurtmani menejerga uzatdik. U ish vaqtida siz bilan bog'lanadi.",
    'checkout.inProgress': "Buyurtma allaqachon yuborilmoqda, biroz kuting.",

    'orders.title': 'Buyurtmalarim',
    'orders.empty': "{phone} raqami bo'yicha CRM'da hali buyurtmalar yo'q.",
    'orders.askPhone': 'Buyurtmalaringizni topish uchun telefon raqamingizni yuboring.',
    'orders.searching': '{phone} raqami bo\'yicha buyurtmalaringizni qidiryapman.',
    'orders.line': '{date} • {count} mahsulot • {total}',
    'orders.reviewButton': '⭐ Fikr qoldirish',

    'status.PROCESSING': "🆕 Qabul qilindi",
    'status.PREPARING': "📦 Jo'natishga tayyorlanmoqda",
    'status.IN_DELIVERY': "🚚 Yo'lda",
    'status.COMPLETED': '✅ Yakunlandi',
    'status.CANCELED': '❌ Bekor qilindi',

    'review.askPhone': 'Fikr qoldirish uchun buyurtmani topishga telefon raqamingizni yuboring.',
    'review.phoneInvalid': "Buyurtmalarni qidirish uchun to'g'ri telefon raqami kerak: +998901234567.",
    'review.noOrders': 'Buyurtmalar topilmadi',
    'review.noOrdersBody': "{phone} raqami bo'yicha CRM'da hali buyurtmalar yo'q.",
    'review.pickTitle': 'Fikr qoldirish uchun buyurtmani tanlang',
    'review.pickSubtitle': "Fikringizni bitim kartochkasiga saqlaymiz.",
    'review.notAllowed': 'Bu buyurtma uchun fikr qoldirib bo\'lmaydi.',
    'review.askRating': "Buyurtmani 1 dan 5 gacha baholang:",
    'review.askText': 'Tajribangiz haqida batafsil yozing (yoki o\'tkazib yuborish uchun "-" yuboring).',
    'review.saveFailed': "Fikrni CRM'ga saqlab bo'lmadi. Birozdan so'ng urinib ko'ring yoki menejerga murojaat qiling.",
    'review.thanks': "Rahmat. Fikringiz saqlandi va menejerga yuborildi.",

    'common.back': 'Bosh menyuga',
    'common.cancelHint': '"bekor qilish" deb yozib amalni bekor qilishingiz mumkin.',
    'common.cancelled': 'Joriy amal bekor qilindi.',
    'common.fallback': "Buyurtma berish yoki fikr qoldirish uchun quyidagi menyudan foydalaning.",
    'common.sendPhoneButton': '📱 Raqamni yuborish',
    'common.cancelButton': 'Bekor qilish',
  },
};

export function t(lang: Lang, key: string, params?: Record<string, string | number>): string {
  const dict = STRINGS[lang] ?? STRINGS.ru;
  let template = dict[key];
  if (template === undefined) {
    if (process.env.NODE_ENV !== 'production') {
      throw new Error(`Missing translation for key "${key}" (lang=${lang})`);
    }
    template = STRINGS.ru[key] ?? key;
  }
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}

export type CustomerStatusGroup = 'PROCESSING' | 'PREPARING' | 'IN_DELIVERY' | 'COMPLETED' | 'CANCELED';

const STATUS_GROUP_MAP: Record<DealStatus, CustomerStatusGroup> = {
  NEW: 'PROCESSING',
  IN_PROGRESS: 'PROCESSING',
  WAITING_STOCK_CONFIRMATION: 'PROCESSING',
  STOCK_CONFIRMED: 'PROCESSING',
  WAITING_FINANCE: 'PROCESSING',
  FINANCE_APPROVED: 'PROCESSING',
  ADMIN_APPROVED: 'PROCESSING',
  PENDING_APPROVAL: 'PROCESSING',
  WAITING_WAREHOUSE_MANAGER: 'PROCESSING',
  PENDING_ADMIN: 'PROCESSING',
  REOPENED: 'PROCESSING',
  READY_FOR_SHIPMENT: 'PREPARING',
  SHIPMENT_ON_HOLD: 'PREPARING',
  READY_FOR_LOADING: 'PREPARING',
  LOADING_ASSIGNED: 'PREPARING',
  READY_FOR_DELIVERY: 'PREPARING',
  IN_DELIVERY: 'IN_DELIVERY',
  SHIPPED: 'COMPLETED',
  CLOSED: 'COMPLETED',
  CANCELED: 'CANCELED',
  REJECTED: 'CANCELED',
};

export function toCustomerStatusGroup(status: DealStatus): CustomerStatusGroup {
  return STATUS_GROUP_MAP[status] ?? 'PROCESSING';
}

export function customerStatusLabel(lang: Lang, status: DealStatus): string {
  return t(lang, `status.${toCustomerStatusGroup(status)}`);
}
