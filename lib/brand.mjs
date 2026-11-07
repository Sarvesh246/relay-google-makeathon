// Brand kit + guardrails for AI-assisted marketing posts.
//
// The point of this file: the model proposes words, the CODE decides everything
// else. Layout, fonts, colors and motifs are fixed (see poster.js), copy is
// clamped and fact-checked against what the officer actually typed, and any
// AI artwork has to be abstract graphics that pass an automated inspection.
// Prompts alone are not trusted to keep posts consistent or honest.

export const TEMPLATES = ['event', 'announce'];
export const MOTIFS = ['tracks', 'gears', 'circuit', 'grid', 'bolts', 'arrows'];
export const ACCENTS = { vermilion: '#FF5A1F', periwinkle: '#8293E7' };
export const PALETTE = { ink: '#16161D', cream: '#F2EFE7' };
export const LIMITS = { prompt: 600, headline: 28, subhead: 70, date: 24, time: 16, place: 40, cta: 32, caption: 240, hashtags: 3 };
export const EXTRA_HASHTAGS = ['#TAMU', '#Robotics', '#STEM', '#Engineering'];
export const BRAND_TAG = '#AggieRobotics';

const MOTIF_ART = {
  tracks: 'parallel running-track lane lines with two or three skewed baton shapes',
  gears: 'a few interlocking gear outlines of different sizes',
  circuit: 'orthogonal circuit-board traces ending in round nodes',
  grid: 'a regular dot grid with a handful of highlighted squares',
  bolts: 'hexagonal nuts and bolts drawn as flat outline icons',
  arrows: 'bold right-pointing chevrons in a repeating row',
};

/** Prompt for Nano Banana. Built only from enums: nothing the officer typed reaches the image model. */
export function artPrompt(motif, accent) {
  const m = MOTIFS.includes(motif) ? motif : 'tracks';
  const a = ACCENTS[accent] ? accent : 'vermilion';
  return [
    'Flat vector-style geometric graphic used as a poster background for a university robotics club.',
    `Subject: ${MOTIF_ART[m]}.`,
    'Style: minimal, bold flat shapes and thin lines, flat colors only, 2D. Not a photograph, not photorealistic, not a 3D render.',
    `Palette strictly limited to deep ink ${PALETTE.ink}, accent ${ACCENTS[a]}, and warm cream ${PALETTE.cream}.`,
    'Composition: artwork concentrated in the upper right, with a large calm empty dark area on the left and bottom reserved for text.',
    'Strictly forbidden: people, faces, hands, animals, any text, letters, numbers, logos, watermarks, and any depiction of a real event, place or real robot.',
  ].join(' ');
}

export const ART_CHECK_QUESTION =
  'You are a strict brand-safety inspector. Look at this image, intended as an abstract flat-graphic poster background. ' +
  'Set pass=false if it contains ANY of: a person, face, hand, animal; a photograph or photorealistic scene or object; ' +
  'a realistic rendering of a robot, building or event; any legible text, letters, numbers, logo or watermark. ' +
  'Abstract geometric shapes, lines, gears and patterns are fine. List every violation you see in "violations".';

export const ART_CHECK_SCHEMA = {
  type: 'OBJECT',
  properties: { pass: { type: 'BOOLEAN' }, violations: { type: 'ARRAY', items: { type: 'STRING' } } },
  required: ['pass', 'violations'],
};

// ---- copy cleaning ------------------------------------------------------------

const EMOJI = /[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu;

export function clean(value, max) {
  if (typeof value !== 'string') return '';
  const s = value.replace(EMOJI, '').replace(/https?:\/\/\S+/gi, '').replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  return cut.slice(0, Math.max(cut.lastIndexOf(' '), Math.floor(max * 0.6))).replace(/[,;:\-–—\s]+$/, '');
}

// ---- fact guardrail -----------------------------------------------------------
// Dates, times, prices and numbers may only appear if the officer typed them.

const FACT = /\$?\d[\d,.:]*\s?(?:am|pm|a\.m\.|p\.m\.)?|\b(?:mon|tues?|wed(?:nes)?|thu(?:rs)?|fri|sat(?:ur)?|sun)(?:day)?\b|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?/gi;
const norm = (s) => s.toLowerCase().replace(/(?<=\d)(st|nd|rd|th)\b/g, '').replace(/:00/g, '').replace(/[^a-z0-9$:]/g, '');

export function factTokens(text) {
  return (String(text).match(FACT) || []).map(norm).filter(Boolean);
}

/** Fact tokens in `text` that the officer's prompt does not contain. */
export function unsupportedFacts(text, prompt) {
  const p = norm(prompt);
  return factTokens(text).filter((t) => {
    if (p.includes(t)) return false;
    // "6pm" typed as "6 PM" is covered by norm(); "6" alone is fine if "6pm"/"6:00" was typed.
    return !(/^\d+$/.test(t) && new RegExp(`(^|[^0-9])${t}(?!\\d)`).test(prompt));
  });
}

// Pull date/time/place straight out of the officer's own words. Used to correct the model when it
// gets a detail wrong: the officer's version is by definition a provided fact.
const DATE = /\b(?:(?:mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)[a-z]*\.?,?\s+)?(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?\b/i;
const TIME = /\b\d{1,2}(?::\d{2})?\s?(?:am|pm)\b/i;
const PLACE = /\b(?:at|in)\s+(?:the\s+)?((?:[A-Z][\w'’-]*|\d+)(?:\s+(?:[A-Z][\w'’-]*|\d+)){0,3})/;

export function extractFacts(prompt) {
  return {
    date: (DATE.exec(prompt) || [''])[0].replace(/,/g, '').toUpperCase(),
    time: (TIME.exec(prompt) || [''])[0].replace(/\s/g, '').toUpperCase(),
    place: (PLACE.exec(prompt) || ['', ''])[1].toUpperCase(),
  };
}

function dropUnsupportedSentences(text, prompt) {
  const parts = text.match(/[^.!?]+[.!?]*/g) || [text];
  const kept = parts.filter((s) => unsupportedFacts(s, prompt).length === 0);
  return { text: kept.join('').trim(), dropped: kept.length !== parts.length };
}

function placeSupported(place, prompt) {
  return place.toLowerCase().split(/\s+/).filter((w) => w.length > 2).every((w) => prompt.toLowerCase().includes(w));
}

/**
 * Turn whatever the model returned into a spec the renderer can trust.
 * Returns { spec, flags } where flags are human-readable notes for the officer.
 */
export function validateSpec(raw, prompt) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const flags = [];
  const template = TEMPLATES.includes(r.template) ? r.template : 'announce';
  const motif = MOTIFS.includes(r.motif) ? r.motif : 'tracks';
  const accent = Object.hasOwn(ACCENTS, r.accent) ? r.accent : 'vermilion';

  let headline = clean(r.headline, 80).toUpperCase();
  if (headline.length > LIMITS.headline) {
    headline = clean(headline, LIMITS.headline);
    flags.push('Headline was shortened to fit the template.');
  }
  if (!headline) {
    headline = clean(prompt, LIMITS.headline).toUpperCase();
    flags.push('No headline came back, so one was taken from your prompt.');
  }

  const typed = extractFacts(prompt);
  const field = (name, max) => {
    let v = clean(r[name], max);
    if (v && unsupportedFacts(v, prompt).length) {
      // Prefer what the officer actually typed over silently dropping the field.
      if ((name === 'date' || name === 'time') && typed[name]) {
        flags.push(`Corrected the ${name} to match your prompt (${typed[name]}).`);
        return typed[name];
      }
      flags.push(`Removed the ${name}: it had details you did not provide.`);
      v = '';
    }
    return v;
  };
  const subhead = field('subhead', LIMITS.subhead);
  const cta = field('cta', LIMITS.cta).toUpperCase();
  const date = field('date', LIMITS.date).toUpperCase();
  const time = field('time', LIMITS.time).toUpperCase();
  let place = clean(r.place, LIMITS.place);
  if (place && !placeSupported(place, prompt)) {
    flags.push('Removed the place: it was not in your prompt.');
    place = '';
  }
  place = place.toUpperCase();

  let caption = clean(r.caption, LIMITS.caption + 200);
  const cut = dropUnsupportedSentences(caption, prompt);
  if (cut.dropped) flags.push('Removed caption lines that stated dates, times or prices you did not provide.');
  caption = clean(cut.text, LIMITS.caption);
  if (!caption) caption = clean(prompt, LIMITS.caption);

  const tags = [BRAND_TAG, ...(Array.isArray(r.hashtags) ? r.hashtags : []).filter((t) => EXTRA_HASHTAGS.includes(t))];
  const hashtags = [...new Set(tags)].slice(0, LIMITS.hashtags);

  const missing = [];
  if (template === 'event') {
    if (!date) missing.push('date');
    if (!time) missing.push('time');
    if (!place) missing.push('place');
  }
  if (missing.length) flags.push(`Not included: ${missing.join(', ')}. Add ${missing.length > 1 ? 'them' : 'it'} to your prompt and Relay will place ${missing.length > 1 ? 'them' : 'it'} for you. It will not guess.`);

  return { spec: { template, headline, subhead, date, time, place, cta, caption, hashtags, motif, accent }, flags };
}
