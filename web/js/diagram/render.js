// ── D3 diagram renderer ─────────────────────────────────────────────────────
//
// Imperative module: owns the SVG canvas, D3 zoom, and all rendering.
// Called from app.js; fires callbacks on node interaction.

import { CFG, NODE_CFG, EDGE_CFG, PAN_DIM_OPACITY, CLUSTER_COLORS } from '../config.js';
import { ICON_SVG } from '../icons.js';
import { computeLayout, lastRepoBounds } from './layout.js';

// ── Private state ───────────────────────────────────────────────────────────
let _svgZoom      = null;
let _currentT     = d3.zoomIdentity;
let _lastPositions = new Map();
let _lastW = 1000, _lastH = 600;
let _onNodeClick  = null; // callback(node, edges)
let _lastGraph    = { nodes: [], edges: [] }; // grafo effettivamente disegnato (post-filtri)

// ── Public API ──────────────────────────────────────────────────────────────
export function setNodeClickHandler(fn) { _onNodeClick = fn; }
export function getPositions()          { return _lastPositions; }
export function getLastSize()           { return { w: _lastW, h: _lastH }; }
export function getRenderedGraph()      { return _lastGraph; }

export function fitView(W = _lastW, H = _lastH) {
  if (!_svgZoom) return;
  const vw = window.innerWidth, vh = window.innerHeight;
  const scale = Math.min(0.92, vw / W, vh / H);
  const tx = (vw - W * scale) / 2;
  const ty = (vh - H * scale) / 2;
  d3.select('#diagram').call(_svgZoom.transform, d3.zoomIdentity.translate(tx, ty).scale(scale));
}

export function zoomToNodes(nodeIds, { pad = 80, maxScale = 2.2, duration = 480 } = {}) {
  if (!_svgZoom || !nodeIds.size) return;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  nodeIds.forEach(id => {
    const pos = _lastPositions.get(id);
    if (!pos) return;
    if (pos.x < minX) minX = pos.x;
    if (pos.y < minY) minY = pos.y;
    if (pos.x + CFG.nodeW > maxX) maxX = pos.x + CFG.nodeW;
    if (pos.y + CFG.nodeH > maxY) maxY = pos.y + CFG.nodeH;
  });
  if (!isFinite(minX)) return;
  const vw = window.innerWidth, vh = window.innerHeight;
  const scale = Math.min(maxScale, vw / ((maxX - minX) + pad * 2), vh / ((maxY - minY) + pad * 2));
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  d3.select('#diagram').transition().duration(duration)
    .call(_svgZoom.transform, d3.zoomIdentity.translate(vw/2 - cx*scale, vh/2 - cy*scale).scale(scale));
}

export function applyFocus(node, edges) {
  const id = safe(node.id);
  d3.selectAll('.node').style('opacity', 0.13);
  d3.selectAll('.edge,.elb').style('opacity', 0.05);

  const connNodes = new Set([node.id]);
  const inE = [], outE = [];
  edges.forEach(e => {
    if (e.from === node.id) { connNodes.add(e.to);   outE.push(e); }
    if (e.to   === node.id) { connNodes.add(e.from); inE.push(e); }
  });
  connNodes.forEach(cid => d3.select(`.nd-${safe(cid)}`).style('opacity', 1));

  const hl = (arr, color, arrowKey) => arr.forEach(e => {
    const fid = safe(e.from), tid = safe(e.to);
    d3.selectAll(`.edge.ef-${fid}.et-${tid}`)
      .style('opacity', 1).attr('stroke', color)
      .attr('stroke-width', (EDGE_CFG[e.relation]?.w || 1.5) + 1.2)
      .attr('marker-end', `url(#arr-hl-${arrowKey})`);
    d3.selectAll(`.elb.ef-${fid}.et-${tid}`)
      .style('opacity', 1).attr('fill', color).attr('font-size', 10).attr('font-weight', 700)
      .attr('stroke', 'white').attr('stroke-width', 2.5).style('paint-order', 'stroke');
    d3.select(`.nr-${safe(e.to === node.id ? e.from : e.to)}`).attr('stroke', color).attr('stroke-width', 2.8);
  });
  hl(inE,  '#22c55e', 'in');
  hl(outE, '#3b82f6', 'out');
  d3.select(`.nr-${id}`).attr('stroke', '#f59e0b').attr('stroke-width', 3.2);
  d3.select(`.nd-${id}`).style('opacity', 1);
  d3.select(`.nlbl-${id}`).text(node.label)
    .attr('stroke', 'white').attr('stroke-width', 3).style('paint-order', 'stroke');

  zoomToNodes(connNodes, { pad: 90, maxScale: 1.8 });
}

export function clearFocus() {
  d3.selectAll('.node').style('opacity', 1);
  d3.selectAll('.edge').style('opacity', 1)
    .each(function() {
      const el = d3.select(this);
      el.attr('stroke',       el.attr('data-stroke'))
        .attr('stroke-width', el.attr('data-sw'))
        .attr('marker-end',   `url(#arr-${el.attr('data-rel')})`);
    });
  d3.selectAll('.elb').style('opacity', 1)
    .each(function() {
      const el = d3.select(this);
      el.attr('fill',         el.attr('data-fill'))
        .attr('font-size',    9).attr('font-weight', null)
        .attr('stroke',       'white').attr('stroke-width', 2.5).style('paint-order', 'stroke');
    });
  d3.selectAll('.nr')
    .each(function() {
      const el = d3.select(this);
      el.attr('stroke',       el.attr('data-stroke'))
        .attr('stroke-width', '1.8');
    });
  // Reset labels to truncated form
  d3.selectAll('[data-raw]').each(function() {
    const raw = this.getAttribute('data-raw');
    if (!raw) return;
    const lbl = raw.length <= 27 ? raw : raw.slice(0, 13) + '\u2026' + raw.slice(-10);
    d3.select(this).text(lbl).attr('stroke', null).style('paint-order', null);
  });
}

// ── Pan dimming helpers ─────────────────────────────────────────────────────
const _PAN_ELS = ['#left-panel','#right-panel','#search-bar','#zoom-ctrls'];
function _dimUI()   { _PAN_ELS.forEach(id => { const el = document.querySelector(id); if (el) el.style.filter = `opacity(${PAN_DIM_OPACITY})`; }); }
function _undimUI() { _PAN_ELS.forEach(id => { const el = document.querySelector(id); if (el) el.style.filter = ''; }); }

// ── Main render ─────────────────────────────────────────────────────────────
export async function render(payload, { filters, layout, doFit = false, clearBg = false }) {
  const { rels, types, labels: showLabels, hideEdges = false } = filters;
  const relsSet  = new Set(rels);
  const typesSet = new Set(types);

  const visibleNodes = payload.nodes.filter(n => typesSet.has(n.type || 'resource'));
  const existingIds  = new Set(visibleNodes.map(n => n.id));
  let edges = payload.edges.filter(e =>
    existingIds.has(e.from) && existingIds.has(e.to) &&
    relsSet.has(e.relation)
  );
  edges = _mergeReadWrites(edges);
  _lastGraph = { nodes: visibleNodes, edges };

  const repoColorMap = new Map();
  let _rci = 0;
  payload.nodes.forEach(n => {
    if (n.repo && !repoColorMap.has(n.repo))
      repoColorMap.set(n.repo, CLUSTER_COLORS[_rci++ % CLUSTER_COLORS.length]);
  });
  visibleNodes.forEach(n => {
    if (n.repo && !repoColorMap.has(n.repo))
      repoColorMap.set(n.repo, CLUSTER_COLORS[_rci++ % CLUSTER_COLORS.length]);
  });

  const { positions, totalW, totalH } = await computeLayout(visibleNodes, edges, layout);
  _lastPositions = positions;
  _lastW = totalW; _lastH = totalH;

  const svgEl = document.getElementById('diagram');
  const prevT = doFit ? null : _currentT;
  svgEl.innerHTML = '';

  const svg = d3.select('#diagram')
    .attr('width', window.innerWidth)
    .attr('height', window.innerHeight);

  // Grid background
  const defs0 = svg.append('defs');
  const pat = defs0.append('pattern').attr('id','grid').attr('width',40).attr('height',40).attr('patternUnits','userSpaceOnUse');
  pat.append('path').attr('d','M 40 0 L 0 0 0 40').attr('fill','none').attr('stroke','#e2e8f0').attr('stroke-width',0.6);
  svg.append('rect').attr('width','100%').attr('height','100%').attr('fill','url(#grid)').style('pointer-events','none');

  const g = svg.append('g');
  _svgZoom = d3.zoom().scaleExtent([0.06, 5])
    .on('start', ev => { if (ev.sourceEvent?.type !== 'wheel') _dimUI(); })
    .on('zoom',  ev => { g.attr('transform', ev.transform); _currentT = ev.transform; })
    .on('end',   ()  => { _undimUI(); });
  svg.call(_svgZoom).on('dblclick.zoom', null);
  window.__svgZoom = _svgZoom;
  svg.on('click', ev => {
    if (!ev.target.closest?.('.node')) {
      if (window.__onClearFocus) window.__onClearFocus();
    }
  });

  // Repo group backgrounds
  const repoBounds = lastRepoBounds;
  if (repoBounds) {
    const bgG = g.append('g').attr('class','repo-bg').style('pointer-events','none');
    repoBounds.forEach((b, safeRepo) => {
      const repoName = [...repoColorMap.keys()].find(r => safe(r) === safeRepo) || safeRepo;
      const color = repoColorMap.get(repoName) || '#334155';
      const shortName = repoName.split('/').pop();
      if (b.cx !== undefined) {
        // cerchio (stress-cluster)
        bgG.append('circle').attr('cx',b.cx).attr('cy',b.cy).attr('r',b.r)
          .attr('fill',color).attr('fill-opacity',0.06)
          .attr('stroke',color).attr('stroke-width',1.5).attr('stroke-opacity',0.35).attr('stroke-dasharray','5,3');
        bgG.append('text').attr('x',b.cx).attr('y',b.cy - b.r + 16)
          .attr('text-anchor','middle').attr('font-size',11).attr('font-family','system-ui,sans-serif')
          .attr('font-weight','600').attr('fill',color).attr('fill-opacity',0.7).text(shortName);
      } else {
        // rettangolo (stress-repo)
        bgG.append('rect').attr('x',b.x-6).attr('y',b.y-6).attr('width',b.w+12).attr('height',b.h+12).attr('rx',14)
          .attr('fill',color).attr('fill-opacity',0.05)
          .attr('stroke',color).attr('stroke-width',1.5).attr('stroke-opacity',0.3).attr('stroke-dasharray','5,3');
        bgG.append('text').attr('x',b.x+6).attr('y',b.y+16).attr('font-size',11).attr('font-family','system-ui,sans-serif')
          .attr('font-weight','600').attr('fill',color).attr('fill-opacity',0.65).text(shortName);
      }
    });
  }

  // Arrow markers + icon symbols
  const defs = svg.append('defs');
  // Node type icon symbols (used in badges)
  Object.entries(ICON_SVG).forEach(([type, inner]) => {
    const sym = defs.append('symbol').attr('id',`ico-${type}`).attr('viewBox','0 0 24 24');
    sym.node().innerHTML = inner;
  });
  Object.entries(EDGE_CFG).forEach(([rel, c]) => {
    defs.append('marker').attr('id',`arr-${rel}`).attr('viewBox','0 0 8 8').attr('refX',7).attr('refY',4)
      .attr('markerWidth',9).attr('markerHeight',9).attr('orient','auto')
      .append('path').attr('d','M0,1 L7,4 L0,7 Z').attr('fill',c.stroke);
  });
  ['in','out'].forEach((k,i) => {
    defs.append('marker').attr('id',`arr-hl-${k}`).attr('viewBox','0 0 8 8').attr('refX',7).attr('refY',4)
      .attr('markerWidth',10).attr('markerHeight',10).attr('orient','auto')
      .append('path').attr('d','M0,1 L7,4 L0,7 Z').attr('fill', i===0 ? '#22c55e' : '#3b82f6');
  });

  // Parallel-edge index
  const pairCount = new Map(), pairCur = new Map(), eIdx = new Map();
  edges.forEach(e => { const k=`${e.from}||${e.to}`; pairCount.set(k,(pairCount.get(k)||0)+1); });
  edges.forEach(e => {
    const k = `${e.from}||${e.to}`;
    eIdx.set(e, pairCur.get(k)||0);
    pairCur.set(k, (pairCur.get(k)||0)+1);
  });

  // Edges
  const edgeG = g.append('g');
  if (!hideEdges) edges.forEach(e => {
    const sp = positions.get(e.from), tp = positions.get(e.to);
    if (!sp || !tp) return;
    const c   = EDGE_CFG[e.relation] || { stroke:'#94a3b8', dash:'', label:e.relation, w:1.2 };
    const k   = `${e.from}||${e.to}`;
    const d   = _edgePath(sp, tp, eIdx.get(e)||0, pairCount.get(k)||1);
    const fid = safe(e.from), tid = safe(e.to);
    const visPath = edgeG.append('path')
      .attr('class',`edge ef-${fid} et-${tid}`)
      .attr('data-rel', e.relation)
      .attr('data-stroke', c.stroke)
      .attr('data-sw', c.w)
      .attr('d',d).attr('fill','none').attr('stroke',c.stroke)
      .attr('stroke-width',c.w).attr('stroke-dasharray',c.dash)
      .attr('marker-end',`url(#arr-${e.relation})`);
    edgeG.append('path').attr('class',`ehit ef-${fid} et-${tid}`)
      .attr('d',d).attr('fill','none').attr('stroke','transparent').attr('stroke-width',12)
      .style('cursor','pointer')
      .on('mouseover', () => { visPath.attr('stroke-width', c.w+2.5); d3.selectAll(`.elb.ef-${fid}.et-${tid}`).attr('font-size',11).attr('font-weight',700); })
      .on('mouseout',  () => { visPath.attr('stroke-width', c.w);     d3.selectAll(`.elb.ef-${fid}.et-${tid}`).attr('font-size',9).attr('font-weight',null); });
    if (showLabels) {
      const { sx, sy, tx: tx0, ty: ty0 } = _bestPorts(sp, tp);
      const cnt = pairCount.get(k)||1, cur = eIdx.get(e)||0;
      const voff = cnt > 1 ? (cur-(cnt-1)/2)*18 : 0;
      const ddx=tx0-sx, ddy=ty0-sy, len=Math.sqrt(ddx*ddx+ddy*ddy)||1;
      const ox=-ddy/len*voff, oy=ddx/len*voff;
      edgeG.append('text').attr('class',`elb ef-${fid} et-${tid}`)
        .attr('x',(sx+tx0)/2+ox+(ddy/len)*9).attr('y',(sy+ty0)/2+oy-(ddx/len)*9-4)
        .attr('text-anchor','middle').attr('font-size',9).attr('font-family','monospace')
        .attr('fill',c.stroke).attr('data-fill',c.stroke)
        .attr('stroke','white').attr('stroke-width',2.5).style('paint-order','stroke')
        .attr('pointer-events','none').text(c.label);
    }
  });

  // Nodes
  const nodeG = g.append('g');
  visibleNodes.forEach(n => {
    const pos = positions.get(n.id);
    if (!pos) return;
    const nc = NODE_CFG[n.type] || NODE_CFG.resource;
    const id = safe(n.id);
    const _raw = n.label || n.id.split('/').pop();
    const lbl  = _raw.length <= 27 ? _raw : _raw.slice(0,13)+'…'+_raw.slice(-10);
    const grp = nodeG.append('g')
      .attr('class',`node nd-${id}`)
      .attr('transform',`translate(${pos.x},${pos.y})`)
      .attr('data-repo', n.repo || '')
      .attr('data-repo-url', n.repoUrl || '')
      .attr('data-label', _raw)
      .style('cursor','pointer')
      .on('click', ev => {
        ev.stopPropagation();
        if (_onNodeClick) _onNodeClick(n, edges);
      });
    grp.append('rect').attr('x',2).attr('y',3).attr('width',CFG.nodeW).attr('height',CFG.nodeH).attr('rx',CFG.nodeRx)
      .attr('fill','rgba(0,0,0,0.08)').style('pointer-events','none');
    grp.append('rect').attr('class',`nr nr-${id}`)
      .attr('width',CFG.nodeW).attr('height',CFG.nodeH).attr('rx',CFG.nodeRx)
      .attr('fill','#fff').attr('stroke',nc.bg).attr('stroke-width',1.8)
      .attr('data-stroke', nc.bg);
    // Badge
    grp.append('rect').attr('x',9).attr('y',CFG.nodeH/2-9).attr('width',32).attr('height',18).attr('rx',4)
      .attr('fill',nc.bg).style('pointer-events','none');
    grp.append('text').attr('x',25).attr('y',CFG.nodeH/2)
      .attr('text-anchor','middle').attr('dominant-baseline','central')
      .attr('font-size',8.5).attr('font-weight','800')
      .attr('fill',nc.text).attr('pointer-events','none').text(nc.badge);
    // Label
    grp.append('text').attr('class',`nlbl nlbl-${id}`)
      .attr('x',47).attr('y',22).attr('font-size',11.5).attr('font-family','system-ui,sans-serif')
      .attr('font-weight','600').attr('fill','#1e293b').attr('pointer-events','none')
      .attr('data-raw', _raw).text(lbl).append('title').text(_raw);
    if (_raw !== lbl) {
      grp.on('mouseenter.lbl', () =>
        d3.select(`.nlbl-${id}`).text(_raw).attr('stroke','white').attr('stroke-width',3).style('paint-order','stroke')
      ).on('mouseleave.lbl', () =>
        d3.select(`.nlbl-${id}`).text(lbl).attr('stroke',null).attr('stroke-width',null)
      );
    }
    // Repo subtitle
    const shortRepo = n.repo ? (n.repo.length > 29 ? '…'+n.repo.slice(-28) : n.repo) : '';
    grp.append('text').attr('x',47).attr('y',40)
      .attr('font-size',9.5).attr('font-family','system-ui,sans-serif')
      .attr('fill','#94a3b8').attr('font-style','italic').attr('pointer-events','none').text(shortRepo);
  });

  // Apply zoom state
  if (doFit) {
    fitView(totalW, totalH);
  } else if (prevT && prevT !== d3.zoomIdentity) {
    d3.select('#diagram').call(_svgZoom.transform, prevT);
  } else {
    fitView(totalW, totalH);
  }
}

// ── Private helpers ─────────────────────────────────────────────────────────
function safe(id) { return id.replace(/[^a-z0-9]/gi, '_'); }

function _bestPorts(sp, tp) {
  const scx=sp.x+CFG.nodeW/2, scy=sp.y+CFG.nodeH/2;
  const tcx=tp.x+CFG.nodeW/2, tcy=tp.y+CFG.nodeH/2;
  const dx=tcx-scx, dy=tcy-scy;
  const adxN=Math.abs(dx)/(CFG.nodeW/2), adyN=Math.abs(dy)/(CFG.nodeH/2);
  if (adxN >= adyN)
    return dx>=0 ? {sx:sp.x+CFG.nodeW,sy:scy,tx:tp.x,ty:tcy,horiz:true}
                 : {sx:sp.x,sy:scy,tx:tp.x+CFG.nodeW,ty:tcy,horiz:true};
  return dy>=0 ? {sx:scx,sy:sp.y+CFG.nodeH,tx:tcx,ty:tp.y,horiz:false}
               : {sx:scx,sy:sp.y,tx:tcx,ty:tp.y+CFG.nodeH,horiz:false};
}

function _edgePath(sp, tp, idx, total) {
  const {sx,sy,tx,ty,horiz} = _bestPorts(sp, tp);
  const ddx=tx-sx, ddy=ty-sy, len=Math.sqrt(ddx*ddx+ddy*ddy)||1;
  const voff = total>1 ? (idx-(total-1)/2)*18 : 0;
  const ox=-ddy/len*voff, oy=ddx/len*voff;
  const ctrld = Math.max(Math.abs(ddx),Math.abs(ddy))*0.45+30;
  const sign = horiz ? Math.sign(ddx||1) : Math.sign(ddy||1);
  const c1x=horiz?sx+sign*ctrld:sx, c1y=horiz?sy:sy+sign*ctrld;
  const c2x=horiz?tx-sign*ctrld:tx, c2y=horiz?ty:ty-sign*ctrld;
  return `M${sx+ox},${sy+oy} C${c1x+ox},${c1y+oy} ${c2x+ox},${c2y+oy} ${tx+ox},${ty+oy}`;
}

function _mergeReadWrites(edges) {
  const byPair = new Map();
  edges.forEach(e => {
    const k = `${e.from}|||${e.to}`;
    if (!byPair.has(k)) byPair.set(k, { from:e.from, to:e.to, list:[] });
    byPair.get(k).list.push(e);
  });
  const result = [];
  byPair.forEach(({ from, to, list }) => {
    const hasR = list.some(e => e.relation==='reads');
    const hasW = list.some(e => e.relation==='writes');
    if (hasR && hasW) {
      result.push(...list.filter(e => e.relation!=='reads' && e.relation!=='writes'),
                  { from, to, relation:'reads_writes' });
    } else {
      result.push(...list);
    }
  });
  return result;
}
