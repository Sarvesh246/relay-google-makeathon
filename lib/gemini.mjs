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

/** POST a generateContent body and return the parsed JSON response. */
export async function callModel({ apiKey, model, body, signal }) {
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
    if (res.ok) return res.json();
    lastErr = new GeminiError(`Gemini ${which} endpoint answered ${res.status}`, res.status);
    // A key meant for the other endpoint looks like a 400/401/403/404: try the next one. Anything else is real.
    if (![400, 401, 403, 404].includes(res.status)) break;
  }
  throw lastErr;
}

const textOf = (data) => data?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';

/** Structured-JSON text generation. Returns the raw JSON string. */
export async function generate({ apiKey, model = 'gemini-2.5-flash', system, contents, schema, signal }) {
  const data = await callModel({
    apiKey,
    model,
    signal,
    body: {
      systemInstruction: { parts: [{ text: system }] },
      contents,
      generationConfig: { temperature: 0.3, maxOutputTokens: 2048, responseMimeType: 'application/json', responseSchema: schema },
    },
  });
  const text = textOf(data);
  if (!text) throw new GeminiError('Gemini returned no text (blocked or empty).', 502);
  return text;
}

/** Nano Banana (Gemini image model). Returns { mime, data (base64) }. */
export async function generateImage({ apiKey, model = 'gemini-2.5-flash-image', prompt, aspectRatio = '4:5', signal }) {
  const data = await callModel({
    apiKey,
    model,
    signal,
    body: {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio } },
    },
  });
  const part = data?.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data || p.inline_data?.data);
  const inline = part?.inlineData || part?.inline_data;
  if (!inline?.data) throw new GeminiError('Image model returned no image.', 502);
  return { mime: inline.mimeType || inline.mime_type || 'image/png', data: inline.data };
}

/** Ask a vision-capable model a structured question about an image. Returns parsed JSON. */
export async function inspectImage({ apiKey, model = 'gemini-2.5-flash', image, question, schema, signal }) {
  const data = await callModel({
    apiKey,
    model,
    signal,
    body: {
      contents: [{ role: 'user', parts: [{ inlineData: { mimeType: image.mime, data: image.data } }, { text: question }] }],
      generationConfig: { temperature: 0, maxOutputTokens: 512, responseMimeType: 'application/json', responseSchema: schema },
    },
  });
  const text = textOf(data);
  if (!text) throw new GeminiError('Inspection returned no text.', 502);
  return JSON.parse(text);
}
