/* Static checks on the page: every asset it loads exists, and every string key
 * it asks for is defined in both languages. */
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'js', 'app.js'), 'utf8');
const i18nSrc = fs.readFileSync(path.join(root, 'js', 'i18n.js'), 'utf8');

let pass = 0, fail = 0;
const check = (n, c, x) => c
  ? (pass++, console.log('  \x1b[32mok\x1b[0m   ' + n))
  : (fail++, console.log('  \x1b[31mFAIL\x1b[0m ' + n + (x !== undefined ? '  -> ' + JSON.stringify(x) : '')));

console.log('\n\x1b[1mpage assets\x1b[0m');
const assets = [...html.matchAll(/(?:src|href)="([^"#:]+)"/g)].map(m => m[1]);
assets.forEach(a => check(`${a} exists`, fs.existsSync(path.join(root, a)), a));

console.log('\n\x1b[1mscript order\x1b[0m');
const order = ['fflate', 'creator5.js', 'i18n.js', 'converter.js', 'app.js']
  .map(s => html.indexOf(s));
check('dependencies load before app.js', order.every((v, i) => v > -1 && (i === 0 || v > order[i - 1])), order);

console.log('\n\x1b[1mtranslation keys\x1b[0m');
const dicts = {};
for (const lang of ['vi', 'en']) {
  const block = new RegExp(`\\n    ${lang}: \\{([\\s\\S]*?)\\n    \\}`).exec(i18nSrc);
  dicts[lang] = new Set([...block[1].matchAll(/^\s*'([\w.]+)':/gm)].map(m => m[1]));
}
check('vi and en have the same keys',
  dicts.vi.size === dicts.en.size && [...dicts.vi].every(k => dicts.en.has(k)),
  { onlyVi: [...dicts.vi].filter(k => !dicts.en.has(k)), onlyEn: [...dicts.en].filter(k => !dicts.vi.has(k)) });

const used = new Set([
  ...[...html.matchAll(/data-i18n="([\w.]+)"/g)].map(m => m[1]),
  ...[...app.matchAll(/(?<![\w$.])t\('([\w.]+)'/g)].map(m => m[1]),
  ...[...app.matchAll(/'(opt\.[\w.]+|res\.[\w.]+|how\.[\w.]+|w\.[\w.]+|err\.[\w.]+|drop\.[\w.]+)'/g)].map(m => m[1])
]);
// keys built at runtime from a code ('w.' + w.code) are covered by the checks below
const missing = [...used].filter(k => !dicts.vi.has(k) && !k.startsWith('err.') && k !== 'w.' && k !== 'q.');
check('every key the UI asks for is defined', missing.length === 0, missing);

console.log('\n\x1b[1mwarning codes\x1b[0m');
const conv = fs.readFileSync(path.join(root, 'js', 'converter.js'), 'utf8');
const codes = [...conv.matchAll(/code:\s*'(\w+)'/g)].map(m => m[1]);
const uncovered = [...new Set(codes)].filter(c => !dicts.vi.has('w.' + c));
check('every warning the converter emits has a message', uncovered.length === 0, uncovered);

const tiers = Object.keys(require('../js/converter.js').QUALITY_TIERS);
const tiersMissing = tiers.filter(tier => !dicts.vi.has('q.' + tier) || !dicts.vi.has('q.' + tier + '.d'));
check('every quality tier has a name and a description', tiersMissing.length === 0, tiersMissing);
check('the UI offers exactly the tiers the converter implements', (() => {
  const offered = [...app.matchAll(/\{ id: '(\w+)',\s+label: 'q\./g)].map(m => m[1]);
  return offered.length === tiers.length && offered.every(o => tiers.includes(o));
})(), tiers);

const errs = [...conv.matchAll(/new Error\('(\w+)'\)/g)].map(m => m[1]);
const uncoveredErrs = [...new Set(errs)].filter(c => !dicts.vi.has('err.' + c));
check('every thrown error has a message', uncoveredErrs.length === 0, uncoveredErrs);

console.log('\n\x1b[1mreferenced ids exist in the DOM\x1b[0m');
const ids = [...new Set([...app.matchAll(/\$\('([\w-]+)'\)/g)].map(m => m[1]))];
const missingIds = ids.filter(id => !new RegExp(`id="${id}"`).test(html));
check('all $(id) lookups resolve', missingIds.length === 0, missingIds);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
