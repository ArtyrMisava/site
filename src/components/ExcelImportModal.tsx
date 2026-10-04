import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from 'react';
import { readSheet } from 'read-excel-file/browser';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  MapPinned,
  RefreshCw,
  Table2,
  UploadCloud,
  X,
} from 'lucide-react';
import { MAP_HEIGHT, MAP_WIDTH } from '../data';
import type { MapItem, PersonPoint } from '../types';

type SpreadsheetCell = string | number | boolean | Date | null;
type MappingKey = 'firstName' | 'lastName' | 'pointName' | 'x' | 'y';

type ColumnMapping = Record<MappingKey, number | null>;

interface LoadedSheet {
  fileName: string;
  fileSize: number;
  headers: string[];
  rows: SpreadsheetCell[][];
  firstDataRowNumber: number;
}

interface ImportRow {
  rowNumber: number;
  firstName: string;
  lastName: string;
  pointName: string;
  x: number | null;
  y: number | null;
  status: 'valid' | 'invalid' | 'duplicate';
  note: string;
}

interface ExcelImportModalProps {
  open: boolean;
  existingItems: MapItem[];
  onClose: () => void;
  onImport: (points: PersonPoint[]) => void;
}

const emptyMapping: ColumnMapping = {
  firstName: null,
  lastName: null,
  pointName: null,
  x: null,
  y: null,
};

const aliases: Record<MappingKey, string[]> = {
  firstName: [
    'имя',
    'имя сотрудника',
    'first name',
    'firstname',
    'name',
  ],
  lastName: [
    'фамилия',
    'фамилия сотрудника',
    'last name',
    'lastname',
    'surname',
  ],
  pointName: [
    'название точки',
    'наименование точки',
    'точка',
    'объект',
    'локация',
    'point name',
    'point',
    'location',
  ],
  x: ['x', 'координата x', 'позиция x', 'coord x'],
  y: ['y', 'координата y', 'позиция y', 'coord y'],
};

function cellText(value: SpreadsheetCell | undefined): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toLocaleDateString('ru-RU');
  return String(value).trim();
}

function normalize(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase('ru-RU')
    .replaceAll('ё', 'е')
    .replace(/[_.\-/\\]+/g, ' ')
    .replace(/\s+/g, ' ');
}

function detectColumn(headers: string[], key: MappingKey): number | null {
  const normalizedHeaders = headers.map(normalize);
  const normalizedAliases = aliases[key].map(normalize);

  const exactMatch = normalizedHeaders.findIndex((header) =>
    normalizedAliases.includes(header),
  );
  if (exactMatch >= 0) return exactMatch;

  const partialMatch = normalizedHeaders.findIndex((header) =>
    normalizedAliases.some(
      (alias) => alias.length > 3 && (header.includes(alias) || alias.includes(header)),
    ),
  );
  return partialMatch >= 0 ? partialMatch : null;
}

function makeMapping(headers: string[]): ColumnMapping {
  return {
    firstName: detectColumn(headers, 'firstName'),
    lastName: detectColumn(headers, 'lastName'),
    pointName: detectColumn(headers, 'pointName'),
    x: detectColumn(headers, 'x'),
    y: detectColumn(headers, 'y'),
  };
}

function findHeaderRow(rows: SpreadsheetCell[][]): number {
  const firstNonEmpty = rows.findIndex((row) =>
    row.some((cell) => cellText(cell) !== ''),
  );
  if (firstNonEmpty < 0) return -1;

  let bestIndex = firstNonEmpty;
  let bestScore = 0;
  rows.slice(0, 25).forEach((row, index) => {
    const candidate = makeMapping(row.map((cell) => cellText(cell)));
    const score = [candidate.firstName, candidate.lastName, candidate.pointName]
      .filter((column) => column !== null).length;
    if (score > bestScore) {
      bestIndex = index;
      bestScore = score;
    }
  });

  return bestScore >= 2 ? bestIndex : firstNonEmpty;
}

function parseCoordinate(value: SpreadsheetCell | undefined): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const text = cellText(value).replace(/\s/g, '').replace(',', '.');
  if (!text) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function pointSignature(firstName: string, lastName: string, pointName: string): string {
  return [firstName, lastName, pointName].map(normalize).join('|');
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}

function pointNoun(count: number, accusative = false): string {
  const remainder100 = count % 100;
  const remainder10 = count % 10;
  if (remainder10 === 1 && remainder100 !== 11) {
    return accusative ? 'точку' : 'точка';
  }
  if (remainder10 >= 2 && remainder10 <= 4 && (remainder100 < 12 || remainder100 > 14)) {
    return 'точки';
  }
  return 'точек';
}

function autoPosition(index: number, total: number): { lat: number; lng: number } {
  const safeTotal = Math.max(total, 1);
  const columns = Math.max(
    1,
    Math.ceil(Math.sqrt((safeTotal * MAP_WIDTH) / MAP_HEIGHT)),
  );
  const rows = Math.max(1, Math.ceil(safeTotal / columns));
  const column = index % columns;
  const row = Math.floor(index / columns);
  const x = ((column + 1) * MAP_WIDTH) / (columns + 1);
  const y = ((row + 1) * MAP_HEIGHT) / (rows + 1);

  return {
    lng: Math.round(x),
    lat: Math.round(MAP_HEIGHT - y),
  };
}

export function ExcelImportModal({
  open,
  existingItems,
  onClose,
  onImport,
}: ExcelImportModalProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [sheet, setSheet] = useState<LoadedSheet | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>(emptyMapping);
  const [loading, setLoading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setSheet(null);
    setMapping(emptyMapping);
    setLoading(false);
    setDragging(false);
    setError('');
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !loading) onClose();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [loading, onClose, open]);

  const requiredMappingReady =
    mapping.firstName !== null &&
    mapping.lastName !== null &&
    mapping.pointName !== null;

  const parsedRows = useMemo<ImportRow[]>(() => {
    if (!sheet || !requiredMappingReady) return [];

    const knownPoints = new Set(
      existingItems
        .filter((item): item is PersonPoint => item.kind === 'person')
        .map((item) =>
          pointSignature(item.firstName, item.lastName, item.pointName),
        ),
    );

    const result: ImportRow[] = [];

    sheet.rows.forEach((row, index) => {
      const selectedValues = [
        mapping.firstName,
        mapping.lastName,
        mapping.pointName,
      ].map((column) => cellText(row[column!]));

      const [firstName, lastName, pointName] = selectedValues;
      const entireRowIsEmpty = row.every((cell) => cellText(cell) === '');
      if (entireRowIsEmpty) return;

      const rowNumber = sheet.firstDataRowNumber + index;
      if (!firstName || !lastName || !pointName) {
        const missing = [
          !firstName ? 'имя' : '',
          !lastName ? 'фамилия' : '',
          !pointName ? 'точка' : '',
        ].filter(Boolean);
        result.push({
          rowNumber,
          firstName,
          lastName,
          pointName,
          x: null,
          y: null,
          status: 'invalid',
          note: `Не заполнено: ${missing.join(', ')}`,
        });
        return;
      }

      const signature = pointSignature(firstName, lastName, pointName);
      if (knownPoints.has(signature)) {
        result.push({
          rowNumber,
          firstName,
          lastName,
          pointName,
          x: null,
          y: null,
          status: 'duplicate',
          note: 'Такая точка уже существует',
        });
        return;
      }
      knownPoints.add(signature);

      const rawX = mapping.x === null ? null : parseCoordinate(row[mapping.x]);
      const rawY = mapping.y === null ? null : parseCoordinate(row[mapping.y]);
      const coordinatesValid =
        rawX !== null &&
        rawY !== null &&
        rawX >= 0 &&
        rawX <= MAP_WIDTH &&
        rawY >= 0 &&
        rawY <= MAP_HEIGHT;

      result.push({
        rowNumber,
        firstName,
        lastName,
        pointName,
        x: coordinatesValid ? rawX : null,
        y: coordinatesValid ? rawY : null,
        status: 'valid',
        note: coordinatesValid
          ? 'Координаты из таблицы'
          : 'Будет размещена автоматически',
      });
    });

    return result;
  }, [existingItems, mapping, requiredMappingReady, sheet]);

  const validRows = parsedRows.filter((row) => row.status === 'valid');
  const invalidCount = parsedRows.filter((row) => row.status === 'invalid').length;
  const duplicateCount = parsedRows.filter((row) => row.status === 'duplicate').length;
  const autoPositionCount = validRows.filter(
    (row) => row.x === null || row.y === null,
  ).length;

  if (!open) return null;

  async function loadFile(file: File) {
    setError('');
    setSheet(null);

    if (!file.name.toLocaleLowerCase('ru-RU').endsWith('.xlsx')) {
      setError('Выберите книгу Excel в формате .xlsx. Старый формат .xls нужно сначала сохранить как .xlsx.');
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      setError('Файл больше 15 МБ. Уменьшите таблицу и попробуйте ещё раз.');
      return;
    }

    setLoading(true);
    try {
      const workbookRows = (await readSheet(file)) as unknown as SpreadsheetCell[][];
      const headerIndex = findHeaderRow(workbookRows);

      if (headerIndex < 0) {
        throw new Error('В книге нет заполненных строк.');
      }

      const maxColumns = Math.max(
        ...workbookRows.slice(headerIndex).map((row) => row.length),
      );
      const headerRow = workbookRows[headerIndex];
      const headers = Array.from({ length: maxColumns }, (_, index) => {
        const value = cellText(headerRow[index]);
        return value || `Столбец ${index + 1}`;
      });
      const rows = workbookRows.slice(headerIndex + 1, headerIndex + 5001);

      if (rows.length === 0) {
        throw new Error('После строки заголовков нет данных для импорта.');
      }

      setSheet({
        fileName: file.name,
        fileSize: file.size,
        headers,
        rows,
        firstDataRowNumber: headerIndex + 2,
      });
      setMapping(makeMapping(headers));
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : 'Не удалось прочитать Excel-файл.',
      );
    } finally {
      setLoading(false);
    }
  }

  function handleFileInput(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) void loadFile(file);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file) void loadFile(file);
  }

  function updateMapping(key: MappingKey, value: string) {
    setMapping((current) => ({
      ...current,
      [key]: value === '' ? null : Number(value),
    }));
  }

  function importPoints() {
    if (validRows.length === 0) return;
    const timestamp = new Date().toISOString();
    let autoIndex = 0;

    const points = validRows.map<PersonPoint>((row, index) => {
      let position: { lat: number; lng: number };
      if (row.x !== null && row.y !== null) {
        position = { lng: row.x, lat: MAP_HEIGHT - row.y };
      } else {
        position = autoPosition(autoIndex, autoPositionCount);
        autoIndex += 1;
      }

      return {
        id: crypto.randomUUID?.() ?? `excel-${Date.now()}-${index}`,
        kind: 'person',
        firstName: row.firstName,
        lastName: row.lastName,
        pointName: row.pointName,
        lat: position.lat,
        lng: position.lng,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
    });

    onImport(points);
  }

  const previewRows = parsedRows.slice(0, 10);

  return (
    <div
      className="modal-backdrop excel-import-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !loading) onClose();
      }}
    >
      <section
        className="excel-import-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="excel-import-title"
      >
        <header className="excel-import-header">
          <div className="excel-modal-emblem" aria-hidden="true">
            <FileSpreadsheet size={24} />
          </div>
          <div>
            <p className="eyebrow">Массовое добавление</p>
            <h2 id="excel-import-title">Импорт точек из Excel</h2>
            <p>Загрузите таблицу, проверьте столбцы и данные перед добавлением.</p>
          </div>
          <button
            className="icon-button excel-close"
            type="button"
            onClick={onClose}
            disabled={loading}
            aria-label="Закрыть импорт"
          >
            <X size={19} />
          </button>
        </header>

        <div className="excel-import-body">
          <input
            ref={inputRef}
            className="visually-hidden"
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={handleFileInput}
          />

          {!sheet ? (
            <>
              <div
                className={`excel-dropzone ${dragging ? 'dragging' : ''} ${loading ? 'loading' : ''}`}
                onDragEnter={(event) => {
                  event.preventDefault();
                  setDragging(true);
                }}
                onDragOver={(event) => event.preventDefault()}
                onDragLeave={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget as Node)) {
                    setDragging(false);
                  }
                }}
                onDrop={handleDrop}
              >
                <span className="dropzone-icon">
                  {loading ? <RefreshCw className="spin" size={27} /> : <UploadCloud size={29} />}
                </span>
                <strong>{loading ? 'Читаем таблицу…' : 'Перетащите Excel-файл сюда'}</strong>
                <p>или выберите книгу в формате .xlsx на компьютере</p>
                <button
                  className="primary-button choose-excel-button"
                  type="button"
                  onClick={() => inputRef.current?.click()}
                  disabled={loading}
                >
                  <FileSpreadsheet size={17} />
                  Выбрать Excel-файл
                </button>
                <small>Максимальный размер — 15 МБ, до 5000 строк</small>
              </div>

              <div className="excel-template-card">
                <div>
                  <span><Table2 size={18} /></span>
                  <p>
                    <strong>Нет подходящей таблицы?</strong>
                    <small>Скачайте готовый шаблон с нужными заголовками и примером.</small>
                  </p>
                </div>
                <a href="/templates/points-import-template.xlsx" download>
                  <Download size={16} />
                  Скачать шаблон
                </a>
              </div>
            </>
          ) : (
            <>
              <div className="excel-file-card">
                <span><FileSpreadsheet size={21} /></span>
                <div>
                  <strong>{sheet.fileName}</strong>
                  <small>{formatFileSize(sheet.fileSize)} · {sheet.rows.length} строк данных</small>
                </div>
                <button type="button" onClick={() => inputRef.current?.click()}>
                  <RefreshCw size={14} />
                  Заменить файл
                </button>
              </div>

              <section className="column-mapping-section">
                <div className="import-section-heading">
                  <div>
                    <span>1</span>
                    <p><strong>Сопоставьте столбцы</strong><small>Мы определили знакомые названия автоматически</small></p>
                  </div>
                  {requiredMappingReady ? (
                    <em className="mapping-ready"><CheckCircle2 size={14} /> Готово</em>
                  ) : (
                    <em className="mapping-warning"><AlertTriangle size={14} /> Нужны 3 столбца</em>
                  )}
                </div>

                <div className="mapping-grid required-mapping">
                  {([
                    ['firstName', 'Имя'],
                    ['lastName', 'Фамилия'],
                    ['pointName', 'Название точки'],
                  ] as Array<[MappingKey, string]>).map(([key, label]) => (
                    <label key={key}>
                      <span className="field-label">{label} <b>*</b></span>
                      <select
                        value={mapping[key] ?? ''}
                        onChange={(event) => updateMapping(key, event.target.value)}
                      >
                        <option value="">Выберите столбец</option>
                        {sheet.headers.map((header, index) => (
                          <option key={`${header}-${index}`} value={index}>{header}</option>
                        ))}
                      </select>
                    </label>
                  ))}
                </div>

                <div className="optional-coordinates">
                  <div className="optional-copy">
                    <MapPinned size={17} />
                    <p><strong>Координаты необязательны</strong><small>Без X и Y точки равномерно разместятся на карте — затем их можно перетащить.</small></p>
                  </div>
                  <div className="coordinate-selects">
                    {([
                      ['x', 'X (0–1600)'],
                      ['y', 'Y (0–1000)'],
                    ] as Array<[MappingKey, string]>).map(([key, label]) => (
                      <label key={key}>
                        <span>{label}</span>
                        <select
                          value={mapping[key] ?? ''}
                          onChange={(event) => updateMapping(key, event.target.value)}
                        >
                          <option value="">Нет</option>
                          {sheet.headers.map((header, index) => (
                            <option key={`${header}-${index}`} value={index}>{header}</option>
                          ))}
                        </select>
                      </label>
                    ))}
                  </div>
                </div>
              </section>

              <section className="excel-preview-section">
                <div className="import-section-heading preview-heading">
                  <div>
                    <span>2</span>
                    <p><strong>Проверьте данные</strong><small>Показаны первые 10 распознанных строк</small></p>
                  </div>
                </div>

                {requiredMappingReady ? (
                  <>
                    <div className="import-summary-row">
                      <div className="import-stat valid"><strong>{validRows.length}</strong><span>будет добавлено</span></div>
                      <div className="import-stat duplicate"><strong>{duplicateCount}</strong><span>дубликатов</span></div>
                      <div className="import-stat invalid"><strong>{invalidCount}</strong><span>с ошибками</span></div>
                      <div className="import-stat auto"><strong>{autoPositionCount}</strong><span>авторазмещение</span></div>
                    </div>

                    <div className="excel-preview-table-wrap">
                      <table className="excel-preview-table">
                        <thead>
                          <tr><th>Строка</th><th>Имя</th><th>Фамилия</th><th>Название точки</th><th>Результат</th></tr>
                        </thead>
                        <tbody>
                          {previewRows.map((row) => (
                            <tr key={row.rowNumber} className={row.status}>
                              <td>{row.rowNumber}</td>
                              <td>{row.firstName || '—'}</td>
                              <td>{row.lastName || '—'}</td>
                              <td>{row.pointName || '—'}</td>
                              <td><span className={`row-status ${row.status}`}>
                                {row.status === 'valid' ? <CheckCircle2 size={12} /> : <AlertTriangle size={12} />}
                                {row.note}
                              </span></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {previewRows.length === 0 && <p className="empty-preview">В выбранных столбцах нет заполненных строк.</p>}
                    </div>
                    {parsedRows.length > previewRows.length && (
                      <p className="preview-more">И ещё {parsedRows.length - previewRows.length} строк — они также будут обработаны.</p>
                    )}
                  </>
                ) : (
                  <div className="mapping-empty-state">
                    <Table2 size={23} />
                    <p><strong>Выберите обязательные столбцы выше</strong><span>После этого здесь появится предварительный просмотр.</span></p>
                  </div>
                )}
              </section>
            </>
          )}

          {error && <p className="form-error excel-error"><AlertTriangle size={15} />{error}</p>}
        </div>

        <footer className="excel-import-footer">
          <p>
            {sheet && validRows.length > 0
              ? `${validRows.length} ${pointNoun(validRows.length)} ${validRows.length === 1 ? 'готова' : 'готовы'} к импорту`
              : 'Существующие точки останутся без изменений'}
          </p>
          <div>
            <button className="secondary-button" type="button" onClick={onClose}>Отмена</button>
            <button
              className="primary-button import-confirm-button"
              type="button"
              onClick={importPoints}
              disabled={!sheet || !requiredMappingReady || validRows.length === 0}
            >
              <UploadCloud size={17} />
              Добавить {validRows.length > 0 ? `${validRows.length} ${pointNoun(validRows.length, true)}` : 'точки'}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
