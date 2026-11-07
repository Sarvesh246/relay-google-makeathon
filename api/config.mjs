// GET /api/config — the public, non-secret settings the browser needs to connect Google Drive.
//
// GOOGLE_CLIENT_ID is an OAuth *web client ID*: it is public by design (it ships in every
// "Sign in with Google" page) and is useless without the matching authorized origins.
// There is intentionally no client secret anywhere in this app.
export function GET() {
  return Response.json(
    {
      googleClientId: process.env.GOOGLE_CLIENT_ID || '388477342960-l3kgcuc2l6r6mb92pfo3mduv9k3hfcnm.apps.googleusercontent.com',
      driveFolderId: process.env.GOOGLE_DRIVE_FOLDER_ID || '',
      allowedDomain: (process.env.GOOGLE_ALLOWED_DOMAIN || '').toLowerCase(),
    },
    { headers: { 'cache-control': 'no-store' } },
  );
}
