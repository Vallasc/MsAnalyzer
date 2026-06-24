// ── GitHub file fetching ────────────────────────────────────────────────────
import { renderMdHtml } from './markdown.js';

const mdCache   = new Map(); // 'owner/repo/branch/path' → raw text | null
const readmeCtx = new Map(); // 'owner/repo' → { branch, html } | null

export async function fetchMdText(owner, repo, path, branch) {
  const key = `${owner}/${repo}/${branch}/${path}`;
  if (mdCache.has(key)) return mdCache.get(key);
  try {
    const res = await fetch(`https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}`);
    if (res.ok) { const text = await res.text(); mdCache.set(key, text); return text; }
  } catch {}
  mdCache.set(key, null);
  return null;
}

export async function fetchReadme(owner, repo) {
  const key = `${owner}/${repo}`;
  if (readmeCtx.has(key)) return readmeCtx.get(key);
  for (const branch of ['develop', 'main', 'master']) {
    const text = await fetchMdText(owner, repo, 'README.md', branch);
    if (text != null) {
      const result = { branch, html: renderMdHtml(text, owner, repo, branch, 'README.md') };
      readmeCtx.set(key, result);
      return result;
    }
  }
  readmeCtx.set(key, null);
  return null;
}

export function clearReadmeCache() {
  mdCache.clear();
  readmeCtx.clear();
}
