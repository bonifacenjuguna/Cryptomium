import { useEffect, useReducer } from 'react';
import type { Coin, Quote, Status } from '../types';

// In production set VITE_API_URL to the backend. Empty = same origin (dev proxy).
export const API_URL = ((import.meta.env.VITE_API_URL as string | undefined) ?? '').replace(/\/$/, '');

const HISTORY_POINTS = 80; // ticks kept per coin for the sparkline
const DEAD_AFTER_MS = 35_000; // backend pings every 15s; silence beyond this = dead link

interface State {
  coins: Coin[];
  quotes: Record<string, Quote>;
  history: Record<string, number[]>;
  status: Status;
  lastUpdate: number | null;
}

type Action =
  | { type: 'status'; status: Status }
  | { type: 'hello'; coins: Coin[] }
  | { type: 'alive' }
  | { type: 'prices'; quotes: Quote[]; t: number };

const initial: State = { coins: [], quotes: {}, history: {}, status: 'connecting', lastUpdate: null };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'status':
      return state.status === action.status ? state : { ...state, status: action.status };
    case 'hello':
      return { ...state, coins: action.coins, status: 'live' };
    case 'alive':
      return state.status === 'live' ? state : { ...state, status: 'live' };
    case 'prices': {
      // Keep object identity for coins that didn't change so their rows don't re-render.
      let quotes = state.quotes;
      let history = state.history;
      for (const q of action.quotes) {
        const old = quotes[q.ticker];
        if (old && old.price === q.price && old.change24h === q.change24h) continue;
        if (quotes === state.quotes) quotes = { ...quotes };
        quotes[q.ticker] = q;
        if (!old || old.price !== q.price) {
          if (history === state.history) history = { ...history };
          history[q.ticker] = [...(history[q.ticker] ?? []), q.price].slice(-HISTORY_POINTS);
        }
      }
      return { ...state, quotes, history, status: 'live', lastUpdate: action.t };
    }
  }
}

/** Opens one Server-Sent Events connection and keeps it alive. */
export function useLivePrices(): State {
  const [state, dispatch] = useReducer(reducer, initial);

  useEffect(() => {
    let es: EventSource | null = null;
    let retryTimer: number | undefined;
    let attempts = 0;
    let lastMessage = Date.now();
    let disposed = false;

    const connect = () => {
      if (disposed) return;
      es?.close();
      lastMessage = Date.now();
      es = new EventSource(`${API_URL}/api/stream`);

      const alive = () => {
        lastMessage = Date.now();
        attempts = 0;
      };
      es.addEventListener('hello', e => {
        alive();
        dispatch({ type: 'hello', coins: JSON.parse((e as MessageEvent).data).coins });
      });
      es.addEventListener('prices', e => {
        alive();
        const { t, quotes } = JSON.parse((e as MessageEvent).data);
        dispatch({ type: 'prices', quotes, t });
      });
      es.addEventListener('ping', () => {
        alive();
        dispatch({ type: 'alive' });
      });
      es.onerror = () => {
        dispatch({ type: 'status', status: 'reconnecting' });
        // The browser retries by itself, unless the server answered with an error
        // and the connection is CLOSED. In that case retry with backoff.
        if (es && es.readyState === EventSource.CLOSED) {
          window.clearTimeout(retryTimer);
          retryTimer = window.setTimeout(connect, Math.min(15_000, 1000 * 2 ** attempts++));
        }
      };
    };

    // A connection can go silent without erroring (sleeping laptop, dropped Wi-Fi).
    const watchdog = window.setInterval(() => {
      if (Date.now() - lastMessage > DEAD_AFTER_MS) {
        dispatch({ type: 'status', status: 'reconnecting' });
        connect();
      }
    }, 5_000);

    const onVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastMessage > DEAD_AFTER_MS) connect();
    };
    document.addEventListener('visibilitychange', onVisible);

    connect();
    return () => {
      disposed = true;
      es?.close();
      window.clearTimeout(retryTimer);
      window.clearInterval(watchdog);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  return state;
}
