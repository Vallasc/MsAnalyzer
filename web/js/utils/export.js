// ── Diagram / data export (PNG, SVG, CSV) ───────────────────────────────────
//
// Esporta il grafo attualmente disegnato (post-filtri) come immagine o come
// matrice di adiacenza CSV. Lo scope può essere:
//   'all'      → tutti i nodi/archi visibili
//   'selected' → il nodo selezionato + i suoi vicini diretti

import { getRenderedGraph } from '../diagram/render.js';
import { CFG } from '../config.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK_NS = 'http://www.w3.org/1999/xlink';

// Stack di font concreti: garantiscono una resa identica nell'SVG standalone e
// nella rasterizzazione PNG (i nomi generici come `system-ui` possono non
// risolversi quando l'SVG è caricato come immagine).
const FONT_SANS = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const FONT_MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace";

// id → classe CSS usata in render.js (replace non-alfanumerici con '_')
function _safe(id) { return id.replace(/[^a-z0-9]/gi, '_'); }

function _slug(s) {
  return (s || 'graph').replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'graph';
}

function _download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// URL del repository GitHub: usa l'URL già calcolato dalla libreria Python,
// con fallback su "owner/repo".
function _repoUrl(node) {
  const direct = (node.getAttribute('data-repo-url') || '').trim();
  if (direct) return direct;
  const r = (node.getAttribute('data-repo') || '').trim();
  if (!r || r === 'unknown' || /^https?:\/\//i.test(r)) return r || null;
  return /^[^/\s]+\/[^/\s]+/.test(r) ? `https://github.com/${r}` : null;
}

// Imposta font-family concreti su ogni <text> così la resa resta coerente
// nell'SVG e nel PNG (preservando il monospace dove già usato).
function _normalizeFonts(root) {
  root.querySelectorAll('text, tspan').forEach(t => {
    const ff = (t.getAttribute('font-family') || '').toLowerCase();
    t.setAttribute('font-family', ff.includes('mono') ? FONT_MONO : FONT_SANS);
  });
}

// Avvolge ogni nodo in un link <a> verso il repository GitHub, così cliccando
// il nodo nell'SVG esportato si apre il repo di origine.
function _linkifyNodes(root) {
  root.querySelectorAll('g.node').forEach(node => {
    const url = _repoUrl(node);
    if (!url) return;
    const a = document.createElementNS(SVG_NS, 'a');
    a.setAttributeNS(XLINK_NS, 'xlink:href', url);
    a.setAttribute('href', url);
    a.setAttribute('target', '_blank');
    a.setAttribute('rel', 'noopener');
    const label = node.getAttribute('data-label');
    if (label) {
      const title = document.createElementNS(SVG_NS, 'title');
      title.textContent = label;
      a.appendChild(title);
    }
    node.parentNode.insertBefore(a, node);
    a.appendChild(node);
  });
}

// Spezza un nome troppo lungo su più righe rispetto a maxW, usando measureEl
// (un <text> già nel DOM) per misurare. Impacchetta carattere per carattere,
// preferendo andare a capo dopo un trattino quando il punto è abbastanza
// avanzato nella riga (così non resta orfano un prefisso corto come "pn-").
function _splitToLines(full, maxW, measureEl) {
  const measure = (s) => { measureEl.textContent = s; return measureEl.getComputedTextLength(); };
  const lines = [];
  let line = '';
  let hyphen = -1; // indice subito dopo l'ultimo trattino della riga corrente
  for (let i = 0; i < full.length; i++) {
    const ch = full[i];
    if (line && measure(line + ch) > maxW) {
      if (hyphen > line.length * 0.4 && hyphen < line.length) {
        lines.push(line.slice(0, hyphen));
        line = line.slice(hyphen);
      } else {
        lines.push(line);
        line = '';
      }
      hyphen = line.lastIndexOf('-');
      hyphen = hyphen >= 0 ? hyphen + 1 : -1;
    }
    line += ch;
    if (ch === '-') hyphen = line.length;
  }
  if (line) lines.push(line);
  measureEl.textContent = '';
  return lines;
}

// Manda a capo i nomi dei nodi (etichette .nlbl): nell'SVG/PNG esportato il
// nome completo viene mostrato su più righe invece che troncato con i puntini.
// Va invocata quando il clone è già attaccato al DOM (serve getComputedTextLength).
function _wrapLabels(root) {
  const x = 47;
  const maxW = CFG.nodeW - x - 12;
  root.querySelectorAll('text.nlbl').forEach(t => {
    const full = t.getAttribute('data-raw') || t.textContent || '';
    if (!full) return;
    t.textContent = full;
    if (t.getComputedTextLength() <= maxW) return; // entra in una riga: lascia il nome intero

    // Preferisce 2 righe; riduce il font (fino a 8.5) per i nomi più lunghi,
    // così il blocco resta dentro al box senza toccare il sottotitolo repo.
    let fs = 11.5;
    let lines = _splitToLines(full, maxW, t);
    while (lines.length > 2 && fs > 8.5) {
      fs -= 0.5;
      t.setAttribute('font-size', fs);
      lines = _splitToLines(full, maxW, t);
    }

    const lh = Math.round(fs) + 1;
    t.textContent = '';
    const baseY = parseFloat(t.getAttribute('y')) || 22;
    const startY = baseY - (lines.length - 1) * lh / 2;
    lines.forEach((line, i) => {
      const ts = document.createElementNS(SVG_NS, 'tspan');
      ts.setAttribute('x', x);
      ts.setAttribute('y', startY + i * lh);
      ts.textContent = line;
      t.appendChild(ts);
    });
  });
}

// Sottoinsieme dati (nodi/archi) per lo scope richiesto.
function _subsetData(scope, selectedId) {
  const { nodes, edges } = getRenderedGraph();
  if (scope !== 'selected' || !selectedId) return { nodes, edges };
  const keep = new Set([selectedId]);
  const subEdges = [];
  edges.forEach(e => {
    if (e.from === selectedId || e.to === selectedId) {
      keep.add(e.from); keep.add(e.to);
      subEdges.push(e);
    }
  });
  return { nodes: nodes.filter(n => keep.has(n.id)), edges: subEdges };
}

// ── SVG ─────────────────────────────────────────────────────────────────────
// Costruisce un SVG standalone (string + dimensioni) dal diagramma corrente.
function _buildSvg(scope, selectedId) {
  const src = document.getElementById('diagram');
  if (!src) throw new Error('Nessun diagramma da esportare.');

  const clone = src.cloneNode(true);

  // Rimuovi le aree-click invisibili degli archi e lo sfondo a griglia.
  clone.querySelectorAll('.ehit').forEach(el => el.remove());
  clone.querySelectorAll('rect').forEach(r => {
    if ((r.getAttribute('fill') || '').includes('url(#grid)')) r.remove();
  });

  // Azzera la trasformazione di zoom così il contenuto è in coordinate native.
  const g = clone.querySelector('g');
  if (g) g.removeAttribute('transform');

  if (scope === 'selected' && selectedId) {
    const sel = _safe(selectedId);
    const { edges } = getRenderedGraph();
    const keep = new Set([sel]);
    edges.forEach(e => {
      if (e.from === selectedId) keep.add(_safe(e.to));
      if (e.to   === selectedId) keep.add(_safe(e.from));
    });
    // Sfondi dei gruppi repo: non pertinenti a una selezione.
    clone.querySelectorAll('.repo-bg').forEach(el => el.remove());
    // Tieni solo i nodi della selezione.
    clone.querySelectorAll('g.node').forEach(node => {
      const tok = (node.getAttribute('class') || '').split(/\s+/).find(t => t.startsWith('nd-'));
      if (!tok || !keep.has(tok.slice(3))) node.remove();
    });
    // Tieni solo gli archi/etichette incidenti al nodo selezionato.
    clone.querySelectorAll('.edge, .elb').forEach(el => {
      const tokens = (el.getAttribute('class') || '').split(/\s+/);
      const incident = tokens.includes(`ef-${sel}`) || tokens.includes(`et-${sel}`);
      if (!incident) el.remove();
    });
  }

  // Font coerenti + nodi cliccabili verso il repo di origine.
  _normalizeFonts(clone);
  _linkifyNodes(clone);

  // getBBox richiede un nodo renderizzato: aggancio il clone off-screen.
  clone.style.position = 'absolute';
  clone.style.left = '-99999px';
  clone.style.top = '0';
  clone.style.pointerEvents = 'none';
  document.body.appendChild(clone);

  // Manda a capo i nomi lunghi (richiede il clone già nel DOM per la misura).
  _wrapLabels(clone);

  let bbox;
  try {
    bbox = clone.querySelector('g').getBBox();
  } catch {
    bbox = { x: 0, y: 0, width: src.clientWidth || 1000, height: src.clientHeight || 600 };
  }
  if (!bbox.width || !bbox.height) {
    document.body.removeChild(clone);
    throw new Error('Nessun contenuto da esportare.');
  }

  document.body.removeChild(clone);

  // Rimuovi lo stile/posizionamento off-screen usato solo per la misura:
  // se restasse nell'SVG serializzato, verrebbe applicato al rendering come
  // immagine, spingendo il contenuto fuori dal canvas (esito: file bianco).
  clone.removeAttribute('style');
  clone.removeAttribute('id');

  const pad = 40;
  const x = Math.floor(bbox.x - pad);
  const y = Math.floor(bbox.y - pad);
  const w = Math.ceil(bbox.width  + pad * 2);
  const h = Math.ceil(bbox.height + pad * 2);

  clone.setAttribute('width', w);
  clone.setAttribute('height', h);
  clone.setAttribute('viewBox', `${x} ${y} ${w} ${h}`);
  clone.setAttribute('xmlns', SVG_NS);
  clone.setAttribute('xmlns:xlink', XLINK_NS);

  const bg = document.createElementNS(SVG_NS, 'rect');
  bg.setAttribute('x', x); bg.setAttribute('y', y);
  bg.setAttribute('width', w); bg.setAttribute('height', h);
  bg.setAttribute('fill', '#ffffff');
  clone.insertBefore(bg, clone.firstChild);

  const xml = new XMLSerializer().serializeToString(clone);

  return { xml: '<?xml version="1.0" encoding="UTF-8"?>\n' + xml, w, h };
}

export function exportSvg(scope = 'all', selectedId = null, name = 'graph') {
  const { xml } = _buildSvg(scope, selectedId);
  _download(new Blob([xml], { type: 'image/svg+xml;charset=utf-8' }), `msanalyzer-${_slug(name)}.svg`);
}

export function exportPng(scope = 'all', selectedId = null, name = 'graph', scale = 2) {
  const { xml, w, h } = _buildSvg(scope, selectedId);
  return new Promise((resolve, reject) => {
    const blob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width  = Math.round(w * scale);
      canvas.height = Math.round(h * scale);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      canvas.toBlob(b => {
        if (!b) { reject(new Error('Conversione PNG fallita.')); return; }
        _download(b, `msanalyzer-${_slug(name)}.png`);
        resolve();
      }, 'image/png');
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Rendering immagine fallito.')); };
    img.src = url;
  });
}

// ── CSV (matrice di adiacenza) ──────────────────────────────────────────────
// La matrice CSV è generata a livello di libreria Python (window.buildGraphCsv):
// intestazioni = nodi; cella[riga][colonna] = relazione/i dell'arco riga→colonna.
export function exportCsv(scope = 'all', selectedId = null, name = 'graph') {
  if (typeof window.buildGraphCsv !== 'function')
    throw new Error('Motore Python non pronto — riprova tra qualche secondo.');

  const { nodes, edges } = _subsetData(scope, selectedId);
  if (!nodes.length) throw new Error('Nessun nodo da esportare.');

  const csv = window.buildGraphCsv(JSON.stringify(nodes), JSON.stringify(edges));
  // BOM per compatibilità Excel con i caratteri UTF-8.
  _download(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' }), `msanalyzer-${_slug(name)}.csv`);
}
