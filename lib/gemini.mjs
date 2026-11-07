// Minimal Gemini client. The key never leaves the server: it is read from
// GEMINI_API_KEY (set in Vercel / .env.local), never from the browser.
//
// Keys that start with "AQ." are Vertex AI express-mode keys and talk to
// aiplatform.googleapis.com; classic AI Studio keys ("AIza...") use
// generativelanguage.googleapis.com. We try the likely endpoint first and fall
// back once, so either kind of key works without extra configuration.

const ENDPOINTS = {
  vertex: (model) => `https://aiplatform.googleapis.com/v1/publishers/google/models/${model}:generateContent`,
  studio: (model) => `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
};

export class GeminiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

export async function generate({ apiKey, model = 'gemini-2.5-flash', system, contents, schema, signal }) {
  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents,
    generationConfig: {
      temperature: 0.3,
      maxOutputTokens: 2048,
      responseMimeType: 'application/json',
      responseSchema: schema,
    },
  };
  // GEMINI_BASE_URL points at a stub or proxy for local testing; it disables the endpoint fallback.
  const base = process.env.GEMINI_BASE_URL;
  const order = base ? ['custom'] : apiKey.startsWith('AQ.') ? ['vertex', 'studio'] : ['studio', 'vertex'];
  let lastErr;
  for (const which of order) {
    const url = which === 'custom' ? `${base.replace(/\/$/, '')}/${model}:generateContent` : ENDPOINTS[which](model);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(body),
      signal,
    });
    if (res.ok) {
      const data = await res.json();
      const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
      if (!text) throw new GeminiError('Gemini returned no text (blocked or empty).', 502);
      return text;
    }
    lastErr = new GeminiError(`Gemini ${which} endpoint answered ${res.status}`, res.status);
    // A key meant for the other endpoint looks like a 400/401/403/404: try the next one. Anything else is real.
    if (![400, 401, 403, 404].includes(res.status)) break;
  }
  throw lastErr;
}
