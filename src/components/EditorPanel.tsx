import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  CarFront,
  FileSpreadsheet,
  Link2,
  MapPin,
  Navigation,
  Plus,
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
  VehicleStatus,
} from '../types';

interface EditorPanelProps {
  editor: EditorState;
  excelConnected: boolean;
  saving?: boolean;
  onCancel: () => void;
  onSave: (item: MapItem) => void | Promise<void>;
  onDelete: (id: string) => void;
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
    void onSave({ ...draft, updatedAt: new Date().toISOString() });
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
                value={draft.status}
                onChange={(event) => setDraft({ ...draft, status: event.target.value as VehicleStatus })}
              >
                {vehicleStatuses.map((status) => (
                  <option key={status.value} value={status.value}>{status.label}</option>
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
                  <Navigation size={24} fill="currentColor" style={{ transform: `rotate(${draft.heading}deg)` }} />
                </div>
                <input
                  className="range-input"
                  type="range"
                  min="0"
                  max="359"
                  step="1"
                  value={draft.heading}
                  aria-label="Направление в градусах"
                  onChange={(event) => setDraft({ ...draft, heading: Number(event.target.value) })}
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
                    setDraft({ ...draft, heading: Number.isFinite(value) ? Math.min(359, Math.max(0, value)) : 0 });
                  }}
                />
              </div>
              <div className="cardinal-labels" aria-hidden="true">
                <span>Север 0°</span><span>Восток 90°</span><span>Юг 180°</span><span>Запад 270°</span>
              </div>
            </div>
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
