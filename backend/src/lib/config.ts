const nodeEnv = process.env.NODE_ENV || 'development';
const isProduction = nodeEnv === 'production';

// Validate critical env vars in production
if (isProduction) {
  if (!process.env.JWT_ACCESS_SECRET || process.env.JWT_ACCESS_SECRET === 'change-me-access-secret') {
    throw new Error('FATAL: JWT_ACCESS_SECRET must be set in production');
  }
  if (!process.env.JWT_REFRESH_SECRET || process.env.JWT_REFRESH_SECRET === 'change-me-refresh-secret') {
    throw new Error('FATAL: JWT_REFRESH_SECRET must be set in production');
  }
  if (!process.env.DATABASE_URL) {
    throw new Error('FATAL: DATABASE_URL must be set in production');
  }
}

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv,
  isProduction,

  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET || 'change-me-access-secret',
    refreshSecret: process.env.JWT_REFRESH_SECRET || 'change-me-refresh-secret',
    accessExpiresIn: '15m',
    refreshExpiresIn: '7d',
    refreshExpiresInMs: 7 * 24 * 60 * 60 * 1000, // 7 days
  },

  bcrypt: {
    saltRounds: 12,
  },

  rateLimit: {
    login: {
      windowMs: 15 * 60 * 1000, // 15 minutes
      maxAttempts: 5,
    },
    api: {
      windowMs: 60 * 1000, // 1 minute
      maxAttempts: 100,
    },
  },

  cors: {
    origins: (process.env.CORS_ORIGIN || 'http://localhost:5173')
      .split(',')
      .map((o) => o.trim()),
  },

  uploads: {
    dir: process.env.UPLOADS_DIR || 'uploads',
  },

  vapid: {
    publicKey: process.env.VAPID_PUBLIC_KEY || '',
    privateKey: process.env.VAPID_PRIVATE_KEY || '',
    subject: process.env.VAPID_SUBJECT || 'mailto:admin@polygraph.uz',
  },

  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN || '',
    clientBotToken: process.env.TELEGRAM_CLIENT_BOT_TOKEN || process.env.TELEGRAM_ORDER_BOT_TOKEN || '',
    crmUrl: process.env.TELEGRAM_CRM_URL || process.env.CRM_PUBLIC_URL || 'https://www.polygraphbusinesscrm.app',
    /** Supergroup/channel IDs (e.g. -1001234567890). Empty = disabled. */
    groupWarehouseChatId: process.env.TELEGRAM_GROUP_WAREHOUSE_CHAT_ID || '',
    groupProductionChatId: process.env.TELEGRAM_GROUP_PRODUCTION_CHAT_ID || '',
    groupFinanceChatId: process.env.TELEGRAM_GROUP_FINANCE_CHAT_ID || '',
  },
} as const;
