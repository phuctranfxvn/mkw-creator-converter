/* Builds a synthetic "MakerWorld download" (Bambu Studio project) from the real
 * Creator 5 sample, so the converter can be tested without a MakerWorld account. */
const fs = require('fs');
const path = require('path');
const fflate = require('../node_modules/fflate');

const SRC = process.argv[2] || path.join(__dirname, '..', '..', 'To Print', 'Vehicle Number Plate Keychain_CREATOR5.3mf');
const variant = process.argv[3] || 'p1s';

const zip = fflate.unzipSync(new Uint8Array(fs.readFileSync(SRC)));
const dec = new TextDecoder(), enc = new TextEncoder();
const cfg = JSON.parse(dec.decode(zip['Metadata/project_settings.config']));

const BEDS = { p1s: 256, a1mini: 180, h2d: 325 };
const bed = BEDS[variant] || 256;
const MODELS = { p1s: 'Bambu Lab P1S', a1mini: 'Bambu Lab A1 mini', h2d: 'Bambu Lab H2D' };

// --- turn it into a Bambu Lab project -------------------------------------
cfg.printer_model = MODELS[variant];
cfg.printer_settings_id = MODELS[variant] + ' 0.4 nozzle';
cfg.print_settings_id = '0.16mm Optimal @BBL P1P';
cfg.printable_area = [`0x0`, `${bed}x0`, `${bed}x${bed}`, `0x${bed}`];
cfg.printable_height = String(bed);
cfg.gcode_flavor = 'marlin';
cfg.machine_start_gcode = ';===== BAMBU LAB START =====\nM1002 gcode_claim_action : 0\nG28\n';
cfg.machine_end_gcode = ';===== BAMBU LAB END =====\nM400\n';
cfg.default_print_profile = '0.20mm Standard @BBL P1P';
cfg.nozzle_type = ['stainless_steel'];
cfg.printer_structure = 'corexy';
cfg.bbl_use_printhost = '1';
cfg.host_type = 'octoprint';

// filaments: 3 colours, one of them PETG
cfg.filament_type = ['PLA', 'PLA', 'PETG'];
cfg.filament_colour = ['#FF6A13', '#0A2FFF', '#1A1A1A'];
cfg.filament_multi_colour = cfg.filament_colour.slice();
cfg.filament_settings_id = ['Bambu PLA Basic @BBL P1P', 'Bambu PLA Matte @BBL P1P', 'Bambu PETG HF @BBL P1P'];
cfg.filament_ids = ['GFA00', 'GFA01', 'GFG02'];
cfg.filament_vendor = ['Bambu Lab', 'Bambu Lab', 'Bambu Lab'];
cfg.nozzle_temperature = ['220', '220', '255'];
cfg.nozzle_temperature_initial_layer = ['220', '220', '255'];
cfg.hot_plate_temp = ['55', '55', '0'];            // 0 = Bambu's "not applicable"
cfg.hot_plate_temp_initial_layer = ['55', '55', '0'];
cfg.cool_plate_temp = ['35', '35', '0'];
cfg.textured_plate_temp = ['55', '55', '0'];
cfg.filament_density = ['1.31', '1.24', '1.27'];   // a real Bambu matte density

// designer intent that MUST survive the conversion
cfg.layer_height = '0.16';
cfg.initial_layer_print_height = '0.2';
cfg.sparse_infill_density = '25%';
cfg.sparse_infill_pattern = 'gyroid';
cfg.wall_loops = '3';
cfg.enable_support = '1';
cfg.support_type = 'tree(auto)';
cfg.brim_type = 'outer_only';
cfg.brim_width = '5';
cfg.seam_position = 'aligned';
cfg.ensure_vertical_shell_thickness = 'disabled';   // Bambu spelling, not Orca's
cfg.raft_first_layer_expansion = '-1';             // Bambu's "auto"; Flash Studio rejects it
cfg.tree_support_wall_count = '-1';
cfg.wall_filament = '2';
cfg.sparse_infill_filament = '3';

// speeds/temps that MUST NOT survive (Bambu-specific machine tuning)
cfg.outer_wall_speed = '333';
cfg.travel_speed = '777';
cfg.retraction_length = ['0.8'];

// a Bambu-only key the Creator 5 profile has never heard of
cfg.bambu_secret_sauce = '42';

zip['Metadata/project_settings.config'] = enc.encode(JSON.stringify(cfg, null, 4));
zip['Metadata/filament_settings_1.config'] = enc.encode('{"inherits":"Bambu PLA Basic @BBL P1P"}');
zip['Auxiliary/.thumbnails/readme.txt'] = enc.encode('MakerWorld extras');
zip['Metadata/plate_1.gcode'] = enc.encode('; sliced for a Bambu printer\nG28\n');

// rewrite the model to sit on the source bed's centre
let model = dec.decode(zip['3D/3dmodel.model']);
model = model.replace(/(<item\b[^>]*transform=")([^"]*)(")/g, (all, pre, tr, post) => {
  const n = tr.trim().split(/\s+/).map(Number);
  n[9] = bed / 2; n[10] = bed / 2;
  return pre + n.join(' ') + post;
});
model = model.replace('BambuStudio-02.06.00.51', 'BambuStudio-01.10.02.76');
model = model.replace(/\s*<metadata name="OrcaSlicer">[^<]*<\/metadata>/, '');
zip['3D/3dmodel.model'] = enc.encode(model);

const out = path.join(__dirname, 'fixtures', `makerworld_${variant}.3mf`);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, Buffer.from(fflate.zipSync(zip, { level: 6 })));
console.log('fixture ->', out, `(bed ${bed}x${bed})`);
