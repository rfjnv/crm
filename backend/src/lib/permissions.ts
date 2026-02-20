export const PERMISSIONS = {
  MANAGE_USERS: 'manage_users',
  VIEW_ALL_DEALS: 'view_all_deals',
  MANAGE_DEALS: 'manage_deals',
  MANAGE_LEADS: 'manage_leads',
  CLOSE_DEALS: 'close_deals',
  ARCHIVE_DEALS: 'archive_deals',
  STOCK_CONFIRM: 'stock_confirm',
  FINANCE_APPROVE: 'finance_approve',
  ADMIN_APPROVE: 'admin_approve',
  CONFIRM_SHIPMENT: 'confirm_shipment',
  MANAGE_INVENTORY: 'manage_inventory',
  MANAGE_PRODUCTS: 'manage_products',
  VIEW_ALL_CLIENTS: 'view_all_clients',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ALL_PERMISSIONS: Permission[] = Object.values(PERMISSIONS);

export const DEFAULT_PERMISSIONS: Record<string, Permission[]> = {
  SUPER_ADMIN: [...ALL_PERMISSIONS],
  ADMIN: [...ALL_PERMISSIONS],
  OPERATOR: [
    PERMISSIONS.MANAGE_LEADS,
    PERMISSIONS.VIEW_ALL_CLIENTS,
  ],
  MANAGER: [
    PERMISSIONS.MANAGE_DEALS,
    PERMISSIONS.MANAGE_INVENTORY,
    PERMISSIONS.VIEW_ALL_CLIENTS,
  ],
  ACCOUNTANT: [
    PERMISSIONS.FINANCE_APPROVE,
    PERMISSIONS.VIEW_ALL_DEALS,
  ],
  WAREHOUSE: [
    PERMISSIONS.STOCK_CONFIRM,
    PERMISSIONS.MANAGE_INVENTORY,
    PERMISSIONS.VIEW_ALL_DEALS,
  ],
  WAREHOUSE_MANAGER: [
    PERMISSIONS.CONFIRM_SHIPMENT,
    PERMISSIONS.MANAGE_INVENTORY,
    PERMISSIONS.VIEW_ALL_DEALS,
  ],
};
