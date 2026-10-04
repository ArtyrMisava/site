import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  CarFront,
  MapPin,
  Navigation,
  Save,
  Trash2,
  UserRound,
  X,
} from 'lucide-react';
import { MAP_HEIGHT } from '../data';
import type { EditorState, MapItem, VehicleStatus } from '../types';

interface EditorPanelProps {
  editor: EditorState;
  onCancel: () => void;
  onSave: (item: MapItem) => void;
  onDelete: (id: string) => void;
}

const vehicleStatuses: Array<{ value: VehicleStatus; label: string }> = [
  { value: 'moving', label: 'В пути' },
  { value: 'parked', label: 'На стоянке' },
  { value: 'service', label: 'Обслуживание' },
];

export function EditorPanel({
  editor,
  onCancel,
  onSave,
  onDelete,
}: EditorPanelProps) {
  const [draft, setDraft] = useState<MapItem>(editor.item);
  const [error, setError] = useState('');

  useEffect(() => {
    setDraft(editor.item);
    setError('');
  }, [editor]);

  const coordinates = useMemo(
    () => `X ${Math.round(draft.lng)} · Y ${Math.round(MAP_HEIGHT - draft.lat)}`,
    [draft.lat, draft.lng],
  );

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');

    if (draft.kind === 'person') {
      if (!draft.firstName.trim() || !draft.lastName.trim() || !draft.pointName.trim()) {
        setError('Заполните имя, фамилию и название точки.');
        return;
      }
    } else if (!draft.name.trim()) {
      setError('Укажите номер или название машины.');
      return;
    }

    onSave({ ...draft, updatedAt: new Date().toISOString() });
  }

  function requestDelete() {
    const title =
      draft.kind === 'person'
        ? `${draft.firstName} ${draft.lastName}`.trim() || 'эту точку'
        : draft.name || 'эту машину';
    if (window.confirm(`Удалить «${title}» с карты?`)) {
      onDelete(draft.id);
    }
  }

  return (
    <aside className="editor-panel" aria-label="Редактор объекта">
      <div className="editor-header">
        <div className={`editor-kind-icon ${draft.kind}`} aria-hidden="true">
          {draft.kind === 'person' ? <UserRound size={20} /> : <CarFront size={21} />}
        </div>
        <div>
          <p className="eyebrow">
            {editor.mode === 'create' ? 'Новый объект' : 'Редактирование'}
          </p>
          <h2>{draft.kind === 'person' ? 'Точка сотрудника' : 'Служебная машина'}</h2>
        </div>
        <button className="icon-button editor-close" type="button" onClick={onCancel} aria-label="Закрыть редактор">
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
            <div className="field-grid two-columns">
              <label>
                <span className="field-label">Имя</span>
                <input
                  value={draft.firstName}
                  onChange={(event) =>
                    setDraft({ ...draft, firstName: event.target.value })
                  }
                  placeholder="Иван"
                  autoFocus
                />
              </label>
              <label>
                <span className="field-label">Фамилия</span>
                <input
                  value={draft.lastName}
                  onChange={(event) =>
                    setDraft({ ...draft, lastName: event.target.value })
                  }
                  placeholder="Петров"
                />
              </label>
            </div>
            <label>
              <span className="field-label">Название точки</span>
              <input
                value={draft.pointName}
                onChange={(event) =>
                  setDraft({ ...draft, pointName: event.target.value })
                }
                placeholder="Например, Главный склад"
              />
            </label>
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
                value={draft.status}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    status: event.target.value as VehicleStatus,
                  })
                }
              >
                {vehicleStatuses.map((status) => (
                  <option key={status.value} value={status.value}>
                    {status.label}
                  </option>
                ))}
              </select>
            </label>

            <div className="heading-control">
              <div className="heading-copy">
                <span className="field-label">Направление движения</span>
                <strong>{Math.round(draft.heading)}°</strong>
              </div>
              <div className="heading-row">
                <div className="compass-preview" aria-hidden="true">
                  <span>С</span>
                  <Navigation
                    size={24}
                    fill="currentColor"
                    style={{ transform: `rotate(${draft.heading}deg)` }}
                  />
                </div>
                <input
                  className="range-input"
                  type="range"
                  min="0"
                  max="359"
                  step="1"
                  value={draft.heading}
                  aria-label="Направление в градусах"
                  onChange={(event) =>
                    setDraft({ ...draft, heading: Number(event.target.value) })
                  }
                />
                <input
                  className="heading-number"
                  type="number"
                  min="0"
                  max="359"
                  value={draft.heading}
                  aria-label="Направление числом"
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    setDraft({
                      ...draft,
                      heading: Number.isFinite(value)
                        ? Math.min(359, Math.max(0, value))
                        : 0,
                    });
                  }}
                />
              </div>
              <div className="cardinal-labels" aria-hidden="true">
                <span>Север 0°</span>
                <span>Восток 90°</span>
                <span>Юг 180°</span>
                <span>Запад 270°</span>
              </div>
            </div>
          </>
        )}

        {error && <p className="form-error">{error}</p>}

        <div className="editor-actions">
          <button className="primary-button" type="submit">
            <Save size={17} />
            {editor.mode === 'create' ? 'Добавить на карту' : 'Сохранить изменения'}
          </button>
          {editor.mode === 'edit' && (
            <button className="danger-button" type="button" onClick={requestDelete}>
              <Trash2 size={17} />
              Удалить
            </button>
          )}
        </div>
      </form>
    </aside>
  );
}
