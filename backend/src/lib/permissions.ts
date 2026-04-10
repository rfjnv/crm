export const PERMISSIONS = {
  MANAGE_USERS: 'manage_users',
  VIEW_ALL_DEALS: 'view_all_deals',
  MANAGE_DEALS: 'manage_deals',
  MANAGE_LEADS: 'manage_leads',
  CLOSE_DEALS: 'close_deals',
  ARCHIVE_DEALS: 'archive_deals',
  /** Просмотр страницы «История закрытых сделок» и выборки status=CLOSED через API */
  VIEW_CLOSED_DEALS_HISTORY: 'view_closed_deals_history',
  STOCK_CONFIRM: 'stock_confirm',
  FINANCE_APPROVE: 'finance_approve',
  ADMIN_APPROVE: 'admin_approve',
  CONFIRM_SHIPMENT: 'confirm_shipment',
  MANAGE_INVENTORY: 'manage_inventory',
  MANAGE_PRODUCTS: 'manage_products',
  VIEW_ALL_CLIENTS: 'view_all_clients',
  CREATE_INVENTORY_IN: 'create_inventory_in',
  EDIT_CLIENT: 'edit_client',
  EDIT_CLOSED_DEAL: 'edit_closed_deal',
  MANAGE_CONTRACT: 'manage_contract',
  APPROVE_DEAL: 'approve_deal',
  SHIPMENT_EXECUTE: 'shipment_execute',
  SUPER_DEAL_OVERRIDE: 'super_deal_override',
  DELETE_ANY_DEAL: 'delete_any_deal',
  VIEW_AUDIT_HISTORY: 'view_audit_history',
  MANAGE_EXPENSES: 'manage_expenses',
  LOADING_EXECUTE: 'loading_execute',
  DELIVERY_EXECUTE: 'delivery_execute',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ALL_PERMISSIONS: Permission[] = Object.values(PERMISSIONS);

/** Permissions exclusive to SUPER_ADMIN */
const SUPER_ONLY: Permission[] = [
  PERMISSIONS.SUPER_DEAL_OVERRIDE,
  PERMISSIONS.DELETE_ANY_DEAL,
  PERMISSIONS.VIEW_AUDIT_HISTORY,
];

export const DEFAULT_PERMISSIONS: Record<string, Permission[]> = {
  SUPER_ADMIN: [...ALL_PERMISSIONS],
  ADMIN: ALL_PERMISSIONS.filter((p) => !SUPER_ONLY.includes(p)),
  OPERATOR: [
    PERMISSIONS.MANAGE_LEADS,
    PERMISSIONS.VIEW_ALL_CLIENTS,
  ],
  MANAGER: [
    PERMISSIONS.MANAGE_DEALS,
    PERMISSIONS.MANAGE_INVENTORY,
    PERMISSIONS.VIEW_ALL_CLIENTS,
    PERMISSIONS.EDIT_CLIENT,
  ],
  ACCOUNTANT: [
    PERMISSIONS.FINANCE_APPROVE,
    PERMISSIONS.VIEW_ALL_DEALS,
    PERMISSIONS.MANAGE_CONTRACT,
    PERMISSIONS.MANAGE_EXPENSES,
  ],
  WAREHOUSE: [
    PERMISSIONS.STOCK_CONFIRM,
    PERMISSIONS.MANAGE_INVENTORY,
    PERMISSIONS.VIEW_ALL_DEALS,
    PERMISSIONS.CREATE_INVENTORY_IN,
  ],
  WAREHOUSE_MANAGER: [
    PERMISSIONS.STOCK_CONFIRM,
    PERMISSIONS.CONFIRM_SHIPMENT,
    PERMISSIONS.MANAGE_INVENTORY,
    PERMISSIONS.VIEW_ALL_DEALS,
    PERMISSIONS.CREATE_INVENTORY_IN,
    PERMISSIONS.SHIPMENT_EXECUTE,
    PERMISSIONS.MANAGE_EXPENSES,
    PERMISSIONS.LOADING_EXECUTE,
  ],
  DRIVER: [
    PERMISSIONS.VIEW_ALL_DEALS,
    PERMISSIONS.LOADING_EXECUTE,
    PERMISSIONS.DELIVERY_EXECUTE,
  ],
  LOADER: [
    PERMISSIONS.VIEW_ALL_DEALS,
    PERMISSIONS.LOADING_EXECUTE,
  ],
};
