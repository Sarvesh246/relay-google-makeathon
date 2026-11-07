// Club memory: loading, validating and ranking the docs the Playbook answers from.
//
// A "doc" is { title, category, event, year, author, text }. Seed docs ship in
// knowledge/seed.json; docs imported at handoff arrive with each chat request
// (see api/chat.mjs) and are merged in here. Ranking is BM25 over a small
// corpus: fast, dependency-free, and easy to reason about when an answer cites
// the wrong doc.
// A static JSON import (not a runtime readFile) so Vercel's bundler traces the seed into the function.
import seedJson from '../knowledge/seed.json' with { type: 'json' };

export const CATEGORIES = ['rules', 'event', 'lessons', 'contacts', 'finance', 'handoff', 'guide'];
export const LIMITS = { titleLen: 120, fieldLen: 80, textLen: 6000, importedDocs: 30, importedChars: 60000 };

let seedCache = null;
export function loadSeed() {
  if (!seedCache) {
    seedCache = seedJson.map((d) => ({ ...normalizeDoc(d), source: 'seed' }));
  }
  return seedCache;
}

/** Clamp and sanitize a doc from an untrusted source. Returns null if unusable. */
export function normalizeDoc(d) {
  if (!d || typeof d !== 'object') return null;
  const str = (v, max) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
  const title = str(d.title, LIMITS.titleLen);
  const text = typeof d.text === 'string' ? d.text.replace(/\r\n/g, '\n').trim().slice(0, LIMITS.textLen) : '';
  if (!title || !text) return null;
  const category = CATEGORIES.includes(d.category) ? d.category : 'guide';
  let event = str(d.event, LIMITS.fieldLen);
  let year = str(d.year, 12);
  // Officers often skip the Event box. For recaps and lessons, the title ("Hackathon 2025 lessons") says it anyway.
  if (!event && (category === 'event' || category === 'lessons')) event = inferEvent(title);
  if (!year) year = /\b(?:19|20)\d\d\b/.exec(title)?.[0] || '';
  return { title, category, event, year, author: str(d.author, LIMITS.fieldLen), text };
}

const TITLE_NOISE = /\b(?:(?:19|20)\d\d|recap|lessons?|learned|notes?|minutes|post-?mortem|retro(?:spective)?|summary|what worked|didn'?t|did not|handoff)\b/gi;
export function inferEvent(title) {
  const e = title.replace(TITLE_NOISE, ' ').replace(/[^\w&' -]+/g, ' ').replace(/\s+/g, ' ').trim();
  return e.length >= 3 ? e.slice(0, LIMITS.fieldLen) : '';
}

/** Merge seed docs with imported ones; an imported doc with the same title replaces the seed. */
export function mergeDocs(imported) {
  const byTitle = new Map(loadSeed().map((d) => [d.title.toLowerCase(), d]));
  let chars = 0;
  for (const raw of (Array.isArray(imported) ? imported : []).slice(0, LIMITS.importedDocs)) {
    const doc = normalizeDoc(raw);
    if (!doc) continue;
    chars += doc.text.length;
    if (chars > LIMITS.importedChars) break;
    byTitle.set(doc.title.toLowerCase(), { ...doc, source: 'imported' });
  }
  return [...byTitle.values()];
}

const STOP = new Set('a an and are as at be by can do does did for from had has have how i if in is it its of on or our should that the their them then there these they this to us was we were what when where which who why will with would you your about get got make made need'.split(' '));

export function tokenize(s) {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9$]+/g, ' ')
    .split(' ')
    .filter((t) => t && !STOP.has(t))
    .map(stem);
}

function stem(t) {
  if (t.length > 5 && t.endsWith('ing')) return t.slice(0, -3);
  if (t.length > 4 && t.endsWith('ed')) return t.slice(0, -2);
  if (t.length > 3 && t.endsWith('es')) return t.slice(0, -2);
  if (t.length > 3 && t.endsWith('s')) return t.slice(0, -1);
  return t;
}

// Officers say "catering", docs say "food" or "Vendor Contacts". Tiny club-specific synonym map (stemmed forms).
const SYNONYMS = {
  cater: ['food', 'vendor', 'order'],
  food: ['cater', 'vendor'],
  pizza: ['food', 'cater'],
  vendor: ['contact', 'cater', 'food'],
  room: ['book', 'reserv', 'venue', 'rec'],
  book: ['room', 'reserv', 'venue'],
  venue: ['room', 'book', 'hilton'],
  fund: ['sponsor', 'budget', 'money'],
  money: ['budget', 'spend', 'sponsor', 'dues'],
  cost: ['budget', 'spend', 'actual'],
  spend: ['budget', 'cost', 'actual'],
  expense: ['budget', 'spend', 'receipt'],
  eligible: ['eligib', 'dues', 'attendance'],
  officer: ['eligib', 'handoff', 'exit'],
  instagram: ['post', 'social'],
  caption: ['post', 'social'],
  promo: ['post', 'social'],
};

function expand(tokens) {
  const out = new Set(tokens);
  for (const t of tokens) for (const s of SYNONYMS[t] || []) out.add(stem(s));
  return [...out];
}

/** Rank docs for a question. Title/event matches count 3x so "Rumble" finds the Rumble recap first. */
export function rank(question, docs, k = 6) {
  const q = expand([...new Set(tokenize(question))]);
  if (!q.length) return [];
  const indexed = docs.map((doc) => {
    const body = tokenize(doc.text);
    const head = tokenize(`${doc.title} ${doc.event} ${doc.category} ${doc.year}`);
    const tf = new Map();
    for (const t of body) tf.set(t, (tf.get(t) || 0) + 1);
    for (const t of head) tf.set(t, (tf.get(t) || 0) + 3);
    return { doc, tf, len: body.length + head.length * 3 };
  });
  const avg = indexed.reduce((a, x) => a + x.len, 0) / (indexed.length || 1);
  const df = new Map();
  for (const { tf } of indexed) for (const t of q) if (tf.has(t)) df.set(t, (df.get(t) || 0) + 1);
  const N = indexed.length;
  const k1 = 1.4;
  const b = 0.75;
  return indexed
    .map(({ doc, tf, len }) => {
      let score = 0;
      for (const t of q) {
        const f = tf.get(t) || 0;
        if (!f) continue;
        const idf = Math.log(1 + (N - (df.get(t) || 0) + 0.5) / ((df.get(t) || 0) + 0.5));
        score += (idf * f * (k1 + 1)) / (f + k1 * (1 - b + (b * len) / avg));
      }
      return { doc, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b2) => b2.score - a.score)
    .slice(0, k)
    .map((x) => x.doc);
}

/** Which known events does the question mention? Used to tell "done before" from "new". */
export function matchEvents(question, docs) {
  const q = new Set(tokenize(question));
  const events = new Map();
  for (const d of docs) {
    if (!d.event) continue;
    const e = events.get(d.event) || { name: d.event, years: new Set() };
    if (d.year) e.years.add(d.year);
    events.set(d.event, e);
  }
  const hits = [];
  for (const e of events.values()) {
    const distinct = tokenize(e.name).filter((t) => t.length >= 5);
    if (distinct.some((t) => q.has(t))) hits.push({ name: e.name, years: [...e.years].sort() });
  }
  return hits;
}

/** Pick the docs sent to the model: top matches, plus the rules docs when the question smells like a policy one. */
export function selectContext(question, docs, k = 6) {
  const picked = rank(question, docs, k);
  const policy = /\b(rule|policy|allowed|allow|require|deadline|approve|approval|sign|permission|eligib|book|reserve|reservation|advisor|adviser)\w*/i.test(question);
  if (policy) {
    for (const d of docs) {
      if (d.category === 'rules' && !picked.includes(d)) picked.push(d);
    }
  }
  if (!picked.length) {
    // Nothing matched: send the general guides so the model can still reason about how the club works.
    picked.push(...docs.filter((d) => d.category === 'guide' || d.category === 'handoff').slice(0, 3));
  }
  return picked.slice(0, k + 3);
}
