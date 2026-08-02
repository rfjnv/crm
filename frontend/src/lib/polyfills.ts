/**
 * Полифилы для встроенных Android-панелей и WebView Telegram со старым движком.
 *
 * `build.target` понижает только синтаксис — отсутствующие методы esbuild не
 * добавляет. В собранном бандле (наш код + React/antd) встречаются вызовы,
 * которые новее выбранного таргета Chrome 87, и на старом WebView они падают с
 * «undefined is not a function», обрывая рендер до пустого экрана.
 *
 * Каждый полифил ставится только при отсутствии штатной реализации, поэтому на
 * современных браузерах файл не делает ничего.
 */

// Object.hasOwn — Chrome 93 / Safari 15.4
if (typeof Object.hasOwn !== 'function') {
  Object.defineProperty(Object, 'hasOwn', {
    value: (target: object, key: PropertyKey) => Object.prototype.hasOwnProperty.call(target, key),
    configurable: true,
    writable: true,
  });
}

// structuredClone — Chrome 98 / Safari 15.4.
// Полная семантика (Transferable, ArrayBuffer) здесь не нужна: приложение
// клонирует только простые данные. Циклы поддерживаем — на них штатная
// реализация тоже рассчитана, и без этого клон ушёл бы в бесконечность.
if (typeof globalThis.structuredClone !== 'function') {
  const clone = (value: unknown, seen: WeakMap<object, unknown>): unknown => {
    if (value === null || typeof value !== 'object') return value;

    const known = seen.get(value as object);
    if (known !== undefined) return known;

    if (value instanceof Date) return new Date(value.getTime());
    if (value instanceof RegExp) return new RegExp(value.source, value.flags);

    if (Array.isArray(value)) {
      const copy: unknown[] = [];
      seen.set(value, copy);
      for (const item of value) copy.push(clone(item, seen));
      return copy;
    }

    if (value instanceof Map) {
      const copy = new Map();
      seen.set(value, copy);
      value.forEach((v, k) => copy.set(clone(k, seen), clone(v, seen)));
      return copy;
    }

    if (value instanceof Set) {
      const copy = new Set();
      seen.set(value, copy);
      value.forEach((v) => copy.add(clone(v, seen)));
      return copy;
    }

    const copy: Record<string, unknown> = {};
    seen.set(value, copy);
    for (const key of Object.keys(value as Record<string, unknown>)) {
      copy[key] = clone((value as Record<string, unknown>)[key], seen);
    }
    return copy;
  };

  globalThis.structuredClone = ((value: unknown) => clone(value, new WeakMap())) as typeof structuredClone;
}

// Array.prototype.at / String.prototype.at — Chrome 92 / Safari 15.4
function atImpl(this: { length: number; [i: number]: unknown }, index: number): unknown {
  const len = this.length;
  const i = Math.trunc(index) || 0;
  const target = i < 0 ? len + i : i;
  return target < 0 || target >= len ? undefined : this[target];
}

for (const proto of [Array.prototype, String.prototype] as { at?: unknown }[]) {
  if (typeof proto.at !== 'function') {
    Object.defineProperty(proto, 'at', { value: atImpl, configurable: true, writable: true });
  }
}

// Array.prototype.findLast / findLastIndex — Chrome 97 / Safari 15.4.
// Методы из ES2023, а lib здесь намеренно ES2022: подняв lib, мы разрешили бы
// остальному коду звать toSorted/toReversed и прочий ES2023, который никто не
// полифиллит. Поэтому до прототипа добираемся через локальный тип.
type FindLastCapable = {
  findLast?: unknown;
  findLastIndex?: unknown;
};

type FindLastPredicate = (value: unknown, index: number, array: unknown[]) => boolean;

function findLastIndexImpl(this: unknown[], predicate: FindLastPredicate, thisArg?: unknown): number {
  for (let i = this.length - 1; i >= 0; i -= 1) {
    if (predicate.call(thisArg, this[i], i, this)) return i;
  }
  return -1;
}

const arrayProto = Array.prototype as FindLastCapable;

if (typeof arrayProto.findLastIndex !== 'function') {
  Object.defineProperty(Array.prototype, 'findLastIndex', {
    value: findLastIndexImpl,
    configurable: true,
    writable: true,
  });
}

if (typeof arrayProto.findLast !== 'function') {
  Object.defineProperty(Array.prototype, 'findLast', {
    value: function findLast(this: unknown[], predicate: FindLastPredicate, thisArg?: unknown) {
      const index = findLastIndexImpl.call(this, predicate, thisArg);
      return index === -1 ? undefined : this[index];
    },
    configurable: true,
    writable: true,
  });
}
