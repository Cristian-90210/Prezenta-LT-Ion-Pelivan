import ExcelJS from 'exceljs';

// ── Tipuri ────────────────────────────────────────────────────────────────────

export interface XlsxColumn {
  /** Numele afișat în header */
  label: string;
  /** Cheia din obiectul de date */
  key: string;
  /** Forțează tipul celulei (auto-detectat dacă lipsește) */
  type?: 'text' | 'number' | 'date' | 'time';
  /** Aliniere forțată (auto-detectată dacă lipsește) */
  align?: 'left' | 'center' | 'right';
  /** Lățime minimă în caractere */
  minWidth?: number;
}

export interface XlsxTotal {
  /** Eticheta rândului de total (ex: "Total prezențe") */
  label: string;
  /** Valoarea totală */
  value: number | string;
}

export interface XlsxSheet {
  sheetName: string;
  title: string;
  subtitle?: string[];
  columns: XlsxColumn[];
  data: Record<string, unknown>[];
  totals?: XlsxTotal;
}

export interface XlsxExportOptions {
  /** Lista de sheet-uri (minimum 1) */
  sheets: XlsxSheet[];
  /** Numele fișierului descărcat (fără extensie) */
  filename: string;
}

// ── Culori ────────────────────────────────────────────────────────────────────

const COLOR = {
  headerBg:    '4F46E5',
  headerFg:    'FFFFFF',
  rowEven:     'EEF2FF',
  rowOdd:      'FFFFFF',
  totalBg:     'E0E7FF',
  totalFg:     '1E1B4B',
  titleFg:     '1E1B4B',
  subtitleFg:  '6B7280',
  borderColor: 'C7D2FE',
} as const;

// ── Utilitare interne ─────────────────────────────────────────────────────────

function detectType(value: unknown, forced?: XlsxColumn['type']): XlsxColumn['type'] {
  if (forced) return forced;
  if (value instanceof Date) return 'date';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'string') {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return 'date';
    if (/^\d{2}:\d{2}(:\d{2})?$/.test(value)) return 'time';
  }
  return 'text';
}

function detectAlign(
  type: XlsxColumn['type'],
  forced?: XlsxColumn['align'],
): ExcelJS.Alignment['horizontal'] {
  if (forced) return forced;
  if (type === 'number' || type === 'time' || type === 'date') return 'center';
  return 'left';
}

function formatCellValue(
  value: unknown,
  type: XlsxColumn['type'],
): { value: ExcelJS.CellValue; numFmt?: string } {
  if (value === null || value === undefined || value === '') return { value: '—' };

  if (type === 'date') {
    const d = value instanceof Date ? value : new Date(String(value) + 'T12:00:00');
    if (isNaN(d.getTime())) return { value: String(value) };
    return { value: d, numFmt: 'DD.MM.YYYY' };
  }
  if (type === 'time') return { value: String(value) };
  if (type === 'number') {
    const n = Number(value);
    return isNaN(n) ? { value: String(value) } : { value: n };
  }
  return { value: String(value) };
}

function borderStyle(): Partial<ExcelJS.Border> {
  return { style: 'thin', color: { argb: COLOR.borderColor } };
}

function applyBorders(cell: ExcelJS.Cell) {
  cell.border = {
    top: borderStyle(), left: borderStyle(),
    bottom: borderStyle(), right: borderStyle(),
  };
}

// ── Populare sheet ────────────────────────────────────────────────────────────

function fillSheet(ws: ExcelJS.Worksheet, sheet: XlsxSheet) {
  const { title, subtitle = [], columns, data, totals } = sheet;
  const colCount = columns.length;
  let row = 1;

  // Titlu
  ws.mergeCells(row, 1, row, colCount);
  const titleCell = ws.getCell(row, 1);
  titleCell.value = title;
  titleCell.font = { name: 'Calibri', size: 16, bold: true, color: { argb: COLOR.titleFg } };
  titleCell.alignment = { horizontal: 'left', vertical: 'middle' };
  ws.getRow(row).height = 28;
  row++;

  // Subtitluri
  for (const line of subtitle) {
    ws.mergeCells(row, 1, row, colCount);
    const cell = ws.getCell(row, 1);
    cell.value = line;
    cell.font = { name: 'Calibri', size: 10, color: { argb: COLOR.subtitleFg } };
    cell.alignment = { horizontal: 'left', vertical: 'middle' };
    ws.getRow(row).height = 16;
    row++;
  }

  // Separator
  row++;

  // Header tabel
  const headerRow = ws.getRow(row);
  headerRow.height = 22;
  columns.forEach((col, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = col.label;
    cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: COLOR.headerFg } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR.headerBg } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    applyBorders(cell);
  });
  const dataStartRow = row + 1;
  row++;

  // Date
  data.forEach((record, rowIdx) => {
    const r = ws.getRow(row);
    r.height = 18;
    const isEven = rowIdx % 2 === 0;

    columns.forEach((col, colIdx) => {
      const rawValue = record[col.key];
      const type = detectType(rawValue, col.type);
      const { value, numFmt } = formatCellValue(rawValue, type);
      const align = detectAlign(type, col.align);
      const cell = r.getCell(colIdx + 1);
      cell.value = value;
      if (numFmt) cell.numFmt = numFmt;
      cell.font = { name: 'Calibri', size: 10 };
      cell.fill = {
        type: 'pattern', pattern: 'solid',
        fgColor: { argb: isEven ? COLOR.rowEven : COLOR.rowOdd },
      };
      cell.alignment = { horizontal: align, vertical: 'middle' };
      applyBorders(cell);
    });
    row++;
  });

  // Totaluri
  if (totals) {
    const r = ws.getRow(row);
    r.height = 20;
    if (colCount > 1) ws.mergeCells(row, 1, row, colCount - 1);
    const labelCell = r.getCell(1);
    labelCell.value = totals.label;
    labelCell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: COLOR.totalFg } };
    labelCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR.totalBg } };
    labelCell.alignment = { horizontal: 'right', vertical: 'middle' };
    applyBorders(labelCell);
    const valueCell = r.getCell(colCount);
    valueCell.value = totals.value;
    valueCell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: COLOR.totalFg } };
    valueCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR.totalBg } };
    valueCell.alignment = { horizontal: 'center', vertical: 'middle' };
    applyBorders(valueCell);
    row++;
  }

  // Auto-fit coloane
  columns.forEach((col, i) => {
    let maxLen = col.label.length;
    for (const record of data) {
      const raw = record[col.key];
      const type = detectType(raw, col.type);
      const len = type === 'date' ? 10 : raw != null ? String(raw).length : 0;
      if (len > maxLen) maxLen = len;
    }
    ws.getColumn(i + 1).width = Math.max(col.minWidth ?? 8, maxLen + 3);
  });

  // Freeze header + autofilter
  ws.views = [{ state: 'frozen', ySplit: dataStartRow - 1 }];
  if (data.length > 0) {
    ws.autoFilter = {
      from: { row: dataStartRow - 1, column: 1 },
      to:   { row: dataStartRow - 1 + data.length - 1, column: colCount },
    };
  }
}

// ── Export principal ──────────────────────────────────────────────────────────

export async function exportXlsx(opts: XlsxExportOptions): Promise<void> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'LT Ion Pelivan – Sistem Prezență';
  wb.created = new Date();

  for (const sheet of opts.sheets) {
    const ws = wb.addWorksheet(sheet.sheetName, {
      pageSetup: { fitToPage: true, fitToWidth: 1, orientation: 'landscape' },
    });
    fillSheet(ws, sheet);
  }

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${opts.filename}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
