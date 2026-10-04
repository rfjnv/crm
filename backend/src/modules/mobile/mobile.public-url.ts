import { config } from '../../lib/config';

/** Публичный адрес бэкенда без /api: для QR привязки телефона и OAuth-redirect Google. */
export function publicServerUrl(fallback: string): string {
  return (config.mobile.publicServerUrl || fallback).replace(/\/+$/, '').replace(/\/api$/, '');
}
