import type { Workbook, Worksheet } from 'exceljs';
import { MAP_HEIGHT, MAP_WIDTH } from './data';
import type { PersonnelEntry, PersonPoint } from './types';

const SERVICE_SHEET_NAME = '_Карта';
const POINT_ID_CELL = 'Z1';
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

interface ExcelWritable {
  write(data: Blob): Promise<void>;
  close(): Promise<void>;
}

export interface ExcelFileHandle {
  name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<ExcelWritable>;
}

interface FilePickerWindow {
  showOpenFilePicker?: (options: {
    multiple: boolean;
    types: Array<{
      description: string;
      accept: Record<string, string[]>;
    }>;
  }) => Promise<ExcelFileHandle[]>;
}

export interface ExcelWorkbookSession {
  fileName: string;
  handle: ExcelFileHandle;
  workbook: Workbook;
}

interface IndexRecord {
  excelId: string;
  sheetName: string;
  lng: number | null;
  mapY: number | null;
}

export function supportsExcelFileLink(): boolean {
  return typeof (window as unknown as FilePickerWindow).showOpenFilePicker === 'function';
}

function newId(): string {
  return crypto.randomUUID?.() ?? `excel-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase('ru-RU').replaceAll('ё', 'е');
}

function cellText(worksheet: Worksheet, address: string): string {
  return worksheet.getCell(address).text.trim();
}

function coordinate(value: unknown, max: number): number | null {
  const parsed = typeof value === 'number'
    ? value
    : Number(String(value ?? '').replace(',', '.'));
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= max ? parsed : null;
}

function readIndex(workbook: Workbook): IndexRecord[] {
  const sheet = workbook.getWorksheet(SERVICE_SHEET_NAME);
  if (!sheet) return [];
  const records: IndexRecord[] = [];

  for (let rowNumber = 2; rowNumber <= Math.min(sheet.rowCount, 5001); rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    const excelId = row.getCell(1).text.trim();
    const sheetName = row.getCell(2).text.trim();
    if (!excelId && !sheetName) continue;
    records.push({
      excelId,
      sheetName,
      lng: coordinate(row.getCell(3).value, MAP_WIDTH),
      mapY: coordinate(row.getCell(4).value, MAP_HEIGHT),
    });
  }

  return records;
}

function readPersonnel(worksheet: Worksheet, excelId: string): PersonnelEntry[] {
  const personnel: PersonnelEntry[] = [];

  for (let rowNumber = 2; rowNumber <= Math.min(worksheet.rowCount, 5001); rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    const fullName = row.getCell(1).text.trim();
    const position = row.getCell(2).text.trim();
    if (!fullName) continue;
    const normalizedName = normalize(fullName);
    if (normalizedName === 'фио' || normalizedName === 'ф.и.о.' || normalizedName === 'сотрудник') {
      continue;
    }
    personnel.push({
      id: `${excelId}-row-${rowNumber}`,
      fullName,
      position,
    });
  }

  return personnel;
}

function autoPosition(index: number, total: number): { lat: number; lng: number } {
  const columns = Math.max(1, Math.ceil(Math.sqrt((Math.max(total, 1) * MAP_WIDTH) / MAP_HEIGHT)));
  const rows = Math.max(1, Math.ceil(Math.max(total, 1) / columns));
  const column = index % columns;
  const row = Math.floor(index / columns);
  return {
    lng: Math.round(((column + 1) * MAP_WIDTH) / (columns + 1)),
    lat: Math.round(MAP_HEIGHT - ((row + 1) * MAP_HEIGHT) / (rows + 1)),
  };
}

function findWorksheetByExcelId(workbook: Workbook, excelId: string): Worksheet | undefined {
  return workbook.worksheets.find(
    (worksheet) => worksheet.name !== SERVICE_SHEET_NAME && cellText(worksheet, POINT_ID_CELL) === excelId,
  );
}

function sanitizedSheetBase(value: string): string {
  const sanitized = value
    .replace(/[\\/*?:[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^'+|'+$/g, '')
    .trim();
  const base = sanitized || 'Новая точка';
  return base === SERVICE_SHEET_NAME ? 'Точка' : base.slice(0, 31);
}

function uniqueSheetName(workbook: Workbook, desired: string, current?: Worksheet): string {
  const base = sanitizedSheetBase(desired);
  const occupied = new Set(
    workbook.worksheets
      .filter((worksheet) => worksheet !== current)
      .map((worksheet) => worksheet.name.toLocaleLowerCase('ru-RU')),
  );
  if (!occupied.has(base.toLocaleLowerCase('ru-RU'))) return base;

  for (let index = 2; index < 1000; index += 1) {
    const suffix = ` (${index})`;
    const candidate = `${base.slice(0, 31 - suffix.length)}${suffix}`;
    if (!occupied.has(candidate.toLocaleLowerCase('ru-RU'))) return candidate;
  }
  return `Точка ${Date.now()}`.slice(0, 31);
}

function setPlaceNameRow(worksheet: Worksheet, pointName: string) {
  worksheet.getCell('A1').value = null;
  worksheet.getCell('B1').value = pointName;
}

function applyNewSheetTemplate(worksheet: Worksheet, pointName: string, excelId: string) {
  setPlaceNameRow(worksheet, pointName);
  worksheet.getCell(POINT_ID_CELL).value = excelId;
  worksheet.getColumn(26).hidden = true;
  worksheet.getColumn(1).width = 38;
  worksheet.getColumn(2).width = 26;
  worksheet.getRow(1).height = 23;
  worksheet.views = [{ state: 'frozen', ySplit: 1 }];

  for (const cell of [worksheet.getCell('A1'), worksheet.getCell('B1')]) {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF34403B' } };
    cell.alignment = { vertical: 'middle' };
  }
  worksheet.getCell('A1').border = {
    bottom: { style: 'medium', color: { argb: 'FFE66A3F' } },
  };
  worksheet.getCell('B1').border = {
    bottom: { style: 'medium', color: { argb: 'FFE66A3F' } },
  };
}

function writePersonnel(worksheet: Worksheet, personnel: PersonnelEntry[]) {
  const removableRows = Math.max(0, worksheet.rowCount - 1);
  if (removableRows > 0) worksheet.spliceRows(2, removableRows);

  personnel
    .filter((person) => person.fullName.trim())
    .forEach((person) => {
      const row = worksheet.addRow([person.fullName.trim(), person.position.trim()]);
      row.getCell(1).alignment = { vertical: 'middle' };
      row.getCell(2).alignment = { vertical: 'middle' };
    });
}

function ensureServiceSheet(workbook: Workbook, points: PersonPoint[]) {
  const existingSheet = workbook.getWorksheet(SERVICE_SHEET_NAME);
  if (existingSheet) workbook.removeWorksheet(existingSheet.id);
  const sheet = workbook.addWorksheet(SERVICE_SHEET_NAME);

  sheet.addRow(['ID', 'Лист', 'X', 'Y']);
  points
    .filter((point) => point.excelId)
    .forEach((point) => {
      sheet!.addRow([
        point.excelId,
        point.sheetName || point.pointName,
        Math.round(point.lng),
        Math.round(MAP_HEIGHT - point.lat),
      ]);
    });

  sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF34403B' } };
  sheet.columns = [
    { key: 'id', width: 40 },
    { key: 'sheet', width: 32 },
    { key: 'x', width: 12 },
    { key: 'y', width: 12 },
  ];
  sheet.state = points.length > 0 ? 'veryHidden' : 'visible';
}

async function createWorkbook(): Promise<Workbook> {
  const module = await import('exceljs');
  return new module.default.Workbook();
}

export async function chooseExcelWorkbook(): Promise<ExcelWorkbookSession> {
  const picker = (window as unknown as FilePickerWindow).showOpenFilePicker;
  if (!picker) {
    throw new Error('Прямая привязка Excel поддерживается в Google Chrome и Microsoft Edge.');
  }

  const handles = await picker({
    multiple: false,
    types: [{
      description: 'Книга Excel',
      accept: { [XLSX_MIME]: ['.xlsx'] },
    }],
  });
  const handle = handles[0];
  if (!handle) throw new Error('Файл не выбран.');
  const file = await handle.getFile();
  const workbook = await createWorkbook();
  await workbook.xlsx.load(await file.arrayBuffer());

  return { fileName: file.name, handle, workbook };
}

export function readWorkbookPoints(
  session: ExcelWorkbookSession,
  existingPoints: PersonPoint[],
): PersonPoint[] {
  const { workbook } = session;
  const index = readIndex(workbook);
  const indexById = new Map(index.filter((entry) => entry.excelId).map((entry) => [entry.excelId, entry]));
  const indexByName = new Map(index.map((entry) => [normalize(entry.sheetName), entry]));
  const existingById = new Map(
    existingPoints.filter((point) => point.excelId).map((point) => [point.excelId!, point]),
  );
  const existingByName = new Map(
    existingPoints.map((point) => [normalize(point.sheetName || point.pointName), point]),
  );
  const pointSheets = workbook.worksheets.filter((worksheet) => worksheet.name !== SERVICE_SHEET_NAME);
  const timestamp = new Date().toISOString();

  return pointSheets.map((worksheet, sheetIndex) => {
    const metadataId = cellText(worksheet, POINT_ID_CELL);
    const indexedByName = indexByName.get(normalize(worksheet.name));
    const excelId = metadataId || indexedByName?.excelId || newId();
    const indexed = indexById.get(excelId) || indexedByName;
    const existing = existingById.get(excelId) || existingByName.get(normalize(worksheet.name));
    const fallback = autoPosition(sheetIndex, pointSheets.length);
    const lng = indexed?.lng ?? existing?.lng ?? fallback.lng;
    const lat = indexed?.mapY !== null && indexed?.mapY !== undefined
      ? MAP_HEIGHT - indexed.mapY
      : existing?.lat ?? fallback.lat;

    worksheet.getCell(POINT_ID_CELL).value = excelId;
    worksheet.getColumn(26).hidden = true;
    setPlaceNameRow(worksheet, worksheet.name);

    return {
      id: existing?.id ?? `excel-point-${excelId}`,
      kind: 'person',
      pointName: worksheet.name,
      personnel: readPersonnel(worksheet, excelId),
      excelId,
      sheetName: worksheet.name,
      lat,
      lng,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
    };
  });
}

export function upsertPointSheet(
  session: ExcelWorkbookSession,
  point: PersonPoint,
  previous?: PersonPoint,
): PersonPoint {
  const { workbook } = session;
  const previousExcelId = previous?.excelId || point.excelId;
  let worksheet = previousExcelId
    ? findWorksheetByExcelId(workbook, previousExcelId)
    : undefined;
  if (!worksheet && previous?.sheetName) worksheet = workbook.getWorksheet(previous.sheetName);

  const excelId = previousExcelId || newId();
  if (!worksheet) {
    const sheetName = uniqueSheetName(workbook, point.pointName);
    worksheet = workbook.addWorksheet(sheetName);
    applyNewSheetTemplate(worksheet, sheetName, excelId);
  } else {
    const sheetName = uniqueSheetName(workbook, point.pointName, worksheet);
    if (worksheet.name !== sheetName) worksheet.name = sheetName;
    worksheet.getCell(POINT_ID_CELL).value = excelId;
    worksheet.getColumn(26).hidden = true;
    setPlaceNameRow(worksheet, sheetName);
  }

  writePersonnel(worksheet, point.personnel);

  return {
    ...point,
    pointName: worksheet.name,
    sheetName: worksheet.name,
    excelId,
    updatedAt: new Date().toISOString(),
  };
}

export function removePointSheet(session: ExcelWorkbookSession, point: PersonPoint) {
  const worksheet = point.excelId
    ? findWorksheetByExcelId(session.workbook, point.excelId)
    : point.sheetName
      ? session.workbook.getWorksheet(point.sheetName)
      : undefined;
  if (worksheet) session.workbook.removeWorksheet(worksheet.id);
}

export async function saveExcelWorkbook(
  session: ExcelWorkbookSession,
  points: PersonPoint[],
): Promise<void> {
  ensureServiceSheet(session.workbook, points);
  const buffer = await session.workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer as unknown as BlobPart], { type: XLSX_MIME });
  const writable = await session.handle.createWritable();
  await writable.write(blob);
  await writable.close();
}

export async function reloadExcelWorkbook(session: ExcelWorkbookSession): Promise<void> {
  const file = await session.handle.getFile();
  const workbook = await createWorkbook();
  await workbook.xlsx.load(await file.arrayBuffer());
  session.fileName = file.name;
  session.workbook = workbook;
}
