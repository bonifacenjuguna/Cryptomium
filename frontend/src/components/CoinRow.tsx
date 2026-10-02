import { memo, useEffect, useRef, useState, type CSSProperties } from 'react';
import type { Coin, Quote } from '../types';
import { formatChange, formatPrice } from '../lib/format';
import { CoinLogo } from './CoinLogo';
import { Sparkline } from './Sparkline';

interface Flash {
  dir: 'up' | 'down';
  n: number;
}

/** Briefly reports which way the price just moved (n changes every tick so the animation restarts). */
function useFlash(price: number | undefined): Flash | null {
  const prev = useRef(price);
  const count = useRef(0);
  const [flash, setFlash] = useState<Flash | null>(null);

  useEffect(() => {
    const before = prev.current;
    prev.current = price;
    if (price === undefined || before === undefined || before === price) return;
    setFlash({ dir: price > before ? 'up' : 'down', n: ++count.current });
    const t = window.setTimeout(() => setFlash(null), 900);
    return () => window.clearTimeout(t);
  }, [price]);

  return flash;
}

interface Props {
  coin: Coin;
  quote: Quote | undefined;
  history: number[];
}

export const CoinRow = memo(function CoinRow({ coin, quote, history }: Props) {
  const flash = useFlash(quote?.price);
  const change = quote?.change24h ?? null;
  const tone = change === null || change === 0 ? 'flat' : change > 0 ? 'up' : 'down';

  return (
    <li className="row" style={{ '--brand': coin.brandColor } as CSSProperties}>
      <CoinLogo coin={coin} />
      <div className="id">
        <span className="ticker">{coin.ticker}</span>
        <span className="name">{coin.name}</span>
      </div>
      <Sparkline data={history} />
      <div className="price">
        {quote ? (
          <span key={flash?.n ?? 0} className={flash ? `px flash-${flash.dir}` : 'px'}>
            ${formatPrice(quote.price, coin.stable)}
          </span>
        ) : (
          <span className="px muted">…</span>
        )}
      </div>
      <div className={`chg ${tone}`} title="Change over the last 24 hours">
        {formatChange(change)}
      </div>
    </li>
  );
});
