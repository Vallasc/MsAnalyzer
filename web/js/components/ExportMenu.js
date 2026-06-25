// ── Export menu (PNG / SVG / CSV, grafo totale o selezione) ─────────────────
import { html } from '../preact-htm.js';
import { useState, useCallback, useEffect, useRef } from '../preact-hooks.js';
import { Icon } from '../icons.js';
import { exportPng, exportSvg, exportCsv } from '../utils/export.js';

export function ExportMenu({ hasGraph, selectedNode }) {
  const [open, setOpen]   = useState(false);
  const [scope, setScope] = useState('all'); // 'all' | 'selected'
  const [error, setError] = useState(null);
  const ref = useRef(null);

  // Chiudi al click fuori / con Escape.
  useEffect(() => {
    if (!open) return;
    const onDoc = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = e => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);

  // Se non c'è selezione, forza lo scope su "tutto".
  const effScope = scope === 'selected' && selectedNode ? 'selected' : 'all';
  const selId    = selectedNode?.id ?? null;
  const name     = effScope === 'selected'
    ? (selectedNode?.label || selectedNode?.id || 'selezione')
    : 'grafo';

  const run = useCallback(async fn => {
    setError(null);
    try { await fn(); setOpen(false); }
    catch (e) { setError(e?.message || String(e)); }
  }, []);

  if (!hasGraph) return null;

  return html`
    <div id="export-ctrls" ref=${ref}>
      ${open ? html`
        <div id="export-pop">
          <div class="exp-scope">
            <button class=${effScope === 'all' ? 'on' : ''} onClick=${() => setScope('all')}>Tutto</button>
            <button class=${effScope === 'selected' ? 'on' : ''}
                    disabled=${!selectedNode}
                    title=${selectedNode ? '' : 'Seleziona un nodo per esportare la selezione'}
                    onClick=${() => selectedNode && setScope('selected')}>Selezione</button>
          </div>
          <button class="exp-item" onClick=${() => run(() => exportPng(effScope, selId, name))}>
            ${Icon({ name: 'image', size: 15 })}<span>PNG</span>
          </button>
          <button class="exp-item" onClick=${() => run(() => exportSvg(effScope, selId, name))}>
            ${Icon({ name: 'code', size: 15 })}<span>SVG</span>
          </button>
          <button class="exp-item" onClick=${() => run(() => exportCsv(effScope, selId, name))}>
            ${Icon({ name: 'table', size: 15 })}<span>CSV (matrice)</span>
          </button>
          ${error ? html`<div class="exp-err">${error}</div>` : null}
        </div>` : null}
      <button class="zbtn" title="Esporta grafo" onClick=${() => setOpen(o => !o)}>
        ${Icon({ name: 'download', size: 18 })}
      </button>
    </div>`;
}
