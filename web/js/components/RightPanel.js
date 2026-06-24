import { html }                           from '../preact-htm.js';
import { useState, useEffect, useCallback } from '../preact-hooks.js';
import { NODE_CFG, EDGE_CFG }              from '../config.js';
import { zoomToNodes }                     from '../diagram/render.js';
import { fetchReadme }                     from '../utils/github.js';
import { renderMermaidBlocks }             from '../utils/markdown.js';
import { Icon }                            from '../icons.js';

// ── RightPanel ───────────────────────────────────────────────────────────────
// Props: { node, edges, inE, outE, repoList, onClose, onOpenMd }

export function RightPanel({ node, edges, inE, outE, repoList, onClose, onOpenMd }) {
  const visible = !!node;

  return html`
    <div class="panel" id="right-panel" class=${visible ? 'panel visible' : 'panel'}>
      <div class="panel-hdr">
        <div style="font-size:11.5px;font-weight:600;color:#64748b;">Nodo selezionato</div>
        <button class="ibtn" onClick=${onClose} title="Chiudi">${Icon({name:'x', size:16})}</button>
      </div>
      <div id="details" style="flex:1;overflow-y:auto;padding:14px 16px;font-size:11.5px;color:#475569;">
        ${node
          ? html`<${NodeDetail} node=${node} edges=${edges} inE=${inE} outE=${outE}
                   repoList=${repoList} onOpenMd=${onOpenMd} />`
          : html`<div style="color:#94a3b8;font-size:12px;text-align:center;margin-top:50px;">
                   Clicca su un nodo per vedere i dettagli
                 </div>`
        }
      </div>
    </div>`;
}

function NodeDetail({ node, edges, inE, outE, repoList, onOpenMd }) {
  const nc = NODE_CFG[node.type] || NODE_CFG.resource;
  const owner = _getOwner(node.repo, repoList);
  const repoName = node.repo && node.repo.includes('/') ? node.repo.split('/')[1] : node.repo;
  const ghUrl = owner && repoName ? `https://github.com/${owner}/${repoName}` : null;
  const safeId = node.id.replace(/'/g, "\\'");

  const rows = (arr, dir) => arr.length
    ? arr.map(e => {
        const other = dir === 'out' ? e.to : e.from;
        const short = other.split('/').pop() || other;
        const c = EDGE_CFG[e.relation];
        const arrow = dir === 'out'
        ? Icon({name:'arrow-up-right',  size:10, color:'#3b82f6'})
        : Icon({name:'arrow-down-left', size:10, color:'#22c55e'});
        return html`
          <div class="det-conn">
            <span class="det-rel" style=${{ color: c?.stroke || '#666' }}>${e.relation}</span>
            <span style="color:#475569;font-size:10.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:flex;align-items:center;gap:3px;" title=${other}>${arrow}${short}</span>
          </div>`;
      })
    : html`<div style="color:#94a3b8;font-size:11px;padding:4px 0;">—</div>`;

  return html`
    <div style="display:flex;align-items:flex-start;gap:8px;margin-bottom:10px;">
      <span class="det-badge" style=${{ background: nc.bg }}>${nc.badge}</span>
      <span style="font-weight:600;color:#1e293b;font-size:13px;line-height:1.35;word-break:break-all;">${node.label}</span>
    </div>
    <div style="display:flex;gap:6px;margin-bottom:12px;">
      <button onClick=${() => zoomToNodes(new Set([node.id]), { pad:140, maxScale:2.5 })}
        style="flex:1;padding:6px 8px;background:#f1f5f9;border:1px solid #e2e8f0;border-radius:9px;font-size:11px;cursor:pointer;color:#475569;display:flex;align-items:center;justify-content:center;gap:5px;">
        ${Icon({name:'map-pin', size:12})} Centra
      </button>
      ${ghUrl ? html`
        <a href=${ghUrl} target="_blank" rel="noopener"
          style="flex:1;padding:6px 8px;background:#f1f5f9;border:1px solid #e2e8f0;border-radius:9px;font-size:11px;cursor:pointer;color:#475569;text-decoration:none;text-align:center;display:inline-flex;align-items:center;justify-content:center;gap:5px;">
          ${Icon({name:'github', size:12})} Repo
        </a>` : null}
    </div>
    ${node.resourceType ? html`
      <div style="font-family:monospace;font-size:10px;color:#94a3b8;padding:5px 8px;background:#f1f5f9;border-radius:7px;margin-bottom:10px;">
        ${node.resourceType}
      </div>` : null}
    <div style="font-size:10.5px;font-weight:600;color:#22c55e;margin-bottom:4px;display:flex;align-items:center;gap:4px;">${Icon({name:'arrow-down-left', size:12, color:'#22c55e'})} Incoming</div>
    ${rows(inE, 'in')}
    <div style="font-size:10.5px;font-weight:600;color:#3b82f6;margin-top:12px;margin-bottom:4px;display:flex;align-items:center;gap:4px;">${Icon({name:'arrow-up-right', size:12, color:'#3b82f6'})} Outgoing</div>
    ${rows(outE, 'out')}
    ${owner && repoName ? html`<${ReadmeSection} owner=${owner} repo=${repoName} onOpenMd=${onOpenMd} />` : null}
  `;
}

function ReadmeSection({ owner, repo, onOpenMd }) {
  const [ctx, setCtx] = useState(undefined); // undefined=loading, null=not found

  useEffect(() => {
    setCtx(undefined);
    fetchReadme(owner, repo).then(setCtx);
  }, [owner, repo]);

  const bodyRef = useCallback(el => {
    if (!el || !ctx) return;
    el.innerHTML = ctx.html;
    el.querySelectorAll('[data-md-link]').forEach(a =>
      a.addEventListener('click', () => onOpenMd(owner, repo, ctx.branch, a.dataset.mdLink.split('#')[0]))
    );
    renderMermaidBlocks(el);
  }, [ctx]);

  if (ctx === undefined) return html`
    <div style="border-top:1px solid #e2e8f0;margin:14px 0 8px;"></div>
    <div class="readme-loading" style="display:flex;align-items:center;justify-content:center;gap:6px;">${Icon({name:'loader', size:13, color:'#94a3b8'})} Caricamento README…</div>`;

  if (!ctx) return html`
    <div style="border-top:1px solid #e2e8f0;margin:14px 0 8px;"></div>
    <div style="color:#94a3b8;font-size:11px;padding:6px 0;">README non trovato</div>`;

  return html`
    <div style="border-top:1px solid #e2e8f0;margin:14px 0 8px;"></div>
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
      <span style="font-size:10.5px;font-weight:600;color:#64748b;display:flex;align-items:center;gap:4px;">${Icon({name:'file-text', size:12, color:'#64748b'})} README</span>
      <button onClick=${() => onOpenMd(owner, repo, ctx.branch, 'README.md')}
        style="margin-left:auto;padding:3px 9px;background:#f1f5f9;border:1px solid #e2e8f0;border-radius:6px;font-size:10.5px;cursor:pointer;color:#475569;display:flex;align-items:center;gap:4px;">
        ${Icon({name:'external-link', size:11})} Apri
      </button>
    </div>
    <div class="readme-body" ref=${bodyRef}></div>`;
}

function _getOwner(repoName, repoList) {
  if (!repoName) return null;
  if (repoName.includes('/')) return repoName.split('/')[0];
  const entry = repoList.find(r => r.repo === repoName);
  return entry ? entry.owner : null;
}
