import { cleanText, contentFingerprint } from './text';
export interface ResumeExtraction { readonly text: string; readonly pages: number; readonly fingerprint: string; }
export interface ResumeOptions {
  /** Bundle pdfjs-dist/legacy/build/pdf.worker.min.mjs with the app and pass its local URL. */
  workerSrc: string;
  signal?: AbortSignal;
  onProgress?: (pagesDone: number, pagesTotal: number) => void;
  maxBytes?: number;
}
/** PDF.js is loaded only for a resume, so it adds nothing to archive imports. */
export async function extractResumePdf(file: Blob, options: ResumeOptions): Promise<ResumeExtraction> {
  if (!options.workerSrc) throw new Error('The bundled PDF worker is not configured.');
  if (file.size > (options.maxBytes ?? 30 * 1024 * 1024)) throw new Error('This PDF is too large. Choose a resume under 30 MB.');
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = options.workerSrc;
  const loading = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), useSystemFonts: true });
  const cancel = () => { void loading.destroy(); };
  options.signal?.addEventListener('abort', cancel, { once: true });
  try {
    options.signal?.throwIfAborted();
    const doc = await loading.promise; const pages: string[] = [];
    if (doc.numPages > 150) throw new Error('This file has more than 150 pages. Choose a resume PDF.');
    for (let i = 1; i <= doc.numPages; i++) {
      options.signal?.throwIfAborted();
      const page = await doc.getPage(i); const content = await page.getTextContent();
      const chunks: string[] = [];
      for (const item of content.items) if ('str' in item) chunks.push(cleanText(item.str), item.hasEOL ? '\n' : ' ');
      pages.push(chunks.join('').trim()); page.cleanup(); options.onProgress?.(i, doc.numPages);
    }
    const text = cleanText(pages.join('\n\n')).trim();
    if (!text) throw new Error('No selectable text was found. This resume may be a scanned PDF.');
    return { text, pages: doc.numPages, fingerprint: await contentFingerprint(text) };
  } finally { options.signal?.removeEventListener('abort', cancel); await loading.destroy(); }
}
export interface PersistenceResult<T> { data?: T | null; error?: { message?: string; code?: string } | Error | null; }
/** Call this for every upsert: resolved SDK errors must fail the import just like thrown errors. */
export async function checkedUpsert<T>(label: string, operation: () => PromiseLike<PersistenceResult<T>>): Promise<T | null> {
  const result = await operation();
  if (result.error) throw new Error(`${label}: ${result.error.message || 'Saving failed'}${'code' in result.error && result.error.code ? ` (${result.error.code})` : ''}`);
  return result.data ?? null;
}
