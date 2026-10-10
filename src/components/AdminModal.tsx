import { useEffect, useState, type FormEvent } from 'react';
import {
  ArrowLeft,
  Check,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  LifeBuoy,
  ShieldCheck,
  UserRound,
  X,
} from 'lucide-react';
import {
  createAdminAccount,
  ensureAccountRecovery,
  hasAdminAccount,
  hasRecoveryCode,
  recoverAdminAccount,
  SESSION_KEY,
  verifyAdmin,
} from '../auth';
import { isFolderStorageAvailable } from '../siteStorage';

type AdminFormMode = 'setup' | 'login' | 'recover';

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
  const [mode, setMode] = useState<AdminFormMode>('login');
  const [username, setUsername] = useState('');
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [newRecoveryCode, setNewRecoveryCode] = useState('');
  const [showPin, setShowPin] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [recoveryAvailable, setRecoveryAvailable] = useState(false);

  useEffect(() => {
    if (!open) return;
    setMode(hasAdminAccount() ? 'login' : 'setup');
    setRecoveryAvailable(hasRecoveryCode());
    setUsername('');
    setPin('');
    setConfirmPin('');
    setRecoveryCode('');
    setNewRecoveryCode('');
    setShowPin(false);
    setCopied(false);
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

  function completeAuthentication(name: string) {
    sessionStorage.setItem(SESSION_KEY, name);
    onAuthenticated(name);
    onClose();
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');

    const cleanUsername = username.trim();
    if (!cleanUsername) {
      setError('Введите имя пользователя.');
      return;
    }
    if (mode === 'recover' && recoveryCode.replace(/[^A-Z0-9]/gi, '').length < 12) {
      setError('Введите полный код восстановления.');
      return;
    }
    if (pin.length < 4) {
      setError('PIN должен содержать не менее 4 символов.');
      return;
    }
    if (mode !== 'login' && pin !== confirmPin) {
      setError('PIN-коды не совпадают.');
      return;
    }

    setSubmitting(true);
    try {
      if (mode === 'setup') {
        const code = await createAdminAccount(cleanUsername, pin);
        setNewRecoveryCode(code);
        setRecoveryAvailable(true);
        return;
      }

      if (mode === 'recover') {
        const recovered = await recoverAdminAccount(cleanUsername, recoveryCode, pin);
        if (!recovered) {
          setError('Неверное имя пользователя или код восстановления.');
          return;
        }
        completeAuthentication(cleanUsername);
        return;
      }

      const isValid = await verifyAdmin(cleanUsername, pin);
      if (!isValid) {
        setError('Неверное имя пользователя или PIN.');
        return;
      }
      const generatedRecoveryCode = await ensureAccountRecovery(pin);
      if (generatedRecoveryCode) {
        setNewRecoveryCode(generatedRecoveryCode);
        setRecoveryAvailable(true);
        return;
      }
      completeAuthentication(cleanUsername);
    } catch {
      setError('Не удалось сохранить данные доступа. Попробуйте ещё раз.');
    } finally {
      setSubmitting(false);
    }
  }

  async function copyRecoveryCode() {
    try {
      await navigator.clipboard.writeText(newRecoveryCode);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  const folderStorage = isFolderStorageAvailable();
  const setupMode = mode === 'setup';
  const recoverMode = mode === 'recover';

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
          {recoverMode ? <LifeBuoy size={26} strokeWidth={1.8} /> : <ShieldCheck size={27} strokeWidth={1.8} />}
        </div>

        {newRecoveryCode ? (
          <>
            <p className="eyebrow">Аварийный доступ</p>
            <h2 id="admin-modal-title">Сохраните код восстановления</h2>
            <p className="modal-intro">
              Код показывается только сейчас. Он позволит задать новый PIN без удаления точек, машин и маршрутов.
            </p>
            <div className="recovery-code-box">
              <code>{newRecoveryCode}</code>
              <button type="button" onClick={() => void copyRecoveryCode()}>
                {copied ? <Check size={16} /> : <Copy size={16} />}
                {copied ? 'Скопировано' : 'Копировать'}
              </button>
            </div>
            <div className="recovery-warning">
              Храните код отдельно от компьютера. В папке сайта сохраняется только его защищённый хеш.
            </div>
            <button
              className="primary-button modal-submit"
              type="button"
              onClick={() => completeAuthentication(username.trim())}
            >
              Я сохранил код · продолжить
            </button>
          </>
        ) : (
          <>
            {recoverMode && (
              <button
                className="admin-mode-back"
                type="button"
                onClick={() => {
                  setMode('login');
                  setPin('');
                  setConfirmPin('');
                  setRecoveryCode('');
                  setError('');
                }}
              >
                <ArrowLeft size={14} /> Вернуться ко входу
              </button>
            )}
            <p className="eyebrow">{recoverMode ? 'Восстановление доступа' : 'Защищённый режим'}</p>
            <h2 id="admin-modal-title">
              {setupMode
                ? 'Создайте доступ администратора'
                : recoverMode
                  ? 'Задайте новый PIN'
                  : 'Вход администратора'}
            </h2>
            <p className="modal-intro">
              {setupMode
                ? 'Это первый запуск. Придумайте имя и PIN для управления объектами карты.'
                : recoverMode
                  ? 'Введите сохранённый код восстановления. Все данные карты останутся на месте.'
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

              {recoverMode && (
                <>
                  <label className="field-label" htmlFor="admin-recovery-code">
                    Код восстановления
                  </label>
                  <div className="input-with-icon recovery-code-input">
                    <LifeBuoy size={17} aria-hidden="true" />
                    <input
                      id="admin-recovery-code"
                      value={recoveryCode}
                      onChange={(event) => setRecoveryCode(event.target.value.toUpperCase())}
                      placeholder="XXXX-XXXX-XXXX-XXXX"
                      autoComplete="off"
                      spellCheck={false}
                    />
                  </div>
                </>
              )}

              <label className="field-label" htmlFor="admin-pin">
                {recoverMode ? 'Новый PIN-код' : 'PIN-код'}
              </label>
              <div className="input-with-icon">
                <KeyRound size={17} aria-hidden="true" />
                <input
                  id="admin-pin"
                  type={showPin ? 'text' : 'password'}
                  value={pin}
                  onChange={(event) => setPin(event.target.value)}
                  placeholder="Не менее 4 символов"
                  autoComplete={setupMode || recoverMode ? 'new-password' : 'current-password'}
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

              {(setupMode || recoverMode) && (
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
                    : recoverMode
                      ? 'Восстановить доступ'
                      : 'Войти в режим управления'}
              </button>
            </form>

            {mode === 'login' && recoveryAvailable && (
              <button
                className="forgot-pin-button"
                type="button"
                onClick={() => {
                  setMode('recover');
                  setPin('');
                  setError('');
                }}
              >
                <LifeBuoy size={14} /> Забыли PIN? Восстановить
              </button>
            )}
            {mode === 'login' && !recoveryAvailable && (
              <p className="legacy-recovery-note">
                Для старой учётной записи без кода используйте <strong>RESET_ADMIN_PASSWORD.bat</strong>.
              </p>
            )}
          </>
        )}

        <p className="security-note">
          {folderStorage
            ? 'Хеш PIN и данные карты сохраняются в папке site-data рядом с сайтом.'
            : 'Запустите сайт через DUS Server, чтобы сохранять данные в папке site-data.'}
        </p>
      </section>
    </div>
  );
}
