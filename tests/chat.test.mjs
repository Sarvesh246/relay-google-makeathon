import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { POST } from '../api/chat.mjs';
import { loadSeed, matchEvents, mergeDocs, normalizeDoc, rank, selectContext } from '../lib/knowledge.mjs';

const seed = loadSeed();
const titles = (docs) => docs.map((d) => d.title);

describe('retrieval', () => {
  it('finds the Rumble recap first for a Rumble question', () => {
    assert.equal(rank('What went wrong at Robo-Rumble last year?', seed)[0].title, 'Robo-Rumble Recap');
  });
  it('finds the caterer contact for a catering question', () => {
    assert.ok(titles(rank('Who do we call for catering?', seed, 3)).includes('Vendor Contacts'));
  });
  it('adds rules docs for policy-shaped questions', () => {
    assert.ok(titles(selectContext('Do we need approval to book the Rec Center?', seed)).includes('Student Activities Room Rules (SAMPLE)'));
  });
  it('detects an event the club has run before, and one it has not', () => {
    assert.equal(matchEvents('How should we plan the Rumble this year?', seed)[0].name, 'Robo-Rumble');
    assert.deepEqual(matchEvents('Can we host a hackathon?', seed), []);
  });
  it('lets imported docs override seed docs and drops junk', () => {
    const merged = mergeDocs([{ title: 'constitution', text: 'new text' }, { title: '', text: 'x' }, null, 'nope']);
    assert.equal(merged.length, seed.length);
    assert.equal(merged.find((d) => d.title === 'constitution').text, 'new text');
  });
  it('infers the event and year from the title when the officer leaves them blank', () => {
    const d = normalizeDoc({ title: 'Hackathon 2025 lessons', category: 'lessons', text: 'order double pizza' });
    assert.equal(d.event, 'Hackathon');
    assert.equal(d.year, '2025');
    assert.equal(matchEvents('can we run a hackathon again?', [d])[0].name, 'Hackathon');
    assert.equal(normalizeDoc({ title: 'Funds rules', category: 'rules', text: 'x' }).event, '');
  });
  it('clamps oversize imported text', () => {
    assert.equal(normalizeDoc({ title: 't', text: 'a'.repeat(99999) }).text.length, 6000);
  });
});

describe('POST /api/chat', () => {
  const realFetch = globalThis.fetch;
  let calls;
  beforeEach(() => {
    calls = [];
    process.env.GEMINI_API_KEY = 'AQ.test-key';
    globalThis.fetch = async (url, init) => {
      calls.push({ url, init, body: JSON.parse(init.body) });
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ answer: 'File 14+ days out.', precedent: 'FOUND', sources: ['Robo-Rumble Recap', 'Not In Context'], followups: ['a', 'b', 'c'] }) }] } }] }), { status: 200 });
    };
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    delete process.env.GEMINI_API_KEY;
  });
  const post = (body) => POST(new Request('http://x/api/chat', { method: 'POST', body: JSON.stringify(body) }));

  it('503s without a key and never calls out', async () => {
    delete process.env.GEMINI_API_KEY;
    assert.equal((await post({ question: 'hi' })).status, 503);
    assert.equal(calls.length, 0);
  });
  it('400s on an empty question', async () => {
    assert.equal((await post({ question: '   ' })).status, 400);
  });
  it('sends the key as a header (never in the URL) and grounds the prompt in retrieved docs', async () => {
    const res = await post({ question: 'What went wrong at Robo-Rumble last year?', screen: 'Events' });
    const out = await res.json();
    assert.equal(res.status, 200);
    assert.equal(calls[0].init.headers['x-goog-api-key'], 'AQ.test-key');
    assert.ok(!calls[0].url.includes('AQ.test-key'));
    assert.ok(calls[0].url.startsWith('https://aiplatform.googleapis.com/'));
    const prompt = calls[0].body.contents.at(-1).parts[0].text;
    assert.match(prompt, /Robo-Rumble Recap/);
    assert.match(prompt, /the club HAS run Robo-Rumble/);
    assert.deepEqual(out.sources, ['Robo-Rumble Recap']); // hallucinated citation filtered out
    assert.equal(out.followups.length, 2);
  });
  it('passes imported handoff docs into the model context', async () => {
    await post({ question: 'How do we run the hackathon?', docs: [{ title: 'Hackathon Lessons', category: 'lessons', event: 'Hackathon', year: '2025', text: 'Pizza ran out at midnight; order double.' }] });
    assert.match(calls[0].body.contents.at(-1).parts[0].text, /Pizza ran out at midnight/);
    assert.match(calls[0].body.contents.at(-1).parts[0].text, /the club HAS run Hackathon/);
  });
  it('starts history on a user turn', async () => {
    await post({ question: 'and food?', history: [{ r: 'a', text: 'Welcome' }, { r: 'u', text: 'q1' }, { r: 'a', text: 'a1' }] });
    assert.equal(calls[0].body.contents[0].role, 'user');
  });
  it('falls back to the other endpoint when the first rejects the key', async () => {
    let n = 0;
    globalThis.fetch = async (url) => {
      n++;
      if (url.includes('aiplatform')) return new Response('{}', { status: 403 });
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"answer":"ok","precedent":"NONE","sources":[]}' }] } }] }), { status: 200 });
    };
    const res = await post({ question: 'anything about gala' });
    assert.equal(res.status, 200);
    assert.equal(n, 2);
  });
  it('maps upstream failure to 502 without leaking details', async () => {
    globalThis.fetch = async () => new Response('secret detail', { status: 500 });
    const res = await post({ question: 'gala?' });
    assert.equal(res.status, 502);
    assert.ok(!(await res.text()).includes('secret'));
  });
});
