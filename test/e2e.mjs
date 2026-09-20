/* Drives real Chrome over the DevTools protocol: loads the page, runs a
 * conversion through the browser code path, and reports console errors.
 * Needs `npm start` running on :5173.  Run: node test/e2e.mjs */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9333;
const BASE = 'http://127.0.0.1:5173';
const SHOTS = process.env.SHOT_DIR || '/tmp';

const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  `--remote-debugging-port=${PORT}`, '--window-size=1000,1400', 'about:blank'
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function targets() {
  for (let i = 0; i < 60; i++) {
    try { return await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); }
    catch { await sleep(200); }
  }
  throw new Error('Chrome never came up');
}

class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.waiting = new Map(); this.console = []; }
  static async open(url) {
    const t = (await targets()).find((x) => x.type === 'page');
    const ws = new WebSocket(t.webSocketDebuggerUrl);
    await new Promise((r) => (ws.onopen = r));
    const c = new CDP(ws);
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.id && c.waiting.has(m.id)) { c.waiting.get(m.id)(m); c.waiting.delete(m.id); }
      if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) {
        c.console.push(m.params.type + ': ' + m.params.args.map((a) => a.value ?? a.description).join(' '));
      }
      if (m.method === 'Runtime.exceptionThrown') {
        c.console.push('exception: ' + (m.params.exceptionDetails.exception?.description
          || m.params.exceptionDetails.text));
      }
    };
    await c.send('Runtime.enable');
    await c.send('Page.enable');
    return c;
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.waiting.set(id, (m) => (m.error ? rej(new Error(m.error.message)) : res(m.result)));
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async goto(url) {
    await this.send('Page.navigate', { url });
    for (let i = 0; i < 100; i++) {
      const r = await this.eval('document.readyState');
      if (r === 'complete') return;
      await sleep(100);
    }
  }
  async eval(expression, awaitPromise = false) {
    const r = await this.send('Runtime.evaluate', {
      expression, awaitPromise, returnByValue: true
    });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  }
  async shot(file) {
    const { data } = await this.send('Page.captureScreenshot', { captureBeyondViewport: true });
    fs.writeFileSync(file, Buffer.from(data, 'base64'));
  }
}

let pass = 0, fail = 0;
const check = (n, c, x) => c
  ? (pass++, console.log('  \x1b[32mok\x1b[0m   ' + n))
  : (fail++, console.log('  \x1b[31mFAIL\x1b[0m ' + n + (x !== undefined ? '  -> ' + JSON.stringify(x) : '')));

try {
  const cdp = await CDP.open();

  // ---------------------------------------------------- the conversion page
  console.log('\n\x1b[1mbrowser conversion\x1b[0m');
  await cdp.goto(`${BASE}/test/browser.html`);
  const out = await cdp.eval(`new Promise(res => {
    const t0 = Date.now();
    (function poll() {
      const v = document.getElementById('out').textContent;
      if (v.includes('RESULT') || Date.now() - t0 > 20000) return res(v);
      setTimeout(poll, 100);
    })();
  })`, true);
  out.split('\n').forEach((l) => l && console.log('       ' + l));
  check('browser pipeline passes', out.includes('RESULT PASS'), out.slice(-200));

  // ------------------------------------------------------------ the real UI
  console.log('\n\x1b[1mmain page\x1b[0m');
  await cdp.goto(`${BASE}/`);
  await sleep(400);
  check('no console errors', cdp.console.length === 0, cdp.console);
  check('tagline translated', await cdp.eval(`document.querySelector('.tagline').textContent.includes('MakerWorld')`));
  check('printer list filled', await cdp.eval(`document.querySelectorAll('#printer option').length`) === 2);
  check('three modes rendered', await cdp.eval(`document.querySelectorAll('#modes .seg').length`) === 3);
  check('only the selected mode explains itself',
    await cdp.eval(`document.getElementById('modes-desc').textContent.length`) > 20);
  check('the masthead states the target machine',
    /256×256/.test(await cdp.eval(`document.getElementById('readout').textContent`)),
    await cdp.eval(`document.getElementById('readout').textContent`));
  check('five checkboxes in full mode', await cdp.eval(`document.querySelectorAll('#checks .check').length`) === 5);
  check('results column shows an empty state at rest',
    await cdp.eval(`!document.getElementById('results-empty').hidden && document.querySelectorAll('.results .card').length === 0`));
  check('results sit in the right-hand column',
    await cdp.eval(`getComputedStyle(document.querySelector('.layout')).gridTemplateColumns.split(' ').length`) === 2);
  check('the results column is the wider of the two', await cdp.eval(`
    const c = getComputedStyle(document.querySelector('.layout')).gridTemplateColumns.split(' ').map(parseFloat);
    c[1] > c[0]`));
  check('the page never scrolls sideways',
    await cdp.eval(`document.documentElement.scrollWidth <= document.documentElement.clientWidth`));
  check('the display and body faces actually loaded, not silently fallen back',
    await cdp.eval(`document.fonts.check('700 16px "Baloo 2"')`)
    && await cdp.eval(`document.fonts.check('600 14px "Quicksand"')`));
  check('the accent survives into the masthead',
    await cdp.eval(`getComputedStyle(document.querySelector('.topbar')).backgroundColor`) !== 'rgba(0, 0, 0, 0)');
  check('the queue is hidden until a file arrives', await cdp.eval(`document.getElementById('queue').hidden`));

  // language toggle
  await cdp.eval(`document.querySelector('.lang[data-lang="en"]').click()`);
  await sleep(150);
  check('EN toggle switches copy', await cdp.eval(`document.querySelector('.tagline').textContent.includes('Orca-Flashforge')`)
    && await cdp.eval(`document.documentElement.lang`) === 'en');
  await cdp.eval(`document.querySelector('.lang[data-lang="vi"]').click()`);
  await sleep(150);
  check('VI toggle switches back', await cdp.eval(`document.documentElement.lang`) === 'vi');

  // geometry-only hides the settings checkboxes that no longer apply
  await cdp.eval(`document.getElementById('options').open = true;
                  document.querySelectorAll('#modes input')[2].click()`);
  await sleep(150);
  check('geometry-only trims the option list',
    await cdp.eval(`document.querySelectorAll('#checks .check').length`) === 1);
  await cdp.eval(`document.querySelectorAll('#modes input')[0].click()`);
  await sleep(150);

  // ------------------------------------------------------ quality tier picker
  console.log('\n\x1b[1mquality tiers in the UI\x1b[0m');
  await cdp.eval(`document.getElementById('options').open = true`);
  check('four tiers rendered', await cdp.eval(`document.querySelectorAll('#quality .seg').length`) === 4);
  check('defaults to "leave as-is"',
    await cdp.eval(`document.querySelectorAll('#quality input')[0].checked`));
  await cdp.eval(`document.querySelectorAll('#quality input')[2].click()`);
  await sleep(150);
  check('the description follows the pick',
    /lưu lượng/.test(await cdp.eval(`document.getElementById('quality-desc').textContent`)),
    await cdp.eval(`document.getElementById('quality-desc').textContent`));
  check('picking balanced shows in the summary',
    /Cân bằng/.test(await cdp.eval(`document.getElementById('opt-state').textContent`)),
    await cdp.eval(`document.getElementById('opt-state').textContent`));
  check('geometry-only hides the tier picker', await (async () => {
    await cdp.eval(`document.querySelectorAll('#modes input')[2].click()`);
    await sleep(150);
    const hidden = await cdp.eval(`document.getElementById('quality-field').hidden`);
    await cdp.eval(`document.querySelectorAll('#modes input')[0].click()`);
    await sleep(150);
    return hidden;
  })());

  // ---------------------------------------------------- drag a file into it
  console.log('\n\x1b[1mfile drop\x1b[0m');
  const b64 = fs.readFileSync(path.join(import.meta.dirname, 'fixtures', 'makerworld_a1mini.3mf')).toString('base64');
  const dropped = await cdp.eval(`(async () => {
    const bin = Uint8Array.from(atob(${JSON.stringify(b64)}), c => c.charCodeAt(0));
    const file = new File([bin], 'Cool Model.3mf', { type: 'model/3mf' });
    const dt = new DataTransfer();
    dt.items.add(file);
    document.getElementById('drop').dispatchEvent(
      new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    // nothing may be converted until Convert is pressed
    const queuedOnly = !document.getElementById('queue').hidden
      && document.querySelectorAll('.results .card').length === 0;
    document.getElementById('convert').click();
    const t0 = Date.now();
    while (Date.now() - t0 < 20000) {
      const card = document.querySelector('.results .card');
      if (card && !card.querySelector('.spin')) {
        return {
          name: card.querySelector('.card-name').firstChild.textContent,
          chips: [...card.querySelectorAll('.chip')].map(c => c.textContent),
          swatches: [...card.querySelectorAll('.swatch')].map(s => s.style.background),
          meta: card.querySelector('.facts') ? card.querySelector('.facts').innerText : '',
          notes: card.querySelector('.notes') ? card.querySelector('.notes').innerText : '',
          quality: [...card.querySelectorAll('.quality-list > div')].map(r => r.textContent).join(' | '),
          flowNote: card.querySelector('.flow-note') ? card.querySelector('.flow-note').textContent : '',
          qualityRows: card.querySelectorAll('.quality-list > div').length,
          error: card.querySelector('.error') ? card.querySelector('.error').innerText : null,
          queuedOnly: queuedOnly,
          queueEmptied: document.getElementById('queue').hidden
        };
      }
      await new Promise(r => setTimeout(r, 100));
    }
    return { timeout: true };
  })()`, true);

  check('dropping a file only queues it', dropped.queuedOnly === true, dropped.queuedOnly);
  check('the queue empties once converted', dropped.queueEmptied === true, dropped.queueEmptied);
  check('a result card appeared', !dropped.timeout && !dropped.error, dropped);
  check('output is named *_C5.3mf', dropped.name === 'Cool Model_C5.3mf', dropped.name);
  check('shows source → target printer',
    /A1 mini/.test(dropped.chips?.[0] || '') && /Creator 5/.test(dropped.chips?.[1] || ''), dropped.chips);
  check('three colour swatches', dropped.swatches?.length === 3, dropped.swatches);
  check('reports the bed change', /180×180/.test(dropped.meta) && /256×256/.test(dropped.meta), dropped.meta);
  check('warns about the PETG preset guess', /PETG/.test(dropped.notes), dropped.notes);
  check('lists the 14 balanced-tier adjustments', dropped.qualityRows === 14, dropped.qualityRows);
  check('explains the flow reasoning', /mm³\/s/.test(dropped.flowNote), dropped.flowNote);
  check('shows the before/after values',
    /outer_wall_speed200 → 120/.test(dropped.quality.replace(/\s\|\s/g, ' | ')), dropped.quality.slice(0, 220));

  // ------------------------------------------- the real 48 MB MakerWorld file
  if (fs.existsSync(path.join(import.meta.dirname, '..', 'samples', 'MoonLamp+v2.2.3mf'))) {
    console.log('\n\x1b[1mreal 48 MB sample through the page\x1b[0m');
    const big = await cdp.eval(`(async () => {
      const t0 = performance.now();
      const buf = await (await fetch('/samples/MoonLamp+v2.2.3mf')).arrayBuffer();
      const dt = new DataTransfer();
      dt.items.add(new File([buf], 'MoonLamp+v2.2.3mf', { type: 'model/3mf' }));
      document.getElementById('drop').dispatchEvent(
        new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
      document.getElementById('convert').click();
      while (performance.now() - t0 < 180000) {
        const cards = document.querySelectorAll('.results .card');
        const card = cards[0];
        if (cards.length === 2 && card && !card.querySelector('.spin')) {
          return {
            cardCount: cards.length,
            secondCard: cards[1].querySelector('.card-name').firstChild.textContent,
            seconds: (performance.now() - t0) / 1000,
            name: card.querySelector('.card-name').firstChild.textContent,
            sub: card.querySelector('.card-name small').textContent,
            chips: [...card.querySelectorAll('.chip')].map(c => c.textContent),
            swatches: card.querySelectorAll('.swatch').length,
            notes: card.querySelector('.notes') ? card.querySelector('.notes').innerText : '',
            error: card.querySelector('.error') ? card.querySelector('.error').innerText : null
          };
        }
        await new Promise(r => setTimeout(r, 200));
      }
      return { timeout: true };
    })()`, true);

    check('48 MB project converts in the browser', !big.timeout && !big.error, big);
    check('P1S → Creator 5', /P1S/.test(big.chips?.[0] || '') && /Creator 5/.test(big.chips?.[1] || ''), big.chips);
    check('two colour swatches', big.swatches === 2, big.swatches);
    check('mentions the 13 plates', /13/.test(big.notes), big.notes);
    check('finishes under 60s', big.seconds < 60, big.seconds);
    check('the newest file is on top, the earlier one below',
      big.cardCount === 2 && /Cool Model/.test(big.secondCard), [big.cardCount, big.secondCard]);
    console.log(`       ${big.sub} in ${big.seconds?.toFixed(1)}s`);
  }

  await cdp.shot(path.join(SHOTS, 'c5-converter.png'));
  console.log('\n  screenshot -> ' + path.join(SHOTS, 'c5-converter.png'));

  console.log(`\n${pass} passed, ${fail} failed\n`);
  chrome.kill();
  process.exit(fail ? 1 : 0);
} catch (e) {
  console.error('\n' + e.stack);
  chrome.kill();
  process.exit(1);
}
