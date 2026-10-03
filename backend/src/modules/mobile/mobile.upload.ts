import os from 'os';
import fs from 'fs/promises';
import { randomUUID } from 'crypto';
import multer from 'multer';
import { Request, Response, NextFunction } from 'express';
import { AppError } from '../../lib/errors';

/**
 * Multipart с телефона: файл во временную папку (не в память — записи до 50 МБ).
 * Слишком большой файл — 413: приложение поймёт, что повтор не поможет.
 */
export function singleFileUpload(field: string, maxBytes: number) {
  const upload = multer({
    storage: multer.diskStorage({
      destination: os.tmpdir(),
      filename: (_req, _file, cb) => cb(null, `callsync-upload-${randomUUID()}`),
    }),
    limits: { fileSize: maxBytes, files: 1, fields: 20 },
  }).single(field);

  return (req: Request, res: Response, next: NextFunction): void => {
    upload(req, res, (err: unknown) => {
      if (!err) return next();
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        return next(new AppError(413, `Файл больше ${Math.round(maxBytes / 1024 / 1024)} МБ`));
      }
      if (err instanceof multer.MulterError) return next(new AppError(400, `Некорректный multipart: ${err.message}`));
      return next(err);
    });
  };
}

/** Временный файл удаляем всегда — и после успеха, и после ошибки. */
export async function removeTempUpload(req: Request): Promise<void> {
  if (req.file?.path) await fs.unlink(req.file.path).catch(() => {});
}
