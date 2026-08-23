/**
 * The handful of things Tailwind 3 cannot express, kept in one string.
 *
 * `index.css` belongs to the design system and is not this feature's to edit,
 * so the shell ships its own stylesheet and mounts it with React 19's
 * `<style href precedence>` — several components can render it and the document
 * still ends up with exactly one copy.
 *
 * Only four things are here, and each one needs a `@keyframes` or a selector
 * Tailwind has no utility for:
 *
 *  - the entry transition, which ramps `backdrop-filter` (the world behind the
 *    glass coming into focus) — a property no utility animates;
 *  - the staggered rise of each band, driven by a per-element `--cq-vn-delay`;
 *  - the portrait's idle loop, which is a sprite sheet stepped with
 *    `steps()` over `background-position-x`;
 *  - a scanline wash, one `repeating-linear-gradient` at very low alpha.
 *
 * `index.css` already neutralises every animation under
 * `prefers-reduced-motion: reduce`, so nothing here needs to repeat that — the
 * end state of each keyframe is also the resting state, so a suppressed
 * animation lands on the finished frame rather than on nothing.
 *
 * Layering note: `backdrop-filter` filters the backdrop of its nearest grouping
 * ancestor. An ancestor with `opacity < 1` becomes that group, and the world
 * canvas then sits outside it — the blur silently stops seeing anything. That
 * is why the veil animates its own filter and colour and never its opacity, and
 * why nothing above it in the tree may be faded.
 */

/** Deduplication key for `<style href>`. One stylesheet, however many mounts. */
export const VN_STYLE_HREF = 'cq-vn'

export const VN_CSS = `
@keyframes cq-vn-veil {
  from {
    -webkit-backdrop-filter: blur(0px) saturate(100%);
    backdrop-filter: blur(0px) saturate(100%);
    background-color: rgba(5, 8, 15, 0);
  }
  to {
    -webkit-backdrop-filter: blur(var(--cq-vn-blur, 9px)) saturate(118%);
    backdrop-filter: blur(var(--cq-vn-blur, 9px)) saturate(118%);
    background-color: var(--cq-vn-dim, rgba(5, 8, 15, 0.64));
  }
}
.cq-vn-veil {
  -webkit-backdrop-filter: blur(var(--cq-vn-blur, 9px)) saturate(118%);
  backdrop-filter: blur(var(--cq-vn-blur, 9px)) saturate(118%);
  background-color: var(--cq-vn-dim, rgba(5, 8, 15, 0.64));
  animation: cq-vn-veil 420ms ease-out both;
}

@keyframes cq-vn-fade { from { opacity: 0; } to { opacity: 1; } }
.cq-vn-fade { animation: cq-vn-fade 420ms ease-out both; }

@keyframes cq-vn-rise {
  from { opacity: 0; transform: translateY(14px); }
  to { opacity: 1; transform: translateY(0); }
}
.cq-vn-rise { animation: cq-vn-rise 340ms cubic-bezier(0.16, 1, 0.3, 1) both; animation-delay: var(--cq-vn-delay, 0ms); }

@keyframes cq-vn-drop {
  from { opacity: 0; transform: translateY(-14px); }
  to { opacity: 1; transform: translateY(0); }
}
.cq-vn-drop { animation: cq-vn-drop 340ms cubic-bezier(0.16, 1, 0.3, 1) both; animation-delay: var(--cq-vn-delay, 0ms); }

/* One row of square frames stepped left to right. --cq-vn-sheet is the negative
   width of the whole scaled sheet, so the last step lands on the last frame. */
@keyframes cq-vn-idle {
  from { background-position-x: 0; }
  to { background-position-x: var(--cq-vn-sheet, 0px); }
}

.cq-vn-scan {
  background-image: repeating-linear-gradient(
    180deg,
    rgba(255, 255, 255, 0.028) 0px,
    rgba(255, 255, 255, 0.028) 1px,
    transparent 1px,
    transparent 3px
  );
}
`
