import { cleanText } from './text';
/** Incremental RFC 4180 parser; chunks may end inside UTF-8, escaped quotes or CRLF. */
export class CsvStreamParser {
  private field = '';
  private row: string[] = [];
  private mode: 'plain' | 'quoted' | 'afterQuote' = 'plain';
  private skipLF = false;
  private decoder = new TextDecoder('utf-8', { fatal: false });
  private first = true;
  constructor(private readonly onRow: (row: string[]) => void, private maxFieldChars = 2_000_000) {}
  write(bytes: Uint8Array): void { this.writeText(this.decoder.decode(bytes, { stream: true })); }
  writeText(text: string): void {
    if (this.first && text.length) { text = text.replace(/^\uFEFF/, ''); this.first = false; }
    for (const char of text) {
      if (this.skipLF) { this.skipLF = false; if (char === '\n') continue; }
      if (this.mode === 'quoted') {
        if (char === '"') this.mode = 'afterQuote'; else this.field += char;
      } else if (this.mode === 'afterQuote' && char === '"') {
        this.field += '"'; this.mode = 'quoted';
      } else if (char === ',') {
        this.finishField(); this.mode = 'plain';
      } else if (char === '\r' || char === '\n') {
        this.finishRow(); this.mode = 'plain'; this.skipLF = char === '\r';
      } else if (char === '"' && this.mode === 'plain' && !this.field) {
        this.mode = 'quoted';
      } else if (this.mode !== 'afterQuote' || !/\s/.test(char)) {
        this.field += char;
      }
      if (this.field.length > this.maxFieldChars) throw new Error('A CSV field exceeds the safe import limit.');
    }
  }
  finish(): void {
    this.writeText(this.decoder.decode());
    if (this.mode === 'quoted') throw new Error('The archive contains an unfinished quoted CSV field.');
    if (this.field.length || this.row.length) this.finishRow();
  }
  private finishField(): void { this.row.push(cleanText(this.field)); this.field = ''; }
  private finishRow(): void {
    this.finishField();
    if (this.row.some(cell => cell.trim().length)) this.onRow(this.row);
    this.row = [];
  }
}
export type RawFact = Readonly<Record<string, string>>;
export function encodeCsv(rows: readonly RawFact[]): string {
  const columns = [...new Set(rows.flatMap(row => Object.keys(row)))];
  const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
  return [columns.map(escape).join(','), ...rows.map(row => columns.map(key => escape(row[key] ?? '')).join(','))].join('\r\n');
}
