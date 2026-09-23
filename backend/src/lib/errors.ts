export class AppError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    /**
     * Машиночитаемая причина — фронт по ней отличает одну ошибку от другой, не разбирая
     * текст. Напр. MONEY_ACCESS_DENIED → экран «нет доступа, обратитесь к администратору».
     */
    public code?: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}
