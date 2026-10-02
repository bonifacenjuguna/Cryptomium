import { CoinRow } from './components/CoinRow';
import { API_URL, useLivePrices } from './hooks/useLivePrices';
import type { Status } from './types';

const STATUS_LABEL: Record<Status, string> = {
  connecting: 'Connecting…',
  live: 'Live',
  reconnecting: 'Reconnecting…',
};

const time = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

export default function App() {
  const { coins, quotes, history, status, lastUpdate } = useLivePrices();
  const missingApiUrl = import.meta.env.PROD && !API_URL;

  return (
    <main className="board">
      <header className="top">
        <div>
          <h1>priceping</h1>
          <p className="lede">Prices update on their own. No refresh needed.</p>
        </div>
        <div className={`pill ${status}`} role="status" aria-live="polite">
          <span className="dot" aria-hidden="true" />
          <span>{STATUS_LABEL[status]}</span>
          {status === 'live' && lastUpdate && <span className="stamp">{time(lastUpdate)}</span>}
        </div>
      </header>

      {missingApiUrl && (
        <p className="notice">
          This build has no backend address. Set <code>VITE_API_URL</code> to your backend URL and redeploy.
        </p>
      )}

      <ul className="rows">
        {coins.length === 0
          ? Array.from({ length: 8 }, (_, i) => <li key={i} className="row skeleton" aria-hidden="true" />)
          : coins.map(coin => <CoinRow key={coin.ticker} coin={coin} quote={quotes[coin.ticker]} history={history[coin.ticker] ?? []} />)}
      </ul>

      <footer>
        <p>Prices come from Binance, Kraken and CoinGecko. Sparklines show changes since you opened this page. Not financial advice.</p>
      </footer>
    </main>
  );
}
