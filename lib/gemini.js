// Gemini generateContent response envelope. Both the text and image providers hit
// the same shape - candidates[0].content.parts[] - so the navigation lives here once.

function geminiParts(body) {
  return body.candidates?.[0]?.content?.parts || [];
}

function geminiText(body) {
  return geminiParts(body).map(p => p.text || '').join('');
}

module.exports = { geminiParts, geminiText };
