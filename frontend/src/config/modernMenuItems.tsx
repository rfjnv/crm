import type { MenuProps } from 'antd';
import { Badge } from 'antd';
import { Link } from 'react-router-dom';
import { FIXED_MAIN_KEYS, isParent, type MenuLeaf, type MenuSection } from './modernMenuTree';

type Items = NonNullable<MenuProps['items']>;

function leafItem(leaf: MenuLeaf, unread: number, withIcon: boolean): Items[number] {
  const Icon = leaf.icon;
  return {
    key: leaf.key,
    icon: withIcon && Icon ? <Icon size={18} /> : undefined,
    disabled: !leaf.to,
    label: leaf.to ? (
      // data-menu-* — для перетаскивания в «Главное» (hooks/useMenuDragPin.ts)
      <Link
        to={leaf.to}
        draggable={false}
        data-menu-key={leaf.key}
        data-menu-pinned={leaf.pinned ? '1' : undefined}
        data-menu-fixed={FIXED_MAIN_KEYS.includes(leaf.key) ? '1' : undefined}
      >
        <span>{leaf.text}</span>
        {leaf.unreadBadge && unread > 0 && <Badge count={unread} size="small" style={{ marginLeft: 8 }} />}
      </Link>
    ) : (
      leaf.text
    ),
  };
}

/** Разделы нового меню → пункты antd Menu: раздел — группа, пункт со стрелкой — подменю. */
export function toModernMenuItems(sections: MenuSection[], unread: number): MenuProps['items'] {
  const items: Items = [];
  sections.forEach((section, index) => {
    const children: Items = section.items.map((node) => {
      if (!isParent(node)) return leafItem(node, unread, true);
      const Icon = node.icon;
      return {
        key: node.key,
        icon: <Icon size={18} />,
        label: node.text,
        // Подпункты без иконок — их объединяет вертикальная линия (см. glass.css)
        children: node.children.map((child) => leafItem(child, unread, false)),
      };
    });
    if (section.title) {
      items.push({
        type: 'group',
        key: `section:${section.key}`,
        // Подсказка, как закрепить пункт: Alt + перетащить (на телефоне — долгое нажатие)
        label: section.sourceKey === 'main'
          ? <span title="Перетащите сюда любой пункт меню с зажатым Alt (на телефоне — долгим нажатием)">{section.title}</span>
          : section.title,
        children,
        // «Главное» — место, куда перетаскивают пункты
        className: section.sourceKey === 'main' ? 'sider-section-main' : undefined,
      });
    } else {
      if (index > 0) items.push({ type: 'divider', key: `divider:${section.key}` });
      items.push(...children);
    }
  });
  return items;
}
