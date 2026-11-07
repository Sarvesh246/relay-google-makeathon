// Builds the deployable site into dist/ straight from Relay.dc.html.
//
// Relay.dc.html is the editable source. It expects window.React to already
// exist (the design tool injects it), so the site build adds the same pinned
// React 18.3.1 scripts the old standalone bundle used and ships support.js
// next to it. Nothing else is transformed, so what you edit is what deploys.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const dist = new URL('dist/', root);

export const REACT_TAGS = [
  '<script src="https://unpkg.com/react@18.3.1/umd/react.production.min.js" crossorigin></script>',
  '<script src="https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js" crossorigin></script>',
].join('\n');

export function renderIndex(dcSource) {
  const marker = '<script src="./support.js"></script>';
  if (!dcSource.includes(marker)) throw new Error('Relay.dc.html is missing <script src="./support.js">');
  const withTitle = dcSource.includes('<title>')
    ? dcSource
    : dcSource.replace('<meta charset="utf-8">', '<meta charset="utf-8">\n<title>Relay · Aggie Robotics</title>');
  return withTitle.replace(marker, REACT_TAGS + '\n' + marker);
}

if (import.meta.url === new URL(process.argv[1], 'file://').href || process.argv[1]?.endsWith('build-site.mjs')) {
  mkdirSync(dist, { recursive: true });
  writeFileSync(new URL('index.html', dist), renderIndex(readFileSync(new URL('Relay.dc.html', root), 'utf8')));
  copyFileSync(new URL('support.js', root), new URL('support.js', dist));
  console.log('Built dist/index.html and dist/support.js');
}
