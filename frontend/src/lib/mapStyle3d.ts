/**
 * Hand-built dark vector style for the 3D map.
 *
 * Tiles: OpenFreeMap (OpenMapTiles schema, OSM data) — free, no API key,
 * no rate limit, so nothing here can expire or bill us mid-demo.
 *
 * On telling building types apart: the `building` layer in this schema carries
 * only `render_height`, `render_min_height` and `colour` — there is no
 * occupancy or type field, so a footprint cannot be coloured "because it is a
 * mall". What IS real, and what this style uses instead:
 *   - render_height          → height bands, so towers read apart from low-rise
 *   - colour                 → OSM building:colour where a mapper supplied it
 *   - landuse.class          → retail / commercial / industrial / residential
 *                              districts tinted under the buildings
 *   - poi.subclass == 'mall' → actual named malls, labelled from OSM
 * Everything drawn here is in the data; nothing is invented.
 */

import type { StyleSpecification } from 'maplibre-gl'

const TILES = 'https://tiles.openfreemap.org/planet'
const GLYPHS = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf'

// Only Regular / Bold / Italic are served. Naming a font this server lacks
// 404s the glyph range, which rejects the whole tile parse in the worker and
// silently blanks every layer in that tile.
const FONT = ['Noto Sans Regular']
const FONT_BOLD = ['Noto Sans Bold']

const C = {
  land: '#050a14',
  water: '#06182e',
  park: '#07160f',
  roadMinor: '#17293d',
  roadMain: '#24415e',
  roadTrunk: '#3b6188',
  motorway: '#4a7fae',
  rail: '#152636',
  label: '#7fb4dd',
  labelHalo: '#020610',
  labelMinor: '#44708f',
  mall: '#c9a2ff',
  transit: '#43d9ff',
}

export const darkStyle3d: StyleSpecification = {
  version: 8,
  glyphs: GLYPHS,
  sources: {
    openmaptiles: { type: 'vector', url: TILES },
  },
  light: { anchor: 'viewport', position: [1.4, 210, 38], color: '#a8dcff', intensity: 0.42 },
  layers: [
    { id: 'bg', type: 'background', paint: { 'background-color': C.land } },

    // ── Land use: gives districts a character before any building appears ──
    {
      id: 'landuse',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'landuse',
      paint: {
        'fill-color': [
          'match', ['get', 'class'],
          'retail', '#241630',       // shopping districts — warm violet
          'commercial', '#15243c',   // offices / business parks
          'industrial', '#1c1d26',   // works and depots
          'residential', '#0b1322',
          'hospital', '#24161c',
          ['college', 'university', 'school', 'education'], '#101f24',
          'garages', '#131620',
          'rgba(0,0,0,0)',
        ],
        'fill-opacity': ['interpolate', ['linear'], ['zoom'], 11, 0.35, 15, 0.7],
      },
    },
    {
      id: 'park',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'park',
      paint: { 'fill-color': C.park, 'fill-opacity': 0.8 },
    },
    {
      id: 'pitch',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'landuse',
      filter: ['in', ['get', 'class'], ['literal', ['pitch', 'playground']]],
      minzoom: 14,
      paint: { 'fill-color': '#0d2a1c', 'fill-opacity': 0.75 },
    },
    {
      id: 'water',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'water',
      paint: { 'fill-color': C.water },
    },
    {
      id: 'waterway',
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'waterway',
      paint: { 'line-color': C.water, 'line-width': 1.4 },
    },

    // ── Roads ─────────────────────────────────────────────────────────────
    {
      id: 'road-minor',
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'transportation',
      filter: ['in', ['get', 'class'], ['literal', ['minor', 'service', 'track']]],
      minzoom: 12,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': C.roadMinor,
        'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], 12, 0.4, 18, 6],
      },
    },
    {
      id: 'road-secondary',
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'transportation',
      filter: ['in', ['get', 'class'], ['literal', ['secondary', 'tertiary']]],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': C.roadMain,
        'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], 9, 0.6, 18, 11],
      },
    },
    {
      id: 'road-primary',
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'transportation',
      filter: ['in', ['get', 'class'], ['literal', ['primary', 'trunk']]],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': C.roadTrunk,
        'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], 8, 0.9, 18, 15],
      },
    },
    {
      id: 'road-motorway',
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'transportation',
      filter: ['==', ['get', 'class'], 'motorway'],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': C.motorway,
        'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], 6, 1, 18, 19],
      },
    },
    {
      id: 'rail',
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'transportation',
      filter: ['==', ['get', 'class'], 'rail'],
      minzoom: 12,
      paint: { 'line-color': C.rail, 'line-width': 1.3 },
    },

    // ── Buildings ─────────────────────────────────────────────────────────
    // Banded by real height so the skyline is legible at a glance:
    //   < 8 m   low-rise / sheds
    //   8-18 m  mid-rise — typical commercial and apartment blocks
    //   18-35 m large footprint blocks: malls, IT campuses
    //   35-70 m highrise apartments and office towers
    //   > 70 m  landmark towers
    {
      id: 'building-3d',
      type: 'fill-extrusion',
      source: 'openmaptiles',
      'source-layer': 'building',
      minzoom: 13,
      filter: ['!', ['has', 'hide_3d']],
      paint: {
        'fill-extrusion-base': ['get', 'render_min_height'],
        'fill-extrusion-height': [
          'interpolate', ['linear'], ['zoom'],
          13, 0,
          13.8, ['get', 'render_height'],
        ],
        'fill-extrusion-color': [
          // Respect an explicitly mapped OSM building:colour when there is one,
          // otherwise fall back to the height band.
          'case',
          ['has', 'colour'], ['to-color', ['get', 'colour'], '#1d4b74'],
          [
            'interpolate', ['linear'], ['get', 'render_height'],
            0, '#0e2138',
            8, '#163a5e',
            18, '#1e5280',
            35, '#2a6fa4',
            70, '#3e92c8',
            120, '#5fb6e8',
          ],
        ],
        'fill-extrusion-opacity': 1,
        'fill-extrusion-vertical-gradient': true,
      },
    },


    // Roof caps: a thin lighter slab on top of every building over 14 m, so
    // rooftops catch the light and the skyline has a crisp edge. Real heights,
    // drawn as geometry (depth-tested), not an overlay.
    {
      id: 'building-roof',
      type: 'fill-extrusion',
      source: 'openmaptiles',
      'source-layer': 'building',
      minzoom: 14,
      filter: ['all', ['!', ['has', 'hide_3d']], ['>', ['get', 'render_height'], 14]],
      paint: {
        'fill-extrusion-base': [
          'interpolate', ['linear'], ['zoom'],
          13, 0,
          13.8, ['max', ['get', 'render_min_height'], ['-', ['get', 'render_height'], 1.4]],
        ],
        'fill-extrusion-height': [
          'interpolate', ['linear'], ['zoom'],
          13, 0,
          13.8, ['get', 'render_height'],
        ],
        'fill-extrusion-color': [
          'interpolate', ['linear'], ['get', 'render_height'],
          14, '#2c6a9c',
          35, '#4a9ad0',
          70, '#7cc6f2',
          120, '#b4e4ff',
        ],
        'fill-extrusion-opacity': 1,
        'fill-extrusion-vertical-gradient': false,
      },
    },

    // ── Labels ────────────────────────────────────────────────────────────
    {
      id: 'road-label',
      type: 'symbol',
      source: 'openmaptiles',
      'source-layer': 'transportation_name',
      minzoom: 13.5,
      layout: {
        'text-field': ['get', 'name'],
        'text-font': FONT,
        'text-size': 11,
        'symbol-placement': 'line',
      },
      paint: {
        'text-color': C.labelMinor,
        'text-halo-color': C.labelHalo,
        'text-halo-width': 1.4,
      },
    },

    // Transit — useful landmarks for orienting on a road map
    {
      id: 'poi-transit',
      type: 'symbol',
      source: 'openmaptiles',
      'source-layer': 'poi',
      minzoom: 14.5,
      filter: ['in', ['get', 'subclass'], ['literal', ['subway', 'station']]],
      layout: {
        'text-field': ['concat', '◉  ', ['get', 'name']],
        'text-font': FONT,
        'text-size': 10.5,
        'text-anchor': 'left',
        'text-offset': [0.4, 0],
        'text-optional': true,
      },
      paint: {
        'text-color': C.transit,
        'text-halo-color': C.labelHalo,
        'text-halo-width': 1.6,
      },
    },

    // Malls and department stores — the one building-use signal the data
    // genuinely carries, as named POIs rather than guessed footprints
    {
      id: 'poi-mall',
      type: 'symbol',
      source: 'openmaptiles',
      'source-layer': 'poi',
      minzoom: 13.5,
      filter: ['in', ['get', 'subclass'], ['literal', ['mall', 'department_store']]],
      layout: {
        'text-field': ['concat', '▣  ', ['get', 'name']],
        'text-font': FONT_BOLD,
        'text-size': ['interpolate', ['linear'], ['zoom'], 13.5, 10, 17, 12.5],
        'text-anchor': 'left',
        'text-offset': [0.4, 0],
        'text-max-width': 11,
      },
      paint: {
        'text-color': C.mall,
        'text-halo-color': C.labelHalo,
        'text-halo-width': 1.8,
      },
    },

    {
      id: 'place-label',
      type: 'symbol',
      source: 'openmaptiles',
      'source-layer': 'place',
      minzoom: 4,
      filter: ['in', ['get', 'class'], ['literal', ['city', 'town', 'village', 'suburb', 'quarter', 'neighbourhood', 'hamlet', 'isolated_dwelling']]],
      layout: {
        'text-field': ['get', 'name'],
        'text-font': FONT_BOLD,
        'text-size': [
          'interpolate', ['linear'], ['zoom'],
          8, ['case', ['==', ['get', 'class'], 'city'], 15, 11],
          15, ['case', ['==', ['get', 'class'], 'city'], 20, 13],
        ],
        'text-letter-spacing': 0.08,
        'text-max-width': 9,
      },
      paint: {
        'text-color': C.label,
        'text-halo-color': C.labelHalo,
        'text-halo-width': 1.8,
      },
    },
  ],
}
