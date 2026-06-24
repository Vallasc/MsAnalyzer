// ── Markdown + Mermaid rendering ────────────────────────────────────────────
//
// Depends on globals: marked (CDN), mermaid (CDN)

export function rewriteUrls(html, owner, repo, branch, currentPath) {
  const pathParts = currentPath.split('/');
  pathParts.pop();
  const baseDir = pathParts.length ? pathParts.join('/') + '/' : '';
  const rawBase = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/`;
  const ghBlob  = `https://github.com/${owner}/${repo}/blob/${branch}/`;

  function resolve(rel) {
    rel = rel.replace(/^\.\//, '');
    if (rel.startsWith('/'))   return rel.slice(1);
    if (rel.startsWith('../')) {
      const bd = baseDir.replace(/\/$/, '').split('/').filter(Boolean);
      bd.pop();
      return (bd.length ? bd.join('/') + '/' : '') + rel.slice(3);
    }
    return baseDir + rel;
  }

  // Images → raw URL
  html = html.replace(/<img\b([^>]*?)src="([^"]+)"([^>]*?)>/gi, (m, pre, src, post) => {
    if (/^https?:|^data:|^\/\//.test(src)) return m;
    return `<img${pre}src="${rawBase}${resolve(src)}" loading="lazy"${post}>`;
  });

  // Links
  html = html.replace(/href="([^"]*)"/gi, (m, href) => {
    if (!href || href.startsWith('#')) return m;
    if (/^https?:|^mailto:/.test(href)) return `href="${href}" target="_blank" rel="noopener"`;
    const [cleanHref, frag] = href.split('#');
    const absPath    = resolve(cleanHref);
    const fragSuffix = frag ? `#${frag}` : '';
    if (/\.(md|markdown)$/i.test(cleanHref))
      return `href="javascript:void(0)" data-md-link="${absPath}${fragSuffix}"`;
    return `href="${ghBlob}${absPath}" target="_blank" rel="noopener"`;
  });

  return html;
}

export function renderMdHtml(text, owner, repo, branch, path) {
  const raw = (typeof marked !== 'undefined')
    ? marked.parse(text, { breaks: false, gfm: true })
    : `<pre style="white-space:pre-wrap;font-size:10.5px;">${text.replace(/</g, '&lt;')}</pre>`;
  return rewriteUrls(raw, owner, repo, branch, path);
}

export async function renderMermaidBlocks(container) {
  if (typeof mermaid === 'undefined') return;
  const blocks = container.querySelectorAll('pre code.language-mermaid');
  let i = 0;
  for (const code of blocks) {
    const text = code.textContent;
    const pre  = code.closest('pre');
    try {
      const id = `mmaid-${Date.now()}-${i++}`;
      const { svg } = await mermaid.render(id, text);
      const div = document.createElement('div');
      div.style.cssText = 'overflow-x:auto;margin:10px 0;text-align:center;';
      div.innerHTML = svg;
      (pre || code).replaceWith(div);
    } catch (e) { console.warn('Mermaid render:', e); }
  }
}

// Init mermaid once (called from app bootstrap)
export function initMermaid() {
  if (typeof mermaid !== 'undefined')
    mermaid.initialize({ startOnLoad: false, theme: 'neutral', securityLevel: 'loose' });
}
