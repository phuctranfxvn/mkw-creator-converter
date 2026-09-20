#!/usr/bin/env node
/* Regenerate js/profiles/creator5.js from a real Orca-Flashforge project file.
 *
 *   node tools/extract-profile.mjs "My Print_CREATOR5.3mf"
 *
 * Use this when Flashforge ships a new profile version, or to bake in a
 * different nozzle size: slice anything for your Creator 5, save the project,
 * and point this at the .3mf. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = process.argv[2];
if (!src) {
  console.error('usage: node tools/extract-profile.mjs <creator5-project.3mf>');
  process.exit(2);
}

const zip = unzipSync(new Uint8Array(fs.readFileSync(src)));
const key = Object.keys(zip).find((p) => /^Metadata\/project_settings\.config$/i.test(p));
if (!key) {
  console.error('No Metadata/project_settings.config in that file — is it an Orca-Flashforge project?');
  process.exit(1);
}

const cfg = JSON.parse(new TextDecoder().decode(zip[key]));
if (!/creator\s*5/i.test(cfg.printer_model || '')) {
  console.warn(`warning: printer_model is "${cfg.printer_model}", not a Creator 5.`);
}

// Keep different_settings_to_system. It records where this profile's values
// differ from Flashforge's stock system preset, and those deviations travel
// with every value in this file. Blanking it makes Flash Studio reload the
// stock preset over the project and silently reset settings such as
// initial_layer_print_height.
const slots = (cfg.filament_type || ['PLA']).length;
cfg.filament_settings_id = Array(slots).fill('Generic PLA @FF C5');
cfg.filament_ids = Array(slots).fill('GFL99');
cfg.filament_type = Array(slots).fill('PLA');
cfg.filament_vendor = Array(slots).fill('Generic');
cfg.filament_colour = ['#FFFFFFFF'];
cfg.filament_multi_colour = ['#FFFFFFFF'];
cfg.from = 'project';
cfg.name = 'project_settings';
for (const k of ['print_host', 'printhost_apikey', 'printhost_cafile', 'print_host_webui']) {
  if (k in cfg) cfg[k] = '';
}

const body = JSON.stringify(cfg, Object.keys(cfg).sort(), 1);
const out = `/* Auto-generated from a real Orca-Flashforge Creator 5 project file.
 * Source: ${JSON.stringify(path.basename(src))} (Metadata/project_settings.config)
 * Printer: ${cfg.printer_settings_id} — profile version ${cfg.version}
 * Do not hand-edit: regenerate with tools/extract-profile.mjs <a-creator5.3mf>
 */
(function (root, factory) {
  var mod = factory();
  if (typeof module === 'object' && module.exports) module.exports = mod;
  else root.C5Profiles = mod;
})(typeof self !== 'undefined' ? self : this, function () {
  var CREATOR5_04 = ${body};

  return {
    list: [
      { id: 'creator5-0.4',     label: 'Flashforge Creator 5 — 0.4mm',     printerModel: 'Flashforge Creator 5',     settingsId: 'Flashforge Creator 5 0.4 nozzle',     exact: true  },
      { id: 'creator5pro-0.4',  label: 'Flashforge Creator 5 Pro — 0.4mm', printerModel: 'Flashforge Creator 5 Pro', settingsId: 'Flashforge Creator 5 Pro 0.4 nozzle', exact: false }
    ],
    base: CREATOR5_04,
    get: function (id) {
      var meta = this.list.filter(function (p) { return p.id === id; })[0] || this.list[0];
      var cfg = JSON.parse(JSON.stringify(CREATOR5_04));
      cfg.printer_model = meta.printerModel;
      cfg.printer_settings_id = meta.settingsId;
      return { config: cfg, meta: meta };
    }
  };
});
`;

const dest = path.join(here, '..', 'js', 'profiles', 'creator5.js');
fs.writeFileSync(dest, out);
console.log(`wrote ${dest} — ${Object.keys(cfg).length} keys from ${cfg.printer_settings_id}`);
