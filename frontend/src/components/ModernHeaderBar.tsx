import { useState } from 'react';
import { Button, Dropdown, Switch } from 'antd';
import {
  Image as ImageIcon,
  List,
  MagnifyingGlassPlus,
  Moon,
  Palette,
  PushPin,
  SignOut,
  Sun,
  UserCircle,
  LockSimple,
} from '@phosphor-icons/react';
import type { ReactNode } from 'react';
import UiScaleControl from './UiScaleControl';
import CostAccessButton from './CostAccessButton';
import NotificationBell from './NotificationBell';
import { APP_BUTTON } from './ui/AppClassNames';
import { useCostAccess } from '../hooks/useCostAccess';

interface Props {
  isMobile: boolean;
  onOpenMobileMenu: () => void;
  displayName: string;
  isDark: boolean;
  onToggleTheme: () => void;
  siderPinned: boolean;
  onToggleSiderPinned: () => void;
  onToggleDesign: () => void;
  onOpenBackground: () => void;
  onOpenProfile: () => void;
  onLogout: () => void;
}

/**
 * Шапка нового дизайна: справа только колокольчик и кружок пользователя.
 * Всё остальное — масштаб, себестоимость, тема, закрепление меню, фон — в панели
 * под кружком. Внешний вид — в theme/glass.css (классы `hdr-*`).
 */
export default function ModernHeaderBar(props: Props) {
  const { isMobile, onOpenMobileMenu, displayName } = props;
  const [open, setOpen] = useState(false);
  const initial = displayName.charAt(0).toUpperCase();

  return (
    <>
      {isMobile ? (
        <Button
          type="text"
          className={`${APP_BUTTON} hdr-btn`}
          icon={<List size={20} />}
          onClick={onOpenMobileMenu}
          aria-label="Открыть меню"
        />
      ) : (
        <span />
      )}
      <div className="hdr-actions">
        <NotificationBell />
        <Dropdown
          open={open}
          onOpenChange={setOpen}
          trigger={['click']}
          placement="bottomRight"
          popupRender={() => (
            <ProfilePanel {...props} initial={initial} close={() => setOpen(false)} />
          )}
        >
          <button type="button" className="hdr-avatar" aria-label={`Меню: ${displayName}`}>
            {initial}
          </button>
        </Dropdown>
      </div>
    </>
  );
}

function ProfilePanel({
  isMobile,
  displayName,
  initial,
  isDark,
  onToggleTheme,
  siderPinned,
  onToggleSiderPinned,
  onToggleDesign,
  onOpenBackground,
  onOpenProfile,
  onLogout,
  close,
}: Props & { initial: string; close: () => void }) {
  const cost = useCostAccess();
  // Пункты, которые уводят со страницы или открывают окно, закрывают панель;
  // переключатели оставляют её открытой, чтобы было видно результат.
  const andClose = (fn: () => void) => () => {
    close();
    fn();
  };

  return (
    <div className="hdr-panel">
      <div className="hdr-panel__head">
        <span className="hdr-avatar hdr-avatar--lg" aria-hidden>{initial}</span>
        <span className="hdr-panel__name">{displayName}</span>
      </div>

      <div className="hdr-panel__group">
        {!isMobile && (
          <Row icon={<MagnifyingGlassPlus size={18} />} label="Масштаб">
            <UiScaleControl />
          </Row>
        )}
        {cost.eligible && (
          <Row icon={<LockSimple size={18} />} label="Себестоимость">
            <CostAccessButton />
          </Row>
        )}
        <Row
          icon={isDark ? <Moon size={18} /> : <Sun size={18} />}
          label="Тёмная тема"
          onClick={onToggleTheme}
        >
          <Switch size="small" checked={isDark} />
        </Row>
        {!isMobile && (
          <Row icon={<PushPin size={18} />} label="Закрепить меню" onClick={onToggleSiderPinned}>
            <Switch size="small" checked={siderPinned} />
          </Row>
        )}
      </div>

      <div className="hdr-panel__group">
        <Row icon={<Palette size={18} />} label="Новый дизайн (бета)" onClick={onToggleDesign}>
          <Switch size="small" checked />
        </Row>
        <Row icon={<ImageIcon size={18} />} label="Фон" onClick={andClose(onOpenBackground)} />
        <Row icon={<UserCircle size={18} />} label="Профиль" onClick={andClose(onOpenProfile)} />
      </div>

      <div className="hdr-panel__group">
        <Row icon={<SignOut size={18} />} label="Выход" danger onClick={andClose(onLogout)} />
      </div>
    </div>
  );
}

function Row({
  icon,
  label,
  children,
  onClick,
  danger,
}: {
  icon: ReactNode;
  label: string;
  children?: ReactNode;
  onClick?: () => void;
  danger?: boolean;
}) {
  const className = `hdr-panel__row${onClick ? ' hdr-panel__row--action' : ''}${danger ? ' hdr-panel__row--danger' : ''}`;
  const content = (
    <>
      <span className="hdr-panel__icon">{icon}</span>
      <span className="hdr-panel__label">{label}</span>
      {children && <span className="hdr-panel__control">{children}</span>}
    </>
  );
  return onClick ? (
    <button type="button" className={className} onClick={onClick}>
      {content}
    </button>
  ) : (
    <div className={className}>{content}</div>
  );
}
