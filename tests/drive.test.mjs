import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';
import { GET as config } from '../api/config.mjs';
import { mergeDocs } from '../lib/knowledge.mjs';

const D = createRequire(import.meta.url)('../drive.js');
const FOLDER = '1AbCdEfGhIjKlMnOpQrStUvWxYz';

describe('parseFolderId', () => {
  it('reads every common Drive link shape and a bare id', () => {
    for (const input of [
      `https://drive.google.com/drive/folders/${FOLDER}`,
      `https://drive.google.com/drive/folders/${FOLDER}?usp=sharing`,
      `https://drive.google.com/drive/u/1/folders/${FOLDER}`,
      `https://drive.google.com/open?id=${FOLDER}`,
      `  ${FOLDER}  `,
    ]) assert.equal(D.parseFolderId(input), FOLDER, input);
  });
  it('rejects things that are not folders', () => {
    for (const input of ['', null, 'hello world', 'https://example.com', 'abc']) assert.equal(D.parseFolderId(input), '', String(input));
  });
});

describe('categorize', () => {
  it('maps file names onto Playbook categories', () => {
    assert.equal(D.categorize('TAMU Student Org Rules', 'x'), 'rules');
    assert.equal(D.categorize('Treasurer Handoff 2025', 'x'), 'handoff');
    assert.equal(D.categorize('Vendor Contacts', 'x'), 'contacts');
    assert.equal(D.categorize('Hackathon lessons learned', 'x'), 'lessons');
    assert.equal(D.categorize('Spring Gala Recap', 'x'), 'event');
    assert.equal(D.categorize('FY25 Budget', 'x'), 'finance');
    assert.equal(D.categorize('Whatever', 'application/vnd.google-apps.spreadsheet'), 'finance');
    assert.equal(D.categorize('Officer notes', 'x'), 'guide');
  });
});

// A tiny fake Drive: folders by id, files by id, with the same URL shapes the real API uses.
function fakeDrive(tree, files, { failOn = [] } = {}) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, auth: init?.headers?.Authorization });
    const u = new URL(url);
    const id = decodeURIComponent(u.pathname.split('/files/')[1]?.split('/')[0] || '');
    if (failOn.some((f) => url.includes(f))) return new Response('no', { status: 403 });
    if (u.pathname.endsWith('/files')) {
      const parent = /'([^']+)' in parents/.exec(u.searchParams.get('q'))[1];
      const all = tree[parent] || [];
      const page = Number((u.searchParams.get('pageToken') || 'p0').slice(1));
      const slice = all.slice(page * 2, page * 2 + 2);
      const next = (page + 1) * 2 < all.length ? 'p' + (page + 1) : undefined;
      return Response.json({ files: slice.map((id2) => files[id2]), nextPageToken: next });
    }
    if (u.pathname.endsWith('/export')) return new Response(files[id].body, { status: 200 });
    if (u.searchParams.get('alt') === 'media') return new Response(files[id].body, { status: 200 });
    return Response.json(files[id]);
  };
  return { fetch, calls };
}

describe('sync', () => {
  const files = {
    [FOLDER]: { id: FOLDER, name: 'Aggie Robotics Docs', mimeType: 'application/vnd.google-apps.folder' },
    sub: { id: 'sub', name: 'Old years', mimeType: 'application/vnd.google-apps.folder' },
    a: { id: 'a', name: 'Spring Gala Recap', mimeType: 'application/vnd.google-apps.document', modifiedTime: '2025-04-30T10:00:00Z', owners: [{ displayName: 'Priya Nair' }], body: 'Gala cost $4,520.\r\n\r\n\r\n\r\nSponsor started late.' },
    b: { id: 'b', name: 'Budget FY26', mimeType: 'application/vnd.google-apps.spreadsheet', modifiedTime: '2026-01-02T00:00:00Z', body: 'item,cost\nfood,500' },
    c: { id: 'c', name: 'notes.md', mimeType: 'text/markdown', modifiedTime: '2026-02-02T00:00:00Z', body: 'Plain notes' },
    d: { id: 'd', name: 'Photo.jpg', mimeType: 'image/jpeg' },
    e: { id: 'e', name: 'Big doc', mimeType: 'application/vnd.google-apps.document', body: 'x'.repeat(20000) },
    f: { id: 'f', name: 'Deep file', mimeType: 'application/vnd.google-apps.document', body: 'from a subfolder' },
  };
  const tree = { [FOLDER]: ['a', 'b', 'c', 'd', 'e', 'sub'], sub: ['f'] };

  it('reads docs, sheets and markdown, follows subfolders and pagination, and skips what it cannot read', async () => {
    const { fetch, calls } = fakeDrive(tree, files);
    const out = await D.sync('tok', FOLDER, { fetch });
    assert.deepEqual(out.docs.map((d) => d.title).sort(), ['Big doc', 'Budget FY26', 'Deep file', 'Spring Gala Recap', 'notes']);
    assert.deepEqual(out.skipped, ['Photo.jpg']);
    assert.equal(out.total, 6);
    assert.ok(calls.every((c) => c.auth === 'Bearer tok'), 'every call is authorised with the officer token');
    assert.ok(calls.some((c) => c.url.includes('nextPageToken') || c.url.includes('pageToken')), 'followed pagination');
  });

  it('shapes docs the way the Playbook expects', async () => {
    const { fetch } = fakeDrive(tree, files);
    const { docs } = await D.sync('tok', FOLDER, { fetch });
    const gala = docs.find((d) => d.title === 'Spring Gala Recap');
    assert.equal(gala.category, 'event');
    assert.equal(gala.year, '2025');
    assert.equal(gala.author, 'Priya Nair');
    assert.equal(gala.source, 'drive');
    assert.equal(gala.driveId, 'a');
    assert.ok(!/\r/.test(gala.text) && !/\n{3}/.test(gala.text), 'whitespace is tidied');
    assert.equal(docs.find((d) => d.title === 'Big doc').text.length, D.LIMITS.textLen);
    assert.equal(docs.find((d) => d.title === 'Budget FY26').category, 'finance');
  });

  it('uses the right export for each Google type', async () => {
    const { fetch, calls } = fakeDrive(tree, files);
    await D.sync('tok', FOLDER, { fetch });
    assert.ok(calls.some((c) => c.url.includes('/files/a/export') && c.url.includes('text%2Fplain')));
    assert.ok(calls.some((c) => c.url.includes('/files/b/export') && c.url.includes('text%2Fcsv')));
    assert.ok(calls.some((c) => c.url.includes('/files/c?alt=media')));
  });

  it('skips a file that fails to read but keeps going; stops entirely on an expired sign-in', async () => {
    const one = fakeDrive(tree, files, { failOn: ['/files/b/export'] });
    const out = await D.sync('tok', FOLDER, { fetch: one.fetch });
    assert.ok(out.skipped.includes('Budget FY26') && out.docs.length === 4);
    const expired = async (url) => (url.includes('/export') ? new Response('', { status: 401 }) : fakeDrive(tree, files).fetch(url, {}));
    await assert.rejects(D.sync('tok', FOLDER, { fetch: expired }), (e) => e.status === 401);
  });

  it('caps how many files it will read', async () => {
    const many = {};
    const kids = [];
    for (let i = 0; i < 90; i++) { many['f' + i] = { id: 'f' + i, name: 'Doc ' + i, mimeType: 'text/plain', body: 'x' }; kids.push('f' + i); }
    const { fetch } = fakeDrive({ [FOLDER]: kids }, many);
    const out = await D.sync('tok', FOLDER, { fetch });
    assert.equal(out.total, D.LIMITS.files);
  });

  it('refuses a link that is a file, and explains errors in plain words', async () => {
    const { fetch } = fakeDrive({}, { x: { id: 'x', name: 'A doc', mimeType: 'application/vnd.google-apps.document' } });
    await assert.rejects(D.folderName('tok', 'x', fetch), /file, not a folder/);
    assert.match(D.explain({ status: 404 }), /shared with you/);
    assert.match(D.explain({ status: 401 }), /Connect again/);
    assert.match(D.explain({ status: 403 }), /Drive API/);
  });

  it('feeds the Playbook: Drive docs override the sample docs of the same title', async () => {
    const { fetch } = fakeDrive(tree, { ...files, a: { ...files.a, name: 'Constitution', body: 'Real constitution text' } });
    const { docs } = await D.sync('tok', FOLDER, { fetch });
    const merged = mergeDocs(docs);
    assert.equal(merged.find((d) => d.title === 'Constitution').text, 'Real constitution text');
  });
});

describe('GET /api/config', () => {
  it('exposes only public settings, never a secret', async () => {
    process.env.GOOGLE_CLIENT_ID = '123.apps.googleusercontent.com';
    process.env.GOOGLE_ALLOWED_DOMAIN = 'TAMU.edu';
    process.env.GOOGLE_CLIENT_SECRET = 'should-never-appear';
    const body = await config().json();
    assert.deepEqual(Object.keys(body).sort(), ['allowedDomain', 'driveFolderId', 'googleClientId']);
    assert.equal(body.allowedDomain, 'tamu.edu');
    assert.ok(!JSON.stringify(body).includes('should-never-appear'));
    delete process.env.GOOGLE_CLIENT_ID; delete process.env.GOOGLE_ALLOWED_DOMAIN; delete process.env.GOOGLE_CLIENT_SECRET;
  });
});
