import { describe, expect, it } from 'vitest';
import type { UserRole } from '../types';
import { buildModernMenu, isParent, type MenuAccess, type MenuSection } from './modernMenuTree';

function access(role: UserRole): MenuAccess {
  const isAdmin = role === 'SUPER_ADMIN' || role === 'ADMIN';
  return {
    role,
    isAdmin,
    hasRole: (...roles) => roles.includes(role),
    hasPermission: () => isAdmin,
    ownPermissions: [],
    canViewClients: true,
    canViewClosedDealsHistory: isAdmin,
    moneyFull: true,
  };
}

const keysOf = (section: MenuSection) =>
  section.items.flatMap((n) => (isParent(n) ? [n.key, ...n.children.map((c) => c.key)] : [n.key]));
const allKeys = (sections: MenuSection[]) => sections.flatMap(keysOf);

describe('боковое меню нового дизайна', () => {
  it('сообщения и уведомления — в самом низу, «Главное» — дашборд и задачи', () => {
    const menu = buildModernMenu(access('SUPER_ADMIN'));
    expect(menu[0].title).toBe('Главное');
    expect(keysOf(menu[0])).toEqual(['/dashboard', '/tasks']);
    const last = menu[menu.length - 1];
    expect(keysOf(last)).toContain('/messages');
    expect(keysOf(last)).toContain('notifications-group');
  });

  it('закреплённый пункт переезжает в «Главное» и пропадает из своей группы', () => {
    const menu = buildModernMenu(access('SUPER_ADMIN'), ['/deals/closed', '/clients']);
    const main = menu[0];
    expect(keysOf(main)).toEqual(['/dashboard', '/tasks', '/deals/closed', '/clients']);
    const pinned = main.items[2];
    expect(!isParent(pinned) && pinned.pinned).toBe(true);
    // В «Главном» — «одиночное» название и иконка группы
    expect(!isParent(pinned) && pinned.text).toBe('История закрытых сделок');
    expect(!isParent(main.items[3]) && main.items[3].text).toBe('Клиенты');
    expect(allKeys(menu).filter((k) => k === '/deals/closed')).toHaveLength(1);
  });

  it('недоступные человеку и постоянные пункты не закрепляются', () => {
    const menu = buildModernMenu(access('MANAGER'), ['/deals/archived', '/dashboard', '/notes-board']);
    expect(keysOf(menu[0])).toEqual(['/dashboard', '/tasks', '/notes-board']);
    expect(allKeys(menu)).not.toContain('/deals/archived');
  });

  it('группа, от которой остался один пункт, становится обычным пунктом', () => {
    const menu = buildModernMenu(access('SUPER_ADMIN'), ['/power-of-attorney']);
    const sales = menu.find((s) => s.sourceKey === 'sales');
    const contracts = sales?.items.find((n) => n.key === '/contracts');
    expect(contracts && !isParent(contracts)).toBe(true);
  });
});
