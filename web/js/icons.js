// ── Node type icons (Lucide MIT) ─────────────────────────────────────────────
// SVG inner content strings for D3 symbol defs
export const ICON_SVG = {
  ecs: `
    <rect x="2" y="2" width="20" height="8" rx="2"/>
    <rect x="2" y="14" width="20" height="8" rx="2"/>
    <line x1="6" y1="6" x2="6.01" y2="6"/>
    <line x1="6" y1="18" x2="6.01" y2="18"/>`,
  lambda: `<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>`,
  sqs: `<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>`,
  dynamodb: `
    <ellipse cx="12" cy="5" rx="9" ry="3"/>
    <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/>
    <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>`,
  eventbus: `
    <circle cx="18" cy="5" r="3"/>
    <circle cx="6" cy="12" r="3"/>
    <circle cx="18" cy="19" r="3"/>
    <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/>
    <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>`,
  eventrule: `<polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>`,
  external: `
    <circle cx="12" cy="12" r="10"/>
    <line x1="2" y1="12" x2="22" y2="12"/>
    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>`,
};

// HTM/Preact component factory
import { html } from './preact-htm.js';

export function NodeIcon({ type, color = 'currentColor', size = 14 }) {
  const inner = ICON_SVG[type];
  if (!inner) return null;
  return html`<svg
    xmlns="http://www.w3.org/2000/svg"
    width=${size} height=${size} viewBox="0 0 24 24"
    fill="none" stroke=${color} stroke-width="2.2"
    stroke-linecap="round" stroke-linejoin="round"
    style="flex-shrink:0;display:block"
    dangerouslySetInnerHTML=${{ __html: inner }}
  />`;
}

// ── General UI icons (Lucide MIT) ────────────────────────────────────────────
export const UI_ICONS = {
  search:            `<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>`,
  x:                 `<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>`,
  'chevron-left':    `<polyline points="15 18 9 12 15 6"/>`,
  'chevron-right':   `<polyline points="9 18 15 12 9 6"/>`,
  'chevron-up':      `<polyline points="18 15 12 9 6 15"/>`,
  'chevron-down':    `<polyline points="6 9 12 15 18 9"/>`,
  play:              `<polygon points="5 3 19 12 5 21 5 3"/>`,
  'rotate-ccw':      `<polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.45"/>`,
  maximize2:         `<polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/>`,
  'zoom-in':         `<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/>`,
  'zoom-out':        `<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/>`,
  plus:              `<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>`,
  'map-pin':         `<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>`,
  'external-link':   `<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>`,
  'file-text':       `<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/>`,
  'arrow-down-left': `<line x1="17" y1="7" x2="7" y2="17"/><polyline points="17 17 7 17 7 7"/>`,
  'arrow-up-right':  `<line x1="7" y1="17" x2="17" y2="7"/><polyline points="7 7 17 7 17 17"/>`,
  github:            `<path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"/>`,
  'git-branch':      `<line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>`,
  menu:              `<line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/>`,
  loader:            `<line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/>`,
};

export function Icon({ name, color = 'currentColor', size = 14 }) {
  const inner = UI_ICONS[name];
  if (!inner) return null;
  return html`<svg
    xmlns="http://www.w3.org/2000/svg"
    width=${size} height=${size} viewBox="0 0 24 24"
    fill="none" stroke=${color} stroke-width="2"
    stroke-linecap="round" stroke-linejoin="round"
    style="flex-shrink:0;display:block"
    dangerouslySetInnerHTML=${{ __html: inner }}
  />`;
}
