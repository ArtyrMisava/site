import { useEffect, useState, type FormEvent } from 'react';
import {
  Eye,
  EyeOff,
  KeyRound,
  ShieldCheck,
  UserRound,
  X,
} from 'lucide-react';
import {
  createAdminAccount,
  hasAdminAccount,
  SESSION_KEY,
  verifyAdmin,
} from '../auth';

interface AdminModalProps {
  open: boolean;
  onClose: () => void;
  onAuthenticated: (username: string) => void;
}

export function AdminModal({
  open,
  onClose,
  onAuthenticated,
}: AdminModalProps) {
  const [setupMode, setSetupMode] = useState(false);
  const [username, setUsername] = useState('');
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [showPin, setShowPin] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSetupMode(!hasAdminAccount());
    setUsername('');
    setPin('');
    setConfirmPin('');
    setShowPin(false);
    setError('');
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !submitting) onClose();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [open, onClose, submitting]);

  if (!open) return null;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');

    const cleanUsername = username.trim();
    if (!cleanUsername) {
      setError('Введите имя пользователя.');
      return;
    }
    if (pin.length < 4) {
      setError('PIN должен содержать не менее 4 символов.');
      return;
    }
    if (setupMode && pin !== confirmPin) {
      setError('PIN-коды не совпадают.');
      return;
    }

    setSubmitting(true);
    try {
      if (setupMode) {
        await createAdminAccount(cleanUsername, pin);
      } else {
        const isValid = await verifyAdmin(cleanUsername, pin);
        if (!isValid) {
          setError('Неверное имя пользователя или PIN.');
          return;
        }
      }

      sessionStorage.setItem(SESSION_KEY, cleanUsername);
      onAuthenticated(cleanUsername);
      onClose();
    } catch {
      setError('Не удалось сохранить данные доступа. Попробуйте ещё раз.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !submitting) onClose();
      }}
    >
      <section
        className="admin-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="admin-modal-title"
      >
        <button
          className="icon-button modal-close"
          type="button"
          onClick={onClose}
          aria-label="Закрыть"
          disabled={submitting}
        >
          <X size={19} />
        </button>

        <div className="modal-emblem" aria-hidden="true">
          <ShieldCheck size={27} strokeWidth={1.8} />
        </div>
        <p className="eyebrow">Защищённый режим</p>
        <h2 id="admin-modal-title">
          {setupMode ? 'Создайте доступ администратора' : 'Вход администратора'}
        </h2>
        <p className="modal-intro">
          {setupMode
            ? 'Это первый запуск. Придумайте имя и PIN для управления объектами карты.'
            : 'После входа можно добавлять, перемещать и удалять точки и машины.'}
        </p>

        <form onSubmit={handleSubmit} className="admin-form">
          <label className="field-label" htmlFor="admin-username">
            Имя пользователя
          </label>
          <div className="input-with-icon">
            <UserRound size={17} aria-hidden="true" />
            <input
              id="admin-username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="Например, admin"
              autoComplete="username"
              autoFocus
            />
          </div>

          <label className="field-label" htmlFor="admin-pin">
            PIN-код
          </label>
          <div className="input-with-icon">
            <KeyRound size={17} aria-hidden="true" />
            <input
              id="admin-pin"
              type={showPin ? 'text' : 'password'}
              value={pin}
              onChange={(event) => setPin(event.target.value)}
              placeholder="Не менее 4 символов"
              autoComplete={setupMode ? 'new-password' : 'current-password'}
            />
            <button
              type="button"
              className="input-action"
              onClick={() => setShowPin((current) => !current)}
              aria-label={showPin ? 'Скрыть PIN' : 'Показать PIN'}
            >
              {showPin ? <EyeOff size={17} /> : <Eye size={17} />}
            </button>
          </div>

          {setupMode && (
            <>
              <label className="field-label" htmlFor="admin-pin-confirm">
                Повторите PIN
              </label>
              <div className="input-with-icon">
                <KeyRound size={17} aria-hidden="true" />
                <input
                  id="admin-pin-confirm"
                  type={showPin ? 'text' : 'password'}
                  value={confirmPin}
                  onChange={(event) => setConfirmPin(event.target.value)}
                  placeholder="Введите PIN ещё раз"
                  autoComplete="new-password"
                />
              </div>
            </>
          )}

          {error && <p className="form-error">{error}</p>}

          <button className="primary-button modal-submit" type="submit" disabled={submitting}>
            {submitting
              ? 'Проверяем…'
              : setupMode
                ? 'Создать доступ'
                : 'Войти в режим управления'}
          </button>
        </form>

        <p className="security-note">
          Данные доступа и карта хранятся только в этом браузере.
        </p>
      </section>
    </div>
  );
}
