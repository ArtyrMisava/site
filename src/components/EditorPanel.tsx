import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  CarFront,
  FileSpreadsheet,
  Link2,
  MapPin,
  Navigation,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Route,
  Save,
  Trash2,
  UserRound,
  UsersRound,
  X,
} from 'lucide-react';
import { MAP_HEIGHT } from '../data';
import type {
  EditorState,
  MapItem,
  PersonnelEntry,
  VehiclePoint,
  VehicleStatus,
} from '../types';

interface EditorPanelProps {
  editor: EditorState;
  excelConnected: boolean;
  saving?: boolean;
  vehicleRuntime?: VehiclePoint;
  routeBuilding?: boolean;
  onCancel: () => void;
  onSave: (item: MapItem) => void | Promise<void>;
  onDelete: (id: string) => void;
  onBeginRoute: (id: string, speed: number) => void;
  onToggleVehicleMotion: (id: string, speed: number) => void;
  onClearVehicleRoute: (id: string) => void;
}

const vehicleStatuses: Array<{ value: VehicleStatus; label: string }> = [
  { value: 'moving', label: 'В пути' },
  { value: 'parked', label: 'На стоянке' },
  { value: 'service', label: 'Обслуживание' },
];

function newPersonnelEntry(): PersonnelEntry {
  return {
    id: crypto.randomUUID?.() ?? `person-${Date.now()}`,
    fullName: '',
    position: '',
  };
}

export function EditorPanel({
  editor,
  excelConnected,
  saving = false,
  vehicleRuntime,
  routeBuilding = false,
  onCancel,
  onSave,
  onDelete,
  onBeginRoute,
  onToggleVehicleMotion,
  onClearVehicleRoute,
}: EditorPanelProps) {
  const [draft, setDraft] = useState<MapItem>(editor.item);
  const [error, setError] = useState('');
  const [statusEdited, setStatusEdited] = useState(false);

  useEffect(() => {
    setDraft(editor.item);
    setError('');
    setStatusEdited(false);
  }, [editor]);

  const routeVehicle = draft.kind === 'vehicle' ? (vehicleRuntime ?? draft) : null;
  const currentPosition = routeVehicle ?? draft;
  const coordinates = useMemo(
    () => `X ${Math.round(currentPosition.lng)} · Y ${Math.round(MAP_HEIGHT - currentPosition.lat)}`,
    [currentPosition.lat, currentPosition.lng],
  );
  const hasRoute = Boolean(routeVehicle && routeVehicle.route.length > 1);
  const routeFinished = Boolean(
    routeVehicle && hasRoute && routeVehicle.routeSegment >= routeVehicle.route.length - 1,
  );
  const automaticHeading = Boolean(hasRoute && routeVehicle?.status === 'moving');
  const displayedHeading = automaticHeading && routeVehicle ? routeVehicle.heading : draft.kind === 'vehicle' ? draft.heading : 0;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');

    if (draft.kind === 'person') {
      if (!draft.pointName.trim()) {
        setError('Укажите название точки — оно станет названием листа Excel.');
        return;
      }
      if (draft.personnel.some((person) => !person.fullName.trim() && person.position.trim())) {
        setError('У сотрудника со званием или должностью должно быть заполнено ФИО.');
        return;
      }
      void onSave({
        ...draft,
        pointName: draft.pointName.trim(),
        personnel: draft.personnel
          .filter((person) => person.fullName.trim())
          .map((person) => ({
            ...person,
            fullName: person.fullName.trim(),
            position: person.position.trim(),
          })),
        updatedAt: new Date().toISOString(),
      });
      return;
    }

    if (!draft.name.trim()) {
      setError('Укажите номер или название машины.');
      return;
    }
    const liveRoute = vehicleRuntime?.id === draft.id
      ? {
          lat: vehicleRuntime.lat,
          lng: vehicleRuntime.lng,
          route: vehicleRuntime.route,
          routeSegment: vehicleRuntime.routeSegment,
          routeProgress: vehicleRuntime.routeProgress,
          heading: vehicleRuntime.status === 'moving' ? vehicleRuntime.heading : draft.heading,
          status: statusEdited ? draft.status : vehicleRuntime.status,
        }
      : {};
    void onSave({
      ...draft,
      ...liveRoute,
      name: draft.name.trim(),
      driver: draft.driver.trim(),
      routeSpeed: Math.min(500, Math.max(1, draft.routeSpeed)),
      updatedAt: new Date().toISOString(),
    });
  }

  function requestDelete() {
    const title = draft.kind === 'person' ? draft.pointName || 'эту точку' : draft.name || 'эту машину';
    const excelWarning = draft.kind === 'person' && draft.sheetName
      ? '\nСвязанный лист Excel также будет удалён.'
      : '';
    if (window.confirm(`Удалить «${title}» с карты?${excelWarning}`)) {
      onDelete(draft.id);
    }
  }

  function updatePerson(id: string, field: 'fullName' | 'position', value: string) {
    setDraft((current) => current.kind === 'person'
      ? {
          ...current,
          personnel: current.personnel.map((person) =>
            person.id === id ? { ...person, [field]: value } : person,
          ),
        }
      : current);
  }

  function removePerson(id: string) {
    setDraft((current) => current.kind === 'person'
      ? { ...current, personnel: current.personnel.filter((person) => person.id !== id) }
      : current);
  }

  function addPerson() {
    setDraft((current) => current.kind === 'person'
      ? { ...current, personnel: [...current.personnel, newPersonnelEntry()] }
      : current);
  }

  function beginRoute() {
    if (draft.kind !== 'vehicle') return;
    setStatusEdited(false);
    onBeginRoute(draft.id, Math.min(500, Math.max(1, draft.routeSpeed)));
  }

  function toggleVehicleMotion() {
    if (draft.kind !== 'vehicle') return;
    setStatusEdited(false);
    onToggleVehicleMotion(draft.id, Math.min(500, Math.max(1, draft.routeSpeed)));
  }

  function clearVehicleRoute() {
    if (draft.kind !== 'vehicle') return;
    if (window.confirm('Удалить сохранённый маршрут этой машины?')) {
      setStatusEdited(false);
      onClearVehicleRoute(draft.id);
    }
  }

  return (
    <aside className="editor-panel" aria-label="Редактор объекта">
      <div className="editor-header">
        <div className={`editor-kind-icon ${draft.kind}`} aria-hidden="true">
          {draft.kind === 'person' ? <MapPin size={20} /> : <CarFront size={21} />}
        </div>
        <div>
          <p className="eyebrow">
            {editor.mode === 'create' ? 'Новый объект' : 'Редактирование'}
          </p>
          <h2>{draft.kind === 'person' ? 'Точка и сотрудники' : 'Служебная машина'}</h2>
        </div>
        <button className="icon-button editor-close" type="button" onClick={onCancel} aria-label="Закрыть редактор" disabled={saving}>
          <X size={19} />
        </button>
      </div>

      <div className="editor-position">
        <MapPin size={16} />
        <span>{coordinates}</span>
        <small>Положение можно менять перетаскиванием</small>
      </div>

      <form className="editor-form" onSubmit={submit}>
        {draft.kind === 'person' ? (
          <>
            <label>
              <span className="field-label">Название точки / листа Excel</span>
              <input
                value={draft.pointName}
                onChange={(event) => setDraft({ ...draft, pointName: event.target.value })}
                placeholder="Например, КПП № 1"
                autoFocus
              />
            </label>

            {excelConnected && (
              <div className={`excel-editor-link ${draft.sheetName ? 'linked' : 'new'}`}>
                <FileSpreadsheet size={17} />
                <p>
                  <strong>{draft.sheetName ? `Лист «${draft.sheetName}»` : 'Будет создан новый лист'}</strong>
                  <span>{draft.sheetName ? 'Изменения сохранятся в связанную книгу' : 'Лист появится в Excel после сохранения точки'}</span>
                </p>
                <Link2 size={14} />
              </div>
            )}

            <section className="personnel-editor">
              <div className="personnel-editor-heading">
                <div><UsersRound size={17} /><p><strong>Сотрудники точки</strong><span>Столбцы A и B связанного листа</span></p></div>
                <small>{draft.personnel.length}</small>
              </div>

              {draft.personnel.length === 0 ? (
                <div className="empty-personnel">
                  <UserRound size={21} />
                  <p><strong>Список пока пуст</strong><span>Можно добавить сотрудника сейчас или заполнить лист в Excel.</span></p>
                </div>
              ) : (
                <div className="personnel-rows">
                  {draft.personnel.map((person, index) => (
                    <div className="personnel-row" key={person.id}>
                      <span className="personnel-index">{index + 1}</span>
                      <div className="personnel-inputs">
                        <input
                          value={person.fullName}
                          onChange={(event) => updatePerson(person.id, 'fullName', event.target.value)}
                          placeholder="Фамилия Имя Отчество"
                          aria-label={`ФИО сотрудника ${index + 1}`}
                        />
                        <input
                          value={person.position}
                          onChange={(event) => updatePerson(person.id, 'position', event.target.value)}
                          placeholder="Звание или должность"
                          aria-label={`Должность сотрудника ${index + 1}`}
                        />
                      </div>
                      <button type="button" onClick={() => removePerson(person.id)} aria-label={`Удалить сотрудника ${index + 1}`}>
                        <X size={15} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <button className="add-person-button" type="button" onClick={addPerson}>
                <Plus size={15} /> Добавить сотрудника
              </button>
            </section>
          </>
        ) : (
          <>
            <label>
              <span className="field-label">Номер или название машины</span>
              <input
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                placeholder="Например, АМ-17"
                autoFocus
              />
            </label>
            <label>
              <span className="field-label">Водитель</span>
              <input
                value={draft.driver}
                onChange={(event) => setDraft({ ...draft, driver: event.target.value })}
                placeholder="Имя и фамилия (необязательно)"
              />
            </label>
            <label>
              <span className="field-label">Статус</span>
              <select
                value={statusEdited ? draft.status : (vehicleRuntime?.status ?? draft.status)}
                onChange={(event) => {
                  setStatusEdited(true);
                  setDraft({ ...draft, status: event.target.value as VehicleStatus });
                }}
              >
                {vehicleStatuses.map((status) => (
                  <option key={status.value} value={status.value}>{status.label}</option>
                ))}
              </select>
            </label>

            <div className="heading-control">
              <div className="heading-copy">
                <span className="field-label">Направление движения</span>
                <strong>{Math.round(displayedHeading)}°{automaticHeading ? ' · авто' : ''}</strong>
              </div>
              <div className="heading-row">
                <div className="compass-preview" aria-hidden="true">
                  <span>С</span>
                  <Navigation size={24} fill="currentColor" style={{ transform: `rotate(${displayedHeading}deg)` }} />
                </div>
                <input
                  className="range-input"
                  type="range"
                  min="0"
                  max="359"
                  step="1"
                  value={displayedHeading}
                  aria-label="Направление в градусах"
                  disabled={automaticHeading}
                  onChange={(event) => setDraft({ ...draft, heading: Number(event.target.value) })}
                />
                <input
                  className="heading-number"
                  type="number"
                  min="0"
                  max="359"
                  value={displayedHeading}
                  aria-label="Направление числом"
                  disabled={automaticHeading}
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    setDraft({ ...draft, heading: Number.isFinite(value) ? Math.min(359, Math.max(0, value)) : 0 });
                  }}
                />
              </div>
              <div className="cardinal-labels" aria-hidden="true">
                <span>Север 0°</span><span>Восток 90°</span><span>Юг 180°</span><span>Запад 270°</span>
              </div>
            </div>

            <label className="vehicle-speed-field">
              <span className="field-label">Скорость движения</span>
              <span className="speed-input-wrap">
                <input
                  type="number"
                  min="1"
                  max="500"
                  step="1"
                  value={draft.routeSpeed}
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    setDraft({
                      ...draft,
                      routeSpeed: Number.isFinite(value) ? Math.min(500, Math.max(1, value)) : 1,
                    });
                  }}
                />
                <span>км/ч</span>
              </span>
              <small>Анимация ускорена: 1 секунда соответствует 1 минуте пути</small>
            </label>

            <section className={`vehicle-route-card ${hasRoute ? 'has-route' : ''} ${routeBuilding ? 'is-building' : ''}`}>
              <div className="vehicle-route-heading">
                <span><Route size={18} /></span>
                <div>
                  <strong>Маршрут машины</strong>
                  <small>
                    {routeBuilding
                      ? 'Отмечайте следующие точки на карте'
                      : hasRoute && routeVehicle
                        ? `${routeVehicle.route.length} точек · ${routeVehicle.status === 'moving' ? 'машина движется' : routeFinished ? 'маршрут завершён' : 'движение приостановлено'}`
                        : 'Путь ещё не задан'}
                  </small>
                </div>
              </div>

              {editor.mode === 'edit' ? (
                <div className="vehicle-route-actions">
                  <button
                    className="route-build-button"
                    type="button"
                    onClick={beginRoute}
                    disabled={routeBuilding}
                  >
                    <Route size={16} />
                    {routeBuilding ? 'Маршрут строится…' : hasRoute ? 'Изменить маршрут' : 'Задать маршрут'}
                  </button>
                  {hasRoute && routeVehicle && !routeBuilding && (
                    <>
                      <button className="route-motion-button" type="button" onClick={toggleVehicleMotion}>
                        {routeVehicle.status === 'moving'
                          ? <><Pause size={16} /> Приостановить</>
                          : routeFinished
                            ? <><RotateCcw size={16} /> Повторить маршрут</>
                            : <><Play size={16} /> Продолжить движение</>}
                      </button>
                      <button className="route-clear-button" type="button" onClick={clearVehicleRoute}>
                        <Trash2 size={15} /> Удалить маршрут
                      </button>
                    </>
                  )}
                </div>
              ) : (
                <p className="route-save-hint">Сначала добавьте машину на карту, затем откройте её редактор и задайте маршрут.</p>
              )}
            </section>
          </>
        )}

        {error && <p className="form-error">{error}</p>}

        <div className="editor-actions">
          <button className="primary-button" type="submit" disabled={saving}>
            <Save size={17} />
            {saving ? 'Сохраняем…' : editor.mode === 'create' ? 'Добавить на карту' : 'Сохранить изменения'}
          </button>
          {editor.mode === 'edit' && (
            <button className="danger-button" type="button" onClick={requestDelete} disabled={saving}>
              <Trash2 size={17} /> Удалить
            </button>
          )}
        </div>
      </form>
    </aside>
  );
}
