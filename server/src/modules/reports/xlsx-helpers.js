// Outils partagés par les exports Excel (Bilan Carbone et Préparation CBAM)
// et libellés de secteur affichés dans les documents exportés.

// Doit rester synchronisé avec SECTORS (auth.validation.js).
export const SECTOR_LABELS = {
  automobile: 'Automobile',
  textile: 'Textile',
  agroalimentaire: 'Agroalimentaire',
  metallurgie: 'Métallurgie',
  fer_et_acier: 'Fer et acier',
  aluminium: 'Aluminium',
  ciment: 'Ciment',
  engrais: 'Engrais',
  electricite: 'Électricité',
  hydrogene: 'Hydrogène',
};

export function sectorLabel(sector) {
  if (!sector) return null;
  return SECTOR_LABELS[sector] ?? sector;
}

export const TCO2E_FORMAT = '#,##0.000';
const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0B4A3A' } };
const HEADER_FONT = { bold: true, color: { argb: 'FFFFFFFF' } };

export async function createWorkbook() {
  const ExcelJS = (await import('exceljs')).default;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'mizancarbone';
  workbook.created = new Date();
  return workbook;
}

// Onglet "Informations" : titre puis paires libellé / valeur.
export function addInfoSheet(workbook, title, pairs) {
  const sheet = workbook.addWorksheet('Informations');
  sheet.getColumn(1).width = 30;
  sheet.getColumn(2).width = 110;
  sheet.addRow([title]).font = { bold: true, size: 14, color: { argb: 'FF0B4A3A' } };
  sheet.addRow([]);
  pairs.forEach(([label, value]) => {
    const row = sheet.addRow([label, value]);
    row.getCell(1).font = { bold: true };
    row.alignment = { vertical: 'top', wrapText: true };
  });
  return sheet;
}

// Onglet tableau : en-tête mis en forme et figé, filtres, formats numériques.
export function addTableSheet(workbook, name, columns, rows) {
  const sheet = workbook.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = columns.map(({ header, key, width }) => ({ header, key, width }));
  const headerRow = sheet.getRow(1);
  headerRow.font = HEADER_FONT;
  headerRow.fill = HEADER_FILL;
  headerRow.alignment = { vertical: 'middle', wrapText: true };
  headerRow.height = 30;
  rows.forEach((row) => sheet.addRow(row));
  columns.forEach(({ key, numFmt }) => {
    if (numFmt) sheet.getColumn(key).numFmt = numFmt;
  });
  sheet.eachRow((row, i) => {
    if (i > 1) row.alignment = { vertical: 'top', wrapText: true };
  });
  if (rows.length > 0) {
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
  }
  return sheet;
}

export async function workbookToBuffer(workbook) {
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
