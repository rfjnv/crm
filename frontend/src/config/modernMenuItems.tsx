import type { MenuProps } from 'antd';
import { Badge } from 'antd';
import { Link } from 'react-router-dom';
import { isParent, type MenuLeaf, type MenuSection } from './modernMenuTree';

type Items = NonNullable<MenuProps['items']>;

function leafItem(leaf: MenuLeaf, unread: number, withIcon: boolean): Items[number] {
  const Icon = leaf.icon;
  return {
    key: leaf.key,
    icon: withIcon && Icon ? <Icon size={18} /> : undefined,
    disabled: !leaf.to,
    label: leaf.to ? (
      <Link to={leaf.to}>
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
      items.push({ type: 'group', key: `section:${section.key}`, label: section.title, children });
    } else {
      if (index > 0) items.push({ type: 'divider', key: `divider:${section.key}` });
      items.push(...children);
    }
  });
  return items;
}
