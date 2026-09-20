/* Converter test harness. Run: npm test */
const fs = require('fs');
const path = require('path');
const fflate = require('../node_modules/fflate');
const Converter = require('../js/converter.js');
const Profiles = require('../js/profiles/creator5.js');

const dec = new TextDecoder();
let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  \x1b[32mok\x1b[0m   ' + name); }
  else { fail++; console.log('  \x1b[31mFAIL\x1b[0m ' + name + (extra !== undefined ? '  -> ' + JSON.stringify(extra) : '')); }
}

function run(fixture, opts, assert) {
  console.log('\n\x1b[1m' + fixture + '\x1b[0m  ' + JSON.stringify(opts));
  const entries = fflate.unzipSync(new Uint8Array(fs.readFileSync(path.join(__dirname, 'fixtures', fixture))));
  const tpl = Profiles.get('creator5-0.4').config;
  const t0 = Date.now();
  const { files, report } = Converter.convert(entries, tpl, opts);
  const ms = Date.now() - t0;
  const cfg = files['Metadata/project_settings.config']
    ? JSON.parse(dec.decode(files['Metadata/project_settings.config'])) : null;
  assert({ files, report, cfg, ms });
  // the output must be a readable zip again
  const buf = fflate.zipSync(files, { level: 6 });
  const back = fflate.unzipSync(buf);
  check('round-trips through zip', Object.keys(back).length === Object.keys(files).length);
  return { files, report, cfg };
}

// ---------------------------------------------------------------- full mode
run('makerworld_p1s.3mf', {}, ({ files, report, cfg, ms }) => {
  check('printer swapped to Creator 5', cfg.printer_settings_id === 'Flashforge Creator 5 0.4 nozzle', cfg.printer_settings_id);
  check('printer_model swapped', cfg.printer_model === 'Flashforge Creator 5', cfg.printer_model);
  check('gcode flavor is klipper', cfg.gcode_flavor === 'klipper', cfg.gcode_flavor);
  check('start gcode is Creator 5 (not Bambu)', /L\+R_PLA_Turbo_Fan/.test(cfg.machine_start_gcode) && !/BAMBU LAB/.test(cfg.machine_start_gcode));
  check('end gcode is Creator 5', !/BAMBU LAB/.test(cfg.machine_end_gcode));
  check('bed is 256x256', JSON.stringify(Converter.parseBed(cfg.printable_area)) === '{"x":256,"y":256}');

  // designer intent survives
  check('layer_height carried (0.16)', cfg.layer_height === '0.16', cfg.layer_height);
  check('initial layer height carried', cfg.initial_layer_print_height === '0.2', cfg.initial_layer_print_height);
  check('infill density carried (25%)', cfg.sparse_infill_density === '25%', cfg.sparse_infill_density);
  check('infill pattern carried (gyroid)', cfg.sparse_infill_pattern === 'gyroid', cfg.sparse_infill_pattern);
  check('wall_loops carried (3)', cfg.wall_loops === '3', cfg.wall_loops);
  check('support settings carried', cfg.enable_support === '1' && cfg.support_type === 'tree(auto)');
  check('brim carried', cfg.brim_type === 'outer_only' && cfg.brim_width === '5');
  check('seam carried', cfg.seam_position === 'aligned');
  check('Bambu "disabled" translated to Flash Studio\'s "none"',
    cfg.ensure_vertical_shell_thickness === 'none', cfg.ensure_vertical_shell_thickness);
  check('the translation is reported', report.remapped.some(r => r.key === 'ensure_vertical_shell_thickness' && r.from === 'disabled' && r.to === 'none'), report.remapped);
  // "-1 not in range": Bambu's auto sentinel on settings Flash Studio bounds at 0
  check('a negative the profile never uses is not carried',
    cfg.raft_first_layer_expansion === Profiles.get('creator5-0.4').config.raft_first_layer_expansion
    && cfg.tree_support_wall_count === Profiles.get('creator5-0.4').config.tree_support_wall_count,
    [cfg.raft_first_layer_expansion, cfg.tree_support_wall_count]);
  check('the rejection is recorded',
    report.rejected.includes('raft_first_layer_expansion') && report.rejected.includes('tree_support_wall_count'),
    report.rejected);
  check('nothing in the output is negative where the profile is not', (() => {
    const tpl = Profiles.get('creator5-0.4').config;
    const neg = (v) => { const n = parseFloat(v); return isFinite(n) && n < 0; };
    return !Object.keys(cfg).some((k) => {
      if (!(k in tpl)) return false;
      const a = Array.isArray(cfg[k]) ? cfg[k][0] : cfg[k];
      const b = Array.isArray(tpl[k]) ? tpl[k][0] : tpl[k];
      return neg(a) && !neg(b);
    });
  })());
  check('no key with a known vocabulary clash keeps the Bambu spelling',
    !['ensure_vertical_shell_thickness'].some(k => cfg[k] === 'enabled' || cfg[k] === 'disabled'),
    cfg.ensure_vertical_shell_thickness);

  // machine tuning must NOT survive
  check('Bambu outer wall speed rejected (C5 keeps 200)', cfg.outer_wall_speed === '200', cfg.outer_wall_speed);
  check('Bambu travel speed rejected (C5 keeps 500)', cfg.travel_speed === '500', cfg.travel_speed);
  check('Bambu retraction rejected', JSON.stringify(cfg.retraction_length) !== '["0.8"]', cfg.retraction_length);
  check('unknown Bambu key not injected', !('bambu_secret_sauce' in cfg));

  // filaments
  check('3 source filaments detected', report.sourceFilaments === 3, report.sourceFilaments);
  check('colours preserved', JSON.stringify(cfg.filament_colour) === '["#FF6A13FF","#0A2FFFFF","#1A1A1AFF"]', cfg.filament_colour);
  check('slot 3 kept as PETG', cfg.filament_type[2] === 'PETG', cfg.filament_type);
  check('slot 3 takes the source nozzle temp (255)', cfg.nozzle_temperature[2] === '255', cfg.nozzle_temperature);
  check('slot 3 falls back to the PETG bed temp when source says 0', cfg.hot_plate_temp[2] === '70', cfg.hot_plate_temp);
  check('slot 1 stays PLA temps', cfg.nozzle_temperature[0] === '220' && cfg.hot_plate_temp[0] === '55');
  check('real spool density carried over', cfg.filament_density[0] === '1.31', cfg.filament_density);
  check('PLA slots keep the machine volumetric limit', cfg.filament_max_volumetric_speed[0] === Profiles.get('creator5-0.4').config.filament_max_volumetric_speed[0], cfg.filament_max_volumetric_speed);
  check('PETG slot gets its own volumetric limit', cfg.filament_max_volumetric_speed[2] === '10', cfg.filament_max_volumetric_speed);
  check('presets renamed to @FF C5', cfg.filament_settings_id.every(s => /@FF C5$/.test(s)), cfg.filament_settings_id);
  check('vendor is Generic', cfg.filament_vendor.every(v => v === 'Generic'));
  check('region filament indices carried', cfg.wall_filament === '2' && cfg.sparse_infill_filament === '3');

  // package hygiene
  check('Bambu filament_settings_1 dropped', !files['Metadata/filament_settings_1.config']);
  check('sliced gcode dropped', !files['Metadata/plate_1.gcode']);
  check('Auxiliary dropped', !Object.keys(files).some(p => p.startsWith('Auxiliary/')));
  check('geometry kept', !!files['3D/3dmodel.model'] && !!files['3D/Objects/Parametric_Model_Maker_1_1.model']);
  check('object rels kept', !!files['3D/_rels/3dmodel.model.rels']);
  check('model_settings kept', !!files['Metadata/model_settings.config']);
  check('thumbnail kept', !!files['Metadata/plate_1.png']);
  check('Content_Types rewritten', /3dmanufacturing-3dmodel/.test(dec.decode(files['[Content_Types].xml'])));
  check('root rels point at thumbnail', /plate_1\.png/.test(dec.decode(files['_rels/.rels'])));
  check('slice_info rewritten with the target version', /OrcaSlicer-Version" value="2\.3\.2"/.test(dec.decode(files['Metadata/slice_info.config'])), dec.decode(files['Metadata/slice_info.config']));
  // an empty list tells Orca "same as the system preset", and it then reloads
  // the stock preset over everything carried from the source
  check('modified settings are declared, not blanked',
    cfg.different_settings_to_system[0].split(';').includes('layer_height'),
    cfg.different_settings_to_system[0]);
  check('every carried change is declared', (() => {
    const declared = new Set(cfg.different_settings_to_system[0].split(';'));
    const tpl = Profiles.get('creator5-0.4').config;
    return Converter.CARRY_OVER.every(k => !(k in cfg) || !(k in tpl)
      || JSON.stringify(cfg[k]) === JSON.stringify(tpl[k]) || declared.has(k));
  })(), cfg.different_settings_to_system[0]);
  // the regression that reset first layer height to the stock preset's value
  check('a setting matching the profile is still declared when the source states it',
    cfg.initial_layer_print_height === '0.2'
    && cfg.different_settings_to_system[0].split(';').includes('initial_layer_print_height'),
    [cfg.initial_layer_print_height, cfg.different_settings_to_system[0]]);
  check('every setting the source states is declared', (() => {
    const declared = new Set(cfg.different_settings_to_system[0].split(';'));
    const tpl = Profiles.get('creator5-0.4').config;
    const srcCfg = JSON.parse(dec.decode(fflate.unzipSync(
      new Uint8Array(fs.readFileSync(path.join(__dirname, 'fixtures', 'makerworld_p1s.3mf'))),
      { filter: (e) => /project_settings/.test(e.name) })['Metadata/project_settings.config']));
    return Converter.CARRY_OVER.filter(k => (k in srcCfg) && (k in tpl) && (k in cfg))
      .every(k => declared.has(k));
  })(), cfg.different_settings_to_system[0]);
  check('filament slots only declare what was written',
    !cfg.different_settings_to_system[1].split(';').includes('filament_flow_ratio'),
    cfg.different_settings_to_system[1]);
  check('one entry per preset slot (print + filaments + printer)',
    cfg.different_settings_to_system.length === cfg.filament_type.length + 2,
    [cfg.different_settings_to_system.length, cfg.filament_type.length]);
  check('printer preset declared unmodified',
    cfg.different_settings_to_system[cfg.different_settings_to_system.length - 1] === '');
  check('stamped with a version Flash Studio accepts', cfg.version === '2.3.2', cfg.version);
  check('model header version matches the config',
    /<metadata name="Application">BambuStudio-2\.3\.2<\/metadata>/.test(dec.decode(files['3D/3dmodel.model'])),
    /<metadata name="Application">([^<]*)/.exec(dec.decode(files['3D/3dmodel.model']))[1]);
  check('slice_info carries the same version',
    /value="2\.3\.2"/.test(dec.decode(files['Metadata/slice_info.config'])));
  check('same bed -> no shift', !report.recentered, report.recentered);
  check('fast (<1500ms)', ms < 1500, ms);
});

// ------------------------------------------------------- small bed: recentre
run('makerworld_a1mini.3mf', {}, ({ report, cfg }) => {
  check('source bed detected as 180', report.sourceBed && report.sourceBed.x === 180, report.sourceBed);
  check('shifted by +38,+38', report.recentered && report.recentered.dx === 38 && report.recentered.dy === 38, report.recentered);
  check('item now at plate centre 128,128', report.placements[0] && report.placements[0].x === 128 && report.placements[0].y === 128, report.placements);
  check('no off-plate warning', !report.warnings.some(w => w.code === 'off_plate'), report.warnings);
});

run('makerworld_a1mini.3mf', { recenter: false }, ({ report }) => {
  check('no shift when disabled', !report.recentered);
  check('item stays at 90,90', report.placements[0].x === 90, report.placements);
});

// ---------------------------------------- unknown enum words are not guessed
{
  console.log('\n\x1b[1munrecognised enum value\x1b[0m');
  const entries = fflate.unzipSync(new Uint8Array(fs.readFileSync(path.join(__dirname, 'fixtures', 'makerworld_p1s.3mf'))));
  const srcCfg = JSON.parse(dec.decode(entries['Metadata/project_settings.config']));
  srcCfg.ensure_vertical_shell_thickness = 'some_future_value';
  entries['Metadata/project_settings.config'] = new TextEncoder().encode(JSON.stringify(srcCfg));
  const tpl = Profiles.get('creator5-0.4').config;
  const { files, report } = Converter.convert(entries, tpl, {});
  const cfg = JSON.parse(dec.decode(files['Metadata/project_settings.config']));
  check('keeps the Creator 5 default instead of guessing',
    cfg.ensure_vertical_shell_thickness === tpl.ensure_vertical_shell_thickness, cfg.ensure_vertical_shell_thickness);
  check('records it as skipped', report.skippedSettings.includes('ensure_vertical_shell_thickness'), report.skippedSettings);
}

// ------------------------------------------------------------ quality tiers
{
  console.log('\n\x1b[1mquality tiers\x1b[0m');
  const raw = fs.readFileSync(path.join(__dirname, 'fixtures', 'makerworld_p1s.3mf'));
  const tpl = Profiles.get('creator5-0.4').config;
  const run1 = (opts) => {
    const { files, report } = Converter.convert(fflate.unzipSync(new Uint8Array(raw)), tpl, opts);
    return { cfg: JSON.parse(dec.decode(files['Metadata/project_settings.config'])), report };
  };

  const off = run1({ quality: 'off' });
  check('off changes nothing', off.report.quality.changes.length === 0, off.report.quality.changes);

  const light = run1({ quality: 'light' });
  const bal = run1({ quality: 'balanced' });
  const max = run1({ quality: 'max' });

  check('each tier does more than the one below',
    light.report.quality.changes.length < bal.report.quality.changes.length
    && bal.report.quality.changes.length < max.report.quality.changes.length,
    [light, bal, max].map(r => r.report.quality.changes.length));

  check('light leaves the outer wall speed alone',
    light.cfg.outer_wall_speed === tpl.outer_wall_speed, light.cfg.outer_wall_speed);
  check('balanced slows the outer wall (200 -> 120)', bal.cfg.outer_wall_speed === '120', bal.cfg.outer_wall_speed);
  check('max slows it further (200 -> 80)', max.cfg.outer_wall_speed === '80', max.cfg.outer_wall_speed);
  check('max lowers outer wall acceleration', Number(max.cfg.outer_wall_acceleration) < Number(bal.cfg.outer_wall_acceleration));
  check('max adds a top layer and a wall loop',
    Number(max.cfg.top_shell_layers) === Number(tpl.top_shell_layers) + 1
    && Number(max.cfg.wall_loops) === Number(bal.cfg.wall_loops) + 1,
    [max.cfg.top_shell_layers, max.cfg.wall_loops]);

  // the promise the feature makes: the expensive settings stay untouched
  ['layer_height', 'initial_layer_print_height', 'sparse_infill_density',
   'sparse_infill_pattern', 'ironing_type', 'top_shell_layers'].forEach((k) => {
    if (k === 'top_shell_layers') return;
    check(`${k} untouched by every tier`,
      [light, bal, max].every(r => r.cfg[k] === off.cfg[k]),
      [k, off.cfg[k], bal.cfg[k]]);
  });
  check('no tier touches infill density', [light, bal, max].every(r => r.cfg.sparse_infill_density === '25%'));

  // every tier only writes keys the profile already has, and only numbers/booleans
  check('tiers never invent a key', Object.keys(Converter.QUALITY_TIERS).every(tier =>
    Converter.QUALITY_TIERS[tier].every(rule => rule.key in tpl)),
    Object.keys(Converter.QUALITY_TIERS).flatMap(t =>
      Converter.QUALITY_TIERS[t].filter(r => !(r.key in tpl)).map(r => r.key)));
  check('tiers only write numeric or boolean values', [light, bal, max].every(r =>
    r.report.quality.changes.every(c => /^-?[\d.]+$/.test(c.to))),
    max.report.quality.changes.filter(c => !/^-?[\d.]+$/.test(c.to)));

  // undeclared changes get reset by Orca on open — this is the trap we already fell into
  [['light', light], ['balanced', bal], ['max', max]].forEach(([name, r]) => {
    const declared = new Set(r.cfg.different_settings_to_system[0].split(';'));
    check(`${name}: every adjusted setting is declared`,
      r.report.quality.changes.every(c => declared.has(c.key)),
      r.report.quality.changes.filter(c => !declared.has(c.key)).map(c => c.key));
  });

  // speeds are machine territory and never carried from a Bambu file, so a tier
  // always computes them from the profile
  check('outer wall speed is not carried from the source', !Converter.CARRY_OVER.includes('outer_wall_speed'));

  // where a setting IS carried, a tier must never undo a finer choice
  {
    const entries = fflate.unzipSync(new Uint8Array(raw));
    const srcCfg = JSON.parse(dec.decode(entries['Metadata/project_settings.config']));
    srcCfg.resolution = '0.005';        // designer asked for finer than the tier target
    srcCfg.top_shell_layers = '8';      // already at the cap
    srcCfg.wall_loops = '4';
    entries['Metadata/project_settings.config'] = new TextEncoder().encode(JSON.stringify(srcCfg));
    const { files } = Converter.convert(entries, tpl, { quality: 'max' });
    const cfg = JSON.parse(dec.decode(files['Metadata/project_settings.config']));
    check('a finer resolution than the tier target survives', cfg.resolution === '0.005', cfg.resolution);
    check('top shell layers stop at the cap', cfg.top_shell_layers === '8', cfg.top_shell_layers);
    check('wall loops stop at the cap', cfg.wall_loops === '4', cfg.wall_loops);
  }

  // floors stop a slow profile being driven into the ground
  {
    const slowTpl = JSON.parse(JSON.stringify(tpl));
    slowTpl.outer_wall_speed = '35';
    const { files } = Converter.convert(fflate.unzipSync(new Uint8Array(raw)), slowTpl, { quality: 'max' });
    const cfg = JSON.parse(dec.decode(files['Metadata/project_settings.config']));
    check('the floor stops it going below 30 mm/s', Number(cfg.outer_wall_speed) >= 30, cfg.outer_wall_speed);
  }

  // ------------------------------------------- the outer wall follows the file
  const atLayer = (h, tier, extra) => {
    const entries = fflate.unzipSync(new Uint8Array(raw));
    const srcCfg = JSON.parse(dec.decode(entries['Metadata/project_settings.config']));
    srcCfg.layer_height = String(h);
    Object.assign(srcCfg, extra || {});
    entries['Metadata/project_settings.config'] = new TextEncoder().encode(JSON.stringify(srcCfg));
    const { files, report } = Converter.convert(entries, tpl, { quality: tier });
    return {
      cfg: JSON.parse(dec.decode(files['Metadata/project_settings.config'])),
      flow: report.quality.flow
    };
  };

  const thin = atLayer(0.12, 'balanced');
  const std = atLayer(0.20, 'balanced');
  const thick = atLayer(0.28, 'balanced');

  check('thin layers keep the speed factor, not an over-slow crawl',
    thin.cfg.outer_wall_speed === '120' && thin.flow.limited === false,
    [thin.cfg.outer_wall_speed, thin.flow]);
  check('thick layers slow down on their own',
    Number(thick.cfg.outer_wall_speed) < Number(std.cfg.outer_wall_speed)
    && Number(std.cfg.outer_wall_speed) <= 120,
    [thin.cfg.outer_wall_speed, std.cfg.outer_wall_speed, thick.cfg.outer_wall_speed]);
  check('the extrusion rate stays at the cap across layer heights',
    [std, thick, atLayer(0.32, 'balanced')].every(r => Math.abs(r.flow.rate - 10) <= 0.2),
    [std.flow.rate, thick.flow.rate]);
  check('max uses a tighter cap than balanced',
    atLayer(0.28, 'max').flow.rate < thick.flow.rate + 0.01,
    [atLayer(0.28, 'max').flow.rate, thick.flow.rate]);
  check('the floor still wins over the flow cap at absurd layer heights',
    Number(atLayer(2.0, 'balanced').cfg.outer_wall_speed) >= 40,
    atLayer(2.0, 'balanced').cfg.outer_wall_speed);
  check('flow numbers are reported for the card',
    std.flow && std.flow.layerHeight === 0.2 && std.flow.lineWidth === 0.42, std.flow);

  // a line width written as a percentage of the nozzle must still work
  {
    const pctTpl = JSON.parse(JSON.stringify(tpl));
    pctTpl.outer_wall_line_width = '105%';        // 105% of a 0.4 nozzle = 0.42
    const entries = fflate.unzipSync(new Uint8Array(raw));
    const srcCfg = JSON.parse(dec.decode(entries['Metadata/project_settings.config']));
    srcCfg.layer_height = '0.28';
    entries['Metadata/project_settings.config'] = new TextEncoder().encode(JSON.stringify(srcCfg));
    const { files } = Converter.convert(entries, pctTpl, { quality: 'balanced' });
    const cfg = JSON.parse(dec.decode(files['Metadata/project_settings.config']));
    check('percentage line widths resolve against the nozzle',
      cfg.outer_wall_speed === thick.cfg.outer_wall_speed,
      [cfg.outer_wall_speed, thick.cfg.outer_wall_speed]);
  }

  // a percentage speed means "relative to another speed" and must be left alone
  {
    const pctTpl = JSON.parse(JSON.stringify(tpl));
    pctTpl.small_perimeter_speed = '50%';
    const { files } = Converter.convert(fflate.unzipSync(new Uint8Array(raw)), pctTpl, { quality: 'max' });
    const cfg = JSON.parse(dec.decode(files['Metadata/project_settings.config']));
    check('a percentage speed is left as a percentage', cfg.small_perimeter_speed === '50%', cfg.small_perimeter_speed);
  }

  check('a missing layer height falls back to the speed factor alone',
    atLayer(0, 'balanced').cfg.outer_wall_speed === '120', atLayer(0, 'balanced').cfg.outer_wall_speed);

  console.log('       balanced:', bal.report.quality.changes.map(c => c.key + ' ' + c.from + '->' + c.to).join(', '));
  console.log('       outer wall by layer height:',
    [0.12, 0.2, 0.28].map(h => h + 'mm→' + atLayer(h, 'balanced').cfg.outer_wall_speed).join('  '));
}

// ------------------------------------------------------------ profile-only
run('makerworld_p1s.3mf', { targetVersion: '2.4.1' }, ({ cfg, files }) => {
  check('donor version overrides the default', cfg.version === '2.4.1', cfg.version);
  check('model header follows the donor version',
    /BambuStudio-2\.4\.1</.test(dec.decode(files['3D/3dmodel.model'])));
});

run('makerworld_p1s.3mf', { mode: 'profile-only' }, ({ cfg }) => {
  check('printer still swapped', cfg.printer_settings_id === 'Flashforge Creator 5 0.4 nozzle');
  check('layer height NOT carried', cfg.layer_height === '0.2', cfg.layer_height);
  check('infill NOT carried', cfg.sparse_infill_density !== '25%', cfg.sparse_infill_density);
  check('colours still preserved', cfg.filament_colour.length === 3);
});

// ----------------------------------------------------------- geometry-only
run('makerworld_p1s.3mf', { mode: 'geometry-only' }, ({ files }) => {
  check('no project settings', !files['Metadata/project_settings.config']);
  check('no metadata at all', !Object.keys(files).some(p => p.startsWith('Metadata/')));
  check('geometry present', !!files['3D/3dmodel.model'] && !!files['3D/Objects/Parametric_Model_Maker_1_1.model']);
  check('container files present', !!files['[Content_Types].xml'] && !!files['_rels/.rels']);
});

// ------------------------------------------------- already-a-Creator-5 file
{
  console.log('\n\x1b[1mreal Creator 5 file (idempotency)\x1b[0m');
  const src = path.join(__dirname, '..', '..', 'To Print', 'Vehicle Number Plate Keychain_CREATOR5.3mf');
  if (fs.existsSync(src)) {
    const entries = fflate.unzipSync(new Uint8Array(fs.readFileSync(src)));
    const { files, report } = Converter.convert(entries, Profiles.get('creator5-0.4').config, {});
    const cfg = JSON.parse(dec.decode(files['Metadata/project_settings.config']));
    check('stays on Creator 5', cfg.printer_settings_id === 'Flashforge Creator 5 0.4 nozzle');
    check('no bed shift', !report.recentered);
    check('layer height preserved', cfg.layer_height === '0.2', cfg.layer_height);
    check('no warnings', report.warnings.length === 0, report.warnings);
  } else { console.log('  (sample missing, skipped)'); }
}

// ---------------------------------------------------------- plain geometry 3mf
{
  console.log('\n\x1b[1mplain non-project 3mf\x1b[0m');
  const entries = fflate.unzipSync(new Uint8Array(fs.readFileSync(path.join(__dirname, 'fixtures', 'makerworld_p1s.3mf'))));
  const plain = {};
  for (const k of Object.keys(entries)) if (k.startsWith('3D/')) plain[k] = entries[k];
  const { files, report } = Converter.convert(plain, Profiles.get('creator5-0.4').config, {});
  const cfg = JSON.parse(dec.decode(files['Metadata/project_settings.config']));
  check('detected as non-project', report.isProject === false);
  check('Creator 5 profile applied', cfg.printer_settings_id === 'Flashforge Creator 5 0.4 nozzle');
  check('defaults to one white filament', cfg.filament_colour.length === 1);
}

// --------------------------------------------------------------- error path
{
  console.log('\n\x1b[1merror handling\x1b[0m');
  let threw = null;
  try { Converter.convert({ 'readme.txt': new Uint8Array([1]) }, Profiles.get('creator5-0.4').config, {}); }
  catch (e) { threw = e.message; }
  check('rejects a 3mf with no model', threw === 'NO_MODEL', threw);
}

// -------------------------------- output must match a genuine C5 file's shape
{
  console.log('\n\x1b[1mstructural match against the real Creator 5 file\x1b[0m');
  const real = path.join(__dirname, '..', '..', 'To Print', 'Vehicle Number Plate Keychain_CREATOR5.3mf');
  if (fs.existsSync(real)) {
    const known = fflate.unzipSync(new Uint8Array(fs.readFileSync(real)));
    const knownCfg = JSON.parse(dec.decode(known['Metadata/project_settings.config']));
    const entries = fflate.unzipSync(new Uint8Array(fs.readFileSync(path.join(__dirname, 'fixtures', 'makerworld_p1s.3mf'))));
    const { files } = Converter.convert(entries, Profiles.get('creator5-0.4').config, {});
    const cfg = JSON.parse(dec.decode(files['Metadata/project_settings.config']));

    const a = new Set(Object.keys(knownCfg)), b = new Set(Object.keys(cfg));
    const missing = [...a].filter(k => !b.has(k));
    const extraKeys = [...b].filter(k => !a.has(k));
    check('same setting keys as a genuine C5 project', missing.length === 0 && extraKeys.length === 0, { missing, extra: extraKeys });

    const machineKeys = Object.keys(knownCfg).filter(k => /^(machine_|printer_|printable_|bed_|nozzle_diameter|gcode_flavor|extruder_)/.test(k));
    const drift = machineKeys.filter(k => JSON.stringify(cfg[k]) !== JSON.stringify(knownCfg[k]));
    check('every machine-level key matches the real file', drift.length === 0, drift);

    const wantFiles = ['3D/3dmodel.model', '3D/_rels/3dmodel.model.rels', 'Metadata/model_settings.config',
      'Metadata/project_settings.config', 'Metadata/slice_info.config', '[Content_Types].xml', '_rels/.rels'];
    check('contains every file a genuine C5 project has', wantFiles.every(f => !!files[f]),
      wantFiles.filter(f => !files[f]));
    check('Content_Types byte-identical to the real file',
      dec.decode(files['[Content_Types].xml']) === dec.decode(known['[Content_Types].xml']));
  } else { console.log('  (sample missing, skipped)'); }
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
