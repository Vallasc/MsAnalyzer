import { html } from '../preact-htm.js';
import { zoomToNodes } from '../diagram/render.js';
import { fitView }     from '../diagram/render.js';
import { Icon }        from '../icons.js';

export function ZoomControls({ lastW, lastH }) {
  return html`
    <div id="zoom-ctrls">
      <button class="zbtn" title="Zoom in"  onClick=${() => d3.select('#diagram').call(window.__svgZoom?.scaleBy, 1.4)}>${Icon({name:'zoom-in',  size:18})}</button>
      <button class="zbtn" title="Fit view" onClick=${() => fitView(lastW, lastH)}>${Icon({name:'maximize2', size:16})}</button>
      <button class="zbtn" title="Zoom out" onClick=${() => d3.select('#diagram').call(window.__svgZoom?.scaleBy, 1/1.4)}>${Icon({name:'zoom-out', size:18})}</button>
    </div>`;
}
