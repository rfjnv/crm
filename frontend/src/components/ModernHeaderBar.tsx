import { Button, Dropdown } from 'antd';
import type { MenuProps } from 'antd';
import { CaretDown, List, Moon, SidebarSimple, Sun } from '@phosphor-icons/react';
import UiScaleControl from './UiScaleControl';
import CostAccessButton from './CostAccessButton';
import NotificationBell from './NotificationBell';
import { APP_BUTTON } from './ui/AppClassNames';

interface Props {
  isMobile: boolean;
  collapsed: boolean;
  onMenuClick: () => void;
  isDark: boolean;
  onToggleTheme: () => void;
  displayName: string;
  profileMenu: MenuProps;
}

/**
 * Шапка нового дизайна: круглые стеклянные кнопки с иконками Phosphor, масштаб
 * одной «таблеткой», чип пользователя с аватаром. Внешний вид — в theme/glass.css
 * (классы `hdr-*`); поведение кнопок то же, что в старой шапке.
 */
export default function ModernHeaderBar({
  isMobile,
  collapsed,
  onMenuClick,
  isDark,
  onToggleTheme,
  displayName,
  profileMenu,
}: Props) {
  return (
    <>
      <Button
        type="text"
        className={`${APP_BUTTON} hdr-btn`}
        icon={isMobile ? <List size={20} /> : <SidebarSimple size={20} />}
        onClick={onMenuClick}
        aria-label={isMobile ? 'Открыть меню' : collapsed ? 'Развернуть меню' : 'Свернуть меню'}
      />
      <div className="hdr-actions">
        {/* Панель и киоск-режим не дают браузерного зума — заменяем его своим */}
        {!isMobile && <UiScaleControl />}
        <CostAccessButton />
        <NotificationBell />
        <Button
          type="text"
          className={`${APP_BUTTON} hdr-btn`}
          icon={isDark ? <Sun size={19} /> : <Moon size={19} />}
          onClick={onToggleTheme}
          aria-label={isDark ? 'Светлая тема' : 'Тёмная тема'}
        />
        {!isMobile && (
          <>
            <span className="hdr-sep" aria-hidden />
            <Dropdown menu={profileMenu} trigger={['click']} placement="bottomRight">
              <button type="button" className="hdr-user">
                <span className="hdr-user__avatar" aria-hidden>
                  {displayName.charAt(0).toUpperCase()}
                </span>
                <span className="hdr-user__name">{displayName}</span>
                <CaretDown size={14} className="hdr-user__caret" />
              </button>
            </Dropdown>
          </>
        )}
      </div>
    </>
  );
}
