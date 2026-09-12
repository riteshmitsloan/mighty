import test from 'node:test';
import assert from 'node:assert/strict';
import { extractResumePdf } from '../src/lib/resume';
/** Generated minimal one-page PDF fixture with real PDF.js extraction. */
function pdf(text: string): Blob {
  const stream = `BT /F1 12 Tf 50 700 Td (${text.replace(/[()\\]/g, '\\$&')}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`
  ];
  let body = '%PDF-1.4\n'; const offsets = [0];
  for (const [i, object] of objects.entries()) { offsets.push(body.length); body += `${i + 1} 0 obj\n${object}\nendobj\n`; }
  const xref = body.length;
  body += `xref\n0 ${offsets.length}\n0000000000 65535 f \n` + offsets.slice(1).map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  body += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new Blob([body], { type: 'application/pdf' });
}
test('real PDF.js text extraction returns clean text and page progress', async () => {
  const ticks: number[] = [];
  const result = await extractResumePdf(pdf('Alex Rivera led 15 engineers.'), { workerSrc: import.meta.resolve('pdfjs-dist/legacy/build/pdf.worker.min.mjs'), onProgress: n => ticks.push(n) });
  assert.equal(result.text, 'Alex Rivera led 15 engineers.'); assert.equal(result.pages, 1); assert.deepEqual(ticks, [1]); assert.match(result.fingerprint, /^[a-f0-9]{64}$/);
});
test('resume PDF size limit refuses before parsing', async () => { await assert.rejects(extractResumePdf(pdf('Resume'), { workerSrc: 'bundled-worker.mjs', maxBytes: 3 }), /too large/); });
test('resume without the bundled worker refuses clearly', async () => { await assert.rejects(extractResumePdf(pdf('Resume'), { workerSrc: '' }), /not configured/); });
