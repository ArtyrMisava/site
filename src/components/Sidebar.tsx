import {
  CarFront,
  ChevronRight,
  LocateFixed,
  MapPin,
  Pencil,
  Search,
  X,
} from 'lucide-react';
import { itemSubtitle, itemTitle } from '../data';
import { placeIconSource } from '../placeIcons';
import type { ItemFilter, MapItem } from '../types';

interface SidebarProps {
  items: MapItem[];
  allItems: MapItem[];
  filter: ItemFilter;
  search: string;
  focusedId: string | null;
  mobileOpen: boolean;
  isAdmin: boolean;
  onFilterChange: (filter: ItemFilter) => void;
  onSearchChange: (value: string) => void;
  onFocus: (item: MapItem) => void;
  onEdit: (item: MapItem) => void;
  onMobileClose: () => void;
}

const filters: Array<{ value: ItemFilter; label: string }> = [
  { value: 'all', label: 'Все' },
  { value: 'person', label: 'Точки' },
  { value: 'vehicle', label: 'Машины' },
];

function vehicleStatus(status: string): string {
  if (status === 'moving') return 'В пути';
  if (status === 'service') return 'Обслуживание';
  return 'На стоянке';
}

export function Sidebar({
  items,
  allItems,
  filter,
  search,
  focusedId,
  mobileOpen,
  isAdmin,
  onFilterChange,
  onSearchChange,
  onFocus,
  onEdit,
  onMobileClose,
}: SidebarProps) {
  const pointCount = allItems.filter((item) => item.kind === 'person').length;
  const vehicleCount = allItems.filter((item) => item.kind === 'vehicle').length;
  const movingCount = allItems.filter(
    (item) => item.kind === 'vehicle' && item.status === 'moving',
  ).length;

  return (
    <>
      {mobileOpen && (
        <button
          className="sidebar-scrim"
          type="button"
          aria-label="Закрыть список"
          onClick={onMobileClose}
        />
      )}
      <aside className={`sidebar ${mobileOpen ? 'mobile-open' : ''}`}>
        <div className="brand-row">
          <div className="brand-mark" aria-hidden="true">
            <span />
            <span />
          </div>
          <div className="brand-copy">
            <strong>ДУС</strong>
            <small>внутренняя карта</small>
          </div>
          <button
            className="icon-button mobile-sidebar-close"
            type="button"
            onClick={onMobileClose}
            aria-label="Закрыть"
          >
            <X size={19} />
          </button>
        </div>

        <div className="sidebar-heading">
          <p className="eyebrow">Оперативная сводка</p>
          <h2>Объекты на карте</h2>
        </div>

        <div className="summary-cards">
          <div className="summary-card">
            <span className="summary-icon points"><MapPin size={16} /></span>
            <div><strong>{pointCount}</strong><small>точек</small></div>
          </div>
          <div className="summary-card">
            <span className="summary-icon vehicles"><CarFront size={17} /></span>
            <div><strong>{vehicleCount}</strong><small>машин</small></div>
          </div>
          <div className="summary-card wide">
            <span className="pulse-dot" />
            <span><strong>{movingCount}</strong> сейчас в пути</span>
          </div>
        </div>

        <div className="search-box">
          <Search size={17} aria-hidden="true" />
          <input
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Найти сотрудника или машину"
            aria-label="Поиск объектов"
          />
          {search && (
            <button type="button" onClick={() => onSearchChange('')} aria-label="Очистить поиск">
              <X size={15} />
            </button>
          )}
        </div>

        <div className="filter-tabs" role="tablist" aria-label="Фильтр объектов">
          {filters.map((option) => (
            <button
              key={option.value}
              className={filter === option.value ? 'active' : ''}
              type="button"
              role="tab"
              aria-selected={filter === option.value}
              onClick={() => onFilterChange(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>

        <div className="object-list-heading">
          <span>Список</span>
          <small>{items.length}</small>
        </div>

        <div className="object-list">
          {items.length === 0 ? (
            <div className="empty-list">
              <LocateFixed size={24} />
              <strong>Ничего не найдено</strong>
              <span>Измените запрос или фильтр</span>
            </div>
          ) : (
            items.map((item) => (
              <div
                key={item.id}
                className={`object-list-item ${focusedId === item.id ? 'focused' : ''}`}
              >
                <button
                  className="object-list-main"
                  type="button"
                  onClick={() => {
                    onFocus(item);
                    onMobileClose();
                  }}
                >
                  <span className={`list-item-icon ${item.kind}`}>
                    {item.kind === 'person'
                      ? <img src={placeIconSource(item.placeIcon)} alt="" />
                      : <CarFront size={19} />}
                  </span>
                  <span className="list-item-copy">
                    <strong>{itemTitle(item)}</strong>
                    <small>{itemSubtitle(item)}</small>
                    {item.kind === 'vehicle' && (
                      <span className={`vehicle-state ${item.status}`}>
                        {vehicleStatus(item.status)}
                      </span>
                    )}
                  </span>
                  {!isAdmin && <ChevronRight className="list-chevron" size={17} />}
                </button>
                {isAdmin && (
                  <button
                    className="list-edit-button"
                    type="button"
                    onClick={() => onEdit(item)}
                    aria-label={`Редактировать ${itemTitle(item)}`}
                  >
                    <Pencil size={15} />
                  </button>
                )}
              </div>
            ))
          )}
        </div>

        <footer className="sidebar-footer">
          <span className="offline-indicator"><i /> Локальное хранение</span>
          <small>Изменения сохраняются автоматически</small>
        </footer>
      </aside>
    </>
  );
}
