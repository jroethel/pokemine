const sharp = require('sharp');

// Trim the white padding Gemini/bridge images arrive with, then re-add a small
// uniform margin. Pure pixel analysis, no LLM. Never throws: any failure (blank
// mock pixels, exotic formats) returns the original art untouched.
const MARGIN_FRAC = 0.05;   // margin re-added on all sides, as a fraction of the short side
const MAX_DIM = 1024;       // cap the long side (bridge canvas re-encodes can be huge)
const TRIM_THRESHOLD = 25;  // distance from pure white that still counts as background (JPEG noise)

async function autocrop(art) {
  try {
    if (!art?.data || art.data.length < 500) return art; // mock/placeholder pixels
    const trimmed = await sharp(art.data)
      .trim({ background: '#ffffff', threshold: TRIM_THRESHOLD })
      .toBuffer({ resolveWithObject: true });
    const { width, height } = trimmed.info;
    if (!width || !height) return art;
    const margin = Math.round(Math.min(width, height) * MARGIN_FRAC);
    let img = sharp(trimmed.data).extend({
      top: margin, bottom: margin, left: margin, right: margin,
      background: '#ffffff',
    });
    if (Math.max(width, height) + 2 * margin > MAX_DIM) {
      img = img.resize({ width: MAX_DIM, height: MAX_DIM, fit: 'inside' });
    }
    const jpeg = art.mime === 'image/jpeg' || art.mime === 'image/jpg';
    const data = await (jpeg ? img.jpeg({ quality: 92 }) : img.png()).toBuffer();
    return { data, mime: jpeg ? 'image/jpeg' : 'image/png' };
  } catch {
    return art;
  }
}

module.exports = { autocrop };
