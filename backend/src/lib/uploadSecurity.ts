import { randomUUID } from 'crypto';
import path from 'path';
import { AppError } from './errors';

/**
 * Magic byte signatures for file type validation.
 * Prevents MIME spoofing by checking actual file content.
 */
const MAGIC_BYTES: Record<string, { offset: number; bytes: number[] }[]> = {
  'application/pdf': [{ offset: 0, bytes: [0x25, 0x50, 0x44, 0x46] }], // %PDF
  'image/png': [{ offset: 0, bytes: [0x89, 0x50, 0x4e, 0x47] }],       // .PNG
  'image/jpeg': [{ offset: 0, bytes: [0xff, 0xd8, 0xff] }],             // JPEG SOI
  'image/jpg': [{ offset: 0, bytes: [0xff, 0xd8, 0xff] }],
  'application/zip': [{ offset: 0, bytes: [0x50, 0x4b] }],              // PK
  'application/x-zip-compressed': [{ offset: 0, bytes: [0x50, 0x4b] }],
};

/**
 * Validate file magic bytes match the declared MIME type.
 * Returns false if the file content doesn't match the expected format.
 */
export function validateMagicBytes(buffer: Buffer, mimeType: string): boolean {
  const signatures = MAGIC_BYTES[mimeType];
  if (!signatures) {
    // Unknown MIME type - skip magic bytes check
    return true;
  }

  return signatures.some((sig) => {
    if (buffer.length < sig.offset + sig.bytes.length) return false;
    return sig.bytes.every((byte, i) => buffer[sig.offset + i] === byte);
  });
}

/**
 * Sanitize filename: strip all characters except [a-zA-Z0-9._-],
 * replace everything else with underscore, collapse multiple underscores.
 */
export function sanitizeFilename(original: string): string {
  const ext = path.extname(original);
  const base = path.basename(original, ext);
  const safeBase = base
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 100); // limit length
  const safeExt = ext.replace(/[^a-zA-Z0-9.]/g, '').slice(0, 10);
  return `${safeBase || 'file'}${safeExt}`;
}

/**
 * Generate a UUID-based storage filename.
 * Original filename is stored in DB, file on disk uses UUID.
 */
export function generateStorageName(originalFilename: string): string {
  const ext = path.extname(originalFilename).replace(/[^a-zA-Z0-9.]/g, '').toLowerCase();
  return `${randomUUID()}${ext}`;
}

/**
 * Validate an uploaded file: check magic bytes against declared MIME type.
 * Throws AppError if validation fails.
 */
export function validateUploadedFile(buffer: Buffer, mimeType: string, originalFilename: string): void {
  if (!validateMagicBytes(buffer, mimeType)) {
    throw new AppError(400,
      `Содержимое файла "${sanitizeFilename(originalFilename)}" не соответствует заявленному типу (${mimeType})`,
    );
  }
}
