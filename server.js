const express = require('express');
const path = require('path');

const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/config', (req, res) => {
  res.json({ providers: [], default: process.env.DEFAULT_IMAGE_PROVIDER || 'gemini' });
});

if (require.main === module) {
  app.listen(PORT, '0.0.0.0', () => console.log(`Pokemine on http://localhost:${PORT}`));
}

module.exports = app;
