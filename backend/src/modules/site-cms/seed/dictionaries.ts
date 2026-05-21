export type SiteLocale = 'ru' | 'uz' | 'en';

export type Dictionary = {
  meta: { title: string; description: string }
  nav: {
    home: string
    about: string
    services: string
    products: string
    blog: string
    contact: string
    cta: string
  }
  hero: {
    badge: string
    title: string[]
    subtitle: string
    primaryCta: string
    secondaryCta: string
    highlights: [string, string][]
  }
  about: {
    label: string
    title: string
    description: string
    learnMore: string
    values: { title: string; items: string[] }
  }
  stats: {
    label: string
    title: string
    metrics: { value: string; label: string }[]
  }
  services: {
    label: string
    title: string
    description: string
    viewAll: string
    enquire: string
    items: { name: string; description: string }[]
  }
  products: {
    label: string
    title: string
    description: string
    viewAll: string
    items: { category: string; name: string }[]
  }
  blog: {
    label: string
    title: string
    description: string
    viewAll: string
    readMore: string
    posts: { category: string; date: string; title: string; excerpt: string }[]
  }
  contact: {
    label: string
    title: string
    description: string
    phone: string
    email: string
    address: string
    support: string
  }
  form: {
    title: string
    description: string
    fields: {
      name: string
      company: string
      phone: string
      email: string
      requestType: string
      quantity: string
      details: string
    }
    placeholders: {
      name: string
      company: string
      phone: string
      email: string
      quantity: string
      details: string
    }
    options: string[]
    submit: string
    success: string
    missingConfig: string
    validation: string
    consent: string
    channelsTitle: string
    channelsDescription: string
    tgPending: string
    emailPending: string
  }
  footer: {
    text: string
    companyLabel: string
    companyItems: string[]
    navLabel: string
    contactLabel: string
  }
  trust: {
    label: string
    title: string
    description: string
    points: string[]
    fitFor: string[]
    fitForLabel: string
    fitForNote: string
    partnerGroups: { title: string; items: string[] }[]
    processLabel: string
    processSteps: string[]
  }
  ctaSection: {
    label: string
    title: string
    description: string
    phone: string
    email: string
  }
}

const ru: Dictionary = {
  meta: {
    title: 'Polygraph Business — Материалы и расходники для полиграфии',
    description:
      'Polygraph Business поставляет материалы, ламинацию, фольгу, краски, химию и расходные материалы для типографий и печатных производств в Ташкенте и по рынку Узбекистана.',
  },
  nav: {
    home: 'Главная',
    about: 'О компании',
    services: 'Каталог',
    products: 'Продукция',
    blog: 'Блог',
    contact: 'Контакты',
    cta: 'Связаться',
  },
  hero: {
    badge: 'Самоклейка, бумага, пленки и расходники для типографий',
    title: ['Материалы для печати', 'упаковки', 'и этикетки'],
    subtitle:
      'Поставляем самоклеящиеся материалы, бумагу, картон, ламинацию, фольгу, краски и химию для B2B-производств в Узбекистане.',
    primaryCta: 'Связаться с нами',
    secondaryCta: 'Смотреть каталог',
    highlights: [
      ['Самоклейка', 'Материалы для этикетки, стикеров и упаковки.'],
      ['Бумага и картон', 'Листовые и рулонные позиции под печать.'],
      ['Отделка', 'Пленки, фольга, краски, химия и расходники.'],
    ],
  },
  about: {
    label: 'О компании',
    title: 'Специализированный поставщик для полиграфии с 2006 года',
    description:
      'Polygraph Business — профильный B2B-поставщик материалов и расходников для полиграфии, упаковки и смежных производств в Узбекистане. Работаем с типографиями, производствами упаковки, компаниями по печати этикетки и стикеров.',
    learnMore: 'Подробнее о компании',
    values: {
      title: 'Ключевые принципы',
      items: ['Профиль', 'Надёжность', 'Оперативность', 'Честность'],
    },
  },
  stats: {
    label: 'В цифрах',
    title: 'Компания в цифрах',
    metrics: [
      { value: '2006', label: 'работаем на рынке с 2006 года' },
      { value: '10+', label: 'ключевых товарных направлений в ассортименте' },
      { value: 'B2B', label: 'фокус на типографии, упаковку и производственные компании' },
      { value: 'UZ', label: 'работаем из Ташкента по рынку Узбекистана' },
    ],
  },
  services: {
    label: 'Каталог',
    title: 'Основные категории продукции',
    description:
      'Ниже показаны ключевые товарные направления, по которым можно быстро понять профиль компании и структуру поставок.',
    viewAll: 'Смотреть весь каталог',
    enquire: 'Запросить',
    items: [
      {
        name: 'Самоклеящаяся бумага',
        description: 'Листовая (Китай, Турция) и рулонная (FASSON, LIANG DU). Глянц и полуглянц, форматы 50×35, 50×70, 70×100.',
      },
      {
        name: 'Мелованная бумага HI-KOTE',
        description: 'Глянцевая 170 и 250 гр/м² и матовая 105 гр/м², формат 70×100. В пачках по 125–250 листов.',
      },
      {
        name: 'Целлюлозный картон',
        description: 'Листовой и в рулонах. ИНДИЯ и КИТАЙ NINGBO FOLD, форматы 62×94 и 70×100, плотность 250–300 гр/м².',
      },
      {
        name: 'Ламинационные пленки',
        description: 'Глянцевая и матовая (17 мкрн, 3000 м), soft touch (27 мкрн), голографик (21 мкрн), металлизированные золото и серебро.',
      },
      {
        name: 'Фольга для горячего тиснения',
        description: 'Золото, серебро, цветная (зелёная, красная, синяя, фиолетовая, чёрная, белая) и голограмма. Ширина 64 см, длина 120–360 м.',
      },
      {
        name: 'Офсетные и пантонные краски',
        description: 'POWER-BRANCHER, FOCUS-BRANCHER, INNAVTION CF (CMYK). Пантонные краски BRANCHER: широкая палитра цветов.',
      },
      {
        name: 'Офсетная резина',
        description: 'Высококачественная офсетная резина в рулонах (780–1450 мм) и с планками (520×440 – 1060×860 мм).',
      },
      {
        name: 'Полиграфическая химия TEKNOVA',
        description: 'Смывки для валов, добавки к увлажнению, очистители для пластин, проявители, UV-лак LANER и офсетный лак.',
      },
      {
        name: 'Расходники и вспомогательные материалы',
        description: 'Биговальный канал, марзан, термоклей, офсетные пластины CTP и PS, металлические гребенки для календарей, калиброванный картон.',
      },
    ],
  },
  products: {
    label: 'Продукция',
    title: 'Качественные материалы для каждого производства',
    description: 'Широкий ассортимент материалов и расходников для полиграфии, упаковки и печати этикетки.',
    viewAll: 'Смотреть все позиции',
    items: [
      { category: 'Самоклейка', name: 'Самоклеящаяся бумага глянц (Китай) 50×70' },
      { category: 'Самоклейка', name: 'FASSON самоклейка в рулонах' },
      { category: 'Бумага', name: 'Мелованная бумага HI-KOTE глянц 170 гр/м²' },
      { category: 'Бумага', name: 'Мелованная бумага HI-KOTE матт 105 гр/м²' },
      { category: 'Картон', name: 'Целлюлозный картон NINGBO FOLD 270 гр/м²' },
      { category: 'Фольга', name: 'Фольга для тиснения золото/серебро 64×120 м' },
      { category: 'Ламинация', name: 'Ламинационная пленка глянцевая 17 мкрн' },
      { category: 'Ламинация', name: 'Ламинационная пленка матовая 17 мкрн' },
      { category: 'Ламинация', name: 'Ламинационная пленка soft touch 27 мкрн' },
      { category: 'Краски', name: 'Офсетные краски POWER-BRANCHER CMYK' },
      { category: 'Резина', name: 'Офсетная резина с планкой' },
      { category: 'Химия', name: 'Полиграфическая химия TEKNOVA' },
    ],
  },
  blog: {
    label: 'Блог',
    title: 'Новости и материалы Polygraph Business',
    description: 'Актуальная информация о новых позициях, трендах полиграфического рынка и специфике материалов.',
    viewAll: 'Смотреть все статьи',
    readMore: 'Читать далее',
    posts: [
      {
        category: 'Ассортимент',
        date: '5 декабря 2024',
        title: 'Новые позиции самоклеящихся материалов в ассортименте',
        excerpt:
          'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.',
      },
      {
        category: 'Ламинация',
        date: '18 ноября 2024',
        title: 'Как выбрать правильное ламинационное покрытие для упаковки',
        excerpt:
          'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris.',
      },
      {
        category: 'Полиграфия',
        date: '3 октября 2024',
        title: 'Офсетная химия: особенности применения в разных условиях',
        excerpt:
          'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum.',
      },
    ],
  },
  contact: {
    label: 'Контакты',
    title: 'Свяжитесь с нами',
    description:
      'Оставьте заявку или свяжитесь напрямую удобным способом. Поможем подобрать материалы под задачи вашего производства.',
    phone: '+998 90 947 33 55',
    email: 'pbtrade.tashkent@gmail.com',
    address: 'Узбекистан, Ташкент, Мирабад, Савр 5',
    support: 'Оперативный ответ на запросы',
  },
  form: {
    title: 'Оставьте заявку на подбор материалов',
    description:
      'Напишите, что вам нужно, и мы подберем подходящие позиции, сориентируем по цене, наличию и срокам поставки.',
    fields: {
      name: 'Имя',
      company: 'Компания',
      phone: 'Телефон',
      email: 'Email',
      requestType: 'Что нужно',
      quantity: 'Объем / количество',
      details: 'Что требуется',
    },
    placeholders: {
      name: 'Как к вам обращаться',
      company: 'Название компании',
      phone: '+998 90 947 33 55',
      email: 'pbtrade.tashkent@gmail.com',
      quantity: 'Например: 20 листов / 5 рулонов / 10 кг',
      details: 'Опишите нужные материалы, объем, формат, плотность, сроки и любые дополнительные пожелания.',
    },
    options: ['Бумага и картон', 'Ламинация и фольга', 'Краски и химия', 'Нужен полный прайс / консультация'],
    submit: 'Отправить заявку',
    success: 'Заявка отправлена! Мы свяжемся с вами в ближайшее время.',
    missingConfig: 'Не удалось отправить заявку. Пожалуйста, свяжитесь с нами напрямую по телефону или Telegram.',
    validation: 'Заполните имя, телефон или email, и кратко опишите, что вам нужно.',
    consent: 'Нажимая кнопку, вы отправляете заявку на подбор продукции и консультацию.',
    channelsTitle: 'Каналы отправки',
    channelsDescription:
      'Форма уже подготовлена под реальную отправку. После получения ваших доступов будет подключен Telegram Bot API и email API.',
    tgPending: 'Telegram: @John_3355',
    emailPending: 'Email: pbtrade.tashkent@gmail.com',
  },
  footer: {
    text: 'Polygraph Business — материалы, расходники и химия для полиграфического бизнеса.',
    companyLabel: 'Компания',
    companyItems: ['Складские и заказные позиции', 'Бумага, картон, пленки, фольга', 'Ташкент и рынок Узбекистана'],
    navLabel: 'Навигация',
    contactLabel: 'Контакты',
  },
  trust: {
    label: 'О компании',
    title: 'Кратко о Polygraph Business',
    description:
      'Polygraph Business — профильный B2B-поставщик материалов и расходников для полиграфии, упаковки и смежных производств в Узбекистане.',
    points: [
      'Профиль компании считывается с первого экрана: поставщик материалов для полиграфии и упаковки.',
      'Основные категории продукции собраны так, чтобы иностранец или новый партнер быстро понял специализацию бизнеса.',
      'Коммуникация ориентирована на подбор позиций под задачу, тираж и формат производства.',
    ],
    fitForLabel: 'С кем работаем',
    fitFor: [
      'Типографии',
      'Производства упаковки',
      'Компании по печати этикетки и стикеров',
      'Рекламно-производственные компании',
      'Книжные, журнальные и календарные производства',
      'Отделы снабжения полиграфического бизнеса',
    ],
    fitForNote:
      'Если вам нужен понятный поставщик для полиграфии, упаковки и печатного производства, здесь можно быстро оценить профиль компании и связаться с нами.',
    partnerGroups: [
      {
        title: 'Бренды и заводы',
        items: [
          'Заводы-производители материалов',
          'Поставщики самоклейки и пленок',
          'Производители фольги, красок и химии',
        ],
      },
      {
        title: 'Клиенты',
        items: ['Типографии', 'Упаковочные производства', 'Производители этикетки и стикеров'],
      },
    ],
    processLabel: 'Закупка и логистика',
    processSteps: [
      'Заявка по материалам и объемам',
      'Подбор формата, плотности и отделки',
      'Уточнение наличия и сроков поставки',
    ],
  },
  ctaSection: {
    label: 'Поставка для полиграфии без лишних задержек',
    title: 'Подберем материалы под ваши задачи и производство',
    description:
      'Если вам нужен надежный поставщик для типографии или упаковочного бизнеса, оставьте заявку. Поможем собрать нужные позиции, рассчитать стоимость и предложить удобный формат поставки.',
    phone: '+998 90 947 33 55',
    email: 'pbtrade.tashkent@gmail.com',
  },
}

const uz: Dictionary = {
  meta: {
    title: "Polygraph Business — Poligrafiya uchun materiallar va sarf mahsulotlari",
    description:
      "Polygraph Business Toshkent va O'zbekiston bozori uchun tipografiyalar hamda qadoqlash ishlab chiqarishiga materiallar, laminatsiya, folga, bo'yoq va kimyo yetkazib beradi.",
  },
  nav: {
    home: "Bosh sahifa",
    about: "Kompaniya haqida",
    services: "Katalog",
    products: "Mahsulotlar",
    blog: "Blog",
    contact: "Kontaktlar",
    cta: "Bog'lanish",
  },
  hero: {
    badge: "Tipografiyalar uchun o'z-o'zidan yopishuvchi materiallar, qog'oz, plyonka va sarflar",
    title: ['Bosma materiallari', 'qadoqlash', 'va etiketka uchun'],
    subtitle:
      "O'zbekistondagi B2B ishlab chiqarishlar uchun samokleyka, qog'oz, karton, laminatsiya, folga, bo'yoq va kimyo yetkazib beramiz.",
    primaryCta: "Biz bilan bog'laning",
    secondaryCta: "Katalogni ko'rish",
    highlights: [
      ['Samokleyka', 'Etiketka, stiker va qadoqlash uchun materiallar.'],
      ["Qog'oz va karton", 'Bosma uchun list va rulon pozitsiyalari.'],
      ['Bezak va sarflar', "Plyonka, folga, bo'yoq, kimyo va sarf mahsulotlari."],
    ],
  },
  about: {
    label: 'Kompaniya haqida',
    title: '2006-yildan poligrafiya uchun ixtisoslashgan yetkazib beruvchi',
    description:
      "Polygraph Business — O'zbekistonda poligrafiya, qadoqlash va unga yaqin ishlab chiqarishlar uchun materiallar hamda sarf mahsulotlari yetkazib beruvchi B2B kompaniya.",
    learnMore: "Kompaniya haqida ko'proq",
    values: {
      title: 'Asosiy tamoyillar',
      items: ['Ixtisoslik', 'Ishonchlilik', 'Tezkorlik', 'Halollik'],
    },
  },
  stats: {
    label: 'Raqamlarda',
    title: 'Kompaniya raqamlarda',
    metrics: [
      { value: '2006', label: '2006-yildan beri bozorda' },
      { value: '10+', label: "assortimentdagi asosiy yo'nalishlar" },
      { value: 'B2B', label: 'tipografiya, qadoqlash va ishlab chiqarish kompaniyalariga fokus' },
      { value: 'UZ', label: "Toshkentdan turib O'zbekiston bozorida ishlaymiz" },
    ],
  },
  services: {
    label: 'Katalog',
    title: 'Asosiy mahsulot kategoriyalari',
    description:
      "Quyida kompaniya profili va yetkazib berish tuzilmasini tez tushunishga yordam beradigan asosiy yo'nalishlar ko'rsatilgan.",
    viewAll: "Butun katalogni ko'rish",
    enquire: "So'rov yuborish",
    items: [
      {
        name: "O'z-o'zidan yopishuvchi qog'oz",
        description: "List (Xitoy, Turkiya) va rulon (FASSON, LIANG DU). Yaltiroq va yarim yaltiroq, o'lchamlar 50×35, 50×70, 70×100.",
      },
      {
        name: "Melovan qog'oz HI-KOTE",
        description: "Yaltiroq (170 va 250 gr/m²) va mat (105 gr/m²), format 70×100. 125–250 varaqli to'plamlarda.",
      },
      {
        name: 'Sellüloz karton',
        description: "List va rulon ko'rinishida. HINDISTON va XITOY NINGBO FOLD, 62×94 va 70×100, 250–300 gr/m².",
      },
      {
        name: 'Laminatsion plyonkalar',
        description: "Yaltiroq va mat (17 mkrn, 3000 m), soft touch (27 mkrn), golografik (21 mkrn), metallangan oltin va kumush.",
      },
      {
        name: 'Issiq tisma uchun folga',
        description: "Oltin, kumush, rangli (yashil, qizil, ko'k, binafsha, qora, oq) va gologramma. Eni 64 sm, uzunligi 120–360 m.",
      },
      {
        name: "Ofset va panton bo'yoqlar",
        description: "POWER-BRANCHER, FOCUS-BRANCHER, INNAVTION CF (CMYK). Panton bo'yoqlari BRANCHER: keng palitra.",
      },
      {
        name: 'Ofset rezina',
        description: "Yuqori sifatli, rulon (780–1450 mm) va planqali (520×440 – 1060×860 mm).",
      },
      {
        name: 'Poligrafik kimyo TEKNOVA',
        description: "Val yuvish vositalari, namlash qo'shimchalari, plita tozalagichlari, projaviteller, UV-lak LANER va ofset lak.",
      },
      {
        name: 'Sarf va yordamchi materiallar',
        description: "Biqovallash kanali, marzan, termoklej, CTP va PS plitalar, kalibrlangan karton, metallik taroqlar (kalendar uchun).",
      },
    ],
  },
  products: {
    label: 'Mahsulotlar',
    title: 'Har bir ishlab chiqarish uchun sifatli materiallar',
    description: 'Poligrafiya, qadoqlash va etiketka bosish uchun keng assortimentdagi materiallar va sarflar.',
    viewAll: "Barcha pozitsiyalarni ko'rish",
    items: [
      { category: 'Samokleyka', name: "O'z-o'zidan yopishuvchi qog'oz yaltiroq (Xitoy) 50×70" },
      { category: 'Samokleyka', name: 'FASSON samokleyka rulon' },
      { category: "Qog'oz", name: "Melovan qog'oz HI-KOTE yaltiroq 170 gr/m²" },
      { category: "Qog'oz", name: "Melovan qog'oz HI-KOTE mat 105 gr/m²" },
      { category: 'Karton', name: 'NINGBO FOLD sellüloz karton 270 gr/m²' },
      { category: 'Folga', name: 'Tisma folga oltin/kumush 64×120 m' },
      { category: 'Laminatsiya', name: 'Laminatsion plyonka yaltiroq 17 mkrn' },
      { category: 'Laminatsiya', name: 'Laminatsion plyonka mat 17 mkrn' },
      { category: 'Laminatsiya', name: 'Laminatsion plyonka soft touch 27 mkrn' },
      { category: "Bo'yoqlar", name: "POWER-BRANCHER ofset bo'yoqlari CMYK" },
      { category: 'Rezina', name: 'Planqali ofset rezina' },
      { category: 'Kimyo', name: 'TEKNOVA poligrafik kimyo' },
    ],
  },
  blog: {
    label: 'Blog',
    title: 'Polygraph Business yangiliklari va materiallari',
    description:
      "Yangi pozitsiyalar, poligrafiya bozori tendentsiyalari va materiallar xususiyatlari haqida dolzarb ma'lumotlar.",
    viewAll: "Barcha maqolalarni ko'rish",
    readMore: "Batafsil o'qish",
    posts: [
      {
        category: 'Assortiment',
        date: '5 dekabr 2024',
        title: 'Assortimentda yangi samokleyka materiallari pozitsiyalari',
        excerpt:
          'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.',
      },
      {
        category: 'Laminatsiya',
        date: '18 noyabr 2024',
        title: "Qadoqlash uchun to'g'ri laminatsion qoplamani qanday tanlash",
        excerpt:
          'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris.',
      },
      {
        category: 'Poligrafiya',
        date: '3 oktyabr 2024',
        title: "Ofset kimyo: turli sharoitlarda qo'llash xususiyatlari",
        excerpt:
          'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum.',
      },
    ],
  },
  contact: {
    label: 'Kontaktlar',
    title: "Biz bilan bog'laning",
    description:
      "So'rov qoldiring yoki to'g'ridan-to'g'ri qulay usulda murojaat qiling. Ishlab chiqarishingiz uchun materiallarni tanlashga yordam beramiz.",
    phone: '+998 90 947 33 55',
    email: 'pbtrade.tashkent@gmail.com',
    address: "O'zbekiston, Toshkent, Mirabad, Savr 5",
    support: "So'rovlarga tezkor javob",
  },
  form: {
    title: "Material tanlash uchun so'rov qoldiring",
    description:
      "Nima kerakligini yozing, biz mos pozitsiyalarni tanlaymiz va narx, mavjudlik hamda yetkazib berish muddati bo'yicha yo'nalish beramiz.",
    fields: {
      name: 'Ism',
      company: 'Kompaniya',
      phone: 'Telefon',
      email: 'Email',
      requestType: 'Nima kerak',
      quantity: 'Hajm / miqdor',
      details: 'Talab tafsilotlari',
    },
    placeholders: {
      name: 'Sizga qanday murojaat qilaylik',
      company: 'Kompaniya nomi',
      phone: '+998 90 947 33 55',
      email: 'pbtrade.tashkent@gmail.com',
      quantity: 'Masalan: 20 varaq / 5 rulon / 10 kg',
      details: "Kerakli materiallar, hajm, format, zichlik, muddat va qo'shimcha istaklarni yozing.",
    },
    options: ["Qog'oz va karton", 'Laminatsiya va folga', "Bo'yoqlar va kimyo", "To'liq prays / konsultatsiya kerak"],
    submit: "So'rov yuborish",
    success: "Ariza yuborildi! Tez orada siz bilan bog'lanamiz.",
    missingConfig: "Ariza yuborishda xatolik. Iltimos, telefon yoki Telegram orqali to'g'ridan-to'g'ri murojaat qiling.",
    validation: 'Ismni, telefon yoki emailni va qisqacha ehtiyojingizni kiriting.',
    consent: "Tugmani bosish orqali mahsulot tanlash va konsultatsiya uchun so'rov yuborasiz.",
    channelsTitle: 'Yuborish kanallari',
    channelsDescription:
      'Forma real yuborish uchun tayyor. Keyinroq Telegram Bot API va email API bilan integratsiya qilinadi.',
    tgPending: 'Telegram: @John_3355',
    emailPending: 'Email: pbtrade.tashkent@gmail.com',
  },
  footer: {
    text: 'Polygraph Business — poligrafiya biznesi uchun materiallar, sarf mahsulotlari va kimyo.',
    companyLabel: 'Kompaniya',
    companyItems: [
      'Ombordagi va buyurtma pozitsiyalari',
      "Qog'oz, karton, plyonka, folga",
      "Toshkent va O'zbekiston bozori",
    ],
    navLabel: 'Navigatsiya',
    contactLabel: 'Kontaktlar',
  },
  trust: {
    label: 'Kompaniya haqida',
    title: 'Polygraph Business haqida qisqacha',
    description:
      "Polygraph Business — O'zbekistonda poligrafiya, qadoqlash va unga yaqin ishlab chiqarishlar uchun materiallar hamda sarf mahsulotlari yetkazib beruvchi B2B kompaniya.",
    points: [
      'Kompaniya profili birinchi ekrandanoq tushunarli: poligrafiya va qadoqlash uchun materiallar yetkazib beruvchisi.',
      "Mahsulot kategoriyalari xorijiy hamkor yoki yangi mijozga biznes yo'nalishini tez anglashga yordam beradi.",
      'Muloqot usuli vazifa, tiraj va ishlab chiqarish formatiga mos pozitsiyalarni tanlashga qaratilgan.',
    ],
    fitForLabel: 'Kimlar bilan ishlaymiz',
    fitFor: [
      'Tipografiyalar',
      'Qadoqlash ishlab chiqarishlari',
      'Etiketka va stiker bosadigan kompaniyalar',
      'Reklama ishlab chiqarish kompaniyalari',
      'Kitob, jurnal va kalendar ishlab chiqarishlari',
      "Poligrafiya biznesi ta'minot bo'limlari",
    ],
    fitForNote:
      "Agar sizga poligrafiya, qadoqlash va bosma ishlab chiqarish uchun tushunarli yetkazib beruvchi kerak bo'lsa, bu yerda kompaniya profilini tez baholab, biz bilan bog'lanishingiz mumkin.",
    partnerGroups: [
      {
        title: 'Brendlar va zavodlar',
        items: [
          'Material ishlab chiqaruvchi zavodlar',
          'Samokleyka va plyonka yetkazib beruvchilari',
          "Folga, bo'yoq va kimyo ishlab chiqaruvchilari",
        ],
      },
      {
        title: 'Mijozlar',
        items: ['Tipografiyalar', 'Qadoqlash ishlab chiqarishlari', 'Etiketka va stiker ishlab chiqaruvchilari'],
      },
    ],
    processLabel: 'Xarid va logistika',
    processSteps: [
      "Material va hajm bo'yicha so'rov",
      'Format, zichlik va bezak tanlovi',
      'Mavjudlik va muddatlarni aniqlash',
    ],
  },
  ctaSection: {
    label: 'Poligrafiya uchun yetkazib berish ortiqcha kechikishlarsiz',
    title: 'Ishlab chiqarishingiz uchun mos materiallarni tanlab beramiz',
    description:
      "Agar sizga tipografiya yoki qadoqlash biznesi uchun ishonchli yetkazib beruvchi kerak bo'lsa, so'rov qoldiring.",
    phone: '+998 90 947 33 55',
    email: 'pbtrade.tashkent@gmail.com',
  },
}

const en: Dictionary = {
  meta: {
    title: 'Polygraph Business — Materials and consumables for print production',
    description:
      'Polygraph Business supplies print materials, lamination films, foils, inks, chemistry, and consumables for printing houses and packaging production in Tashkent, Uzbekistan.',
  },
  nav: {
    home: 'Home',
    about: 'About',
    services: 'Catalog',
    products: 'Products',
    blog: 'Blog',
    contact: 'Contact',
    cta: 'Contact us',
  },
  hero: {
    badge: 'Self-adhesive stock, paper, films, and consumables for printers',
    title: ['Print materials', 'for packaging', 'and labels'],
    subtitle:
      'We supply self-adhesive stock, paper, carton, lamination films, foil, inks, and chemistry for B2B production in Uzbekistan.',
    primaryCta: 'Contact us',
    secondaryCta: 'View catalog',
    highlights: [
      ['Self-adhesive', 'Materials for labels, stickers, and packaging.'],
      ['Paper and carton', 'Sheet and roll stock for print production.'],
      ['Finishing', 'Films, foil, inks, chemistry, and consumables.'],
    ],
  },
  about: {
    label: 'About company',
    title: 'Specialized print supplier since 2006',
    description:
      'Polygraph Business is a focused B2B supplier of materials and consumables for print, packaging, and related production businesses in Uzbekistan.',
    learnMore: 'Learn more about us',
    values: {
      title: 'Core values',
      items: ['Specialization', 'Reliability', 'Responsiveness', 'Honesty'],
    },
  },
  stats: {
    label: 'By the numbers',
    title: 'Company by the numbers',
    metrics: [
      { value: '2006', label: 'on the market since 2006' },
      { value: '10+', label: 'core product directions in the assortment' },
      { value: 'B2B', label: 'focus on printing houses, packaging, and manufacturing companies' },
      { value: 'UZ', label: 'operating from Tashkent across the Uzbekistan market' },
    ],
  },
  services: {
    label: 'Catalog',
    title: 'Main product categories',
    description:
      'These directions help a new visitor quickly understand the company profile and the main structure of the supply offering.',
    viewAll: 'View full catalog',
    enquire: 'Enquire',
    items: [
      {
        name: 'Self-adhesive paper',
        description: 'Sheet stock (China, Turkey) and rolls (FASSON, LIANG DU). Gloss and semi-gloss, formats 50×35, 50×70, 70×100.',
      },
      {
        name: 'Coated paper HI-KOTE',
        description: 'Gloss (170 and 250 gsm) and matte (105 gsm), format 70×100. Packs of 125–250 sheets.',
      },
      {
        name: 'Cellulose carton',
        description: 'In sheets and rolls. INDIA and CHINA NINGBO FOLD, formats 62×94 and 70×100, 250–300 gsm.',
      },
      {
        name: 'Lamination films',
        description: 'Gloss and matte (17 mic, 3000 m), soft touch (27 mic), holographic (21 mic), metallized gold and silver.',
      },
      {
        name: 'Hot stamping foil',
        description: 'Gold, silver, colored (green, red, blue, violet, black, white) and hologram. Width 64 cm, length 120–360 m.',
      },
      {
        name: 'Offset and Pantone inks',
        description: 'POWER-BRANCHER, FOCUS-BRANCHER, INNAVTION CF (CMYK). Pantone inks BRANCHER: wide color range.',
      },
      {
        name: 'Offset rubber',
        description: 'High-quality offset rubber in rolls (780–1450 mm) and with bars (520×440 – 1060×860 mm).',
      },
      {
        name: 'Print chemistry TEKNOVA',
        description: 'Roller washes, fountain additives, plate cleaners, developers, UV varnish LANER and offset varnish.',
      },
      {
        name: 'Consumables and auxiliaries',
        description: 'Creasing channel, makeready, hot glue, CTP and PS plates, wire-o coils for calendars, calibrated carton.',
      },
    ],
  },
  products: {
    label: 'Products',
    title: 'Quality materials for every production',
    description: 'Wide range of materials and consumables for printing, packaging, and label production.',
    viewAll: 'View all items',
    items: [
      { category: 'Self-adhesive', name: 'Self-adhesive paper gloss (China) 50×70' },
      { category: 'Self-adhesive', name: 'FASSON self-adhesive rolls' },
      { category: 'Paper', name: 'Coated paper HI-KOTE gloss 170 gsm' },
      { category: 'Paper', name: 'Coated paper HI-KOTE matte 105 gsm' },
      { category: 'Carton', name: 'NINGBO FOLD cellulose carton 270 gsm' },
      { category: 'Foil', name: 'Hot stamping foil gold/silver 64×120 m' },
      { category: 'Lamination', name: 'Lamination film gloss 17 mic' },
      { category: 'Lamination', name: 'Lamination film matte 17 mic' },
      { category: 'Lamination', name: 'Lamination film soft touch 27 mic' },
      { category: 'Inks', name: 'POWER-BRANCHER offset inks CMYK' },
      { category: 'Rubber', name: 'Offset rubber with bars' },
      { category: 'Chemistry', name: 'TEKNOVA print chemistry' },
    ],
  },
  blog: {
    label: 'Blog',
    title: 'News and insights from Polygraph Business',
    description:
      'Up-to-date information on new product additions, print market trends, and material specifications.',
    viewAll: 'View all articles',
    readMore: 'Read more',
    posts: [
      {
        category: 'Assortment',
        date: 'December 5, 2024',
        title: 'New self-adhesive material positions added to the assortment',
        excerpt:
          'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.',
      },
      {
        category: 'Lamination',
        date: 'November 18, 2024',
        title: 'How to choose the right lamination coating for packaging',
        excerpt:
          'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris.',
      },
      {
        category: 'Print',
        date: 'October 3, 2024',
        title: 'Offset chemistry: application specifics in different environments',
        excerpt:
          'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum.',
      },
    ],
  },
  contact: {
    label: 'Contact',
    title: 'Get in touch',
    description:
      'Leave a request or contact us directly in any convenient way. We will help select materials for your production.',
    phone: '+998 90 947 33 55',
    email: 'pbtrade.tashkent@gmail.com',
    address: 'Uzbekistan, Tashkent, Mirabad, Savr 5',
    support: 'Fast response to enquiries',
  },
  form: {
    title: 'Leave a request for materials',
    description:
      'Tell us what you need and we will match suitable positions and guide you on price, availability, and delivery lead time.',
    fields: {
      name: 'Name',
      company: 'Company',
      phone: 'Phone',
      email: 'Email',
      requestType: 'What do you need',
      quantity: 'Volume / quantity',
      details: 'Request details',
    },
    placeholders: {
      name: 'How should we address you',
      company: 'Company name',
      phone: '+998 90 947 33 55',
      email: 'pbtrade.tashkent@gmail.com',
      quantity: 'For example: 20 sheets / 5 rolls / 10 kg',
      details: 'Describe the required materials, quantity, format, gsm, deadline, and any extra notes.',
    },
    options: ['Paper and carton', 'Lamination and foil', 'Inks and chemistry', 'Need full price list / consultation'],
    submit: 'Send request',
    success: 'Request sent! We will get back to you shortly.',
    missingConfig: 'Failed to send request. Please contact us directly by phone or Telegram.',
    validation: 'Please provide your name, phone or email, and a short description of what you need.',
    consent: 'By clicking the button, you send a request for product selection and consultation.',
    channelsTitle: 'Delivery channels',
    channelsDescription:
      'The form is ready for real submission. Telegram Bot API and email API will be connected once credentials are provided.',
    tgPending: 'Telegram: @John_3355',
    emailPending: 'Email: pbtrade.tashkent@gmail.com',
  },
  footer: {
    text: 'Polygraph Business — materials, consumables, and chemistry for the print business.',
    companyLabel: 'Company',
    companyItems: ['Stock and made-to-order positions', 'Paper, carton, films, foil', 'Tashkent and Uzbekistan market'],
    navLabel: 'Navigation',
    contactLabel: 'Contact',
  },
  trust: {
    label: 'About company',
    title: 'Polygraph Business at a glance',
    description:
      'Polygraph Business is a focused B2B supplier of materials and consumables for print, packaging, and related production businesses in Uzbekistan.',
    points: [
      'The company profile is clear from the first screen: a supplier for print and packaging materials.',
      'Product categories are arranged so an international visitor or new partner can quickly understand the business specialization.',
      'Communication is built around matching positions to the task, run size, and production format.',
    ],
    fitForLabel: 'Who we work with',
    fitFor: [
      'Printing houses',
      'Packaging manufacturers',
      'Label and sticker printing companies',
      'Advertising production companies',
      'Book, magazine, and calendar production',
      'Procurement teams in print businesses',
    ],
    fitForNote:
      'If you need a clear supplier profile for print, packaging, and production materials, this page helps you understand the company quickly and get in touch.',
    partnerGroups: [
      {
        title: 'Brands and factories',
        items: ['Material manufacturing plants', 'Self-adhesive and film suppliers', 'Foil, ink, and chemistry producers'],
      },
      {
        title: 'Clients',
        items: ['Printing houses', 'Packaging manufacturers', 'Label and sticker producers'],
      },
    ],
    processLabel: 'Procurement and logistics',
    processSteps: [
      'Request by material and volume',
      'Format, gsm, and finish matching',
      'Availability and lead-time check',
    ],
  },
  ctaSection: {
    label: 'Supply for print production without unnecessary delays',
    title: 'We will match materials to your production needs',
    description:
      'If you need a reliable supplier for a printing house or packaging business, leave a request. We will help collect the right items and suggest a convenient supply format.',
    phone: '+998 90 947 33 55',
    email: 'pbtrade.tashkent@gmail.com',
  },
}

export const dictionaries: Record<SiteLocale, Dictionary> = { ru, uz, en }
