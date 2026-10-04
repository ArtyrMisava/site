import { useEffect, useMemo, useState } from 'react';
import {
  CarFront,
  Crosshair,
  FileSpreadsheet,
  LockKeyhole,
  LogOut,
  MapPin,
  Menu,
  Plus,
  RefreshCw,
  ShieldCheck,
  WifiOff,
  X,
} from 'lucide-react';
import { AdminModal } from './components/AdminModal';
import { EditorPanel } from './components/EditorPanel';
import { ExcelWorkbookModal } from './components/ExcelWorkbookModal';
import { MapView } from './components/MapView';
import { Sidebar } from './components/Sidebar';
import { SESSION_KEY } from './auth';
import {
  itemSubtitle,
  itemTitle,
  loadItems,
  makeDraft,
  STORAGE_KEY,
} from './data';
import { useExcelWorkbook } from './hooks/useExcelWorkbook';
import type {
  EditorState,
  ItemFilter,
  ItemKind,
  MapItem,
  PersonPoint,
} from './types';

export default function App() {
  const [items, setItems] = useState<MapItem[]>(loadItems);
  const [filter, setFilter] = useState<ItemFilter>('all');
  const [search, setSearch] = useState('');
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [placement, setPlacement] = useState<ItemKind | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [adminName, setAdminName] = useState<string | null>(() =>
    sessionStorage.getItem(SESSION_KEY),
  );
  const [adminModalOpen, setAdminModalOpen] = useState(false);
  const [workbookModalOpen, setWorkbookModalOpen] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [toast, setToast] = useState('');
  const excel = useExcelWorkbook();

  const isAdmin = adminName !== null;
  const pointItems = useMemo(
    () => items.filter((item): item is PersonPoint => item.kind === 'person'),
    [items],
  );

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  }, [items]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(''), 3000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const filteredItems = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('ru-RU');
    return items.filter((item) => {
      if (filter !== 'all' && item.kind !== filter) return false;
      if (!query) return true;
      const personnelText = item.kind === 'person'
        ? item.personnel.map((person) => `${person.fullName} ${person.position}`).join(' ')
        : '';
      const haystack = `${itemTitle(item)} ${itemSubtitle(item)} ${personnelText}`.toLocaleLowerCase('ru-RU');
      return haystack.includes(query);
    });
  }, [filter, items, search]);

  const visibleFocusedItem = useMemo(
    () => filteredItems.find((item) => item.id === focusedId) ?? null,
    [filteredItems, focusedId],
  );

  function startPlacement(kind: ItemKind) {
    if (!isAdmin) {
      setAdminModalOpen(true);
      return;
    }
    if (kind === 'person' && !excel.isConnected) {
      setToast('Сначала привяжите рабочую Excel-книгу');
      setWorkbookModalOpen(true);
      return;
    }
    setEditor(null);
    setFocusedId(null);
    setPlacement((current) => (current === kind ? null : kind));
  }

  function handlePlace(lat: number, lng: number) {
    if (!placement || !isAdmin) return;
    const draft = makeDraft(placement, lat, lng);
    setEditor({ mode: 'create', item: draft });
    setPlacement(null);
  }

  function handleEdit(item: MapItem) {
    if (!isAdmin) return;
    if (item.kind === 'person' && !excel.isConnected) {
      setToast('Чтобы изменить точку, снова привяжите Excel-книгу');
      setWorkbookModalOpen(true);
      return;
    }
    setPlacement(null);
    setFocusedId(item.id);
    setEditor({ mode: 'edit', item: structuredClone(item) });
  }

  async function handleSave(item: MapItem) {
    if (!editor) return;
    const editorSnapshot = editor;
    let savedItem = item;

    if (item.kind === 'person' && excel.isConnected) {
      const previous = editorSnapshot.mode === 'edit' && editorSnapshot.item.kind === 'person'
        ? editorSnapshot.item
        : undefined;
      const pointsForSave = editorSnapshot.mode === 'create'
        ? [...pointItems, item]
        : pointItems.map((point) => point.id === item.id ? item : point);
      try {
        savedItem = await excel.savePoint(item, previous, pointsForSave);
      } catch {
        setToast('Не удалось сохранить точку в Excel');
        return;
      }
    }

    setItems((current) => {
      if (editorSnapshot.mode === 'create') return [...current, savedItem];
      return current.map((existing) => existing.id === savedItem.id ? savedItem : existing);
    });
    setFilter('all');
    setSearch('');
    setFocusedId(savedItem.id);
    setEditor(null);
    setToast(editorSnapshot.mode === 'create'
      ? savedItem.kind === 'person' && excel.isConnected
        ? 'Точка и новый лист Excel созданы'
        : 'Объект добавлен на карту'
      : 'Изменения сохранены');
  }

  function openWorkbook() {
    if (!isAdmin) {
      setAdminModalOpen(true);
      return;
    }
    setPlacement(null);
    setEditor(null);
    setToast('');
    setWorkbookModalOpen(true);
  }

  function handleWorkbookPoints(points: PersonPoint[]) {
    setItems((current) => [
      ...points,
      ...current.filter((item) => item.kind === 'vehicle'),
    ]);
    setFilter('person');
    setSearch('');
    setFocusedId(points.length === 1 ? points[0].id : null);
    setToast(`Excel подключён · загружено точек: ${points.length}`);
  }

  async function handleDelete(id: string) {
    const target = items.find((item) => item.id === id);
    if (!target) return;
    const remainingItems = items.filter((item) => item.id !== id);

    if (target.kind === 'person' && excel.isConnected && target.excelId) {
      try {
        await excel.deletePoint(
          target,
          remainingItems.filter((item): item is PersonPoint => item.kind === 'person'),
        );
      } catch {
        setToast('Не удалось удалить лист из Excel');
        return;
      }
    }

    setItems(remainingItems);
    if (focusedId === id) setFocusedId(null);
    setEditor(null);
    setToast(target.kind === 'person' && target.excelId
      ? 'Точка и лист Excel удалены'
      : 'Объект удалён');
  }

  function handleMove(id: string, lat: number, lng: number) {
    const updatedAt = new Date().toISOString();
    const updatedItems = items.map((item) =>
      item.id === id ? { ...item, lat, lng, updatedAt } : item,
    );
    setItems(updatedItems);
    setEditor((current) => current?.item.id === id
      ? { ...current, item: { ...current.item, lat, lng, updatedAt } }
      : current);

    const movedPoint = updatedItems.find(
      (item): item is PersonPoint => item.id === id && item.kind === 'person',
    );
    if (movedPoint && excel.isConnected) {
      void excel.savePositions(
        updatedItems.filter((item): item is PersonPoint => item.kind === 'person'),
      ).catch(() => setToast('Координаты изменены локально, но Excel не сохранён'));
    }
  }

  function logout() {
    sessionStorage.removeItem(SESSION_KEY);
    excel.disconnect();
    setAdminName(null);
    setPlacement(null);
    setEditor(null);
    setWorkbookModalOpen(false);
    setToast('Режим администратора выключен');
  }

  const excelButtonLabel = excel.state.status === 'saving'
    ? 'Сохраняем Excel…'
    : excel.isConnected
      ? excel.state.fileName
      : excel.state.status === 'error'
        ? 'Ошибка Excel'
        : 'Привязать Excel';

  return (
    <div className="app-shell">
      <Sidebar
        items={filteredItems}
        allItems={items}
        filter={filter}
        search={search}
        focusedId={focusedId}
        mobileOpen={mobileSidebarOpen}
        isAdmin={isAdmin}
        onFilterChange={setFilter}
        onSearchChange={setSearch}
        onFocus={(item) => setFocusedId(item.id)}
        onEdit={handleEdit}
        onMobileClose={() => setMobileSidebarOpen(false)}
      />

      <main className="workspace">
        <header className="topbar">
          <div className="topbar-title-group">
            <button className="icon-button mobile-menu-button" type="button" onClick={() => setMobileSidebarOpen(true)} aria-label="Открыть список объектов">
              <Menu size={21} />
            </button>
            <div>
              <div className="breadcrumb"><span>Главная</span><i /> <strong>Карта объектов</strong></div>
              <h1>Оперативная карта</h1>
            </div>
          </div>

          <div className="topbar-actions">
            <div className="offline-badge" title="Карта не использует интернет"><WifiOff size={15} /><span>Офлайн</span></div>
            {isAdmin ? (
              <div className="admin-session">
                <div className="admin-session-copy"><span><i /> Режим управления</span><strong>{adminName}</strong></div>
                <button className="icon-button logout-button" type="button" onClick={logout} aria-label="Выйти из режима администратора" title="Выйти"><LogOut size={18} /></button>
              </div>
            ) : (
              <button className="admin-login-button" type="button" onClick={() => setAdminModalOpen(true)}><LockKeyhole size={16} /><span>Администратор</span></button>
            )}
          </div>
        </header>

        {isAdmin && (
          <div className="admin-toolbar">
            <div className="admin-toolbar-status">
              <ShieldCheck size={17} /><span>Редактирование включено</span><small>{excel.isConnected ? 'Точки связаны с Excel' : 'Для точек подключите Excel'}</small>
            </div>
            <div className="admin-toolbar-actions">
              <button
                className={`toolbar-add-button import ${excel.isConnected ? 'connected' : ''} ${excel.state.status === 'error' ? 'has-error' : ''}`}
                type="button"
                onClick={openWorkbook}
                title={excelButtonLabel}
              >
                <span className="toolbar-icon">
                  {excel.state.status === 'saving' ? <RefreshCw className="spin" size={16} /> : <FileSpreadsheet size={16} />}
                </span>
                <span className="toolbar-button-label">{excelButtonLabel}</span>
              </button>
              <button className={`toolbar-add-button person ${placement === 'person' ? 'active' : ''}`} type="button" onClick={() => startPlacement('person')}>
                <span className="toolbar-icon"><MapPin size={16} /></span>
                <span className="toolbar-button-label">{placement === 'person' ? 'Отменить точку' : 'Добавить точку'}</span>
                {placement !== 'person' && <Plus size={14} />}
              </button>
              <button className={`toolbar-add-button vehicle ${placement === 'vehicle' ? 'active' : ''}`} type="button" onClick={() => startPlacement('vehicle')}>
                <span className="toolbar-icon"><CarFront size={17} /></span>
                <span className="toolbar-button-label">{placement === 'vehicle' ? 'Отменить машину' : 'Добавить машину'}</span>
                {placement !== 'vehicle' && <Plus size={14} />}
              </button>
            </div>
          </div>
        )}

        <section className="map-stage" aria-label="Карта объектов компании">
          {placement && (
            <div className="placement-banner">
              <span className={`placement-banner-icon ${placement}`}>{placement === 'person' ? <MapPin size={19} /> : <CarFront size={19} />}</span>
              <div><strong>{placement === 'person' ? 'Выберите место для новой точки' : 'Укажите положение машины'}</strong><small>Нажмите в нужном месте на карте</small></div>
              <Crosshair className="placement-crosshair" size={20} />
              <button type="button" onClick={() => setPlacement(null)} aria-label="Отменить размещение"><X size={17} /></button>
            </div>
          )}

          <MapView
            items={filteredItems}
            focusedItem={visibleFocusedItem}
            placement={placement}
            isAdmin={isAdmin}
            excelConnected={excel.isConnected}
            onPlace={handlePlace}
            onEdit={handleEdit}
            onMove={handleMove}
          />

          {editor && (
            <EditorPanel
              editor={editor}
              excelConnected={excel.isConnected}
              saving={excel.state.status === 'saving'}
              onCancel={() => setEditor(null)}
              onSave={handleSave}
              onDelete={(id) => void handleDelete(id)}
            />
          )}
        </section>
      </main>

      <AdminModal
        open={adminModalOpen}
        onClose={() => setAdminModalOpen(false)}
        onAuthenticated={(username) => {
          setAdminName(username);
          setToast('Режим администратора включён');
        }}
      />

      {workbookModalOpen && (
        <ExcelWorkbookModal
          state={excel.state}
          points={pointItems}
          onClose={() => setWorkbookModalOpen(false)}
          onConnect={() => excel.connect(pointItems)}
          onRefresh={() => excel.refresh(pointItems)}
          onPointsLoaded={handleWorkbookPoints}
          onDisconnect={() => {
            excel.disconnect();
            setToast('Excel-файл отключён');
          }}
          onClearError={excel.clearError}
        />
      )}

      {toast && <div className="toast" role="status"><span><i /></span>{toast}</div>}
    </div>
  );
}
