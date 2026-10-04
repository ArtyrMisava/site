import { useEffect, useMemo, useState } from 'react';
import {
  CarFront,
  Crosshair,
  LockKeyhole,
  LogOut,
  MapPin,
  Menu,
  Plus,
  ShieldCheck,
  WifiOff,
  X,
} from 'lucide-react';
import { AdminModal } from './components/AdminModal';
import { EditorPanel } from './components/EditorPanel';
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
import type { EditorState, ItemFilter, ItemKind, MapItem } from './types';

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
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [toast, setToast] = useState('');

  const isAdmin = adminName !== null;

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  }, [items]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(''), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const filteredItems = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('ru-RU');
    return items.filter((item) => {
      if (filter !== 'all' && item.kind !== filter) return false;
      if (!query) return true;
      const haystack = `${itemTitle(item)} ${itemSubtitle(item)}`.toLocaleLowerCase(
        'ru-RU',
      );
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
    setPlacement(null);
    setFocusedId(item.id);
    setEditor({ mode: 'edit', item: { ...item } });
  }

  function handleSave(item: MapItem) {
    if (!editor) return;
    setItems((current) => {
      if (editor.mode === 'create') return [...current, item];
      return current.map((existing) => (existing.id === item.id ? item : existing));
    });
    setFilter('all');
    setSearch('');
    setFocusedId(item.id);
    setEditor(null);
    setToast(editor.mode === 'create' ? 'Объект добавлен на карту' : 'Изменения сохранены');
  }

  function handleDelete(id: string) {
    setItems((current) => current.filter((item) => item.id !== id));
    if (focusedId === id) setFocusedId(null);
    setEditor(null);
    setToast('Объект удалён');
  }

  function handleMove(id: string, lat: number, lng: number) {
    const updatedAt = new Date().toISOString();
    setItems((current) =>
      current.map((item) =>
        item.id === id ? { ...item, lat, lng, updatedAt } : item,
      ),
    );
    setEditor((current) =>
      current?.item.id === id
        ? {
            ...current,
            item: { ...current.item, lat, lng, updatedAt },
          }
        : current,
    );
  }

  function logout() {
    sessionStorage.removeItem(SESSION_KEY);
    setAdminName(null);
    setPlacement(null);
    setEditor(null);
    setToast('Режим администратора выключен');
  }

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
            <button
              className="icon-button mobile-menu-button"
              type="button"
              onClick={() => setMobileSidebarOpen(true)}
              aria-label="Открыть список объектов"
            >
              <Menu size={21} />
            </button>
            <div>
              <div className="breadcrumb">
                <span>Главная</span><i /> <strong>Карта объектов</strong>
              </div>
              <h1>Оперативная карта</h1>
            </div>
          </div>

          <div className="topbar-actions">
            <div className="offline-badge" title="Карта не использует интернет">
              <WifiOff size={15} />
              <span>Офлайн</span>
            </div>

            {isAdmin ? (
              <div className="admin-session">
                <div className="admin-session-copy">
                  <span><i /> Режим управления</span>
                  <strong>{adminName}</strong>
                </div>
                <button className="icon-button logout-button" type="button" onClick={logout} aria-label="Выйти из режима администратора" title="Выйти">
                  <LogOut size={18} />
                </button>
              </div>
            ) : (
              <button className="admin-login-button" type="button" onClick={() => setAdminModalOpen(true)}>
                <LockKeyhole size={16} />
                <span>Администратор</span>
              </button>
            )}
          </div>
        </header>

        {isAdmin && (
          <div className="admin-toolbar">
            <div className="admin-toolbar-status">
              <ShieldCheck size={17} />
              <span>Редактирование включено</span>
              <small>Метки можно перетаскивать</small>
            </div>
            <div className="admin-toolbar-actions">
              <button
                className={`toolbar-add-button person ${placement === 'person' ? 'active' : ''}`}
                type="button"
                onClick={() => startPlacement('person')}
              >
                <span><MapPin size={16} /></span>
                {placement === 'person' ? 'Отменить точку' : 'Добавить точку'}
                {placement !== 'person' && <Plus size={14} />}
              </button>
              <button
                className={`toolbar-add-button vehicle ${placement === 'vehicle' ? 'active' : ''}`}
                type="button"
                onClick={() => startPlacement('vehicle')}
              >
                <span><CarFront size={17} /></span>
                {placement === 'vehicle' ? 'Отменить машину' : 'Добавить машину'}
                {placement !== 'vehicle' && <Plus size={14} />}
              </button>
            </div>
          </div>
        )}

        <section className="map-stage" aria-label="Карта объектов компании">
          {placement && (
            <div className="placement-banner">
              <span className={`placement-banner-icon ${placement}`}>
                {placement === 'person' ? <MapPin size={19} /> : <CarFront size={19} />}
              </span>
              <div>
                <strong>
                  {placement === 'person'
                    ? 'Выберите место для новой точки'
                    : 'Укажите положение машины'}
                </strong>
                <small>Нажмите в нужном месте на карте</small>
              </div>
              <Crosshair className="placement-crosshair" size={20} />
              <button type="button" onClick={() => setPlacement(null)} aria-label="Отменить размещение">
                <X size={17} />
              </button>
            </div>
          )}

          <MapView
            items={filteredItems}
            focusedItem={visibleFocusedItem}
            placement={placement}
            isAdmin={isAdmin}
            onPlace={handlePlace}
            onEdit={handleEdit}
            onMove={handleMove}
          />

          {editor && (
            <EditorPanel
              editor={editor}
              onCancel={() => setEditor(null)}
              onSave={handleSave}
              onDelete={handleDelete}
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

      {toast && (
        <div className="toast" role="status">
          <span><i /></span>
          {toast}
        </div>
      )}
    </div>
  );
}
