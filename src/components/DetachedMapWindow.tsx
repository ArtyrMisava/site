import { useEffect, useMemo, useRef, useState } from 'react';
import { CarFront, ExternalLink, MapPin, Monitor, X } from 'lucide-react';
import { SESSION_KEY } from '../auth';
import { loadItems, STORAGE_KEY } from '../data';
import {
  isMapWindowMessage,
  MAP_WINDOW_CHANNEL,
  type DetachedMapState,
  type MapWindowMessage,
} from '../mapWindowSync';
import type { MapItem } from '../types';
import { MapView } from './MapView';

function initialMapState(): DetachedMapState {
  return {
    items: loadItems(),
    focusedId: null,
    placement: null,
    routeDraft: null,
    routeVehicleId: null,
    isAdmin: sessionStorage.getItem(SESSION_KEY) !== null,
    excelConnected: false,
  };
}

export function DetachedMapWindow() {
  const [mapState, setMapState] = useState<DetachedMapState>(initialMapState);
  const [connected, setConnected] = useState(false);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const lastControllerContact = useRef(0);

  function sendMessage(message: MapWindowMessage) {
    if (channelRef.current) {
      channelRef.current.postMessage(message);
      return;
    }
    if (window.opener && !window.opener.closed) {
      window.opener.postMessage(message, window.location.origin);
    }
  }

  useEffect(() => {
    document.title = 'ДУС — интерактивная карта';

    const receiveMessage = (message: unknown) => {
      if (!isMapWindowMessage(message)) return;
      if (message.type === 'controller-state') {
        lastControllerContact.current = Date.now();
        setConnected(true);
        setMapState(message.state);
      } else if (message.type === 'controller-heartbeat') {
        lastControllerContact.current = Date.now();
        setConnected(true);
      } else if (message.type === 'controller-closing') {
        setConnected(false);
      }
    };

    let channel: BroadcastChannel | null = null;
    if ('BroadcastChannel' in window) {
      channel = new BroadcastChannel(MAP_WINDOW_CHANNEL);
      channelRef.current = channel;
      channel.onmessage = (event: MessageEvent<unknown>) => receiveMessage(event.data);
    }

    const handleWindowMessage = (event: MessageEvent<unknown>) => {
      if (event.origin !== window.location.origin) return;
      receiveMessage(event.data);
    };
    window.addEventListener('message', handleWindowMessage);

    const handleStorage = (event: StorageEvent) => {
      if (channel || event.key !== STORAGE_KEY) return;
      setMapState((current) => ({ ...current, items: loadItems() }));
    };
    window.addEventListener('storage', handleStorage);

    const handleBeforeUnload = () => {
      const closingMessage: MapWindowMessage = { type: 'detached-closing' };
      channelRef.current?.postMessage(closingMessage);
      if (window.opener && !window.opener.closed) {
        window.opener.postMessage(closingMessage, window.location.origin);
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    window.addEventListener('pagehide', handleBeforeUnload);

    sendMessage({ type: 'detached-ready' });
    sendMessage({ type: 'request-state' });

    const connectionTimer = window.setInterval(() => {
      sendMessage({ type: 'detached-heartbeat' });
      if (lastControllerContact.current > 0 && Date.now() - lastControllerContact.current > 5500) {
        setConnected(false);
      }
    }, 2000);

    return () => {
      window.clearInterval(connectionTimer);
      window.removeEventListener('message', handleWindowMessage);
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener('beforeunload', handleBeforeUnload);
      window.removeEventListener('pagehide', handleBeforeUnload);
      channel?.close();
      channelRef.current = null;
    };
  }, []);

  const focusedItem = useMemo(
    () => mapState.items.find((item) => item.id === mapState.focusedId) ?? null,
    [mapState.focusedId, mapState.items],
  );

  function handleEdit(item: MapItem) {
    if (!connected) return;
    setMapState((current) => ({ ...current, focusedId: item.id }));
    sendMessage({ type: 'map-edit', id: item.id });
  }

  function handleMove(id: string, lat: number, lng: number) {
    if (!connected) return;
    setMapState((current) => ({
      ...current,
      items: current.items.map((item) => item.id === id ? { ...item, lat, lng } : item),
    }));
    sendMessage({ type: 'map-move', id, lat, lng });
  }

  function focusController() {
    sendMessage({ type: 'focus-controller' });
    if (window.opener && !window.opener.closed) window.opener.focus();
  }

  return (
    <div className="detached-map-shell">
      <header className="detached-map-header">
        <div className="detached-map-title">
          <span className="detached-map-emblem" aria-hidden="true"><Monitor size={21} /></span>
          <div>
            <p>ДУС · отдельное окно</p>
            <h1>Интерактивная карта</h1>
          </div>
        </div>

        <div className="detached-map-header-actions">
          <span className={`detached-connection ${connected ? 'connected' : 'disconnected'}`}>
            <i /> {connected ? 'Связь с управлением установлена' : 'Окно управления не подключено'}
          </span>
          <button type="button" onClick={focusController} disabled={!connected}>
            <ExternalLink size={16} /> К управлению
          </button>
          <button className="detached-close-button" type="button" onClick={() => window.close()} aria-label="Закрыть отдельную карту">
            <X size={18} />
          </button>
        </div>
      </header>

      <main className="detached-map-stage">
        {mapState.placement && connected && (
          <div className="detached-placement-banner">
            <span className={mapState.placement}>
              {mapState.placement === 'person' ? <MapPin size={18} /> : <CarFront size={18} />}
            </span>
            <div>
              <strong>{mapState.placement === 'person' ? 'Выберите место для новой точки' : 'Укажите положение машины'}</strong>
              <small>Нажмите в нужном месте на этой карте</small>
            </div>
          </div>
        )}

        <MapView
          items={mapState.items}
          focusedItem={focusedItem}
          placement={mapState.placement}
          routeDraft={mapState.routeDraft}
          routeVehicleId={mapState.routeVehicleId}
          isAdmin={mapState.isAdmin && connected}
          excelConnected={mapState.excelConnected}
          onPlace={(lat, lng) => sendMessage({ type: 'map-place', lat, lng })}
          onEdit={handleEdit}
          onMove={handleMove}
          onUndoRoutePoint={() => sendMessage({ type: 'route-undo' })}
          onCancelRoute={() => sendMessage({ type: 'route-cancel' })}
          onStartRoute={() => sendMessage({ type: 'route-start' })}
        />
      </main>
    </div>
  );
}
