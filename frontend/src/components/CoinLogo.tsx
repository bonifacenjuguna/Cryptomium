import { useState } from 'react';
import type { Coin } from '../types';

// Community icon set on a CDN. A few newer coins aren't in it, so the
// coloured ticker badge is the fallback.
const iconUrl = (ticker: string) =>
  `https://cdn.jsdelivr.net/gh/spothq/cryptocurrency-icons@0.18.1/svg/color/${ticker.toLowerCase()}.svg`;

export function CoinLogo({ coin }: { coin: Coin }) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <span className="logo badge" style={{ background: coin.brandColor }} aria-hidden="true">
        {coin.ticker.slice(0, 3)}
      </span>
    );
  }
  return (
    <img
      className="logo"
      src={iconUrl(coin.ticker)}
      alt=""
      width={36}
      height={36}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}
