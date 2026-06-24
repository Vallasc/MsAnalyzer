// ── ELK layout ──────────────────────────────────────────────────────────────
import { CFG } from '../config.js';

const elk = new ELK(); // ELK is a global from CDN

export let lastRepoBounds = null; // Map: safeRepo → {x,y,w,h}

function safe(id) { return id.replace(/[^a-z0-9]/gi, '_'); }

function getLayoutOptions(algo) {
  const common = {
    'elk.spacing.nodeNode': '45',
    'elk.layered.spacing.nodeNodeBetweenLayers': '200',
    'elk.padding': '[top=0,left=0,bottom=0,right=0]',
  };
  switch (algo) {
    case 'layered-lr-ns': return { ...common, 'elk.algorithm':'layered','elk.direction':'RIGHT',
      'elk.layered.crossingMinimization.strategy':'NETWORK_SIMPLEX',
      'elk.layered.nodePlacement.strategy':'NETWORK_SIMPLEX' };
    case 'layered-tb-ns': return { ...common, 'elk.algorithm':'layered','elk.direction':'DOWN',
      'elk.layered.crossingMinimization.strategy':'NETWORK_SIMPLEX',
      'elk.layered.nodePlacement.strategy':'NETWORK_SIMPLEX' };
    case 'layered-lr-ls': return { ...common, 'elk.algorithm':'layered','elk.direction':'RIGHT',
      'elk.layered.crossingMinimization.strategy':'LAYER_SWEEP',
      'elk.layered.nodePlacement.strategy':'BRANDES_KOEPF' };
    case 'layered-lr-lp': return { ...common, 'elk.algorithm':'layered','elk.direction':'RIGHT',
      'elk.layered.crossingMinimization.strategy':'NETWORK_SIMPLEX',
      'elk.layered.nodePlacement.strategy':'LINEAR_SEGMENTS' };
    case 'stress': return {
      'elk.algorithm':'stress',
      'elk.spacing.nodeNode':'150',
      'elk.stress.desiredEdgeLength': String(CFG.nodeW + 350),
      'elk.padding':'[top=0,left=0,bottom=0,right=0]' };
    case 'stress-tight': return {
      'elk.algorithm':'stress',
      'elk.spacing.nodeNode':'80',
      'elk.stress.desiredEdgeLength': String(CFG.nodeW + 160),
      'elk.stress.overlappingNodeOverlapRemoval':'true',
      'elk.stress.iterationLimit':'1000',
      'elk.padding':'[top=40,left=40,bottom=40,right=40]' };
    case 'stress-repo': return {};
    default: return { ...common, 'elk.algorithm':'layered','elk.direction':'RIGHT',
      'elk.layered.crossingMinimization.strategy':'NETWORK_SIMPLEX',
      'elk.layered.nodePlacement.strategy':'NETWORK_SIMPLEX' };
  }
}

export async function computeLayout(nodes, edges, algo) {
  const layoutOptions = getLayoutOptions(algo);
  const isLayered = layoutOptions['elk.algorithm'] === 'layered';
  const EM = 8;

  const seen = new Set();
  const elkEdges = [];
  edges.forEach((e, i) => {
    const [s, t] = (isLayered && e.relation === 'reads') ? [e.to, e.from] : [e.from, e.to];
    if (s === t) return;
    const key = `${s}→${t}`;
    if (seen.has(key)) return;
    seen.add(key);
    elkEdges.push({ id: `le${i}`, sources: [s], targets: [t] });
  });

  const positions = new Map();
  let totalW, totalH;

  if (algo === 'stress-repo' || algo === 'stress-cluster') {
    const isCluster = algo === 'stress-cluster';
    const byRepo = new Map();

    if (isCluster) {
      // Assign each external node to the repo it connects to most
      const nodeRepoMap = new Map();
      nodes.forEach(n => { if (n.repo) nodeRepoMap.set(n.id, n.repo); });
      const extNodes = nodes.filter(n => n.type === 'external');
      const nonExtNodes = nodes.filter(n => n.type !== 'external');
      nonExtNodes.forEach(n => {
        const r = n.repo || '__orphan__';
        if (!byRepo.has(r)) byRepo.set(r, []);
        byRepo.get(r).push(n);
      });
      // For each external, find the repo with most edge connections
      extNodes.forEach(n => {
        const connRepos = new Map();
        edges.forEach(e => {
          if (e.from === n.id) {
            const tr = nodeRepoMap.get(e.to);
            if (tr) connRepos.set(tr, (connRepos.get(tr) || 0) + 1);
          }
          if (e.to === n.id) {
            const fr = nodeRepoMap.get(e.from);
            if (fr) connRepos.set(fr, (connRepos.get(fr) || 0) + 1);
          }
        });
        let bestRepo = '__orphan__';
        let bestCount = 0;
        connRepos.forEach((count, repo) => {
          if (count > bestCount) { bestCount = count; bestRepo = repo; }
        });
        if (!byRepo.has(bestRepo)) byRepo.set(bestRepo, []);
        byRepo.get(bestRepo).push(n);
      });
    } else {
      nodes.forEach(n => {
        const r = n.repo || '__ext__';
        if (!byRepo.has(r)) byRepo.set(r, []);
        byRepo.get(r).push(n);
      });
    }

    // stress-cluster: separa archi intra-repo (guidano layout interno)
    // da archi inter-repo (guidano layout esterno tra i gruppi)
    let rootEdges = elkEdges;
    const repoIntraEdges = new Map();
    if (isCluster) {
      // Build nodeToRepo from byRepo (includes external nodes assigned to repos)
      const nodeToRepo = new Map();
      byRepo.forEach((rNodes, repo) => {
        rNodes.forEach(n => nodeToRepo.set(n.id, repo));
      });
      rootEdges = [];
      elkEdges.forEach(e => {
        const fr = nodeToRepo.get(e.sources[0]);
        const tr = nodeToRepo.get(e.targets[0]);
        if (fr && tr && fr === tr) {
          if (!repoIntraEdges.has(fr)) repoIntraEdges.set(fr, []);
          repoIntraEdges.get(fr).push(e);
        } else {
          rootEdges.push(e);
        }
      });
    }

    const repoChildren = [...byRepo.entries()].map(([repo, rNodes]) => ({
      id: `_grp_${safe(repo)}`,
      layoutOptions: isCluster ? {
        'elk.algorithm':'stress',
        'elk.spacing.nodeNode':'40',
        'elk.stress.desiredEdgeLength': String(CFG.nodeW + 60),
        'elk.stress.iterationLimit':'600',
        'elk.padding':'[top=30,left=18,bottom=18,right=18]',
      } : {
        'elk.algorithm':'rectpacking',
        'elk.spacing.nodeNode': String(EM * 2 + 4),
        'elk.padding':'[top=32,left=10,bottom=10,right=10]',
      },
      children: rNodes.map(n => ({ id: n.id, width: CFG.nodeW + EM*2, height: CFG.nodeH + EM*2 })),
      edges: isCluster ? (repoIntraEdges.get(repo) || []) : undefined,
    }));
    const graph = {
      id: 'root',
      layoutOptions: isCluster ? {
        'elk.algorithm':'stress',
        'elk.spacing.nodeNode':'200',
        'elk.stress.desiredEdgeLength': String(CFG.nodeW * 3),
        'elk.stress.iterationLimit':'800',
        'elk.padding':'[top=50,left=50,bottom=50,right=50]',
      } : {
        'elk.algorithm':'stress', 'elk.spacing.nodeNode':'80',
        'elk.stress.desiredEdgeLength': String(CFG.nodeW + 400),
        'elk.padding':'[top=20,left=20,bottom=20,right=20]',
      },
      children: repoChildren,
      edges: rootEdges,
    };
    const result = await elk.layout(graph);
    totalW = (result.width  || 1200) + CFG.colPadX * 2;
    totalH = (result.height || 800)  + CFG.topPad  + CFG.botPad;
    const repoBounds = new Map();
    result.children.forEach(grp => {
      const grpPos = [];
      (grp.children || []).forEach(n => {
        const px = grp.x + n.x + EM + CFG.colPadX;
        const py = grp.y + n.y + EM + CFG.topPad;
        positions.set(n.id, { x: px, y: py });
        grpPos.push({ x: px + CFG.nodeW / 2, y: py + CFG.nodeH / 2 });
      });
      const key = grp.id.replace(/^_grp_/, '');
      if (isCluster && grpPos.length > 0) {
        const cx = grpPos.reduce((s, p) => s + p.x, 0) / grpPos.length;
        const cy = grpPos.reduce((s, p) => s + p.y, 0) / grpPos.length;
        const r = Math.max(...grpPos.map(p =>
          Math.sqrt((p.x - cx) ** 2 + (p.y - cy) ** 2)
        )) + Math.sqrt((CFG.nodeW / 2) ** 2 + (CFG.nodeH / 2) ** 2) + 28;
        repoBounds.set(key, { cx, cy, r });
      } else {
        repoBounds.set(key, {
          x: grp.x + CFG.colPadX, y: grp.y + CFG.topPad, w: grp.width, h: grp.height,
        });
      }
    });
    lastRepoBounds = repoBounds;
  } else {
    const graph = {
      id: 'root', layoutOptions,
      children: nodes.map(n => ({ id: n.id, width: CFG.nodeW + EM*2, height: CFG.nodeH + EM*2 })),
      edges: elkEdges,
    };
    const result = await elk.layout(graph);
    result.children.forEach(n =>
      positions.set(n.id, { x: n.x + EM + CFG.colPadX, y: n.y + EM + CFG.topPad })
    );
    totalW = (result.width  || 1000) + CFG.colPadX * 2;
    totalH = (result.height || 600)  + CFG.topPad  + CFG.botPad;
    lastRepoBounds = null;
  }

  return { positions, totalW, totalH };
}
