import { html }                                from '../preact-htm.js';
import { useState, useEffect, useCallback }    from '../preact-hooks.js';
import { lsGet, lsSave }                       from '../utils/storage.js';
import { NodeIcon, Icon }                      from '../icons.js';
import {
  LS_REPOS, LS_RELS, LS_TYPES, LS_OPTS, LS_LAYOUT,
  DEFAULT_REPOS, DEFAULT_FILTERS, NODE_CFG, EDGE_CFG,
} from '../config.js';

// ── LeftPanel ────────────────────────────────────────────────────────────────
// Props: { repoList, setRepoList, filters, setFilters, layout, setLayout,
//          logLines, statsChips, onRun, onResetFocus, collapsed, onToggle }

export function LeftPanel({
  repoList, setRepoList, filters, setFilters, layout, setLayout,
  logLines, statsChips, onRun, onResetFocus, collapsed, onToggle,
}) {
  const [logOpen, setLogOpen] = useState(true);

  const toggleRepo = useCallback((i, checked) => {
    const next = repoList.map((r, j) => j === i ? { ...r, checked } : r);
    setRepoList(next);
    lsSave(LS_REPOS, next);
  }, [repoList, setRepoList]);

  const removeRepo = useCallback(i => {
    const next = repoList.filter((_, j) => j !== i);
    setRepoList(next);
    lsSave(LS_REPOS, next);
  }, [repoList, setRepoList]);

  const addRepo = useCallback(e => {
    e.preventDefault();
    const inp = e.target.elements['custom-repo'];
    const raw = inp.value.trim();
    if (!raw.includes('/')) return;
    const [owner, repo] = raw.split('/', 2);
    if (repoList.some(r => r.owner === owner && r.repo === repo)) { inp.value=''; return; }
    const next = [...repoList, { owner, repo, checked: true }];
    setRepoList(next);
    lsSave(LS_REPOS, next);
    inp.value = '';
  }, [repoList, setRepoList]);

  const setFilter = useCallback((key, val) => {
    const next = { ...filters, [key]: val };
    setFilters(next);
    lsSave(LS_OPTS, { labels: next.labels, focus: next.focus });
  }, [filters, setFilters]);

  const toggleRel = useCallback(rel => {
    const rels = filters.rels.includes(rel)
      ? filters.rels.filter(r => r !== rel)
      : [...filters.rels, rel];
    const next = { ...filters, rels };
    setFilters(next);
    lsSave(LS_RELS, rels);
  }, [filters, setFilters]);

  const toggleType = useCallback(type => {
    const types = filters.types.includes(type)
      ? filters.types.filter(t => t !== type)
      : [...filters.types, type];
    const next = { ...filters, types };
    setFilters(next);
    lsSave(LS_TYPES, types);
  }, [filters, setFilters]);

  const changeLayout = useCallback(val => {
    setLayout(val);
    lsSave(LS_LAYOUT, val);
  }, [setLayout]);

  return html`
    <div class="panel" id="left-panel" class=${collapsed ? 'panel collapsed' : 'panel'}>
      <div class="panel-hdr">
        <div>
          <div style="font-size:13.5px;font-weight:700;color:#0f172a;line-height:1.2;display:flex;align-items:center;gap:6px;">
            ${Icon({name:'git-branch', size:15, color:'#0066CC'})}
            <span><span style="color:#0066CC;">SEND</span> MsAnalyzer</span>
          </div>
          <div style="font-size:9.5px;color:#94a3b8;margin-top:1px;">Multi-repo visualizer</div>
        </div>
        <button class="ibtn" id="panel-hide" onClick=${onToggle} title="Nascondi pannello">${Icon({name:'chevron-left', size:16})}</button>
      </div>
      <div class="panel-body">

        <!-- Repositories -->
        <div class="sec">
          <div class="sec-title">Repository</div>
          <div id="preset-list">
            ${repoList.map((r, i) => html`
              <div class="repo-row" key=${`${r.owner}/${r.repo}`}>
                <input type="checkbox" class="repo-chk" checked=${r.checked}
                  onChange=${e => toggleRepo(i, e.target.checked)} />
                <span class="repo-name" title=${`${r.owner}/${r.repo}`}>${r.owner}/${r.repo}</span>
                <button class="repo-rm" onClick=${() => removeRepo(i)} title="Rimuovi">${Icon({name:'x', size:11})}</button>
              </div>`
            )}
          </div>
          <form onSubmit=${addRepo} style="display:flex;gap:4px;margin-top:6px;align-items:stretch;">
            <input name="custom-repo" class="repo-input" type="text" placeholder="owner/repo" style="flex:1;min-width:0;" />
            <button type="submit" style="padding:0 10px;background:#f1f5f9;border:1px solid #e2e8f0;border-radius:8px;cursor:pointer;color:#475569;flex-shrink:0;display:flex;align-items:center;">${Icon({name:'plus', size:16})}</button>
          </form>
        </div>

        <!-- Connection filters -->
        <div class="sec">
          <div class="sec-title">Connessioni</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:1px;">
            ${Object.entries(EDGE_CFG)
              .filter(([rel]) => rel !== 'triggered_by')
              .map(([rel, c]) => html`
                <label class="filter-row" key=${rel}>
                  <input type="checkbox" name="rel" value=${rel}
                    checked=${filters.rels.includes(rel)}
                    onChange=${() => toggleRel(rel)} />
                  <span class="filter-dot" style=${{ background: c.stroke }}></span>
                  <span>${c.label}</span>
                </label>`
            )}
          </div>
        </div>

        <!-- Node type filters -->
        <div class="sec">
          <div class="sec-title">Tipi nodo</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:1px;">
            ${Object.entries(NODE_CFG).map(([type, nc]) => html`
              <label class="filter-row" key=${type}>
                <input type="checkbox" value=${type}
                  checked=${filters.types.includes(type)}
                  onChange=${() => toggleType(type)} />
                <span style="display:flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:5px;background:${nc.bg};flex-shrink:0;">
                  ${NodeIcon({ type, color: nc.text, size: 11 })}
                </span>
                <span>${nc.label}</span>
              </label>`
            )}
          </div>
        </div>

        <!-- Options -->
        <div class="sec">
          <div class="sec-title">Opzioni</div>
          <label class="filter-row">
            <input type="checkbox" checked=${filters.labels}
              onChange=${e => setFilter('labels', e.target.checked)} />
            <span>Label archi</span>
          </label>
          <label class="filter-row">
            <input type="checkbox" checked=${filters.focus}
              onChange=${e => setFilter('focus', e.target.checked)} />
            <span>Focus su click</span>
          </label>
        </div>

        <!-- Layout -->
        <div class="sec">
          <div class="sec-title">Layout</div>
          <select id="layout-algo" class="repo-input"
            value=${layout} onChange=${e => changeLayout(e.target.value)}>
            <option value="stress">Stress (default)</option>
            <option value="stress-cluster">Stress cluster per repo</option>
            <option value="stress-tight">Stress compatto</option>
            <option value="stress-repo">Stress + raggruppa repo</option>
            <option value="layered-lr-ns">Layered LR Network Simplex</option>
            <option value="layered-tb-ns">Layered TB Network Simplex</option>
            <option value="layered-lr-ls">Layered LR Layer Sweep</option>
            <option value="layered-lr-lp">Layered LR Linear Segments</option>
          </select>
        </div>

        <!-- Log -->
        <div class="sec">
          <div style="display:flex;justify-content:space-between;align-items:center;cursor:pointer;"
               onClick=${() => setLogOpen(o => !o)}>
            <div class="sec-title" style="margin-bottom:0;">Log</div>
            <span style="display:flex;align-items:center;">${logOpen ? Icon({name:'chevron-up', size:13, color:'#94a3b8'}) : Icon({name:'chevron-down', size:13, color:'#94a3b8'})}</span>
          </div>
          ${logOpen ? html`<pre id="log">${logLines.join('\n')}</pre>` : null}
        </div>

        <!-- Stats -->
        ${statsChips?.length ? html`
          <div class="sec">
            <div class="sec-title">Componenti trovati</div>
            <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:5px;margin-top:6px;">
              ${statsChips.map(p => html`
                <div key=${p.label} style="background:rgba(255,255,255,0.55);border:1.5px solid ${p.bg};border-radius:10px;padding:7px 6px 6px;text-align:center;">
                  <div style="font-size:17px;font-weight:700;color:${p.bg};line-height:1;">${p.v}</div>
                  <div style="font-size:9px;font-weight:500;color:#64748b;margin-top:3px;">${p.label}</div>
                </div>`
              )}
            </div>
          </div>` : null}

      </div><!-- /panel-body -->
      <div class="panel-ftr">
        <button id="run-btn" class="btn-run" onClick=${onRun}>${Icon({name:'play', size:13, color:'#fff'})} Analizza</button>
        <button id="reset-focus" class="btn-sec" onClick=${onResetFocus}>${Icon({name:'rotate-ccw', size:13})} Reset focus / fit view</button>
      </div>
    </div>`;
}
