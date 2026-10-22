const path = require('path');
const express = require('express');
const objects = require('./data/objects.json');
const { calculate } = require('./lib/calc');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.get('/calc.js', (req, res) => res.sendFile(path.join(__dirname, 'lib', 'calc.js')));

app.get('/api/objects', (req, res) => res.json(objects));

// Същото изчисление и от сървъра, за проверка или за други програми
app.post('/api/calculate', (req, res) => res.json(calculate(objects, req.body || {})));

app.get('/health', (req, res) => res.json({ ok: true }));

app.listen(PORT, () => console.log(`Гранд: http://localhost:${PORT}`));
