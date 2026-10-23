const path = require('path');
const { createApp } = require('./server/app');

const PORT = Number(process.env.PORT) || 3000;
const DB_FILE = process.env.DB_FILE || path.join(__dirname, 'data', 'grand.json');

const app = createApp({ dbFile: DB_FILE });
app.listen(PORT, () => console.log(`ТАЦ Гранд — сметки: http://localhost:${PORT}  (база: ${DB_FILE})`));
