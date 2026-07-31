/* Polygraph Business — Telegram Mini App (магазин клиентского бота).
   Данные берутся из CRM через /api/telegram/miniapp, авторизация — подпись initData. */

(function () {
  'use strict';

  var tg = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;
  var API = '/api/telegram/miniapp';
  var DEMO = new URLSearchParams(location.search).has('demo');

  // ── Словари ────────────────────────────────────────────────────────────

  var I18N = {
    ru: {
      'brand.sub': 'Магазин материалов',
      'search.placeholder': 'Поиск по каталогу',
      'catalog.all': 'Все товары',
      'catalog.noCategory': 'Без категории',
      'catalog.emptyTitle': 'Ничего не найдено',
      'catalog.emptyText': 'Попробуйте другую категорию или запрос.',
      'catalog.more': 'Показать ещё',
      'cart.title': 'Корзина',
      'cart.emptyTitle': 'Корзина пуста',
      'cart.emptyText': 'Добавьте товары из каталога.',
      'cart.toCatalog': 'В каталог',
      'cart.total': 'Итого',
      'cart.checkout': 'Оформить заказ',
      'cart.added': 'Добавлено в корзину',
      'cart.positions': 'Позиций: {n}',
      'checkout.title': 'Данные для заказа',
      'checkout.name': 'Ваше имя или компания',
      'checkout.phone': 'Телефон',
      'checkout.manager': 'Менеджер',
      'checkout.comment': 'Комментарий (необязательно)',
      'checkout.needName': 'Укажите имя или компанию',
      'checkout.needPhone': 'Укажите телефон в формате +998 …',
      'checkout.needManager': 'Выберите менеджера',
      'checkout.sending': 'Отправляем…',
      'orders.title': 'Мои заказы',
      'orders.emptyTitle': 'Заказов пока нет',
      'orders.emptyText': 'Оформите первый заказ — он появится здесь.',
      'orders.manager': 'Менеджер: {name}',
      'tab.catalog': 'Каталог',
      'tab.cart': 'Корзина',
      'tab.orders': 'Заказы',
      'product.stock': 'В наличии: {qty} {unit}',
      'product.inStock': 'В наличии',
      'product.low': 'Осталось мало',
      'product.add': 'В корзину',
      'product.noDescription': 'Описание пока не добавлено.',
      'product.perUnit': '/ {unit}',
      'product.article': 'Артикул: {sku}',
      'done.title': 'Заказ принят',
      'done.text': 'Менеджер {name} свяжется с вами. Сумма заказа: {total}. Статус придёт в чат.',
      'done.close': 'Вернуться в чат',
      'done.orders': 'Мои заказы',
      'hours.closedTitle': 'Сейчас заказы не принимаются',
      'hours.note': 'Пн–Пт 09:00–18:00 · Сб 10:00–18:00 · Вс выходной',
      'boot.loading': 'Загружаем каталог…',
      'error.load': 'Не удалось загрузить данные. Потяните вниз, чтобы обновить.',
      'error.auth': 'Откройте магазин через Telegram-бота.',
      'error.order': 'Не удалось оформить заказ. Попробуйте ещё раз.',
      'unit.default': 'шт',
    },
    uz: {
      'brand.sub': 'Materiallar do‘koni',
      'search.placeholder': 'Katalogdan qidirish',
      'catalog.all': 'Barcha mahsulotlar',
      'catalog.noCategory': 'Kategoriyasiz',
      'catalog.emptyTitle': 'Hech narsa topilmadi',
      'catalog.emptyText': 'Boshqa kategoriya yoki so‘rovni sinab ko‘ring.',
      'catalog.more': 'Yana ko‘rsatish',
      'cart.title': 'Savat',
      'cart.emptyTitle': 'Savat bo‘sh',
      'cart.emptyText': 'Katalogdan mahsulot qo‘shing.',
      'cart.toCatalog': 'Katalogga',
      'cart.total': 'Jami',
      'cart.checkout': 'Buyurtma berish',
      'cart.added': 'Savatga qo‘shildi',
      'cart.positions': 'Pozitsiyalar: {n}',
      'checkout.title': 'Buyurtma ma’lumotlari',
      'checkout.name': 'Ismingiz yoki kompaniya',
      'checkout.phone': 'Telefon',
      'checkout.manager': 'Menejer',
      'checkout.comment': 'Izoh (ixtiyoriy)',
      'checkout.needName': 'Ism yoki kompaniyani kiriting',
      'checkout.needPhone': 'Telefonni +998 … formatida kiriting',
      'checkout.needManager': 'Menejerni tanlang',
      'checkout.sending': 'Yuborilmoqda…',
      'orders.title': 'Buyurtmalarim',
      'orders.emptyTitle': 'Hozircha buyurtma yo‘q',
      'orders.emptyText': 'Birinchi buyurtmani bering — u shu yerda ko‘rinadi.',
      'orders.manager': 'Menejer: {name}',
      'tab.catalog': 'Katalog',
      'tab.cart': 'Savat',
      'tab.orders': 'Buyurtmalar',
      'product.stock': 'Mavjud: {qty} {unit}',
      'product.inStock': 'Mavjud',
      'product.low': 'Kam qoldi',
      'product.add': 'Savatga',
      'product.noDescription': 'Tavsif hozircha qo‘shilmagan.',
      'product.perUnit': '/ {unit}',
      'product.article': 'Artikul: {sku}',
      'done.title': 'Buyurtma qabul qilindi',
      'done.text': '{name} siz bilan bog‘lanadi. Buyurtma summasi: {total}. Holat chatga keladi.',
      'done.close': 'Chatga qaytish',
      'done.orders': 'Buyurtmalarim',
      'hours.closedTitle': 'Hozir buyurtmalar qabul qilinmayapti',
      'hours.note': 'Du–Ju 09:00–18:00 · Sha 10:00–18:00 · Yak dam olish kuni',
      'boot.loading': 'Katalog yuklanmoqda…',
      'error.load': 'Ma’lumotlarni yuklab bo‘lmadi. Yangilash uchun pastga torting.',
      'error.auth': 'Do‘konni Telegram bot orqali oching.',
      'error.order': 'Buyurtma berilmadi. Yana urinib ko‘ring.',
      'unit.default': 'dona',
    },
  };

  var state = {
    lang: 'ru',
    view: 'catalog',
    hours: null,
    managers: [],
    categories: [],
    profile: null,
    category: '',
    search: '',
    offset: 0,
    total: 0,
    products: [],
    cart: [],
    managerId: null,
    orders: null,
    sheetProduct: null,
    sending: false,
  };

  // ── Утилиты ────────────────────────────────────────────────────────────

  function t(key, params) {
    var dict = I18N[state.lang] || I18N.ru;
    var value = dict[key] || I18N.ru[key] || key;
    if (!params) return value;
    return value.replace(/\{(\w+)\}/g, function (m, name) {
      return params[name] === undefined ? m : String(params[name]);
    });
  }

  var money = function (value) {
    return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(Math.round(value)) + ' so\'m';
  };
  var qtyFmt = function (value) {
    return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 3 }).format(value);
  };

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function $(id) { return document.getElementById(id); }

  function haptic(type) {
    if (!tg || !tg.HapticFeedback) return;
    try {
      if (type === 'select') tg.HapticFeedback.selectionChanged();
      else if (type === 'error') tg.HapticFeedback.notificationOccurred('error');
      else if (type === 'success') tg.HapticFeedback.notificationOccurred('success');
      else tg.HapticFeedback.impactOccurred(type || 'light');
    } catch (e) { /* старые клиенты */ }
  }

  var toastTimer = null;
  function toast(message) {
    var el = $('toast');
    el.textContent = message;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, 2200);
  }

  // Логотип-заглушка для товаров без фото
  var MARK = '<svg viewBox="0 0 100 78" aria-hidden="true"><g fill="currentColor">'
    + '<path d="M44.5 0 52 12.9 15 77h-15z"/><path d="M56.5 20.6 64 33.5 39.2 77h-15z"/>'
    + '<path d="M68.5 41.2 76 54.1 63.4 77h-15z"/><path d="M80.5 61.8 84.2 68.2 79.1 77h-7.4z"/></g></svg>';

  function mediaHtml(imageUrl, name, withLabel) {
    var placeholder = '<div class="ph" aria-hidden="true">' + MARK
      + (withLabel ? '<span class="ph__label">Polygraph Business</span>' : '') + '</div>';
    if (!imageUrl) return placeholder;
    // Заглушка лежит под фото: если картинка не загрузится, её удалит обработчик ниже.
    return placeholder + '<img src="' + esc(imageUrl) + '" alt="' + esc(name) + '" loading="lazy" decoding="async" />';
  }

  // Инлайновые onload/onerror запрещены CSP, поэтому слушаем на фазе перехвата.
  document.addEventListener('load', function (event) {
    if (event.target.tagName === 'IMG') event.target.classList.add('is-loaded');
  }, true);
  document.addEventListener('error', function (event) {
    if (event.target.tagName === 'IMG') event.target.remove();
  }, true);

  // ── API ────────────────────────────────────────────────────────────────

  function api(path, options) {
    var opts = options || {};
    var headers = { 'X-Telegram-Init-Data': (tg && tg.initData) || '' };
    if (opts.body) headers['Content-Type'] = 'application/json';

    return fetch(API + path, {
      method: opts.method || 'GET',
      headers: headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) {
          var err = new Error(data.message || data.error || 'REQUEST_FAILED');
          err.status = res.status;
          err.payload = data;
          throw err;
        }
        return data;
      });
    });
  }

  // ── Корзина ────────────────────────────────────────────────────────────

  function cartKey() {
    var uid = tg && tg.initDataUnsafe && tg.initDataUnsafe.user ? tg.initDataUnsafe.user.id : 'demo';
    return 'pb_cart_' + uid;
  }

  function loadCart() {
    try {
      var raw = localStorage.getItem(cartKey());
      state.cart = raw ? JSON.parse(raw) : [];
    } catch (e) { state.cart = []; }
  }

  function saveCart() {
    try { localStorage.setItem(cartKey(), JSON.stringify(state.cart)); } catch (e) { /* private mode */ }
    // Не терять собранную корзину случайным свайпом вниз
    if (tg && tg.enableClosingConfirmation) {
      try {
        if (state.cart.length) tg.enableClosingConfirmation();
        else tg.disableClosingConfirmation();
      } catch (e) { /* старые клиенты */ }
    }
  }

  function cartTotal() {
    return state.cart.reduce(function (sum, item) { return sum + item.qty * item.price; }, 0);
  }

  function cartQty(productId) {
    var found = state.cart.filter(function (item) { return item.productId === productId; })[0];
    return found ? found.qty : 0;
  }

  /** `product` — карточка каталога (id) либо строка корзины (productId). */
  function setCartQty(product, qty) {
    var productId = product.id || product.productId;
    var index = -1;
    for (var i = 0; i < state.cart.length; i++) {
      if (state.cart[i].productId === productId) { index = i; break; }
    }

    var capped = Math.min(qty, product.stock);
    if (capped <= 0) {
      if (index >= 0) state.cart.splice(index, 1);
    } else if (index >= 0) {
      state.cart[index].qty = capped;
      state.cart[index].price = product.price;
    } else {
      state.cart.push({
        productId: productId,
        name: product.name,
        unit: product.unit,
        price: product.price,
        stock: product.stock,
        imageUrl: product.imageUrl || null,
        qty: capped,
      });
    }

    saveCart();
    renderCartBadge();
    renderActionBar();
    if (state.view === 'cart') renderCart();
  }

  // ── Рендер: каталог ────────────────────────────────────────────────────

  function renderCategories() {
    var html = '<button class="chip' + (state.category ? '' : ' is-active') + '" data-cat="">'
      + esc(t('catalog.all'))
      + '<span class="chip__count">' + state.categories.reduce(function (s, c) { return s + c.count; }, 0) + '</span></button>';

    html += state.categories.map(function (cat) {
      var label = cat.key === '__none__' ? t('catalog.noCategory') : cat.name;
      return '<button class="chip' + (state.category === cat.key ? ' is-active' : '') + '" data-cat="' + esc(cat.key) + '">'
        + esc(label) + '<span class="chip__count">' + cat.count + '</span></button>';
    }).join('');

    $('categoryChips').innerHTML = html;
  }

  function skeletons(count) {
    var one = '<div class="sk"><div class="sk__media shimmer"></div>'
      + '<div class="sk__line shimmer"></div><div class="sk__line shimmer"></div></div>';
    return new Array(count).fill(one).join('');
  }

  function productCard(product) {
    var inCart = cartQty(product.id);
    var low = product.stock <= 5;
    return '<article class="card" data-product="' + esc(product.id) + '">'
      + '<div class="card__media">' + mediaHtml(product.imageUrl, product.name)
      // Плашка только когда остаток на исходе — иначе она у каждого товара и превращается в шум
      + (low ? '<span class="card__stock is-low">' + esc(t('product.low')) + '</span>' : '')
      + '</div>'
      + '<div class="card__body">'
      + '<h3 class="card__name">' + esc(product.name) + '</h3>'
      + '<div class="card__foot">'
      + '<span class="price"><span class="price__value">' + esc(money(product.price)) + '</span>'
      + '<span class="price__unit">' + esc(t('product.perUnit', { unit: product.unit || t('unit.default') })) + '</span></span>'
      + '<button class="add' + (inCart ? ' is-in-cart' : '') + '" data-add="' + esc(product.id) + '" '
      + 'aria-label="' + esc(t('product.add')) + '">' + (inCart ? '✓' : '+') + '</button>'
      + '</div></div></article>';
  }

  function renderProducts(append) {
    var grid = $('productGrid');
    var html = state.products.map(productCard).join('');
    if (append) grid.insertAdjacentHTML('beforeend', html);
    else grid.innerHTML = html;

    $('catalogEmpty').hidden = state.products.length > 0;
    $('loadMore').hidden = state.products.length >= state.total;
  }

  function fetchProducts(append) {
    if (!append) {
      state.offset = 0;
      $('productGrid').innerHTML = skeletons(6);
      $('catalogEmpty').hidden = true;
      $('loadMore').hidden = true;
    }

    var params = new URLSearchParams();
    if (state.category) params.set('category', state.category);
    if (state.search) params.set('q', state.search);
    params.set('offset', String(state.offset));
    params.set('limit', '24');

    var request = DEMO ? demoProducts() : api('/products?' + params.toString());

    return request.then(function (data) {
      state.total = data.total;
      state.products = append ? state.products.concat(data.items) : data.items;
      renderProducts(false);
    }).catch(function (err) {
      $('productGrid').innerHTML = '';
      $('catalogEmpty').hidden = false;
      toast(err.status === 401 ? t('error.auth') : t('error.load'));
    });
  }

  // ── Рендер: карточка товара ────────────────────────────────────────────

  function openSheet(productId) {
    var product = state.products.filter(function (item) { return item.id === productId; })[0];
    if (!product) return;

    state.sheetProduct = product;
    var current = cartQty(product.id) || 1;
    var description = (state.lang === 'uz' ? product.descriptionUz : product.descriptionRu) || t('product.noDescription');

    $('sheetBody').innerHTML =
      '<div class="detail__media">' + mediaHtml(product.imageUrl, product.name, true) + '</div>'
      + '<div class="detail__body">'
      + '<h2 class="detail__name">' + esc(product.name) + '</h2>'
      + '<div class="detail__meta">'
      + '<span class="tag">' + esc(t('product.stock', { qty: qtyFmt(product.stock), unit: product.unit || t('unit.default') })) + '</span>'
      + (product.sku ? '<span class="tag">' + esc(t('product.article', { sku: product.sku })) + '</span>' : '')
      + (product.category ? '<span class="tag">' + esc(product.category) + '</span>' : '')
      + '</div>'
      + '<div class="detail__price"><b>' + esc(money(product.price)) + '</b>'
      + '<span>' + esc(t('product.perUnit', { unit: product.unit || t('unit.default') })) + '</span></div>'
      + '<p class="detail__text">' + esc(description) + '</p>'
      + '</div>'
      + '<div class="detail__actions">'
      + '<div class="stepper">'
      + '<button type="button" data-sheet-step="-1">−</button>'
      + '<input id="sheetQty" type="text" inputmode="decimal" value="' + qtyFmt(current) + '" />'
      + '<button type="button" data-sheet-step="1">+</button>'
      + '</div>'
      + '<button class="btn btn--primary" id="sheetAdd">' + esc(t('product.add')) + '</button>'
      + '</div>';

    $('productSheet').hidden = false;
    syncBackButton();
    haptic('light');
  }

  function closeSheet() {
    $('productSheet').hidden = true;
    state.sheetProduct = null;
    syncBackButton();
  }

  function sheetQtyValue() {
    var raw = ($('sheetQty').value || '').replace(',', '.').trim();
    var value = parseFloat(raw);
    return Number.isFinite(value) && value > 0 ? value : 0;
  }

  // ── Рендер: корзина ────────────────────────────────────────────────────

  function renderCart() {
    var list = $('cartList');
    var isEmpty = state.cart.length === 0;

    $('cartEmpty').hidden = !isEmpty;
    $('checkoutForm').hidden = isEmpty;
    list.innerHTML = state.cart.map(function (item) {
      return '<div class="line" data-line="' + esc(item.productId) + '">'
        + '<div class="line__media">' + mediaHtml(item.imageUrl, item.name) + '</div>'
        + '<div class="line__body">'
        + '<div class="line__top">'
        + '<span class="line__name">' + esc(item.name) + '</span>'
        + '<button class="line__remove" data-remove="' + esc(item.productId) + '" aria-label="✕">✕</button>'
        + '</div>'
        + '<div class="line__bottom">'
        + '<div class="stepper">'
        + '<button type="button" data-step="-1" data-id="' + esc(item.productId) + '">−</button>'
        + '<input type="text" inputmode="decimal" data-qty="' + esc(item.productId) + '" value="' + qtyFmt(item.qty) + '" />'
        + '<button type="button" data-step="1" data-id="' + esc(item.productId) + '">+</button>'
        + '</div>'
        + '<span class="line__sum">' + esc(money(item.qty * item.price)) + '</span>'
        + '</div></div></div>';
    }).join('');

    renderManagers();
  }

  function renderManagers() {
    $('managerList').innerHTML = state.managers.map(function (manager) {
      var initials = (manager.name || '?').trim().charAt(0).toUpperCase();
      return '<button type="button" class="manager' + (state.managerId === manager.id ? ' is-active' : '') + '" '
        + 'data-manager="' + esc(manager.id) + '">'
        + '<span class="manager__ava">' + esc(initials) + '</span>' + esc(manager.name) + '</button>';
    }).join('');
  }

  function renderCartBadge() {
    var badge = $('cartBadge');
    var count = state.cart.length;
    if (!count) { badge.hidden = true; return; }
    badge.hidden = false;
    badge.textContent = String(count);
  }

  // ── Рендер: заказы ─────────────────────────────────────────────────────

  function renderOrders() {
    var list = $('ordersList');
    if (state.orders === null) {
      list.innerHTML = '<div class="order-sk sk shimmer"></div><div class="order-sk sk shimmer"></div>';
      $('ordersEmpty').hidden = true;
      return;
    }

    $('ordersEmpty').hidden = state.orders.length > 0;
    list.innerHTML = state.orders.map(function (order) {
      var date = new Date(order.createdAt).toLocaleDateString(state.lang === 'uz' ? 'uz-UZ' : 'ru-RU', {
        day: '2-digit', month: 'long', year: 'numeric',
      });
      var items = order.items.slice(0, 4).map(function (item) {
        return '<div class="order__item"><span>' + esc(item.name) + '</span>'
          + '<span>' + esc(qtyFmt(item.qty) + ' ' + (item.unit || '')) + '</span></div>';
      }).join('');
      var rest = order.items.length > 4 ? '<div class="order__item"><span>+ ' + (order.items.length - 4) + '</span><span></span></div>' : '';

      return '<article class="order">'
        + '<div class="order__head"><span class="order__date">' + esc(date) + '</span>'
        + '<span class="badge">' + esc(order.statusLabel) + '</span></div>'
        + '<div class="order__items">' + items + rest + '</div>'
        + '<div class="order__foot"><span class="order__sum">' + esc(money(order.amount)) + '</span>'
        + (order.manager ? '<span class="order__manager">' + esc(t('orders.manager', { name: order.manager })) + '</span>' : '')
        + '</div></article>';
    }).join('');
  }

  function fetchOrders() {
    state.orders = null;
    renderOrders();
    var request = DEMO ? demoOrders() : api('/orders?lang=' + state.lang);
    return request.then(function (data) {
      state.orders = data.items;
      renderOrders();
    }).catch(function () {
      state.orders = [];
      renderOrders();
    });
  }

  // ── Нижняя панель ──────────────────────────────────────────────────────

  function renderActionBar() {
    var bar = $('actionBar');
    var visible = state.view === 'cart' && state.cart.length > 0;
    bar.hidden = !visible;
    document.body.classList.toggle('has-actionbar', visible);
    if (!visible) return;

    $('actionLabel').textContent = t('cart.positions', { n: state.cart.length });
    $('actionTotal').textContent = money(cartTotal());
    var button = $('actionButton');
    button.textContent = state.sending ? t('checkout.sending') : t('cart.checkout');
    button.classList.toggle('is-busy', state.sending);
    button.disabled = !!state.sending || (state.hours && !state.hours.isOpen);
  }

  // ── Навигация ──────────────────────────────────────────────────────────

  function goto(view) {
    state.view = view;
    ['catalog', 'cart', 'orders'].forEach(function (name) {
      $('view-' + name).classList.toggle('is-active', name === view);
    });
    Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (tab) {
      tab.classList.toggle('is-active', tab.dataset.goto === view);
    });

    window.scrollTo(0, 0);

    if (view === 'cart') renderCart();
    if (view === 'orders' && state.orders === null) fetchOrders();

    renderActionBar();
    syncBackButton();
    haptic('select');
  }

  function syncBackButton() {
    if (!tg || !tg.BackButton) return;
    var needsBack = !$('productSheet').hidden || state.view !== 'catalog';
    try {
      if (needsBack) tg.BackButton.show(); else tg.BackButton.hide();
    } catch (e) { /* клиенты до Bot API 6.1 */ }
  }

  // ── Оформление ─────────────────────────────────────────────────────────

  function validPhone(raw) {
    var digits = (raw || '').replace(/\D/g, '');
    return digits.length >= 9 && digits.length <= 15;
  }

  function submitOrder() {
    if (state.sending || !state.cart.length) return;

    var name = $('nameInput').value.trim();
    var phone = $('phoneInput').value.trim();

    if (name.length < 2) {
      $('nameInput').classList.add('is-invalid');
      $('nameInput').focus();
      toast(t('checkout.needName'));
      haptic('error');
      return;
    }
    if (!validPhone(phone)) {
      $('phoneInput').classList.add('is-invalid');
      $('phoneInput').focus();
      toast(t('checkout.needPhone'));
      haptic('error');
      return;
    }
    if (!state.managerId) {
      toast(t('checkout.needManager'));
      haptic('error');
      return;
    }

    state.sending = true;
    renderActionBar();

    api('/orders', {
      method: 'POST',
      body: {
        managerId: state.managerId,
        customerName: name,
        phone: phone,
        comment: $('commentInput').value.trim() || null,
        lang: state.lang,
        items: state.cart.map(function (item) { return { productId: item.productId, qty: item.qty }; }),
      },
    }).then(function (data) {
      haptic('success');
      showDone(data);
      state.cart = [];
      saveCart();
      renderCartBadge();
      state.orders = null;
    }).catch(function (err) {
      haptic('error');
      toast(err.message || t('error.order'));
      if (err.payload && err.payload.error === 'CLOSED' && err.payload.hours) {
        state.hours = err.payload.hours;
        renderHours();
      }
    }).then(function () {
      state.sending = false;
      renderActionBar();
    });
  }

  function showDone(data) {
    $('doneTitle').textContent = t('done.title');
    $('doneText').textContent = t('done.text', {
      name: data.manager || '',
      total: money(data.totalAmount),
    });
    $('doneClose').textContent = t('done.close');
    $('doneOrders').textContent = t('done.orders');
    $('doneScreen').hidden = false;
  }

  // ── Часы работы ────────────────────────────────────────────────────────

  function renderHours() {
    var strip = $('statusStrip');
    if (!state.hours || state.hours.isOpen) { strip.hidden = true; return; }
    strip.hidden = false;
    $('statusText').textContent = t('hours.closedTitle') + ' · ' + t('hours.note');
    renderActionBar();
  }

  // ── Язык ───────────────────────────────────────────────────────────────

  function applyStaticTexts() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-i18n]'), function (el) {
      el.textContent = t(el.dataset.i18n);
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-i18n-placeholder]'), function (el) {
      el.placeholder = t(el.dataset.i18nPlaceholder);
    });
    $('langLabel').textContent = state.lang === 'ru' ? 'UZ' : 'RU';
    document.documentElement.lang = state.lang;
    $('bootText').textContent = t('boot.loading');
  }

  function setLang(lang) {
    state.lang = lang;
    applyStaticTexts();
    renderCategories();
    renderProducts(false);
    if (state.view === 'cart') renderCart();
    if (state.orders) fetchOrders();
    renderHours();
    renderActionBar();
    if (!DEMO) api('/language', { method: 'POST', body: { lang: lang } }).catch(function () {});
  }

  // ── События ────────────────────────────────────────────────────────────

  function bindEvents() {
    $('langToggle').addEventListener('click', function () {
      haptic('select');
      setLang(state.lang === 'ru' ? 'uz' : 'ru');
    });

    document.addEventListener('click', function (event) {
      var target = event.target;

      var tab = target.closest('[data-goto]');
      if (tab) { goto(tab.dataset.goto); return; }

      var addBtn = target.closest('[data-add]');
      if (addBtn) {
        event.stopPropagation();
        var product = state.products.filter(function (p) { return p.id === addBtn.dataset.add; })[0];
        if (product) {
          setCartQty(product, cartQty(product.id) ? 0 : 1);
          addBtn.classList.toggle('is-in-cart', cartQty(product.id) > 0);
          addBtn.textContent = cartQty(product.id) > 0 ? '✓' : '+';
          if (cartQty(product.id) > 0) toast(t('cart.added'));
          haptic('light');
        }
        return;
      }

      var card = target.closest('[data-product]');
      if (card) { openSheet(card.dataset.product); return; }

      var chip = target.closest('[data-cat]');
      if (chip) {
        state.category = chip.dataset.cat;
        renderCategories();
        fetchProducts(false);
        haptic('select');
        return;
      }

      if (target.closest('[data-close-sheet]')) { closeSheet(); return; }

      var sheetStep = target.closest('[data-sheet-step]');
      if (sheetStep && state.sheetProduct) {
        var next = sheetQtyValue() + Number(sheetStep.dataset.sheetStep);
        next = Math.max(0, Math.min(next, state.sheetProduct.stock));
        $('sheetQty').value = qtyFmt(next || 0);
        haptic('light');
        return;
      }

      if (target.id === 'sheetAdd' && state.sheetProduct) {
        var qty = sheetQtyValue();
        if (qty <= 0) { haptic('error'); return; }
        setCartQty(state.sheetProduct, qty);
        toast(t('cart.added'));
        haptic('success');
        closeSheet();
        renderProducts(false);
        return;
      }

      var step = target.closest('[data-step]');
      if (step) {
        var item = state.cart.filter(function (line) { return line.productId === step.dataset.id; })[0];
        if (item) {
          setCartQty(item, item.qty + Number(step.dataset.step));
          haptic('light');
        }
        return;
      }

      var remove = target.closest('[data-remove]');
      if (remove) {
        var line = state.cart.filter(function (entry) { return entry.productId === remove.dataset.remove; })[0];
        if (line) { setCartQty(line, 0); haptic('light'); }
        return;
      }

      var manager = target.closest('[data-manager]');
      if (manager) {
        state.managerId = manager.dataset.manager;
        renderManagers();
        haptic('select');
        return;
      }
    });

    // Ручной ввод количества в корзине
    $('cartList').addEventListener('change', function (event) {
      var input = event.target.closest('[data-qty]');
      if (!input) return;
      var item = state.cart.filter(function (line) { return line.productId === input.dataset.qty; })[0];
      if (!item) return;
      var value = parseFloat((input.value || '').replace(',', '.'));
      setCartQty(item, Number.isFinite(value) && value > 0 ? value : 0);
    });

    $('actionButton').addEventListener('click', submitOrder);

    $('doneClose').addEventListener('click', function () {
      if (tg && tg.close) tg.close(); else $('doneScreen').hidden = true;
    });
    $('doneOrders').addEventListener('click', function () {
      $('doneScreen').hidden = true;
      goto('orders');
      fetchOrders();
    });

    ['nameInput', 'phoneInput'].forEach(function (id) {
      $(id).addEventListener('input', function () { $(id).classList.remove('is-invalid'); });
    });

    var searchTimer = null;
    $('searchInput').addEventListener('input', function (event) {
      var value = event.target.value.trim();
      $('searchClear').hidden = !value;
      clearTimeout(searchTimer);
      searchTimer = setTimeout(function () {
        state.search = value;
        fetchProducts(false);
      }, 320);
    });

    $('searchClear').addEventListener('click', function () {
      $('searchInput').value = '';
      $('searchClear').hidden = true;
      state.search = '';
      fetchProducts(false);
    });

    $('loadMore').addEventListener('click', function () {
      state.offset += 24;
      fetchProducts(true);
    });

    window.addEventListener('scroll', function () {
      document.querySelector('.topbar').classList.toggle('is-stuck', window.scrollY > 4);
    }, { passive: true });

    if (tg && tg.BackButton) {
      try {
        tg.BackButton.onClick(function () {
          if (!$('productSheet').hidden) { closeSheet(); return; }
          if (state.view !== 'catalog') { goto('catalog'); return; }
          tg.close();
        });
      } catch (e) { /* клиенты до Bot API 6.1 */ }
    }
  }

  // ── Старт ──────────────────────────────────────────────────────────────

  function applyTheme() {
    if (!tg) return;
    document.body.classList.toggle('dark', tg.colorScheme === 'dark');
    try {
      tg.setHeaderColor(tg.themeParams.bg_color || (tg.colorScheme === 'dark' ? '#0f1419' : '#f4f6fa'));
      tg.setBackgroundColor(tg.themeParams.bg_color || (tg.colorScheme === 'dark' ? '#0f1419' : '#f4f6fa'));
    } catch (e) { /* старые клиенты */ }
  }

  function boot() {
    loadCart();
    applyStaticTexts();
    bindEvents();
    renderCartBadge();

    if (tg) {
      tg.ready();
      tg.expand();
      applyTheme();
      tg.onEvent('themeChanged', applyTheme);
    }

    var request = DEMO ? demoBootstrap() : api('/bootstrap');

    request.then(function (data) {
      state.lang = data.lang || 'ru';
      state.hours = data.hours;
      state.managers = data.managers;
      state.categories = data.categories;
      state.profile = data.profile;

      if (data.profile) {
        $('nameInput').value = data.profile.name || '';
        $('phoneInput').value = data.profile.phone || '';
        if (data.profile.managerId) state.managerId = data.profile.managerId;
      } else if (data.user && data.user.firstName) {
        $('nameInput').value = data.user.firstName;
      }
      if (!state.managerId && state.managers.length === 1) state.managerId = state.managers[0].id;

      applyStaticTexts();
      renderCategories();
      renderHours();
      renderManagers();
      return fetchProducts(false);
    }).then(function () {
      $('boot').classList.add('is-hidden');
      setTimeout(function () { $('boot').hidden = true; }, 320);
    }).catch(function (err) {
      $('boot').classList.add('is-hidden');
      setTimeout(function () { $('boot').hidden = true; }, 320);
      toast(err && err.status === 401 ? t('error.auth') : t('error.load'));
    });
  }

  // ── Демо-режим (?demo=1): только для просмотра оформления без Telegram ──

  function demoBootstrap() {
    return Promise.resolve({
      lang: 'ru',
      user: { firstName: 'Демо' },
      hours: { isOpen: true, currentTimeText: '' },
      managers: [
        { id: 'm1', name: 'Тимур' }, { id: 'm2', name: 'Мадина' }, { id: 'm3', name: 'Фарход' },
      ],
      categories: [
        { key: 'Ламинация', name: 'Ламинация', count: 18, imageUrl: null },
        { key: 'Бумага', name: 'Бумага', count: 12, imageUrl: null },
        { key: 'Плёнка', name: 'Плёнка', count: 7, imageUrl: null },
      ],
      profile: null,
    });
  }

  function demoProducts() {
    var names = [
      ['Плёнка ламинационная 62 Gold', 'Ламинация', 'кг', 2500, 340],
      ['Плёнка глянцевая 30 мкм', 'Плёнка', 'рулон', 185000, 4],
      ['Бумага мелованная 150 г/м²', 'Бумага', 'пачка', 92000, 60],
      ['Плёнка матовая 35 мкм', 'Плёнка', 'рулон', 210000, 12],
      ['Картон переплётный 2 мм', 'Бумага', 'лист', 7400, 800],
      ['Клей-расплав для КБС', 'Ламинация', 'кг', 46000, 25],
    ];
    return Promise.resolve({
      total: names.length,
      items: names.map(function (row, index) {
        return {
          id: 'p' + index, name: row[0], sku: 'SKU-' + (1000 + index), unit: row[2],
          category: row[1], price: row[3], stock: row[4], imageUrl: null,
          descriptionRu: 'Товар со склада в Ташкенте. Отгрузка в день заказа при наличии.',
          descriptionUz: 'Toshkentdagi ombordan. Mavjud bo‘lsa, buyurtma kuni jo‘natiladi.',
        };
      }),
    });
  }

  function demoOrders() {
    return Promise.resolve({
      items: [{
        id: 'd1', title: 'Заказ', amount: 1840000, status: 'NEW', statusLabel: '🆕 В обработке',
        createdAt: new Date().toISOString(), manager: 'Тимур',
        items: [{ name: 'Плёнка 62 Gold', unit: 'кг', qty: 120, price: 2500, imageUrl: null }],
      }],
    });
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
