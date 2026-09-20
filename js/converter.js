/* Creator5 Converter — core logic.
 * Pure, dependency-free, runs in the browser and in Node (for the test harness).
 * Input/output are plain maps of { "path/in/zip": Uint8Array }.
 */
(function (root, factory) {
  var mod = factory();
  if (typeof module === 'object' && module.exports) module.exports = mod;
  else root.C5Converter = mod;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var dec = new TextDecoder('utf-8');
  var enc = new TextEncoder();
  var txt = function (u8) { return dec.decode(u8); };
  var bin = function (s) { return enc.encode(s); };

  /* ------------------------------------------------------------------ *
   * Print-process settings that describe *what the designer wanted*     *
   * rather than *what the machine can do*. Only these are carried over  *
   * from the MakerWorld project; everything else comes from the         *
   * Creator 5 profile. Speeds, accelerations, temperatures, retraction  *
   * and every machine_* key are deliberately absent.                    *
   * ------------------------------------------------------------------ */
  var CARRY_OVER = [
    // layers & shells
    'layer_height', 'initial_layer_print_height', 'adaptive_layer_height',
    'wall_loops', 'wall_sequence', 'wall_generator', 'wall_distribution_count',
    'min_bead_width', 'min_feature_size', 'detect_thin_wall', 'alternate_extra_wall',
    'top_shell_layers', 'top_shell_thickness', 'bottom_shell_layers', 'bottom_shell_thickness',
    'top_surface_pattern', 'bottom_surface_pattern', 'internal_solid_infill_pattern',
    'ensure_vertical_shell_thickness', 'only_one_wall_top', 'only_one_wall_first_layer',
    'top_one_wall_type', 'interface_shells',
    // infill
    'sparse_infill_density', 'sparse_infill_pattern', 'infill_direction', 'infill_combination',
    'minimum_sparse_infill_area', 'infill_wall_overlap', 'sparse_infill_anchor',
    'sparse_infill_anchor_max', 'detect_narrow_internal_solid_infill', 'infill_anchor',
    'infill_anchor_max', 'align_infill_direction_to_model', 'gap_fill_target', 'filter_out_gap_fill',
    // overhangs & bridges
    'bridge_angle', 'bridge_no_support', 'thick_bridges', 'dont_filter_internal_bridges',
    'max_bridge_length', 'detect_overhang_wall', 'overhang_reverse',
    'overhang_reverse_threshold', 'overhang_reverse_internal_only',
    'make_overhang_printable', 'make_overhang_printable_angle', 'make_overhang_printable_hole_area',
    // support
    'enable_support', 'support_type', 'support_style', 'support_threshold_angle',
    'support_on_build_plate_only', 'support_critical_regions_only', 'support_remove_small_overhang',
    'support_top_z_distance', 'support_bottom_z_distance', 'support_base_pattern',
    'support_base_pattern_spacing', 'support_interface_top_layers', 'support_interface_bottom_layers',
    'support_interface_pattern', 'support_interface_spacing', 'support_interface_loop_pattern',
    'support_object_xy_distance', 'support_object_first_layer_gap', 'support_angle',
    'support_line_width', 'support_expansion', 'support_bottom_interface_spacing',
    'independent_support_layer_height', 'support_filament', 'support_interface_filament',
    'tree_support_branch_angle', 'tree_support_branch_diameter', 'tree_support_branch_distance',
    'tree_support_wall_count', 'tree_support_adaptive_layer_height', 'tree_support_auto_brim',
    'tree_support_brim_width', 'tree_support_tip_diameter', 'tree_support_branch_diameter_angle',
    // bed adhesion
    'brim_type', 'brim_width', 'brim_object_gap', 'brim_ears_max_angle', 'brim_ears_detection_length',
    'raft_layers', 'raft_first_layer_density', 'raft_first_layer_expansion',
    'raft_contact_distance', 'raft_expansion',
    'skirt_loops', 'skirt_distance', 'skirt_height', 'draft_shield',
    // dimensional tuning
    'xy_hole_compensation', 'xy_contour_compensation', 'elefant_foot_compensation',
    'elefant_foot_compensation_layers', 'hole_to_polyhole', 'hole_to_polyhole_threshold',
    'precise_z_height', 'slice_closing_radius', 'slicing_mode', 'resolution',
    // surface finish
    'seam_position', 'seam_gap', 'seam_slope_type', 'staggered_inner_seams',
    'scarf_joint_seam', 'scarf_joint_flow_ratio', 'wipe_on_loops',
    'ironing_type', 'ironing_pattern', 'ironing_flow', 'ironing_spacing',
    'ironing_angle', 'ironing_inset',
    'fuzzy_skin', 'fuzzy_skin_thickness', 'fuzzy_skin_point_distance',
    'fuzzy_skin_first_layer', 'fuzzy_skin_noise_type',
    // multi-material
    'wall_filament', 'sparse_infill_filament', 'solid_infill_filament',
    'top_surface_filament', 'bottom_surface_filament',
    'mmu_segmented_region_max_width', 'mmu_segmented_region_interlocking_depth',
    'flush_into_infill', 'flush_into_objects', 'flush_into_support',
    'prime_tower_width', 'prime_tower_brim_width', 'enable_prime_tower',
    'wipe_tower_no_sparse_layers', 'prime_volume',
    // misc
    'print_sequence', 'reduce_infill_retraction', 'reduce_crossing_wall',
    'max_travel_detour_distance', 'exclude_object'
  ];

  /* A few settings mean the same thing in both slicers but spell their values
   * differently. Bambu Studio writes "enabled"/"disabled" where Flash Studio
   * (Orca) wants a four-way enum; carrying the word across unchanged makes
   * Flash Studio pop a "some values have been replaced" dialog on open.
   *
   * `map`   — source spelling -> Flash Studio spelling.
   * `allow` — spellings Flash Studio already understands, carried as-is.
   * Anything else is left at the Creator 5 default rather than guessed at. */
  var ENUM_FIXUPS = {
    ensure_vertical_shell_thickness: {
      map: { enabled: 'ensure_all', disabled: 'none', '1': 'ensure_all', '0': 'none' },
      allow: ['none', 'ensure_critical_only', 'ensure_moderate', 'ensure_all']
    }
  };

  /* Flash Studio refuses to trust a project that claims a version newer than
   * its own, drops the "unrecognized" keys and says so in a dialog. Bambu's own
   * numbering (02.06.00.51) always looks newer, so the project is stamped with
   * the Flashforge profile version instead — the same one Flashforge's own
   * converted files carry. */
  var TARGET_VERSION = '2.3.2';

  /* Filament-level values this converter may change. They are listed per slot
   * in different_settings_to_system so Orca keeps them instead of reloading the
   * stock preset over the top. */
  var FILAMENT_DIFF_KEYS = [
    'nozzle_temperature', 'nozzle_temperature_initial_layer',
    'hot_plate_temp', 'hot_plate_temp_initial_layer',
    'textured_plate_temp', 'textured_plate_temp_initial_layer',
    'cool_plate_temp', 'cool_plate_temp_initial_layer',
    'temperature_vitrification', 'filament_density', 'filament_cost',
    'filament_max_volumetric_speed', 'filament_flow_ratio'
  ];

  /* ------------------------------------------------------------------ *
   * Quality tiers.                                                      *
   *                                                                     *
   * Deliberately limited to numeric and boolean settings whose values    *
   * were observed in real Creator 5 projects. Enum settings are avoided  *
   * because a spelling Flash Studio does not know gets silently replaced *
   * and pops a dialog on open.                                          *
   *                                                                     *
   * Layer height, infill density and ironing are NOT touched: those are  *
   * what actually multiply print time, and the first two are the         *
   * designer's call. Everything here trades a little speed on the outer  *
   * wall — a small share of total extrusion — for surface finish.        *
   *                                                                     *
   *   scale  target = profile value * factor, then min(current, target)  *
   *   flow   as scale, but also capped so the outer wall never exceeds a   *
   *          volumetric rate: speed = cap / (layer height * line width).   *
   *          This is the one rule that adapts to the file — the same       *
   *          120 mm/s is 8 mm3/s at 0.16 mm layers and 14 at 0.28.         *
   *   min    min(current, value)                                         *
   *   set    force the value                                             *
   *   add    current + n, capped                                         *
   *                                                                     *
   * Scaling from the profile value rather than the current one means a   *
   * file the designer already slowed down is never slowed down further.  *
   * ------------------------------------------------------------------ */
  var QUALITY_LIGHT = [
    { key: 'enable_arc_fitting', set: '1' },            // smoother curves on klipper
    { key: 'precise_outer_wall', set: '1' },            // outer wall at its true width
    { key: 'precise_z_height', set: '1' },
    { key: 'resolution', min: 0.008 },                  // finer arc/segment tolerance
    { key: 'top_surface_acceleration', scale: 0.6, floor: 500 }
  ];

  var QUALITY_BALANCED = QUALITY_LIGHT.concat([
    { key: 'outer_wall_speed', scale: 0.6, floor: 40, flowCap: 10, widthKey: 'outer_wall_line_width' },
    { key: 'small_perimeter_speed', scale: 0.7, floor: 15 },
    { key: 'outer_wall_acceleration', scale: 0.5, floor: 1000 },
    { key: 'overhang_1_4_speed', scale: 0.8, floor: 10 },
    { key: 'overhang_2_4_speed', scale: 0.8, floor: 8 },
    { key: 'overhang_3_4_speed', scale: 0.8, floor: 5 },
    { key: 'bridge_speed', scale: 0.8, floor: 10 },
    { key: 'slowdown_for_curled_perimeters', set: '1' },
    { key: 'reduce_crossing_wall', set: '1' }           // fewer travel scars on the wall
  ]);

  var QUALITY_MAX = QUALITY_BALANCED.concat([
    { key: 'outer_wall_speed', scale: 0.4, floor: 30, flowCap: 7, widthKey: 'outer_wall_line_width' },
    { key: 'outer_wall_acceleration', scale: 0.3, floor: 800 },
    { key: 'inner_wall_acceleration', scale: 0.5, floor: 2000 },
    { key: 'default_acceleration', scale: 0.6, floor: 2000 },
    { key: 'top_surface_acceleration', scale: 0.4, floor: 400 },
    { key: 'top_shell_layers', add: 1, cap: 8 },
    { key: 'wall_loops', add: 1, cap: 4 }
  ]);

  var QUALITY_TIERS = {
    off: [], light: QUALITY_LIGHT, balanced: QUALITY_BALANCED, max: QUALITY_MAX
  };

  /* Orca accepts a line width either in mm or as a percentage of the nozzle. */
  function lineWidthMm(cfg, key) {
    var raw = cfg[key];
    if (Array.isArray(raw)) raw = raw[0];
    var s = String(raw === undefined ? '' : raw).trim();
    var n = parseFloat(s);
    if (!isFinite(n) || n <= 0) return null;
    if (/%$/.test(s)) {
      var nozzle = parseFloat(Array.isArray(cfg.nozzle_diameter) ? cfg.nozzle_diameter[0] : cfg.nozzle_diameter);
      return isFinite(nozzle) && nozzle > 0 ? (n / 100) * nozzle : null;
    }
    return n;
  }

  /* Speed that keeps the extruder at or below `cap` mm3/s for this file. */
  function speedForFlow(cfg, rule) {
    var h = parseFloat(cfg.layer_height);
    var w = lineWidthMm(cfg, rule.widthKey);
    if (!isFinite(h) || h <= 0 || !w) return null;
    return { speed: rule.flowCap / (h * w), layerHeight: h, lineWidth: w };
  }

  function tidy(n) {
    return String(n >= 10 ? Math.round(n) : Math.round(n * 10) / 10);
  }

  /* Applies one tier. Returns the keys it touched, so they can be declared in
   * different_settings_to_system — undeclared changes are reset by Orca. */
  function applyQuality(cfg, template, tier, report) {
    var rules = QUALITY_TIERS[tier] || [];
    var touched = [], changes = {};

    rules.forEach(function (rule) {
      var key = rule.key;
      if (!(key in cfg) || !(key in template)) return;      // unknown to this profile
      var isArray = Array.isArray(cfg[key]);
      var before = isArray ? cfg[key].slice() : cfg[key];
      var flow = rule.flowCap ? speedForFlow(cfg, rule) : null;

      var next = function (current, profileValue) {
        if (rule.set !== undefined) return rule.set;
        // a percentage is relative to another speed, so it already follows it
        if (/%\s*$/.test(String(current))) return current;
        var cur = parseFloat(current);
        if (!isFinite(cur)) return current;
        if (rule.min !== undefined) return String(Math.min(cur, rule.min));
        if (rule.add !== undefined) return String(Math.min(cur + rule.add, rule.cap));

        var base = parseFloat(profileValue);
        if (!isFinite(base)) base = cur;
        var target = base * rule.scale;

        if (rule.flowCap && flow) target = Math.min(target, flow.speed);
        target = Math.max(target, rule.floor);
        return tidy(Math.min(cur, target));
      };

      if (isArray) {
        cfg[key] = cfg[key].map(function (v, i) {
          var pv = Array.isArray(template[key]) ? template[key][i] : template[key];
          return next(v, pv);
        });
      } else {
        cfg[key] = next(cfg[key], Array.isArray(template[key]) ? template[key][0] : template[key]);
      }

      if (JSON.stringify(before) !== JSON.stringify(cfg[key])) {
        if (touched.indexOf(key) === -1) touched.push(key);
        changes[key] = { key: key, from: changes[key] ? changes[key].from : before, to: cfg[key] };
      }
    });

    var outer = rules.filter(function (r) { return r.flowCap; }).pop();
    var outerFlow = outer ? speedForFlow(cfg, outer) : null;

    report.quality = {
      tier: tier,
      changes: touched.map(function (k) {
        return { key: k, from: String(changes[k].from), to: String(changes[k].to) };
      })
    };
    if (outerFlow && cfg[outer.key] !== undefined) {
      var finalSpeed = parseFloat(Array.isArray(cfg[outer.key]) ? cfg[outer.key][0] : cfg[outer.key]);
      if (isFinite(finalSpeed)) {
        report.quality.flow = {
          speed: finalSpeed,
          layerHeight: outerFlow.layerHeight,
          lineWidth: outerFlow.lineWidth,
          rate: Math.round(finalSpeed * outerFlow.layerHeight * outerFlow.lineWidth * 10) / 10,
          cap: outer.flowCap,
          limited: finalSpeed <= outerFlow.speed + 0.5 &&
                   outerFlow.speed < parseFloat(template[outer.key]) * outer.scale
        };
      }
    }
    return touched;
  }

  /* Keys holding a 1-based filament index; clamped when the source project
   * uses more filaments than the Creator 5 has slots. */
  var FILAMENT_INDEX_KEYS = [
    'wall_filament', 'sparse_infill_filament', 'solid_infill_filament',
    'top_surface_filament', 'bottom_surface_filament',
    'support_filament', 'support_interface_filament'
  ];

  /* Generic material presets. Creator 5 ships "Generic PLA @FF C5"; the rest
   * are best-effort names with matching thermal values written inline, so the
   * project still opens even when the preset name is not installed. */
  var MATERIALS = {
    'PLA':      { id: 'GFL99', preset: 'Generic PLA @FF C5',      nozzle: 220, bed: 55,  density: 1.24, vol: 21,  vitrify: 45,  flow: 0.98 },
    'PLA-CF':   { id: 'GFL98', preset: 'Generic PLA-CF @FF C5',   nozzle: 230, bed: 55,  density: 1.22, vol: 8,   vitrify: 45,  flow: 0.98 },
    'PLA-HS':   { id: 'GFL95', preset: 'Generic HS PLA @FF C5',   nozzle: 230, bed: 55,  density: 1.24, vol: 32,  vitrify: 45,  flow: 0.98 },
    'PETG':     { id: 'GFG99', preset: 'Generic PETG @FF C5',     nozzle: 255, bed: 70,  density: 1.27, vol: 10,  vitrify: 75,  flow: 0.95 },
    'PETG-CF':  { id: 'GFG98', preset: 'Generic PETG-CF @FF C5',  nozzle: 260, bed: 70,  density: 1.30, vol: 8,   vitrify: 75,  flow: 0.95 },
    'ABS':      { id: 'GFB99', preset: 'Generic ABS @FF C5',      nozzle: 255, bed: 95,  density: 1.04, vol: 16,  vitrify: 100, flow: 0.95 },
    'ASA':      { id: 'GFB98', preset: 'Generic ASA @FF C5',      nozzle: 260, bed: 95,  density: 1.04, vol: 12,  vitrify: 100, flow: 0.95 },
    'TPU':      { id: 'GFU99', preset: 'Generic TPU @FF C5',      nozzle: 230, bed: 35,  density: 1.21, vol: 3.6, vitrify: 40,  flow: 1.00 },
    'PVA':      { id: 'GFS99', preset: 'Generic PVA @FF C5',      nozzle: 215, bed: 60,  density: 1.24, vol: 8,   vitrify: 45,  flow: 0.98 },
    'PA':       { id: 'GFN99', preset: 'Generic PA @FF C5',       nozzle: 290, bed: 100, density: 1.15, vol: 8,   vitrify: 120, flow: 0.95 },
    'PC':       { id: 'GFC99', preset: 'Generic PC @FF C5',       nozzle: 270, bed: 100, density: 1.20, vol: 10,  vitrify: 130, flow: 0.95 }
  };

  /* Bambu stores one entry per filament, but sometimes one per filament *and*
   * per extruder variant (twice as many). Pick the value that belongs to slot i. */
  function srcSlot(source, key, i, used) {
    if (!source) return null;
    var a = source[key];
    if (!Array.isArray(a) || !a.length) return null;
    if (a.length === used) return a[i];
    if (used && a.length === used * 2) return a[i * 2];
    return (i < a.length) ? a[i] : null;
  }

  /* A source value is only worth keeping when it is a real, positive number;
   * Bambu writes 0 for "this plate type does not apply to this filament". */
  function positive(v) {
    var n = parseFloat(v);
    return (isFinite(n) && n > 0) ? String(v) : null;
  }

  /* Bambu Studio writes -1 to mean "auto" on a number of settings where Flash
   * Studio only accepts a non-negative value, and then refuses the file with
   * "-1 not in range" (raft_first_layer_expansion, tree_support_wall_count).
   * When the Creator 5 profile itself never goes negative on a key, a negative
   * source value is not a number this printer understands, so the profile's
   * value is kept instead. Keys where the profile does use a negative — fan
   * speeds at -1, skirt_start_angle at -135 — are left alone. */
  function negativeWhereProfileIsNot(sourceValue, profileValue) {
    var bad = function (sv, pv) {
      var sn = parseFloat(sv), pn = parseFloat(pv);
      return isFinite(sn) && sn < 0 && isFinite(pn) && pn >= 0;
    };
    if (Array.isArray(sourceValue)) {
      return sourceValue.some(function (v, i) {
        return bad(v, Array.isArray(profileValue) ? profileValue[i] : profileValue);
      });
    }
    return bad(sourceValue, Array.isArray(profileValue) ? profileValue[0] : profileValue);
  }

  function materialFor(type) {
    if (!type) return MATERIALS['PLA'];
    var t = String(type).toUpperCase().trim();
    if (MATERIALS[t]) return MATERIALS[t];
    if (/^PLA/.test(t)) return MATERIALS['PLA'];
    if (/^PETG/.test(t)) return MATERIALS['PETG'];
    if (/^(ABS)/.test(t)) return MATERIALS['ABS'];
    if (/^ASA/.test(t)) return MATERIALS['ASA'];
    if (/^(TPU|TPE)/.test(t)) return MATERIALS['TPU'];
    if (/^(PVA|BVOH|HIPS)/.test(t)) return MATERIALS['PVA'];
    if (/^(PA|PAHT|NYLON)/.test(t)) return MATERIALS['PA'];
    if (/^PC/.test(t)) return MATERIALS['PC'];
    return null;
  }

  /* ------------------------------------------------------------------ */

  function parseBed(printableArea) {
    // ["0x0","256x0","256x256","0x256"] -> { x: 256, y: 256 }
    if (!Array.isArray(printableArea) || !printableArea.length) return null;
    var maxX = 0, maxY = 0, ok = false;
    printableArea.forEach(function (pt) {
      var m = /^\s*(-?[\d.]+)\s*x\s*(-?[\d.]+)\s*$/i.exec(String(pt));
      if (!m) return;
      ok = true;
      maxX = Math.max(maxX, parseFloat(m[1]));
      maxY = Math.max(maxY, parseFloat(m[2]));
    });
    return ok ? { x: maxX, y: maxY } : null;
  }

  function safeJson(u8) {
    try { return JSON.parse(txt(u8)); } catch (e) { return null; }
  }

  function xmlEscape(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* ------------------------------------------------------------------ *
   * Build the Creator 5 project_settings.config                         *
   * ------------------------------------------------------------------ */
  function buildTargetConfig(template, source, opts, report) {
    var cfg = JSON.parse(JSON.stringify(template));
    var slots = (cfg.filament_type || ['PLA']).length || 1;

    /* ---- 1. carry over printer-agnostic process settings ---- */
    if (opts.carryPrintSettings && source) {
      var carried = 0, skipped = [];
      var remapped = [], rejected = [];
      CARRY_OVER.forEach(function (key) {
        if (!(key in source)) return;
        if (!(key in cfg)) { skipped.push(key); return; }   // key unknown to Creator 5
        var sv = source[key], tv = cfg[key];
        if (Array.isArray(tv) !== Array.isArray(sv)) { skipped.push(key); return; }

        if (negativeWhereProfileIsNot(sv, template[key])) {
          rejected.push(key);
          skipped.push(key);
          return;
        }

        var fix = ENUM_FIXUPS[key];
        if (fix && !Array.isArray(sv)) {
          var word = String(sv);
          if (fix.map.hasOwnProperty(word)) {
            if (fix.map[word] !== tv) remapped.push({ key: key, from: word, to: fix.map[word] });
            cfg[key] = fix.map[word];
            carried++;
            return;
          }
          if (fix.allow.indexOf(word) === -1) { skipped.push(key); return; }
        }

        cfg[key] = JSON.parse(JSON.stringify(sv));
        carried++;
      });
      report.carriedSettings = carried;
      report.skippedSettings = skipped;
      report.remapped = remapped;
      report.rejected = rejected;
    }

    /* ---- 1b. quality tier, applied on top of the designer's settings ---- */
    var qualityKeys = applyQuality(cfg, template, opts.quality || 'off', report);

    /* ---- 2. filament slots ---- */
    var srcTypes = (source && Array.isArray(source.filament_type)) ? source.filament_type : [];
    var srcColours = (source && Array.isArray(source.filament_colour)) ? source.filament_colour : [];
    var used = Math.max(srcTypes.length, srcColours.length, 1);

    report.sourceFilaments = used;
    report.targetSlots = slots;
    if (used > slots) {
      report.warnings.push({ code: 'too_many_filaments', n: used, max: slots });
    }

    var colours = [], types = [], presets = [], ids = [], vendors = [];
    var writtenPerSlot = [];
    for (var i = 0; i < slots; i++) {
      var written = writtenPerSlot[i] = [];
      var type = srcTypes[i] || (i < used ? 'PLA' : (template.filament_type || [])[i] || 'PLA');
      var mat = materialFor(type);
      if (!mat) {
        report.warnings.push({ code: 'unknown_material', slot: i + 1, type: type });
        mat = MATERIALS['PLA'];
        type = 'PLA';
      } else if (mat.preset !== 'Generic PLA @FF C5' && i < used) {
        report.warnings.push({ code: 'material_guess', slot: i + 1, type: type, preset: mat.preset });
      }
      types.push(mat === MATERIALS['PLA-HS'] ? 'PLA' : type.toUpperCase());
      presets.push(mat.preset);
      ids.push(mat.id);
      vendors.push('Generic');
      if (i < srcColours.length) colours.push(normaliseColour(srcColours[i]));

      if (opts.retuneTemperatures && i < used) {
        // the source knows this exact spool better than a generic table does,
        // so its own temperatures win whenever it actually states one
        var take = function (key, fallback) {
          return positive(srcSlot(source, key, i, used)) || String(fallback);
        };
        // record what we actually write, so only those keys get declared modified
        var put = function (key, value) { setSlot(cfg, key, i, value); written.push(key); };
        var bed = take('hot_plate_temp', mat.bed);
        put('nozzle_temperature', take('nozzle_temperature', mat.nozzle));
        put('nozzle_temperature_initial_layer', take('nozzle_temperature_initial_layer', take('nozzle_temperature', mat.nozzle)));
        put('hot_plate_temp', bed);
        put('hot_plate_temp_initial_layer', take('hot_plate_temp_initial_layer', bed));
        put('textured_plate_temp', take('textured_plate_temp', bed));
        put('textured_plate_temp_initial_layer', take('textured_plate_temp_initial_layer', bed));
        put('cool_plate_temp', take('cool_plate_temp', Math.min(mat.bed, 35)));
        put('cool_plate_temp_initial_layer', take('cool_plate_temp_initial_layer', Math.min(mat.bed, 35)));
        put('temperature_vitrification', take('temperature_vitrification', mat.vitrify));
        put('filament_density', take('filament_density', mat.density));
        put('filament_cost', take('filament_cost', (cfg.filament_cost || [])[i] || '20'));
        // flow and volumetric limits belong to the machine, not the spool:
        // only touch them when the material is not what the profile was tuned for
        if (types[i] !== 'PLA') {
          put('filament_max_volumetric_speed', String(mat.vol));
          put('filament_flow_ratio', String(mat.flow));
        }
      }
    }
    if (!colours.length) colours = ['#FFFFFFFF'];

    cfg.filament_type = types;
    cfg.filament_settings_id = presets;
    cfg.filament_ids = ids;
    cfg.filament_vendor = vendors;
    cfg.filament_colour = colours;
    cfg.filament_multi_colour = colours.slice();
    report.filaments = colours.map(function (c, i) {
      return { slot: i + 1, colour: c, type: types[i], preset: presets[i] };
    });

    /* ---- 3. clamp filament indices into range ---- */
    FILAMENT_INDEX_KEYS.forEach(function (key) {
      if (!(key in cfg)) return;
      var v = cfg[key];
      var clamp = function (x) {
        var n = parseInt(x, 10);
        if (!isFinite(n) || n < 1) return x;
        return String(Math.min(n, slots));
      };
      cfg[key] = Array.isArray(v) ? v.map(clamp) : clamp(v);
    });

    /* ---- 4. tell Orca which settings really differ from the stock preset ----
     * An empty list means "identical to the system preset", and Orca then loads
     * the system preset over everything written here — which silently throws
     * away every setting carried from the source. The list has one entry for
     * the print preset, one per filament slot, and one for the printer. */
    var tplDiff = template.different_settings_to_system || [];
    var changed = 0;

    /* A key must be declared when our value differs from the profile's, and
     * also when it merely matches the profile while the profile itself differs
     * from Flashforge's stock preset — otherwise Orca resets exactly the
     * settings the designer chose (first layer height is the usual casualty). */
    var declaredPrint = CARRY_OVER.filter(function (key) {
      if (!(key in cfg) || !(key in template)) return false;
      if (JSON.stringify(cfg[key]) !== JSON.stringify(template[key])) { changed++; return true; }
      return !!(opts.carryPrintSettings && source && (key in source));
    }).concat(qualityKeys);

    var diff = [merge(tplDiff[0], declaredPrint)];
    for (var f = 0; f < slots; f++) {
      var wrote = writtenPerSlot[f] || [];
      diff.push(merge(tplDiff[1 + f], FILAMENT_DIFF_KEYS.filter(function (key) {
        if (!Array.isArray(cfg[key]) || !Array.isArray(template[key])) return false;
        return cfg[key][f] !== template[key][f] || wrote.indexOf(key) !== -1;
      })));
    }
    diff.push(tplDiff.length > slots + 1 ? tplDiff[tplDiff.length - 1] : '');
    cfg.different_settings_to_system = diff;

    report.modifiedPrint = changed;
    report.declaredPrint = declaredPrint.length;
    cfg.version = report.version;
    cfg.from = 'project';
    cfg.name = 'project_settings';

    return cfg;
  }

  /* "a;b" + ["b","c"] -> "a;b;c" */
  function merge(existing, added) {
    var seen = {}, all = [];
    String(existing || '').split(';').concat(added || []).forEach(function (k) {
      k = k.trim();
      if (k && !seen[k]) { seen[k] = 1; all.push(k); }
    });
    return all.sort().join(';');
  }

  function setSlot(cfg, key, i, value) {
    if (!Array.isArray(cfg[key])) return;
    while (cfg[key].length <= i) cfg[key].push(cfg[key][cfg[key].length - 1] || value);
    cfg[key][i] = value;
  }

  function normaliseColour(c) {
    var s = String(c || '#FFFFFF').trim();
    if (s[0] !== '#') s = '#' + s;
    s = s.toUpperCase();
    if (/^#[0-9A-F]{6}$/.test(s)) return s + 'FF';
    if (/^#[0-9A-F]{8}$/.test(s)) return s;
    return '#FFFFFFFF';
  }

  /* ------------------------------------------------------------------ *
   * Shift every build item so the plate keeps its relative position     *
   * when the source bed is a different size (e.g. A1 mini 180x180).     *
   * ------------------------------------------------------------------ */
  function recenterModel(modelXml, dx, dy, report) {
    var placed = [];
    var out = modelXml.replace(/(<item\b[^>]*\btransform=")([^"]*)(")/g, function (all, pre, tr, post) {
      var nums = tr.trim().split(/\s+/).map(Number);
      if (nums.length !== 12 || nums.some(function (n) { return !isFinite(n); })) return all;
      nums[9] += dx;
      nums[10] += dy;
      placed.push({ x: round(nums[9]), y: round(nums[10]), z: round(nums[11]) });
      return pre + nums.map(fmt).join(' ') + post;
    });
    report.placements = placed;
    return out;
  }

  /* A MakerWorld project often holds a dozen plates. Orca lays them out on a
   * virtual grid, so items far outside the bed are plates 2..N, not mistakes. */
  /* Flash Studio takes the file's version from the generator string in the
   * model header, so it has to agree with project_settings.config. */
  function stampApplication(modelXml, version) {
    return modelXml.replace(
      /(<metadata name="Application">)([^<]*)(<\/metadata>)/,
      function (all, pre, value, post) {
        return pre + 'BambuStudio-' + xmlEscape(version) + post;
      });
  }

  function countPlates(entries) {
    var key = Object.keys(entries).filter(function (p) {
      return /^Metadata\/model_settings\.config$/i.test(p);
    })[0];
    if (!key) return 1;
    var m = txt(entries[key]).match(/<plate>/g);
    return m ? m.length : 1;
  }

  function collectPlacements(modelXml, report) {
    var placed = [];
    var re = /<item\b[^>]*\btransform="([^"]*)"/g, m;
    while ((m = re.exec(modelXml))) {
      var nums = m[1].trim().split(/\s+/).map(Number);
      if (nums.length === 12) placed.push({ x: round(nums[9]), y: round(nums[10]), z: round(nums[11]) });
    }
    report.placements = placed;
  }

  function fmt(n) {
    return (Math.abs(n) < 1e-12) ? '0' : String(parseFloat(n.toPrecision(9)));
  }
  function round(n) { return Math.round(n * 100) / 100; }

  /* ------------------------------------------------------------------ *
   * Package scaffolding                                                 *
   * ------------------------------------------------------------------ */
  function contentTypes() {
    return '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\n' +
      ' <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>\n' +
      ' <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>\n' +
      ' <Default Extension="png" ContentType="image/png"/>\n' +
      ' <Default Extension="gcode" ContentType="text/x.gcode"/>\n' +
      '</Types>';
  }

  function rootRels(files) {
    var rels = ['<?xml version="1.0" encoding="UTF-8"?>',
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
      ' <Relationship Target="/3D/3dmodel.model" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>'];
    if (files['Metadata/plate_1.png']) {
      rels.push(' <Relationship Target="/Metadata/plate_1.png" Id="rel-2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/thumbnail"/>');
      rels.push(' <Relationship Target="/Metadata/plate_1.png" Id="rel-4" Type="http://schemas.bambulab.com/package/2021/cover-thumbnail-middle"/>');
    }
    if (files['Metadata/plate_1_small.png']) {
      rels.push(' <Relationship Target="/Metadata/plate_1_small.png" Id="rel-5" Type="http://schemas.bambulab.com/package/2021/cover-thumbnail-small"/>');
    }
    rels.push('</Relationships>');
    return rels.join('\n');
  }

  function sliceInfo(version) {
    return '<?xml version="1.0" encoding="UTF-8"?>\n<config>\n  <header>\n' +
      '    <header_item key="X-BBL-Client-Type" value="slicer"/>\n' +
      '    <header_item key="X-BBL-Client-Version" value="' + xmlEscape(version) + '"/>\n' +
      '    <header_item key="OrcaSlicer-Version" value="' + xmlEscape(version) + '"/>\n' +
      '    <uuid value="' + uuidHex() + '"/>\n' +
      '  </header>\n</config>\n';
  }

  function uuidHex() {
    var s = '';
    for (var i = 0; i < 32; i++) s += '0123456789abcdef'[(Math.random() * 16) | 0];
    return s;
  }

  /* ------------------------------------------------------------------ *
   * Main entry                                                          *
   * ------------------------------------------------------------------ */
  var DEFAULTS = {
    mode: 'full',                 // 'full' | 'profile-only' | 'geometry-only'
    targetVersion: null,          // null -> TARGET_VERSION
    carryPrintSettings: true,
    retuneTemperatures: true,
    quality: 'off',               // 'off' | 'light' | 'balanced' | 'max'
    recenter: true,
    keepThumbnails: true,
    dropAuxiliary: true,
    dropSlicedGcode: true
  };

  function convert(entries, template, options) {
    var opts = Object.assign({}, DEFAULTS, options || {});
    var report = {
      warnings: [], notes: [], placements: [], filaments: [],
      droppedFiles: [], sourceApp: null, sourcePrinter: null, sourceBed: null,
      targetBed: null, mode: opts.mode
    };

    var paths = Object.keys(entries);
    var modelPath = paths.filter(function (p) { return /^3D\/3dmodel\.model$/i.test(p); })[0];
    if (!modelPath) {
      // some packages nest the model elsewhere; fall back to the first .model at 3D root
      modelPath = paths.filter(function (p) { return /^3D\/[^/]+\.model$/i.test(p); })[0];
    }
    if (!modelPath) throw new Error('NO_MODEL');

    var srcSettingsPath = paths.filter(function (p) {
      return /^Metadata\/project_settings\.config$/i.test(p);
    })[0];
    var source = srcSettingsPath ? safeJson(entries[srcSettingsPath]) : null;
    report.isProject = !!source;
    if (source) {
      report.sourcePrinter = source.printer_settings_id || source.printer_model || null;
      report.sourceBed = parseBed(source.printable_area);
      report.sourceProcess = source.print_settings_id || null;
    } else {
      report.notes.push('plain_3mf');
    }

    var modelXml = txt(entries[modelPath]);
    var appMatch = /<metadata name="Application">([^<]*)<\/metadata>/.exec(modelXml);
    if (appMatch) report.sourceApp = appMatch[1];

    report.version = opts.targetVersion || TARGET_VERSION;
    modelXml = stampApplication(modelXml, report.version);

    /* ---------- assemble the output package ---------- */
    var out = {};
    var keep = function (p) { out[p] = entries[p]; };

    paths.forEach(function (p) {
      var lower = p.toLowerCase();
      if (lower === '[content_types].xml' || lower === '_rels/.rels') return;           // rewritten
      if (/^metadata\/(project_settings|slice_info)\.config$/.test(lower)) return;       // rewritten
      if (/^metadata\/filament_settings_\d+\.config$/.test(lower)) {                     // Bambu-side
        report.droppedFiles.push(p); return;
      }
      if (opts.dropSlicedGcode && /\.gcode(\.md5)?$/.test(lower)) {
        report.droppedFiles.push(p); return;
      }
      // MakerWorld ships these as "Auxiliaries/"; Bambu Studio writes "Auxiliary/"
      if (opts.dropAuxiliary && /^auxiliar(y|ies)\//.test(lower)) { report.droppedFiles.push(p); return; }
      // Bambu plate bookkeeping and cut data describe a slice we are throwing away
      if (/^metadata\/plate_\d+\.json$/.test(lower) || lower === 'metadata/cut_information.xml') {
        report.droppedFiles.push(p); return;
      }
      if (!opts.keepThumbnails && /^metadata\/.*\.png$/.test(lower)) {
        report.droppedFiles.push(p); return;
      }
      if (opts.mode === 'geometry-only' && !/^3d\//.test(lower)) { report.droppedFiles.push(p); return; }
      keep(p);
    });

    /* ---------- bed / placement ---------- */
    var targetBed = parseBed(template.printable_area) || { x: 256, y: 256 };
    report.targetBed = targetBed;
    report.plates = countPlates(entries);

    var bedDiffers = !!report.sourceBed &&
      (report.sourceBed.x !== targetBed.x || report.sourceBed.y !== targetBed.y);
    var dx = 0, dy = 0;

    if (opts.recenter && bedDiffers) {
      if (report.plates > 1) {
        // every plate sits at its own grid origin; one global offset would only
        // be right for the first of them, so leave the layout alone and say so
        report.warnings.push({
          code: 'multi_plate_bed_mismatch', n: report.plates,
          sx: report.sourceBed.x, sy: report.sourceBed.y, tx: targetBed.x, ty: targetBed.y
        });
      } else {
        dx = (targetBed.x - report.sourceBed.x) / 2;
        dy = (targetBed.y - report.sourceBed.y) / 2;
      }
    }

    if (dx || dy) {
      modelXml = recenterModel(modelXml, dx, dy, report);
      report.recentered = { dx: round(dx), dy: round(dy) };
    } else {
      collectPlacements(modelXml, report);
    }

    if (report.plates > 1) {
      report.warnings.push({ code: 'multi_plate', n: report.plates });
    } else {
      var off = report.placements.filter(function (p) {
        return p.x < 0 || p.y < 0 || p.x > targetBed.x || p.y > targetBed.y;
      });
      if (off.length) {
        report.warnings.push({ code: 'off_plate', n: off.length, x: off[0].x, y: off[0].y });
      }
    }
    out[modelPath] = bin(modelXml);

    /* ---------- settings ---------- */
    if (opts.mode !== 'geometry-only') {
      var cfg = (opts.mode === 'profile-only')
        ? buildTargetConfig(template, source, Object.assign({}, opts, {
            carryPrintSettings: false, retuneTemperatures: false
          }), report)
        : buildTargetConfig(template, source, opts, report);

      out['Metadata/project_settings.config'] = bin(JSON.stringify(cfg, null, 4) + '\n');
      out['Metadata/slice_info.config'] = bin(sliceInfo(report.version));
      if (!out['Metadata/filament_sequence.json']) {
        out['Metadata/filament_sequence.json'] =
          bin('{"plate_1":{"nozzle_sequence":[],"optimal_assignment":[],"sequence":[]}}');
      }
      var msPath = Object.keys(out).filter(function (p) {
        return /^Metadata\/model_settings\.config$/i.test(p);
      })[0];
      if (msPath) {
        out[msPath] = bin(fixModelSettings(txt(out[msPath]),
          (cfg.filament_type || []).length, report));
      }
      report.targetPrinter = cfg.printer_settings_id;
    }

    out['[Content_Types].xml'] = bin(contentTypes());
    out['_rels/.rels'] = bin(rootRels(out));

    return { files: out, report: report };
  }

  /* Clamp per-object / per-part extruder assignments to the slots that exist. */
  function fixModelSettings(xml, slots, report) {
    var clamped = 0;
    var fixed = xml.replace(
      /(<metadata\s+key="extruder"\s+value=")(\d+)(")/g,
      function (all, pre, val, post) {
        var n = parseInt(val, 10);
        if (n > slots) { clamped++; return pre + slots + post; }
        return all;
      });
    if (clamped) report.warnings.push({ code: 'extruder_clamped', n: clamped, max: slots });
    return fixed;
  }

  return {
    convert: convert,
    DEFAULTS: DEFAULTS,
    CARRY_OVER: CARRY_OVER,
    MATERIALS: MATERIALS,
    QUALITY_TIERS: QUALITY_TIERS,
    parseBed: parseBed,
    _internal: { buildTargetConfig: buildTargetConfig, materialFor: materialFor }
  };
});
