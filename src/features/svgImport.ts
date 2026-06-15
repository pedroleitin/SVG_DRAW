import type { Asset } from "../scene/types";

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

  const viewBox = resolveViewBox(svg);
  const markup = svg.innerHTML.trim();
  if (!markup) return null;

  return { id: slugId(name || "asset"), name: name || "Untitled", viewBox, markup, user: true };
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

/** Use the file's viewBox, or synthesize one from width/height, or default. */
function resolveViewBox(svg: SVGSVGElement): string {
  const vb = svg.getAttribute("viewBox");
  if (vb) return vb;
  const w = parseFloat(svg.getAttribute("width") || "");
  const h = parseFloat(svg.getAttribute("height") || "");
  if (w > 0 && h > 0) return `0 0 ${w} ${h}`;
  return "0 0 100 100";
}
