export const PANEL_FONT_FAMILY = 'Mighty Panel Schibsted';

/** Register the bundled font with the document, since Chrome does not reliably
 * expose shadow-root @font-face rules to its font loader. No page CSS is added. */
export function loadPanelFont(doc: Document, url: string, Font: typeof FontFace | undefined = globalThis.FontFace) {
  try {
    if (!Font || !doc.fonts?.add) return;
    if ([...doc.fonts].some(face => face.family === PANEL_FONT_FAMILY)) return;
    const face = new Font(PANEL_FONT_FAMILY, `url("${url}") format("woff2")`, {weight: '100 900', display: 'swap'});
    doc.fonts.add(face);
    void face.load().catch(() => {});
  } catch { /* The explicit sans-serif fallback keeps the panel readable. */ }
}
