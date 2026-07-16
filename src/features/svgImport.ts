import type { Asset } from "../scene/types";
import { parseStyle, type AssetAnim } from "./svgAnim";

/** Parse, sanitize, and normalize an uploaded SVG file into an Asset.
 *  Sanitization strips scripts, event handlers, and external/remote refs so
 *  injected markup can't execute. Because the whole tool is palette-driven,
 *  fills/strokes are converted to `currentColor` (monochromatic) so uploads
 *  recolor like the built-in shapes. */

// Elements we never keep — they can script, load remote data, or break layout.
const FORBIDDEN_TAGS = new Set([
  "script",
  "foreignobject",
  "image",
  "iframe",
  "use", // avoid nested external refs inside an uploaded file
  "animate", // animation comes from our engine, not embedded SMIL
  "animatetransform",
  "set",
]);

let counter = 0;
const slugId = (name: string) =>
  `u-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-${(counter++).toString(36)}`;

export async function importSvgFile(file: File): Promise<Asset | null> {
  const text = await file.text();
  return parseSvg(text, file.name.replace(/\.svg$/i, ""));
}

export function parseSvg(text: string, name: string): Asset | null {
  const doc = new DOMParser().parseFromString(text, "image/svg+xml");
  const svg = doc.querySelector("svg");
  if (!svg || doc.querySelector("parsererror")) return null;

  sanitize(svg);
  forceCurrentColor(svg);
  inheritRootPaint(svg);
  const anim = extractAnim(svg);

  const viewBox = resolveViewBox(svg);
  const markup = svg.innerHTML.trim();
  if (!markup) return null;

  return { id: slugId(name || "asset"), name: name || "Untitled", viewBox, markup, user: true, anim };
}

/** Read any embedded `<style>` for CSS-keyframes transforms, tag each animated
 *  element with `data-anim="i"` (so the renderer/export can target it), then
 *  drop the `<style>` so its CSS can't run in parallel with our time-driven
 *  sampling. Returns the parsed tracks, or undefined when there's no animation. */
function extractAnim(svg: SVGSVGElement): AssetAnim[] | undefined {
  const styles = Array.from(svg.querySelectorAll("style"));
  if (!styles.length) return undefined;
  const css = styles.map((s) => s.textContent ?? "").join("\n");
  const model = parseStyle(css);
  if (!model.animByClass.size || !model.keyframes.size) {
    for (const s of styles) s.remove();
    return undefined;
  }

  const tracks: AssetAnim[] = [];
  const walk = (el: Element) => {
    for (const cls of Array.from(el.classList)) {
      const ref = model.animByClass.get(cls);
      const stops = ref && model.keyframes.get(ref.name);
      if (ref && stops && stops.length) {
        const index = tracks.length;
        el.setAttribute("data-anim", String(index));
        tracks.push({ index, stops, dur: ref.dur });
        break; // one track per element
      }
    }
    for (const c of Array.from(el.children)) walk(c);
  };
  walk(svg);

  for (const s of styles) s.remove();
  return tracks.length ? tracks : undefined;
}

/** Recursively remove forbidden elements and dangerous attributes. */
function sanitize(node: Element): void {
  for (const child of Array.from(node.children)) {
    if (FORBIDDEN_TAGS.has(child.tagName.toLowerCase())) {
      child.remove();
      continue;
    }
    for (const attr of Array.from(child.attributes)) {
      const n = attr.name.toLowerCase();
      const v = attr.value.trim().toLowerCase();
      const isRef = n === "href" || n === "xlink:href";
      if (
        n.startsWith("on") || // event handlers
        (isRef && !v.startsWith("#")) || // only internal refs allowed
        (v.includes("javascript:") && (n === "href" || n === "xlink:href"))
      ) {
        child.removeAttribute(attr.name);
      }
    }
    sanitize(child);
  }
}

/** Replace concrete fill/stroke colors with currentColor (keep "none"). */
function forceCurrentColor(root: Element): void {
  const walk = (el: Element) => {
    for (const prop of ["fill", "stroke"] as const) {
      const val = el.getAttribute(prop);
      if (val && val.trim().toLowerCase() !== "none") {
        el.setAttribute(prop, "currentColor");
      }
    }
    const style = el.getAttribute("style");
    if (style) {
      el.setAttribute(
        "style",
        style
          .replace(/fill:\s*(?!none)[^;]+/gi, "fill:currentColor")
          .replace(/stroke:\s*(?!none)[^;]+/gi, "stroke:currentColor"),
      );
    }
    for (const c of Array.from(el.children)) walk(c);
  };
  walk(root);
}

/** The <svg> root's fill/stroke are lost once we keep only its innerHTML, so
 *  direct children that relied on inheritance would fall back to SVG defaults
 *  (fill: black). Pin those explicitly — e.g. a stroke-only icon whose root set
 *  fill="none" must keep fill="none", not become a filled blob. */
function inheritRootPaint(svg: SVGSVGElement): void {
  const rootFill = svg.getAttribute("fill");
  const rootStroke = svg.getAttribute("stroke");
  const fillNone = rootFill != null && rootFill.trim().toLowerCase() === "none";
  for (const child of Array.from(svg.children)) {
    if (!child.hasAttribute("fill")) child.setAttribute("fill", fillNone ? "none" : "currentColor");
    if (!child.hasAttribute("stroke") && rootStroke && rootStroke.trim().toLowerCase() !== "none") {
      child.setAttribute("stroke", "currentColor");
    }
  }
}

/** Use the file's viewBox, or synthesize one from width/height, or default. */
function resolveViewBox(svg: SVGSVGElement): string {
  const vb = svg.getAttribute("viewBox");
  if (vb) return vb;
  const w = parseFloat(svg.getAttribute("width") || "");
  const h = parseFloat(svg.getAttribute("height") || "");
  if (w > 0 && h > 0) return `0 0 ${w} ${h}`;
  return "0 0 100 100";
}
