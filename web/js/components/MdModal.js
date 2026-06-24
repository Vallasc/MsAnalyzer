import { html }                       from '../preact-htm.js';
import { useState, useCallback }      from '../preact-hooks.js';
import { fetchMdText }                from '../utils/github.js';
import { renderMdHtml, renderMermaidBlocks } from '../utils/markdown.js';
import { Icon }                       from '../icons.js';

// ── MdModal ──────────────────────────────────────────────────────────────────
// Props: { state: {owner,repo,branch,history,idx} | null, onClose, onNavigate }

export function MdModal({ state, onClose, onNavigate }) {
  if (!state) return null;

  const { owner, repo, branch, history, idx } = state;
  const currentPath = (history[idx] || 'README.md').split('#')[0];
  const ghUrl = `https://github.com/${owner}/${repo}/blob/${branch}/${currentPath}`;

  const goBack = useCallback(() => {
    if (idx > 0) onNavigate({ ...state, idx: idx - 1 });
  }, [state, idx, onNavigate]);

  return html`
    <div id="md-modal" class="open">
      <div id="md-modal-bg" onClick=${onClose}></div>
      <div id="md-modal-box">
        <div id="md-modal-hdr">
          <button class="mhbtn" disabled=${idx <= 0} onClick=${goBack}>${Icon({name:'chevron-left', size:13})} Indietro</button>
          <span id="md-modal-path">${currentPath}</span>
          <a href=${ghUrl} target="_blank" rel="noopener"
            style="font-size:11px;color:#3b82f6;text-decoration:none;white-space:nowrap;padding:4px 8px;flex-shrink:0;display:inline-flex;align-items:center;gap:4px;">
            ${Icon({name:'external-link', size:12, color:'#3b82f6'})} GitHub
          </a>
          <button class="mhbtn" onClick=${onClose}>${Icon({name:'x', size:14})}</button>
        </div>
        <${MdModalBody} owner=${owner} repo=${repo} branch=${branch}
          path=${currentPath} state=${state} onNavigate=${onNavigate} />
      </div>
    </div>`;
}

function MdModalBody({ owner, repo, branch, path, state, onNavigate }) {
  const [content, setContent] = useState(null);
  const [loading, setLoading] = useState(true);
  const bodyRef = useCallback(el => {
    if (!el) return;
    setLoading(true);
    fetchMdText(owner, repo, path, branch).then(text => {
      if (!text) { setLoading(false); setContent(null); return; }
      const html = renderMdHtml(text, owner, repo, branch, path);
      el.innerHTML = html;
      // Wire .md links
      el.querySelectorAll('[data-md-link]').forEach(a =>
        a.addEventListener('click', () => {
          const target = a.dataset.mdLink;
          const newHistory = [...state.history.slice(0, state.idx + 1), target];
          onNavigate({ ...state, history: newHistory, idx: newHistory.length - 1 });
        })
      );
      renderMermaidBlocks(el);
      el.scrollTop = 0;
      setLoading(false);
    });
  }, [owner, repo, branch, path]);

  return html`
    <div id="md-modal-body" class="readme-body" ref=${bodyRef}>
      ${loading ? html`<div class="readme-loading" style="padding:48px 0;display:flex;align-items:center;justify-content:center;gap:6px;">${Icon({name:'loader', size:14, color:'#94a3b8'})} Caricamento…</div>` : null}
      ${content === null && !loading ? html`<div style="color:#94a3b8;text-align:center;padding:48px 0;">File non trovato</div>` : null}
    </div>`;
}
