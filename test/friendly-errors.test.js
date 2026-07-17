const test = require('node:test');
const assert = require('node:assert');
const { friendlyError } = require('../public/friendly-errors');

test('art-failed -> Caught it... almost!', () => {
  assert.match(friendlyError('art-failed').title, /almost/);
});
test('timeout -> It got away!', () => {
  assert.match(friendlyError('bridge: timed out after 5 minutes').title, /got away/);
});
test('overloaded -> The lab is busy', () => {
  assert.match(friendlyError('gemini text: 503 overloaded').title, /lab is busy/);
});
test('high demand -> The lab is busy (real Gemini message, caught in E2E 2026-07-16)', () => {
  assert.match(friendlyError(
    'gemini text: This model is currently experiencing high demand. Please try again later.').title,
    /lab is busy/);
});
test('bridge-offline -> Helper not connected', () => {
  assert.match(friendlyError('bridge-offline').title, /not connected/i);
});
test('quota -> Out of pokeballs', () => {
  assert.match(friendlyError('PERMISSION_DENIED: quota exceeded').title, /pokeballs/i);
});
test('unknown -> generic fallback', () => {
  assert.match(friendlyError('something unprecedented').title, /weird/);
});
