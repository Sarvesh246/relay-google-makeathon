/* Relay <-> Google Drive.
 *
 * How it connects: an officer signs in with their organization Google account
 * (Google Identity Services, scope drive.readonly) and points Relay at ONE
 * folder. Relay then reads that folder (and its subfolders) straight from the
 * browser with the officer's own access token and turns the documents into
 * Playbook memory. There is no server-side copy of the token and no client
 * secret: Relay can only see what the signed-in officer can see, and nothing is
 * readable by a visitor who isn't signed in.
 *
 * Works in the browser (window.RelayDrive) and in Node tests (module.exports),
 * where `fetch` is injectable.
 */
(function (root) {
  'use strict';

  var API = 'https://www.googleapis.com/drive/v3';
  var SCOPE = 'https://www.googleapis.com/auth/drive.readonly openid email';
  var LIMITS = { files: 40, depth: 2, textLen: 6000, pageSize: 100 };
  var FOLDER = 'application/vnd.google-apps.folder';
  var EXPORT = {
    'application/vnd.google-apps.document': 'text/plain',
    'application/vnd.google-apps.presentation': 'text/plain',
    'application/vnd.google-apps.spreadsheet': 'text/csv',
  };
  var PLAIN = /^(text\/(plain|markdown|csv)|application\/json)$/;

  /** Accepts a Drive folder URL (any of the common shapes) or a bare folder ID. */
  function parseFolderId(input) {
    var s = String(input || '').trim();
    if (!s) return '';
    var m = /\/folders\/([A-Za-z0-9_-]{10,})/.exec(s) || /[?&]id=([A-Za-z0-9_-]{10,})/.exec(s);
    if (m) return m[1];
    return /^[A-Za-z0-9_-]{10,}$/.test(s) ? s : '';
  }

  /** Best-guess Playbook category from the file name and type. */
  function categorize(name, mime) {
    var n = String(name || '');
    if (/handoff|hand-off|transition|exit interview|passdown/i.test(n)) return 'handoff';
    if (/rule|polic|constitution|bylaw|guideline|requirement|regulation/i.test(n)) return 'rules';
    if (/contact|vendor|directory|roster/i.test(n)) return 'contacts';
    if (/lesson|learned|what worked|retro|post-?mortem|takeaway/i.test(n)) return 'lessons';
    if (/recap|minutes|event|summary|report/i.test(n)) return 'event';
    if (/budget|financ|treasur|expense|invoice|dues/i.test(n) || mime === 'application/vnd.google-apps.spreadsheet') return 'finance';
    return 'guide';
  }

  function authHeaders(token) { return { Authorization: 'Bearer ' + token }; }

  function check(res, what) {
    if (res.ok) return res;
    var e = new Error(what + ' failed (' + res.status + ')');
    e.status = res.status;
    throw e;
  }

  /** Human message for a failed Drive call, aimed at an officer rather than a developer. */
  function explain(err) {
    var s = err && err.status;
    if (s === 401) return 'Google sign-in expired. Connect again.';
    if (s === 404) return "Can't open that folder with this account. Check the link and that it's shared with you.";
    if (s === 403) return 'Google Drive refused access. Check the Drive API is enabled and the account can open the folder.';
    if (s === 429) return 'Google is rate limiting Drive requests. Try again in a minute.';
    return (err && err.message) || 'Could not reach Google Drive.';
  }

  function json(f, url, token, what) {
    return f(url, { headers: authHeaders(token) }).then(function (r) { return check(r, what).json(); });
  }

  function folderName(token, id, f) {
    f = f || root.fetch.bind(root);
    return json(f, API + '/files/' + encodeURIComponent(id) + '?fields=id,name,mimeType&supportsAllDrives=true', token, 'Opening the folder')
      .then(function (d) {
        if (d.mimeType !== FOLDER) { var e = new Error('That link is a file, not a folder.'); e.status = 400; throw e; }
        return d.name;
      });
  }

  /** Walk the folder (and subfolders up to LIMITS.depth), capped at LIMITS.files documents. */
  async function listFiles(token, folderId, f) {
    f = f || root.fetch.bind(root);
    var out = [];
    async function walk(id, depth) {
      var page = '';
      do {
        var q = encodeURIComponent("'" + id + "' in parents and trashed=false");
        var url = API + '/files?q=' + q + '&pageSize=' + LIMITS.pageSize + '&supportsAllDrives=true&includeItemsFromAllDrives=true' +
          '&fields=' + encodeURIComponent('nextPageToken,files(id,name,mimeType,modifiedTime,owners(displayName),size)') + (page ? '&pageToken=' + encodeURIComponent(page) : '');
        var data = await json(f, url, token, 'Listing the folder');
        for (var i = 0; i < (data.files || []).length; i++) {
          var file = data.files[i];
          if (file.mimeType === FOLDER) { if (depth < LIMITS.depth) await walk(file.id, depth + 1); }
          else if (out.length < LIMITS.files) out.push(file);
        }
        page = data.nextPageToken || '';
      } while (page && out.length < LIMITS.files);
    }
    await walk(folderId, 0);
    return out;
  }

  function isReadable(file) { return !!EXPORT[file.mimeType] || PLAIN.test(file.mimeType); }

  async function fetchText(token, file, f) {
    f = f || root.fetch.bind(root);
    var url = EXPORT[file.mimeType]
      ? API + '/files/' + encodeURIComponent(file.id) + '/export?mimeType=' + encodeURIComponent(EXPORT[file.mimeType])
      : API + '/files/' + encodeURIComponent(file.id) + '?alt=media&supportsAllDrives=true';
    var res = check(await f(url, { headers: authHeaders(token) }), 'Reading "' + file.name + '"');
    return (await res.text()).replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, LIMITS.textLen);
  }

  /**
   * Pull a folder into Playbook docs. A file that can't be read is skipped (and reported), never fatal.
   * Returns { docs, skipped, total }.
   */
  async function sync(token, folderId, opts) {
    opts = opts || {};
    var f = opts.fetch || root.fetch.bind(root);
    var files = await listFiles(token, folderId, f);
    var docs = [], skipped = [];
    for (var i = 0; i < files.length; i++) {
      var file = files[i];
      if (opts.onProgress) opts.onProgress(i + 1, files.length, file.name);
      if (!isReadable(file)) { skipped.push(file.name); continue; }
      try {
        var text = await fetchText(token, file, f);
        if (!text) { skipped.push(file.name); continue; }
        var title = file.name.replace(/\.(md|txt|csv|json)$/i, '');
        docs.push({
          title: title.slice(0, 120),
          category: categorize(file.name, file.mimeType),
          event: '',
          year: (file.modifiedTime || '').slice(0, 4),
          author: ((file.owners || [])[0] || {}).displayName || '',
          text: text,
          source: 'drive',
          driveId: file.id,
          modified: file.modifiedTime || '',
        });
      } catch (e) {
        if (e.status === 401) throw e; // signed out mid-sync: stop and say so
        skipped.push(file.name);
      }
    }
    return { docs: docs, skipped: skipped, total: files.length };
  }

  // ---- browser-only: Google sign-in --------------------------------------------------
  var gsiPromise = null;
  function loadGsi() {
    if (root.google && root.google.accounts && root.google.accounts.oauth2) return Promise.resolve();
    if (gsiPromise) return gsiPromise;
    gsiPromise = new Promise(function (res, rej) {
      var s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
      s.onload = function () { res(); };
      s.onerror = function () { gsiPromise = null; rej(new Error('Could not load Google sign-in. Check your connection or ad blocker.')); };
      document.head.appendChild(s);
    });
    return gsiPromise;
  }

  /** Opens Google's consent popup (must be called from a click). Resolves { token, expiresAt }. */
  function connect(clientId, hostedDomain, prompt) {
    return loadGsi().then(function () {
      return new Promise(function (res, rej) {
        var client = root.google.accounts.oauth2.initTokenClient({
          client_id: clientId,
          scope: SCOPE,
          hd: hostedDomain || undefined,
          prompt: prompt === undefined ? '' : prompt,
          callback: function (r) {
            if (r.error) return rej(new Error(r.error === 'access_denied' ? 'Google sign-in was cancelled.' : 'Google sign-in failed: ' + (r.error_description || r.error)));
            res({ token: r.access_token, expiresAt: Date.now() + (Number(r.expires_in) || 3600) * 1000 - 30000 });
          },
          error_callback: function (e) { rej(new Error(e && e.type === 'popup_closed' ? 'Google sign-in was cancelled.' : 'Google sign-in failed.')); },
        });
        client.requestAccessToken();
      });
    });
  }

  function whoami(token, f) {
    f = f || root.fetch.bind(root);
    return json(f, 'https://www.googleapis.com/oauth2/v3/userinfo', token, 'Reading your Google account').then(function (u) {
      return { email: u.email || '', domain: (u.hd || (u.email || '').split('@')[1] || '').toLowerCase() };
    });
  }

  var api = { LIMITS: LIMITS, parseFolderId: parseFolderId, categorize: categorize, explain: explain, folderName: folderName, listFiles: listFiles, fetchText: fetchText, sync: sync, connect: connect, whoami: whoami, SCOPE: SCOPE };
  root.RelayDrive = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
