import { useEffect } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  FolderOpen,
  Link2,
  RefreshCw,
  Save,
  ShieldCheck,
  Unlink,
  UsersRound,
  X,
} from 'lucide-react';
import type { ExcelConnectionState } from '../hooks/useExcelWorkbook';
import type { PersonPoint } from '../types';

interface ExcelWorkbookModalProps {
  state: ExcelConnectionState;
  points: PersonPoint[];
  onClose: () => void;
  onConnect: () => Promise<PersonPoint[] | null>;
  onRefresh: () => Promise<PersonPoint[]>;
  onPointsLoaded: (points: PersonPoint[]) => void;
  onDisconnect: () => void;
  onClearError: () => void;
}

function formatSyncTime(date: Date | null): string {
  if (!date) return 'ещё не синхронизировано';
  return `синхронизировано в ${date.toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
  })}`;
}

export function ExcelWorkbookModal({
  state,
  points,
  onClose,
  onConnect,
  onRefresh,
  onPointsLoaded,
  onDisconnect,
  onClearError,
}: ExcelWorkbookModalProps) {
  const busy = state.status === 'connecting' || state.status === 'saving';
  const connected = state.status === 'connected' || state.status === 'saving';

  useEffect(() => {
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onEscape);
    return () => window.removeEventListener('keydown', onEscape);
  }, [busy, onClose]);

  async function connect() {
    onClearError();
    const loadedPoints = await onConnect();
    if (loadedPoints) onPointsLoaded(loadedPoints);
  }

  async function refresh() {
    onClearError();
    try {
      const loadedPoints = await onRefresh();
      onPointsLoaded(loadedPoints);
    } catch {
      // The hook exposes the readable error in its state.
    }
  }

  return (
    <div
      className="modal-backdrop workbook-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <section
        className="workbook-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="workbook-modal-title"
      >
        <header className="workbook-header">
          <div className="workbook-emblem"><FileSpreadsheet size={24} /></div>
          <div>
            <p className="eyebrow">Источник данных точек</p>
            <h2 id="workbook-modal-title">Связь с Excel-книгой</h2>
            <p>Каждый лист книги соответствует одному ярлыку на карте.</p>
          </div>
          <button
            className="icon-button workbook-close"
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Закрыть"
          >
            <X size={19} />
          </button>
        </header>

        <div className="workbook-body">
          {connected ? (
            <>
              <div className="linked-file-card">
                <span className="linked-file-icon"><FileSpreadsheet size={24} /></span>
                <div className="linked-file-copy">
                  <span className="linked-status"><i /> Excel подключён</span>
                  <strong>{state.fileName}</strong>
                  <small>{formatSyncTime(state.lastSync)}</small>
                </div>
                <span className="linked-points-count">
                  <strong>{points.length}</strong>
                  <small>листов-точек</small>
                </span>
              </div>

              <div className="workbook-benefits">
                <div><Save size={18} /><p><strong>Автосохранение</strong><span>Создание, перемещение и удаление точек записываются в этот же файл.</span></p></div>
                <div><UsersRound size={18} /><p><strong>Данные сотрудников</strong><span>Столбец A — ФИО, столбец B — звание или должность.</span></p></div>
                <div><ShieldCheck size={18} /><p><strong>Надёжная связь</strong><span>Скрытый лист «_Карта» хранит ID, координаты и иконки ярлыков.</span></p></div>
              </div>

              <div className="workbook-actions-card">
                <div>
                  <strong>Изменили сотрудников вручную в Excel?</strong>
                  <span>Сохраните книгу в Excel, затем обновите данные на карте.</span>
                </div>
                <button className="refresh-workbook-button" type="button" onClick={() => void refresh()} disabled={busy}>
                  <RefreshCw className={busy ? 'spin' : ''} size={16} />
                  {state.status === 'saving' ? 'Сохраняем…' : 'Обновить из Excel'}
                </button>
              </div>

              <div className="workbook-disconnect-row">
                <p><AlertTriangle size={15} /><span>Не держите книгу открытой в Excel во время сохранения с сайта.</span></p>
                <button type="button" onClick={onDisconnect} disabled={busy}><Unlink size={15} /> Отключить файл</button>
              </div>
            </>
          ) : (
            <>
              <div className="workbook-intro">
                <span className="workbook-link-graphic"><FileSpreadsheet size={28} /><Link2 size={18} /></span>
                <h3>Выберите рабочую книгу `.xlsx`</h3>
                <p>
                  Сайт прочитает все листы, создаст по одному ярлыку для каждого листа
                  и сможет сохранять новые точки обратно в тот же файл.
                </p>
              </div>

              <div className="sheet-structure-preview">
                <div className="fake-excel-tabs">
                  <span className="active">КПП №1</span><span>Склад №2</span><span>Офис</span>
                </div>
                <div className="fake-excel-grid">
                  <span className="column-letter">A</span><span className="column-letter">B</span>
                  <strong aria-hidden="true">&nbsp;</strong><strong>КПП №1</strong>
                  <span>Иванов Иван Иванович</span><span>Капитан</span>
                  <span>Петров Пётр Сергеевич</span><span>Инспектор</span>
                </div>
                <p><CheckCircle2 size={14} /> Название листа станет названием точки</p>
              </div>

              {!state.supported && (
                <div className="browser-support-warning">
                  <AlertTriangle size={18} />
                  <p><strong>Откройте сайт в Chrome или Microsoft Edge</strong><span>Другие браузеры не разрешают сайту сохранять изменения в тот же Excel-файл.</span></p>
                </div>
              )}

              <button
                className="primary-button connect-workbook-button"
                type="button"
                onClick={() => void connect()}
                disabled={busy || !state.supported}
              >
                {state.status === 'connecting' ? <RefreshCw className="spin" size={18} /> : <FolderOpen size={18} />}
                {state.status === 'connecting' ? 'Открываем книгу…' : 'Выбрать и привязать Excel'}
              </button>

              <div className="workbook-template-link">
                <p><strong>Нужен пример?</strong><span>Скачайте книгу с несколькими листами и правильной структурой.</span></p>
                <a href="/templates/points-workbook-template.xlsx" download><Download size={15} /> Скачать пример</a>
              </div>
            </>
          )}

          {state.error && (
            <div className="workbook-error" role="alert">
              <AlertTriangle size={17} />
              <p><strong>Не удалось обработать Excel</strong><span>{state.error}</span></p>
              <button type="button" onClick={onClearError}><X size={14} /></button>
            </div>
          )}
        </div>

        <footer className="workbook-footer">
          <p><ShieldCheck size={14} /> Файл обрабатывается только на этом компьютере</p>
          <button className="secondary-button" type="button" onClick={onClose} disabled={busy}>Закрыть</button>
        </footer>
      </section>
    </div>
  );
}
