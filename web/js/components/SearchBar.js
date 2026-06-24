import { html } from '../preact-htm.js';
import { useCallback } from '../preact-hooks.js';
import { NODE_CFG } from '../config.js';
import { zoomToNodes, getPositions } from '../diagram/render.js';
import { Icon } from '../icons.js';

export function SearchBar({ payload, lastPositions, onSelectNode }) {
  const handleInput = useCallback(e => {
    const q = e.target.value.trim().toLowerCase();
    const clear = document.getElementById('sb-clear');
    const drop  = document.getElementById('sb-drop');
    if (clear) clear.style.display = q ? 'flex' : 'none';
    if (!q || !payload) { if (drop) drop.style.display = 'none'; return; }
    const pos = getPositions();
    const hits = payload.nodes
      .filter(n => pos.has(n.id))
      .filter(n => {
        const lbl = (n.label || n.id.split('/').pop() || '').toLowerCase();
        return lbl.includes(q) || n.id.toLowerCase().includes(q);
      })
      .slice(0, 14);
    if (!drop) return;
    if (!hits.length) {
      drop.innerHTML = '<div style="padding:10px 12px;color:#94a3b8;font-size:11px;">Nessun risultato</div>';
    } else {
      drop.innerHTML = hits.map(n => {
        const nc = NODE_CFG[n.type] || NODE_CFG.resource;
        const label = n.label || n.id.split('/').pop();
        const repo  = (n.repo || '').split('/').pop();
        return `<div class="sr-item" data-id="${n.id}">
          <span class="sr-badge" style="background:${nc.bg};">${nc.badge}</span>
          <span class="sr-name" title="${n.id}">${label}</span>
          ${repo ? `<span class="sr-repo">${repo}</span>` : ''}
        </div>`;
      }).join('');
      drop.querySelectorAll('.sr-item').forEach(el =>
        el.addEventListener('click', () => {
          onSelectNode(el.dataset.id);
          drop.style.display = 'none';
          const inp = document.getElementById('sb-input');
          if (inp) inp.value = '';
          if (clear) clear.style.display = 'none';
        })
      );
    }
    drop.style.display = 'block';
  }, [payload]);

  const clearSearch = useCallback(() => {
    const inp  = document.getElementById('sb-input');
    const drop = document.getElementById('sb-drop');
    const clr  = document.getElementById('sb-clear');
    if (inp)  inp.value = '';
    if (drop) drop.style.display = 'none';
    if (clr)  clr.style.display = 'none';
  }, []);

  const handleKey = useCallback(e => {
    if (e.key === 'Escape') { clearSearch(); e.stopPropagation(); }
    if (e.key === 'Enter') {
      const first = document.querySelector('.sr-item');
      if (first) { onSelectNode(first.dataset.id); clearSearch(); }
    }
  }, [clearSearch, onSelectNode]);

  return html`
    <div id="search-bar">
      <span id="search-icon" style="display:flex;align-items:center;">${Icon({name:'search', size:14, color:'#94a3b8'})}</span>
      <input id="sb-input" type="text" placeholder="Cerca componente…"
        autocomplete="off" spellcheck="false"
        onInput=${handleInput} onKeyDown=${handleKey} />
      <button id="sb-clear" style="display:none;align-items:center;" onClick=${clearSearch}>${Icon({name:'x', size:14, color:'#94a3b8'})}</button>
      <div id="sb-drop" style="display:none"></div>
    </div>`;
}
