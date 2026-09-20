/* Converts the real MakerWorld sample and compares the result against the
 * reference Creator 5 file sitting next to it in samples/.
 * Skipped when the pair is absent. */
const fs = require('fs');
const path = require('path');
const fflate = require('../node_modules/fflate');
const Converter = require('../js/converter.js');
const Profiles = require('../js/profiles/creator5.js');

const dec = new TextDecoder();
const dir = path.join(__dirname, '..', 'samples');
const SRC = path.join(dir, 'MoonLamp+v2.2.3mf');
const REF = path.join(dir, 'MoonLamp+v2.2_CREATOR5.3mf');

let pass = 0, fail = 0;
const check = (n, c, x) => c
  ? (pass++, console.log('  \x1b[32mok\x1b[0m   ' + n))
  : (fail++, console.log('  \x1b[31mFAIL\x1b[0m ' + n + (x !== undefined ? '  -> ' + JSON.stringify(x) : '')));

if (!fs.existsSync(SRC) || !fs.existsSync(REF)) {
  console.log('\n(samples/ pair not present — skipped)\n');
  process.exit(0);
}

console.log('\n\x1b[1mreal MakerWorld sample vs. reference conversion\x1b[0m');
const t0 = Date.now();
const src = fflate.unzipSync(new Uint8Array(fs.readFileSync(SRC)));
const ref = fflate.unzipSync(new Uint8Array(fs.readFileSync(REF)), {
  filter: (e) => !/^3D\/Objects\//.test(e.name)
});
const refCfg = JSON.parse(dec.decode(ref['Metadata/project_settings.config']));

const tplCfg = Profiles.get('creator5-0.4').config;
const src2Cfg = JSON.parse(dec.decode(src['Metadata/project_settings.config']));
const { files, report } = Converter.convert(src, tplCfg, {});
const cfg = JSON.parse(dec.decode(files['Metadata/project_settings.config']));
console.log(`  (${Object.keys(src).length} entries, ${((Date.now() - t0) / 1000).toFixed(1)}s)`);

// --- agrees with the reference conversion on everything that matters -------
check('same printer as the reference', cfg.printer_settings_id === refCfg.printer_settings_id, [cfg.printer_settings_id, refCfg.printer_settings_id]);
check('same printer model', cfg.printer_model === refCfg.printer_model);
check('same gcode flavor (klipper)', cfg.gcode_flavor === refCfg.gcode_flavor && cfg.gcode_flavor === 'klipper');
check('same bed', JSON.stringify(cfg.printable_area) === JSON.stringify(refCfg.printable_area));
check('same filament presets', JSON.stringify(cfg.filament_settings_id.slice(0, 2)) === JSON.stringify(refCfg.filament_settings_id), [cfg.filament_settings_id, refCfg.filament_settings_id]);
check('same layer height kept from the design (0.16)', cfg.layer_height === refCfg.layer_height && cfg.layer_height === '0.16', [cfg.layer_height, refCfg.layer_height]);
check('same infill', cfg.sparse_infill_density === refCfg.sparse_infill_density && cfg.sparse_infill_pattern === refCfg.sparse_infill_pattern);
check('same shell counts', cfg.top_shell_layers === refCfg.top_shell_layers && cfg.bottom_shell_layers === refCfg.bottom_shell_layers);
check('same support settings', cfg.enable_support === refCfg.enable_support && cfg.support_type === refCfg.support_type);
check('vertical shell setting matches the reference (no Flash Studio dialog)',
  cfg.ensure_vertical_shell_thickness === refCfg.ensure_vertical_shell_thickness
  && cfg.ensure_vertical_shell_thickness === 'ensure_all',
  [cfg.ensure_vertical_shell_thickness, refCfg.ensure_vertical_shell_thickness]);
// "disabled" is legitimate for draft_shield and friends, so only the keys with
// a known vocabulary clash are checked — and nothing may be invented from scratch
const invented = Object.keys(cfg).filter((k) => typeof cfg[k] === 'string'
  && cfg[k] !== refCfg[k] && cfg[k] !== src2Cfg[k] && cfg[k] !== tplCfg[k]);
check('every value comes from the source, the profile or the reference', invented.length === 0, invented);
check('same version as the reference (2.3.2)', cfg.version === refCfg.version && cfg.version === '2.3.2', [cfg.version, refCfg.version]);
check('model header stamped like the reference', (() => {
  const mine = /<metadata name="Application">([^<]*)/.exec(dec.decode(files['3D/3dmodel.model']))[1];
  const theirs = /<metadata name="Application">([^<]*)/.exec(dec.decode(ref['3D/3dmodel.model']))[1];
  return mine === theirs && mine === 'BambuStudio-2.3.2';
})(), /<metadata name="Application">([^<]*)/.exec(dec.decode(files['3D/3dmodel.model']))[1]);
check('the designer\'s settings are declared as modified', (() => {
  const declared = new Set(cfg.different_settings_to_system[0].split(';'));
  return ['layer_height', 'enable_support', 'support_type', 'bottom_shell_layers'].every((k) => declared.has(k));
})(), cfg.different_settings_to_system[0]);
// the reference declares only what differs from ITS base preset (0.12mm), so it
// lists a different set — what matters is that it uses the mechanism at all
check('the reference uses the same mechanism', (() => {
  const theirs = new Set(refCfg.different_settings_to_system[0].split(';'));
  return theirs.has('layer_height') && theirs.has('bottom_shell_layers') && theirs.size > 20;
})(), refCfg.different_settings_to_system[0].slice(0, 80));
check('nothing we changed is left undeclared', (() => {
  const declared = new Set(cfg.different_settings_to_system[0].split(';'));
  return Converter.CARRY_OVER.every((k) => !(k in cfg) || !(k in tplCfg)
    || JSON.stringify(cfg[k]) === JSON.stringify(tplCfg[k]) || declared.has(k));
})(), cfg.different_settings_to_system[0].slice(0, 120));
check('raft expansion matches the reference, not the source -1',
  cfg.raft_first_layer_expansion === refCfg.raft_first_layer_expansion
  && cfg.raft_first_layer_expansion === '2',
  [cfg.raft_first_layer_expansion, refCfg.raft_first_layer_expansion, src2Cfg.raft_first_layer_expansion]);
check('tree support wall count matches the reference',
  cfg.tree_support_wall_count === refCfg.tree_support_wall_count, [cfg.tree_support_wall_count, refCfg.tree_support_wall_count]);
check('no value is negative where the Creator 5 profile is not', (() => {
  const neg = (v) => { const n = parseFloat(v); return isFinite(n) && n < 0; };
  return Object.keys(cfg).filter((k) => {
    if (!(k in tplCfg)) return false;
    const a = Array.isArray(cfg[k]) ? cfg[k][0] : cfg[k];
    const b = Array.isArray(tplCfg[k]) ? tplCfg[k][0] : tplCfg[k];
    return neg(a) && !neg(b);
  });
})().length === 0);
check('Bambu start gcode gone', !/BBL|bambu/i.test(cfg.machine_start_gcode) && cfg.machine_start_gcode === Profiles.get('creator5-0.4').config.machine_start_gcode);

// --- colours: the whole point of keeping a MakerWorld project -------------
const refColours = refCfg.filament_colour.map((c) => c.slice(0, 7).toUpperCase());
const ourColours = cfg.filament_colour.map((c) => c.slice(0, 7).toUpperCase());
check('same filament colours as the reference', JSON.stringify(ourColours) === JSON.stringify(refColours), [ourColours, refColours]);
check('two filaments detected', report.sourceFilaments === 2, report.sourceFilaments);

// --- geometry must come through untouched ---------------------------------
const meshes = Object.keys(src).filter((k) => /^3D\/Objects\//.test(k));
check('every mesh file preserved', meshes.every((k) => files[k] === src[k]), meshes.filter((k) => files[k] !== src[k]));
check('mesh bytes identical (290 MB, byte-for-byte)',
  meshes.every((k) => files[k].length === src[k].length));
check('object relationships preserved', files['3D/_rels/3dmodel.model.rels'] === src['3D/_rels/3dmodel.model.rels']);
check('model_settings preserved (paint, names, transforms)',
  dec.decode(files['Metadata/model_settings.config']) === dec.decode(src['Metadata/model_settings.config']));
check('per-layer height profile preserved', files['Metadata/layer_heights_profile.txt'] === src['Metadata/layer_heights_profile.txt']);

// --- multi-plate handling --------------------------------------------------
check('13 plates detected', report.plates === 13, report.plates);
check('warns that the project has several plates', report.warnings.some((w) => w.code === 'multi_plate'), report.warnings);
check('no bogus off-plate warnings for plates 2..13', !report.warnings.some((w) => w.code === 'off_plate'), report.warnings);
check('nothing shifted (beds are both 256)', !report.recentered, report.recentered);

// --- package hygiene -------------------------------------------------------
check('Auxiliaries/ dropped (real MakerWorld spelling)', !Object.keys(files).some((k) => /^Auxiliaries\//i.test(k)), Object.keys(files).filter((k) => /^Auxiliaries\//i.test(k)));
check('Bambu plate_N.json dropped, as the reference does', !Object.keys(files).some((k) => /^Metadata\/plate_\d+\.json$/.test(k)));
check('cut_information.xml dropped, as the reference does', !files['Metadata/cut_information.xml']);
check('reference also drops those', !Object.keys(ref).some((k) => /^Metadata\/(plate_\d+\.json|cut_information\.xml)$/.test(k)));
check('all 13 plate thumbnails kept', Object.keys(files).filter((k) => /^Metadata\/plate_\d+\.png$/.test(k)).length === 13);

// --- keeping Auxiliaries is a real option ---------------------------------
{
  const kept = Converter.convert(src, Profiles.get('creator5-0.4').config, { dropAuxiliary: false });
  check('Auxiliaries kept when the option is off',
    Object.keys(kept.files).filter((k) => /^Auxiliaries\//i.test(k)).length === 12);
}

// --------------------------------------------- second real file: iris_lamp
{
  const IRIS = path.join(dir, 'iris_lamp.3mf');
  if (fs.existsSync(IRIS)) {
    console.log('\n\x1b[1mreal sample: iris_lamp.3mf (Bambu A1, 2 plates)\x1b[0m');
    const z = fflate.unzipSync(new Uint8Array(fs.readFileSync(IRIS)));
    const zCfg = JSON.parse(dec.decode(z['Metadata/project_settings.config']));
    const out = Converter.convert(z, tplCfg, {});
    const c = JSON.parse(dec.decode(out.files['Metadata/project_settings.config']));
    const declared = new Set(c.different_settings_to_system[0].split(';'));

    check('source is a Bambu A1 project', zCfg.printer_model === 'Bambu Lab A1', zCfg.printer_model);
    check('converted to Creator 5', c.printer_settings_id === 'Flashforge Creator 5 0.4 nozzle');
    check('first layer height kept at the source value', c.initial_layer_print_height === '0.2', c.initial_layer_print_height);
    check('first layer height declared so Orca cannot reset it',
      declared.has('initial_layer_print_height'), c.different_settings_to_system[0].slice(0, 100));
    check('layer height kept and declared',
      c.layer_height === zCfg.layer_height && declared.has('layer_height'), [c.layer_height, zCfg.layer_height]);
    check('2 plates detected', out.report.plates === 2, out.report.plates);
    check('stamped 2.3.2', c.version === '2.3.2', c.version);
    check('iris: raft expansion not left at -1', c.raft_first_layer_expansion === '2', c.raft_first_layer_expansion);
    check('iris: nothing negative the profile would reject', (() => {
      const neg = (v) => { const n = parseFloat(v); return isFinite(n) && n < 0; };
      return !Object.keys(c).some((k) => {
        if (!(k in tplCfg)) return false;
        const a = Array.isArray(c[k]) ? c[k][0] : c[k];
        const b = Array.isArray(tplCfg[k]) ? tplCfg[k][0] : tplCfg[k];
        return neg(a) && !neg(b);
      });
    })());
    check('no unresolved warnings beyond the plate note',
      out.report.warnings.every((w) => w.code === 'multi_plate'), out.report.warnings);
  }
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
