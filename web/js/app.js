// ── App root ─────────────────────────────────────────────────────────────────
import { html, render }                        from './preact-htm.js';
import { useState, useEffect, useCallback, useRef } from './preact-hooks.js';
import { lsGet, lsSave }                       from './utils/storage.js';
import { initMermaid }                         from './utils/markdown.js';
import {
  LS_REPOS, LS_RELS, LS_TYPES, LS_OPTS, LS_LAYOUT,
  DEFAULT_REPOS, DEFAULT_FILTERS, NODE_CFG,
} from './config.js';
import * as Diagram from './diagram/render.js';
import { Icon }        from './icons.js';
import { LeftPanel }   from './components/LeftPanel.js';
import { RightPanel }  from './components/RightPanel.js';
import { SearchBar }   from './components/SearchBar.js';
import { ZoomControls } from './components/ZoomControls.js';
import { MdModal }     from './components/MdModal.js';

initMermaid();

// ── App component ─────────────────────────────────────────────────────────────
function App() {
  // ── Persisted state ────────────────────────────────────────────────────────
  const [repoList, setRepoList] = useState(() => lsGet(LS_REPOS, DEFAULT_REPOS));
  const [filters,  setFilters]  = useState(() => {
    const validRels  = new Set(DEFAULT_FILTERS.rels);
    const validTypes = new Set(DEFAULT_FILTERS.types);
    const rels   = lsGet(LS_RELS,  DEFAULT_FILTERS.rels).filter(r => validRels.has(r));
    const types  = lsGet(LS_TYPES, DEFAULT_FILTERS.types).filter(t => validTypes.has(t));
    const opts   = lsGet(LS_OPTS,   {});
    return {
      rels, types,
      labels: opts.labels ?? DEFAULT_FILTERS.labels,
      focus:  opts.focus  ?? DEFAULT_FILTERS.focus,
    };
  });
  const [layout, setLayout] = useState(() => lsGet(LS_LAYOUT, 'stress'));

  // ── Runtime state ──────────────────────────────────────────────────────────
  const [payload,      setPayload]      = useState(null);
  const [selectedNode, setSelectedNode] = useState(null);
  const [focusEdges,   setFocusEdges]   = useState({ inE: [], outE: [] });
  const [allEdges,     setAllEdges]     = useState([]);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [mdModal,      setMdModal]      = useState(null); // {owner,repo,branch,history,idx}
  const [logLines,     setLogLines]     = useState([]);
  const [statsChips,   setStatsChips]   = useState([]);
  const [loading,      setLoading]      = useState(false);
  const [lastSize,     setLastSize]     = useState({ w: 1000, h: 600 });
  const fitNextRef = useRef(false);

  const appendLog = useCallback(msg => setLogLines(l => [...l, msg]), []);

  // ── Re-render diagram when payload/filters/layout change ──────────────────
  useEffect(() => {
    if (!payload) return;
    const doFit = fitNextRef.current;
    fitNextRef.current = false;
    Diagram.render(payload, { filters, layout, doFit }).then(() => {
      setLastSize(Diagram.getLastSize());
    });
  }, [payload, filters, layout]);

  // ── Node click handler ────────────────────────────────────────────────────
  useEffect(() => {
    Diagram.setNodeClickHandler((node, edges) => {
      const inE  = edges.filter(e => e.to   === node.id);
      const outE = edges.filter(e => e.from === node.id);
      if (filters.focus) Diagram.applyFocus(node, edges);
      setSelectedNode(node);
      setAllEdges(edges);
      setFocusEdges({ inE, outE });
    });
    window.__onClearFocus = () => {
      Diagram.clearFocus();
      setSelectedNode(null);
      setFocusEdges({ inE: [], outE: [] });
    };
  }, [filters.focus]);

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = e => {
      if (e.key === 'Escape') {
        setMdModal(null);
        window.__onClearFocus?.();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') runAnalysis();
      if (!e.ctrlKey && !e.metaKey) {
        if (e.key === '=') d3.select('#diagram').call(window.__svgZoom?.scaleBy, 1.25);
        if (e.key === '-') d3.select('#diagram').call(window.__svgZoom?.scaleBy, 1/1.25);
        if (e.key === '0') Diagram.fitView(lastSize.w, lastSize.h);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lastSize]);

  // ── Analysis ───────────────────────────────────────────────────────────────
  const runAnalysis = useCallback(async () => {
    const repos = repoList.filter(r => r.checked);
    if (!repos.length) { appendLog('⚠️ Seleziona almeno un repository.'); return; }
    if (typeof window.buildMultiRepoGraph === 'undefined') {
      appendLog('⚠️ PyScript non pronto — attendi qualche secondo e riprova.'); return;
    }
    setLoading(true);
    setLogLines([]);
    try {
      const resultJson = await window.buildMultiRepoGraph.callPromising(
        JSON.stringify(repos.map(r => ({ owner: r.owner, repo: r.repo })))
      );
      const data = JSON.parse(resultJson);
      if (data.log) data.log.split('\n').filter(l => l.trim()).forEach(appendLog);
      const s = data.stats || {};
      setStatsChips([
        { v: s.repos,      type: null,        label: 'Repo',                        bg: '#47556999' },
        { v: s.ecs,        type: 'ecs',        label: NODE_CFG.ecs.label,       bg: NODE_CFG.ecs.bg       },
        { v: s.lambda,     type: 'lambda',     label: NODE_CFG.lambda.label,    bg: NODE_CFG.lambda.bg    },
        { v: s.sqs,        type: 'sqs',        label: NODE_CFG.sqs.label,       bg: NODE_CFG.sqs.bg       },
        { v: s.dynamo,     type: 'dynamodb',   label: NODE_CFG.dynamodb.label,  bg: NODE_CFG.dynamodb.bg  },
        { v: s.rest_calls, type: null,         label: 'REST',                        bg: '#b91c1c'             },
        { v: s.external,   type: 'external',   label: NODE_CFG.external.label,  bg: NODE_CFG.external.bg  },
        { v: s.eventrules, type: 'eventrule',  label: NODE_CFG.eventrule.label, bg: NODE_CFG.eventrule.bg },
      ].filter(p => p.v > 0));
      appendLog(`\n✅ Completato — repo:${s.repos}`);
      fitNextRef.current = true;
      setPayload(data.graph);
    } catch (e) {
      appendLog('✗ Errore JS: ' + e);
    } finally {
      setLoading(false);
    }
  }, [repoList, filters, layout, appendLog]);

  const resetFocus = useCallback(() => {
    window.__onClearFocus?.();
    Diagram.fitView(lastSize.w, lastSize.h);
  }, [lastSize]);

  const selectSearchNode = useCallback(nodeId => {
    if (!payload) return;
    const node = payload.nodes.find(n => n.id === nodeId);
    if (!node) return;
    Diagram.zoomToNodes(new Set([nodeId]), { pad: 140, maxScale: 2.5 });
    const edges = payload.edges.filter(e => e.from === nodeId || e.to === nodeId);
    if (filters.focus) Diagram.applyFocus(node, payload.edges);
    else {
      setSelectedNode(node);
      setAllEdges(payload.edges);
      setFocusEdges({
        inE:  payload.edges.filter(e => e.to   === nodeId),
        outE: payload.edges.filter(e => e.from === nodeId),
      });
    }
  }, [payload, filters.focus]);

  const openMdModal = useCallback((owner, repo, branch, path) => {
    setMdModal({ owner, repo, branch, history: [path], idx: 0 });
  }, []);

  return html`
    <!-- Loading overlay -->
    <div id="loading" class=${loading ? 'on' : ''}>
      <div class="spinner"></div>
      <div style="font-size:13px;color:#64748b;">Analisi in corso…</div>
    </div>

    <!-- Left panel -->
    <${LeftPanel}
      repoList=${repoList}    setRepoList=${setRepoList}
      filters=${filters}      setFilters=${setFilters}
      layout=${layout}        setLayout=${setLayout}
      logLines=${logLines}    statsChips=${statsChips}
      onRun=${runAnalysis}    onResetFocus=${resetFocus}
      collapsed=${leftCollapsed} onToggle=${() => setLeftCollapsed(c => !c)} />

    <!-- Left panel toggle -->
    ${leftCollapsed ? html`
      <button id="panel-toggle" class="show" onClick=${() => setLeftCollapsed(false)}>${Icon({name:'menu', size:17})}</button>` : null}

    <!-- Right panel -->
    <${RightPanel}
      node=${selectedNode}
      edges=${allEdges}
      inE=${focusEdges.inE}
      outE=${focusEdges.outE}
      repoList=${repoList}
      onClose=${() => window.__onClearFocus?.()}
      onOpenMd=${openMdModal} />

    <!-- Search bar -->
    <${SearchBar} payload=${payload} onSelectNode=${selectSearchNode} />

    <!-- Zoom controls -->
    <${ZoomControls} lastW=${lastSize.w} lastH=${lastSize.h} />

    <!-- MD Modal -->
    ${mdModal ? html`
      <${MdModal}
        state=${mdModal}
        onClose=${() => setMdModal(null)}
        onNavigate=${setMdModal} />` : null}
  `;
}

render(html`<${App} />`, document.getElementById('app'));
