export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',

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
} as const;
