/**
 * Локальный просмотр мини-аппы без базы и без запуска ботов.
 *
 *   node scripts/serve-miniapp.js        → http://localhost:4173/?demo=1
 *
 * `?demo=1` показывает оформление на демо-данных: боевые данные приходят из CRM
 * только внутри Telegram, где мини-аппа подписывает запросы initData.
 */
const express = require('express');
const path = require('path');

const port = Number(process.env.MINIAPP_PREVIEW_PORT) || 4173;
const app = express();

app.use(express.static(path.join(__dirname, '..', 'public', 'miniapp')));

app.listen(port, () => {
  console.log(`Mini app preview: http://localhost:${port}/?demo=1`);
});
