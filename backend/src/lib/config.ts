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
    origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  },

  uploads: {
    dir: process.env.UPLOADS_DIR || 'uploads',
  },
} as const;
