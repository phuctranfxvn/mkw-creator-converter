/* Creator 5 Converter — UI glue. */
(function () {
  'use strict';

  var t = I18N.t;
  var $ = function (id) { return document.getElementById(id); };

  var CHECKS = [
    { key: 'carryPrintSettings', label: 'opt.carry',    desc: 'opt.carry.d',    modes: ['full'] },
    { key: 'retuneTemperatures', label: 'opt.retune',   desc: 'opt.retune.d',   modes: ['full'] },
    { key: 'recenter',           label: 'opt.recenter', desc: 'opt.recenter.d', modes: ['full', 'profile-only', 'geometry-only'] },
    { key: 'keepThumbnails',     label: 'opt.thumbs',   desc: null,             modes: ['full', 'profile-only'] },
    { key: 'dropAuxiliary',      label: 'opt.aux',      desc: 'opt.aux.d',      modes: ['full', 'profile-only'] }
  ];

  var QUALITY = [
    { id: 'off',      label: 'q.off',      desc: 'q.off.d' },
    { id: 'light',    label: 'q.light',    desc: 'q.light.d' },
    { id: 'balanced', label: 'q.balanced', desc: 'q.balanced.d' },
    { id: 'max',      label: 'q.max',      desc: 'q.max.d' }
  ];

  var MODES = [
    { id: 'full',          label: 'opt.mode.full.s',     desc: 'opt.mode.full.d' },
    { id: 'profile-only',  label: 'opt.mode.profile.s',  desc: 'opt.mode.profile.d' },
    { id: 'geometry-only', label: 'opt.mode.geometry.s', desc: 'opt.mode.geometry.d' }
  ];

  var STORE = 'c5conv.v1';
  var state = Object.assign({ printerId: C5Profiles.list[0].id }, C5Converter.DEFAULTS);
  var donor = null;          // { name, config }
  var pending = [];          // File objects waiting for the Convert button
  var results = [];          // { id, name, file, status, ... }
  var busy = false;

  /* ------------------------------------------------------------ storage */
  function load() {
    try {
      var raw = localStorage.getItem(STORE);
      if (raw) Object.assign(state, JSON.parse(raw));
    } catch (e) { /* private window, blocked storage — defaults are fine */ }
    try {
      var l = localStorage.getItem(STORE + '.lang');
      if (l) I18N.set(l);
    } catch (e) { /* ignore */ }
  }
  function save() {
    try { localStorage.setItem(STORE, JSON.stringify(state)); } catch (e) { /* ignore */ }
  }

  /* --------------------------------------------------------------- i18n */
  function applyI18n() {
    document.documentElement.lang = I18N.lang;
    [].forEach.call(document.querySelectorAll('[data-i18n]'), function (el) {
      el.textContent = t(el.getAttribute('data-i18n'));
    });
    [].forEach.call(document.querySelectorAll('.lang'), function (b) {
      b.classList.toggle('on', b.dataset.lang === I18N.lang);
    });
    buildPrinters();
    buildModes();
    buildQuality();
    buildChecks();
    updateSummary();
    renderQueue();
    renderResults();
    renderDonor();
  }

  /* ------------------------------------------------------------ options */
  function buildPrinters() {
    var sel = $('printer');
    sel.innerHTML = '';
    C5Profiles.list.forEach(function (p) {
      var o = document.createElement('option');
      o.value = p.id;
      o.textContent = p.label;
      sel.appendChild(o);
    });
    sel.value = state.printerId;
  }

  /* One row of choices; only the selected one explains itself, which keeps the
   * control panel short enough to sit beside the results. */
  function buildSegmented(boxId, group, items, current, onPick) {
    var box = $(boxId);
    box.innerHTML = '';
    items.forEach(function (m) {
      var lab = document.createElement('label');
      lab.className = 'seg' + (current === m.id ? ' on' : '');
      var input = document.createElement('input');
      input.type = 'radio'; input.name = group; input.value = m.id;
      input.id = group + '-' + m.id;
      input.checked = current === m.id;
      input.addEventListener('change', function () { onPick(m.id); });
      var span = document.createElement('span');
      span.textContent = t(m.label);
      lab.appendChild(input); lab.appendChild(span);
      box.appendChild(lab);
    });
    var picked = items.filter(function (m) { return m.id === current; })[0];
    $(boxId + '-desc').textContent = picked ? t(picked.desc) : '';
  }

  function buildModes() {
    buildSegmented('modes', 'modes', MODES, state.mode, function (id) {
      state.mode = id; save(); buildModes(); buildChecks(); buildQuality(); updateSummary();
    });
  }

  function buildQuality() {
    // geometry-only writes no settings at all, so the tiers have nothing to act on
    $('quality-field').hidden = state.mode === 'geometry-only';
    buildSegmented('quality', 'quality', QUALITY, state.quality, function (id) {
      state.quality = id; save(); buildQuality(); updateSummary();
    });
  }

  function buildChecks() {
    var box = $('checks');
    box.innerHTML = '';
    CHECKS.forEach(function (c) {
      if (c.modes.indexOf(state.mode) === -1) return;
      var lab = document.createElement('label');
      lab.className = 'check';
      var input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = !!state[c.key];
      input.addEventListener('change', function () {
        state[c.key] = input.checked; save(); updateSummary();
      });
      var body = document.createElement('div');
      body.innerHTML = '<b></b>' + (c.desc ? '<span></span>' : '');
      body.querySelector('b').textContent = t(c.label);
      if (c.desc) body.querySelector('span').textContent = t(c.desc);
      lab.appendChild(input); lab.appendChild(body);
      box.appendChild(lab);
    });
  }

  function updateSummary() {
    var printer = C5Profiles.list.filter(function (p) { return p.id === state.printerId; })[0];
    var mode = MODES.filter(function (m) { return m.id === state.mode; })[0];
    var bits = [donor ? donor.name : printer.label, t(mode.label)];
    if (state.quality !== 'off' && state.mode !== 'geometry-only') {
      bits.push(t(QUALITY.filter(function (q) { return q.id === state.quality; })[0].label));
    }
    $('opt-state').textContent = bits.join(' · ');

    // the machine this page is aimed at, in its own units
    var cfg = template();
    var bed = C5Converter.parseBed(cfg.printable_area);
    var nozzle = Array.isArray(cfg.nozzle_diameter) ? cfg.nozzle_diameter[0] : cfg.nozzle_diameter;
    var out = $('readout');
    out.innerHTML = '';
    [cfg.printer_model || printer.label,
     nozzle ? nozzle + ' mm' : null,
     bed ? bed.x + '×' + bed.y + '×' + (cfg.printable_height || '') : null].forEach(function (bit, i) {
      if (!bit) return;
      if (out.childNodes.length) out.appendChild(el('span', 'dot', '·'));
      out.appendChild(el('b', null, bit));
    });
  }

  function renderDonor() {
    var st = $('donor-status');
    $('donor-clear').hidden = !donor;
    if (!donor) { st.hidden = true; return; }
    st.hidden = false;
    st.className = 'donor-status' + (donor.warn ? ' bad' : '');
    st.textContent = donor.warn ? donor.warn : t('opt.donor.ok') + ' ' + donor.name;
  }

  /* ------------------------------------------------------------- helpers */
  /* The async paths run in a worker so the tab stays responsive on a 50 MB
   * project. Some sandboxes block workers — fall back to the blocking call
   * rather than failing the conversion. */
  function unzip(u8) {
    return new Promise(function (res, rej) {
      try {
        fflate.unzip(u8, function (err, data) {
          if (err) rej(new Error('BAD_ZIP')); else res(data);
        });
      } catch (e) {
        try { res(fflate.unzipSync(u8)); } catch (e2) { rej(new Error('BAD_ZIP')); }
      }
    });
  }
  function zip(files) {
    return new Promise(function (res, rej) {
      try {
        fflate.zip(files, { level: 4 }, function (err, data) {
          if (err) rej(err); else res(data);
        });
      } catch (e) {
        try { res(fflate.zipSync(files, { level: 4 })); } catch (e2) { rej(e2); }
      }
    });
  }
  function readFile(file) {
    return new Promise(function (res, rej) {
      var r = new FileReader();
      r.onload = function () { res(new Uint8Array(r.result)); };
      r.onerror = function () { rej(new Error('BAD_ZIP')); };
      r.readAsArrayBuffer(file);
    });
  }
  function outName(name) {
    return name.replace(/\.3mf$/i, '') + '_C5.3mf';
  }
  function human(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
  }
  function download(bytes, name) {
    var url = URL.createObjectURL(new Blob([bytes], { type: 'model/3mf' }));
    var a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  function template() {
    if (donor && donor.config) return donor.config;
    return C5Profiles.get(state.printerId).config;
  }

  /* ---------------------------------------------------------- conversion */
  var seq = 0;

  /* Files wait in a queue; nothing is converted until Convert is pressed, so
   * the options below can be set first. */
  function addFiles(list) {
    var files = [].slice.call(list).filter(function (f) { return /\.3mf$/i.test(f.name); });
    if (!files.length) return;
    pending = pending.concat(files);
    renderQueue();
  }

  function renderQueue() {
    $('queue').hidden = pending.length === 0;
    var ul = $('queue-list');
    ul.innerHTML = '';
    pending.forEach(function (f, i) {
      var li = el('li');
      li.appendChild(el('span', 'q-name', f.name));
      li.appendChild(el('span', 'q-size', human(f.size)));
      var x = el('button', 'q-drop', '\u00d7');
      x.type = 'button';
      x.title = t('queue.remove');
      x.setAttribute('aria-label', t('queue.remove'));
      x.addEventListener('click', function () { pending.splice(i, 1); renderQueue(); });
      li.appendChild(x);
      ul.appendChild(li);
    });
    var btn = $('convert');
    btn.textContent = busy ? t('drop.busy')
      : (pending.length > 1 ? t('queue.convert', { n: pending.length }) : t('queue.convert1'));
    btn.disabled = busy || pending.length === 0;
  }

  function currentOptions() {
    // a donor file states the version its own Flash Studio writes
    return Object.assign({}, state, {
      targetVersion: (donor && donor.config && donor.config.version) || null
    });
  }

  async function convertFile(file, existing) {
    var row = existing || { id: ++seq, name: file.name, file: file };
    row.status = 'busy';
    row.inSize = file.size;
    if (!existing) results.unshift(row);          // newest first
    renderResults();
    // let the browser paint the spinner before the heavy work starts
    await new Promise(function (r) { requestAnimationFrame(function () { r(); }); });

    try {
      var entries = await unzip(await readFile(file));
      var res = C5Converter.convert(entries, template(), currentOptions());
      var bytes = await zip(res.files);
      row.status = 'ok';
      row.report = res.report;
      row.bytes = bytes;
      row.outName = outName(file.name);
      row.outSize = bytes.length;
      row.error = null;
    } catch (e) {
      row.status = 'error';
      row.error = e && e.message ? e.message : 'generic';
    }
    renderResults();
  }

  async function runQueue() {
    if (busy || !pending.length) return;
    busy = true;
    var batch = pending;
    pending = [];
    renderQueue();
    $('drop').classList.add('busy');
    for (var i = 0; i < batch.length; i++) await convertFile(batch[i]);
    $('drop').classList.remove('busy');
    busy = false;
    renderQueue();
  }

  async function reconvert(row) {
    if (busy || !row.file) return;
    busy = true;
    renderQueue();
    await convertFile(row.file, row);
    busy = false;
    renderQueue();
  }

  /* ------------------------------------------------------------- render */
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function renderResults() {
    var box = $('results');
    box.innerHTML = '';
    $('results-empty').hidden = results.length > 0;
    $('clear').hidden = results.length === 0;
    var done = results.filter(function (r) { return r.status === 'ok'; });
    $('download-all').hidden = done.length < 2;

    results.forEach(function (r) {
      var li = el('li', 'card' + (r.status === 'error' ? ' bad' : ''));

      var head = el('div', 'card-head');
      if (r.status === 'busy') head.appendChild(el('div', 'spin'));
      var nameBox = el('div', 'card-name');
      nameBox.appendChild(el('strong', null, r.status === 'ok' ? r.outName : r.name));
      var sub = el('small');
      sub.textContent = r.status === 'ok'
        ? human(r.inSize) + ' → ' + human(r.outSize)
        : (r.status === 'busy' ? t('drop.busy') : human(r.inSize));
      nameBox.appendChild(sub);
      head.appendChild(nameBox);

      if (r.status !== 'busy') {
        var acts = el('div', 'card-actions');
        if (r.status === 'ok') {
          var dl = el('button', 'btn', t('res.download'));
          dl.type = 'button';
          dl.addEventListener('click', function () { download(r.bytes, r.outName); });
          acts.appendChild(dl);
        }
        if (r.file) {
          // options may have changed since this file was converted
          var again = el('button', 'btn link', t('res.again'));
          again.type = 'button';
          again.addEventListener('click', function () { reconvert(r); });
          acts.appendChild(again);
        }
        head.appendChild(acts);
      }
      li.appendChild(head);

      if (r.status === 'error') {
        li.appendChild(el('div', 'error', t('err.' + r.error) !== 'err.' + r.error
          ? t('err.' + r.error) : t('err.generic')));
        box.appendChild(li);
        return;
      }
      if (r.status !== 'ok') { box.appendChild(li); return; }

      var rep = r.report;
      var body = el('div', 'card-body');

      // printer route
      var route = el('div', 'route');
      route.appendChild(el('span', 'chip', rep.isProject
        ? (rep.sourcePrinter || t('res.unknown'))
        : t('res.plain')));
      route.appendChild(el('span', 'arrow', '→'));
      route.appendChild(el('span', 'chip target', rep.targetPrinter || t('res.plain')));
      body.appendChild(route);

      // filament swatches
      if (rep.filaments && rep.filaments.length) {
        var sw = el('div', 'swatches');
        rep.filaments.forEach(function (f) {
          var slot = el('div', 'slot');
          var chip = el('span', 'swatch');
          chip.style.background = '#' + f.colour.slice(1, 7);
          chip.title = t('res.slot') + ' ' + f.slot + ' · ' + f.type + ' · ' + f.preset;
          slot.appendChild(chip);
          slot.appendChild(el('em', null, f.slot + ' · ' + f.type));
          sw.appendChild(slot);
        });
        body.appendChild(sw);
      }

      // meta lines
      var meta = el('div', 'facts');
      function line(label, value) {
        var p = el('div');
        p.appendChild(el('span', 'k', label));
        p.appendChild(el('span', 'v', value));
        meta.appendChild(p);
      }
      if (rep.sourceBed) {
        line(t('res.bed'), rep.sourceBed.x + '×' + rep.sourceBed.y + ' → ' +
          rep.targetBed.x + '×' + rep.targetBed.y +
          (rep.recentered ? ' (' + t('res.moved') + ' ' + rep.recentered.dx + ', ' + rep.recentered.dy + ')' : ''));
      }
      if (rep.plates > 1) line(t('res.plates'), String(rep.plates));
      // with several plates these are grid coordinates, not positions on the bed
      if (rep.placements && rep.placements.length && rep.plates === 1) {
        line(t('res.objects'), rep.placements.slice(0, 6).map(function (p) {
          return p.x + ', ' + p.y;
        }).join('  ·  ') + (rep.placements.length > 6 ? '  …' : ''));
      }
      if (rep.carriedSettings) line(t('res.carried'), String(rep.carriedSettings));
      if (rep.remapped && rep.remapped.length) {
        line(t('res.remapped'), rep.remapped.map(function (x) { return x.from + ' → ' + x.to; }).join(', '));
      }
      if (rep.droppedFiles && rep.droppedFiles.length) {
        line(t('res.dropped'), String(rep.droppedFiles.length));
      }
      if (meta.children.length) body.appendChild(meta);

      if (rep.quality && rep.quality.changes.length) {
        var det = el('details', 'quality-box');
        var sum = el('summary');
        sum.appendChild(el('b', null, t('res.quality') + ': ' +
          t('q.' + rep.quality.tier)));
        sum.appendChild(el('span', null, '  ' + rep.quality.changes.length + ' ' + t('res.qualityChanges')));
        det.appendChild(sum);

        if (rep.quality.flow) {
          var f = rep.quality.flow;
          var fl = el('p', 'flow-note');
          fl.textContent = t('res.flow', {
            speed: f.speed, layer: f.layerHeight, rate: f.rate
          }) + (f.limited ? ' — ' + t('res.flowLimited', { cap: f.cap }) : '');
          det.appendChild(fl);
        }

        var tbl = el('div', 'quality-list');
        rep.quality.changes.forEach(function (c) {
          var row = el('div');
          row.appendChild(el('code', null, c.key));
          row.appendChild(el('span', 'val', c.from + ' → ' + c.to));
          tbl.appendChild(row);
        });
        det.appendChild(tbl);
        body.appendChild(det);
      }

      // warnings
      if (rep.warnings && rep.warnings.length) {
        var n = el('div', 'notes');
        var nb = el('div', 'notes-body');
        nb.appendChild(el('h4', null, t('w.title')));
        var ul = el('ul');
        rep.warnings.forEach(function (w) {
          ul.appendChild(el('li', null, t('w.' + w.code, w)));
        });
        nb.appendChild(ul);
        n.appendChild(nb);
        body.appendChild(n);
      }

      li.appendChild(body);
      box.appendChild(li);
    });
  }

  /* --------------------------------------------------------------- wire */
  function init() {
    load();

    var drop = $('drop'), input = $('file');
    drop.addEventListener('click', function () { input.click(); });
    drop.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); }
    });
    input.addEventListener('change', function () { addFiles(input.files); input.value = ''; });

    ['dragenter', 'dragover'].forEach(function (ev) {
      drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('over'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('over'); });
    });
    drop.addEventListener('drop', function (e) {
      if (e.dataTransfer && e.dataTransfer.files) addFiles(e.dataTransfer.files);
    });
    // stop the browser from navigating away when a file misses the box
    window.addEventListener('dragover', function (e) { e.preventDefault(); });
    window.addEventListener('drop', function (e) { e.preventDefault(); });

    $('convert').addEventListener('click', runQueue);
    $('queue-clear').addEventListener('click', function () { pending = []; renderQueue(); });

    $('printer').addEventListener('change', function () {
      state.printerId = $('printer').value; save(); updateSummary();
    });

    $('donor-btn').addEventListener('click', function () { $('donor-file').click(); });
    $('donor-file').addEventListener('change', async function () {
      var f = $('donor-file').files[0];
      $('donor-file').value = '';
      if (!f) return;
      try {
        var entries = await unzip(await readFile(f));
        var key = Object.keys(entries).filter(function (p) {
          return /^Metadata\/project_settings\.config$/i.test(p);
        })[0];
        if (!key) throw new Error('bad');
        var cfg = JSON.parse(new TextDecoder().decode(entries[key]));
        if (!cfg.printer_settings_id) throw new Error('bad');
        donor = { name: f.name, config: cfg, warn: null };
        if (!/creator\s*5/i.test(cfg.printer_model || cfg.printer_settings_id)) {
          donor.warn = t('w.donor_not_c5', { printer: cfg.printer_model || cfg.printer_settings_id });
        }
      } catch (e) {
        donor = null;
        $('donor-status').hidden = false;
        $('donor-status').className = 'donor-status bad';
        $('donor-status').textContent = t('w.donor_bad');
        updateSummary();
        return;
      }
      renderDonor();
      updateSummary();
    });
    $('donor-clear').addEventListener('click', function () {
      donor = null; renderDonor(); updateSummary();
    });

    $('reset').addEventListener('click', function () {
      state = Object.assign({ printerId: C5Profiles.list[0].id }, C5Converter.DEFAULTS);
      donor = null;
      save(); applyI18n();
    });

    $('clear').addEventListener('click', function () {
      results = []; renderResults();
    });

    $('download-all').addEventListener('click', async function () {
      var bundle = {};
      results.filter(function (r) { return r.status === 'ok'; })
        .forEach(function (r) { bundle[r.outName] = r.bytes; });
      download(await zip(bundle), 'creator5_converted.zip');
    });

    [].forEach.call(document.querySelectorAll('.lang'), function (b) {
      b.addEventListener('click', function () {
        I18N.set(b.dataset.lang);
        try { localStorage.setItem(STORE + '.lang', I18N.lang); } catch (e) { /* ignore */ }
        applyI18n();
      });
    });

    if (window.matchMedia && window.matchMedia('(max-width: 940px)').matches) {
      $('options').open = false;
    }

    applyI18n();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
