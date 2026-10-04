import { useCallback, useMemo, useRef, useState } from 'react';
import {
  chooseExcelWorkbook,
  readWorkbookPoints,
  reloadExcelWorkbook,
  removePointSheet,
  saveExcelWorkbook,
  supportsExcelFileLink,
  upsertPointSheet,
  type ExcelWorkbookSession,
} from '../excelWorkbook';
import type { PersonPoint } from '../types';

export type ExcelConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'saving'
  | 'error';

export interface ExcelConnectionState {
  status: ExcelConnectionStatus;
  fileName: string;
  lastSync: Date | null;
  error: string;
  supported: boolean;
}

const initialState = (): ExcelConnectionState => ({
  status: 'disconnected',
  fileName: '',
  lastSync: null,
  error: '',
  supported: supportsExcelFileLink(),
});

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return 'Не удалось выполнить операцию с Excel.';
}

export function useExcelWorkbook() {
  const [state, setState] = useState<ExcelConnectionState>(initialState);
  const sessionRef = useRef<ExcelWorkbookSession | null>(null);
  const operationQueue = useRef<Promise<void>>(Promise.resolve());

  const isConnected = state.status === 'connected' || state.status === 'saving';

  const connect = useCallback(async (existingPoints: PersonPoint[]) => {
    setState((current) => ({ ...current, status: 'connecting', error: '' }));
    try {
      const session = await chooseExcelWorkbook();
      const points = readWorkbookPoints(session, existingPoints);
      if (points.length === 0) {
        throw new Error('В книге не найдено ни одного листа точки.');
      }
      await saveExcelWorkbook(session, points);
      sessionRef.current = session;
      setState({
        status: 'connected',
        fileName: session.fileName,
        lastSync: new Date(),
        error: '',
        supported: true,
      });
      return points;
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        setState(initialState());
        return null;
      }
      setState((current) => ({
        ...current,
        status: 'error',
        error: errorMessage(error),
      }));
      return null;
    }
  }, []);

  const enqueue = useCallback(<Result,>(operation: (session: ExcelWorkbookSession) => Promise<Result>) => {
    const execute = async (): Promise<Result> => {
      const session = sessionRef.current;
      if (!session) throw new Error('Сначала привяжите Excel-файл.');
      setState((current) => ({ ...current, status: 'saving', error: '' }));
      try {
        const result = await operation(session);
        setState((current) => ({
          ...current,
          status: 'connected',
          fileName: session.fileName,
          lastSync: new Date(),
          error: '',
        }));
        return result;
      } catch (error) {
        setState((current) => ({
          ...current,
          status: 'error',
          error: errorMessage(error),
        }));
        throw error;
      }
    };

    const queued = operationQueue.current.then(execute, execute);
    operationQueue.current = queued.then(() => undefined, () => undefined);
    return queued;
  }, []);

  const refresh = useCallback(
    (existingPoints: PersonPoint[]) => enqueue(async (session) => {
      await reloadExcelWorkbook(session);
      const points = readWorkbookPoints(session, existingPoints);
      if (points.length === 0) throw new Error('В книге не найдено листов точек.');
      await saveExcelWorkbook(session, points);
      return points;
    }),
    [enqueue],
  );

  const savePoint = useCallback(
    (
      point: PersonPoint,
      previous: PersonPoint | undefined,
      allPoints: PersonPoint[],
    ) => enqueue(async (session) => {
      const savedPoint = upsertPointSheet(session, point, previous);
      const pointsForIndex = allPoints.map((existing) =>
        existing.id === point.id ? savedPoint : existing,
      );
      if (!pointsForIndex.some((existing) => existing.id === point.id)) {
        pointsForIndex.push(savedPoint);
      }
      await saveExcelWorkbook(session, pointsForIndex);
      return savedPoint;
    }),
    [enqueue],
  );

  const savePositions = useCallback(
    (points: PersonPoint[]) => enqueue(async (session) => {
      await saveExcelWorkbook(session, points);
    }),
    [enqueue],
  );

  const deletePoint = useCallback(
    (point: PersonPoint, remainingPoints: PersonPoint[]) => enqueue(async (session) => {
      removePointSheet(session, point);
      await saveExcelWorkbook(session, remainingPoints);
    }),
    [enqueue],
  );

  const disconnect = useCallback(() => {
    sessionRef.current = null;
    operationQueue.current = Promise.resolve();
    setState(initialState());
  }, []);

  const clearError = useCallback(() => {
    setState((current) => ({
      ...current,
      status: sessionRef.current ? 'connected' : 'disconnected',
      error: '',
    }));
  }, []);

  return useMemo(() => ({
    state,
    isConnected,
    connect,
    refresh,
    savePoint,
    savePositions,
    deletePoint,
    disconnect,
    clearError,
  }), [
    clearError,
    connect,
    deletePoint,
    disconnect,
    isConnected,
    refresh,
    savePoint,
    savePositions,
    state,
  ]);
}
