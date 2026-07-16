// Pure kid-friendly error mapper. No DOM references, so it is unit-testable in node.
// Order matters: art-failed before timeout (a successful-but-imageless card is friendlier than "got away").
const RULES = [
  { match: /art-failed/i, title: 'Caught it... almost!',
    body: "We got the card, but the picture got away. Tap Redraw to try the picture again." },
  { match: /timed out|no image appeared/i, title: 'It got away!',
    body: "That Pokemon took too long to show up. Let's try again!" },
  { match: /overloaded|429|503|rate limit/i, title: 'The lab is busy',
    body: "Professor Oak's computers are swamped. Wait a sec and try again." },
  { match: /bridge-offline|driver offline|driver not connected/i, title: 'Helper not connected',
    body: 'Ask a grown-up to open gemini.google.com in Brave with the Bridge extension.' },
  { match: /quota|permission_denied|billing/i, title: 'Out of pokeballs',
    body: "We've made a lot today! Try again tomorrow or ask a grown-up." },
];

function friendlyError(msg) {
  const hit = RULES.find(r => r.match.test(String(msg || '')));
  return hit || { title: "Hmm, that's weird", body: 'Something goofed. Try again!' };
}

if (typeof module !== 'undefined') module.exports = { friendlyError, RULES };
if (typeof window !== 'undefined') window.friendlyError = friendlyError;
