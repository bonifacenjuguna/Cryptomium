// PricePing dashboard: fetches /api/prices on the backend's own refresh rhythm
// and updates the cards in place (no page reload).
(function () {
  const API = (window.PRICEPING_API || '').replace(/\/+$/, '');
  const grid = document.getElementById('grid');
  const message = document.getElementById('message');
  const statusEl = document.getElementById('status');
  const statusText = document.getElementById('status-text');
  const sortEl = document.getElementById('sort');

  const cards = new Map();   // ticker -> { el, priceEl, changeEl, last }
  let coins = [];
  let updatedAt = null;
  let failing = false;
  let timer = null;
  let refreshMs = 15000;
  let source = null;

  // --- Formatting: same rules as the Telegram banners -------------------------
  function formatPrice(price, stable) {
    if (price === null || price === undefined) return '–';
    let decimals;
    if (stable) decimals = 3;
    else if (price >= 10000) decimals = 0;
    else if (price >= 1) decimals = 2;
    else if (price >= 0.01) decimals = 3;
    else decimals = Math.min(12, Math.ceil(-Math.log10(price)) + 3);
    let text = price.toFixed(decimals);
    if (!stable && price < 0.01 && text.includes('.')) {
      const [w, f] = text.split('.');
      text = w + '.' + f.replace(/0+$/, '').padEnd(4, '0');
    }
    const [whole, frac] = text.split('.');
    const grouped = Number(whole).toLocaleString('en-US');
    return '$' + (frac === undefined ? grouped : grouped + '.' + frac);
  }

  function formatChange(change) {
    if (change === null || change === undefined) return { text: 'n/a', cls: 'flat' };
    const rounded = Math.round(change * 100) / 100;
    if (rounded === 0) return { text: '0.00%', cls: 'flat' };
    const sign = rounded > 0 ? '+' : '−';
    return { text: sign + Math.abs(rounded).toFixed(2) + '%', cls: rounded > 0 ? 'up' : 'down' };
  }

  // --- Cards -----------------------------------------------------------------------
  function makeLogo(coin) {
    const wrap = document.createElement('div');
    wrap.className = 'logo';
    const monogram = () => { wrap.replaceChildren(document.createTextNode(coin.ticker.slice(0, 4))); };
    if (coin.logo) {
      const img = new Image();
      img.alt = '';
      img.loading = 'lazy';
      img.src = API + coin.logo;
      img.onerror = monogram;
      wrap.appendChild(img);
    } else {
      monogram();
    }
    return wrap;
  }

  function makeCard(coin) {
    const li = document.createElement('li');
    li.className = 'coin';
    if (coin.color) li.style.setProperty('--brand', coin.color);

    const name = document.createElement('div');
    name.className = 'info';
    const nameMain = document.createElement('div');
    nameMain.className = 'name';
    nameMain.textContent = coin.name;
    const ticker = document.createElement('div');
    ticker.className = 'ticker';
    ticker.textContent = coin.ticker;
    name.append(nameMain, ticker);

    const priceEl = document.createElement('div');
    priceEl.className = 'price';
    const changeEl = document.createElement('div');
    changeEl.className = 'change flat';

    li.append(makeLogo(coin), name, priceEl, changeEl);
    return { el: li, priceEl, changeEl, last: null };
  }

  function flash(card, direction) {
    const cls = direction > 0 ? 'flash-up' : 'flash-down';
    card.el.classList.remove('flash-up', 'flash-down');
    void card.el.offsetWidth; // restart the transition
    card.el.classList.add(cls);
    setTimeout(() => card.el.classList.remove(cls), 60);
  }

  function sorted(list) {
    const mode = sortEl.value;
    const copy = list.slice();
    const byNum = (f, desc) => copy.sort((a, b) => {
      const x = f(a), y = f(b);
      if (x === null) return 1;
      if (y === null) return -1;
      return desc ? y - x : x - y;
    });
    if (mode === 'gainers') return byNum(c => c.change24h, true);
    if (mode === 'losers') return byNum(c => c.change24h, false);
    if (mode === 'price') return byNum(c => c.price, true);
    return copy;
  }

  function render() {
    const order = sorted(coins);
    for (const coin of order) {
      let card = cards.get(coin.ticker);
      if (!card) { card = makeCard(coin); cards.set(coin.ticker, card); }
      card.priceEl.textContent = formatPrice(coin.price, coin.stable);
      const ch = formatChange(coin.change24h);
      card.changeEl.textContent = ch.text;
      card.changeEl.className = 'change ' + ch.cls;
      card.changeEl.title = '24 hour change';
      if (card.last !== null && coin.price !== null && coin.price !== card.last) {
        flash(card, coin.price > card.last ? 1 : -1);
      }
      card.last = coin.price;
    }
    // Re-append in order only when the order really changed (keeps focus/animation stable).
    const want = order.map(c => cards.get(c.ticker).el);
    const have = Array.from(grid.children);
    if (want.length !== have.length || want.some((el, i) => el !== have[i])) grid.replaceChildren(...want);
  }

  // --- Status line -----------------------------------------------------------------
  function ago(ms) {
    const s = Math.max(0, Math.round(ms / 1000));
    if (s < 5) return 'just now';
    if (s < 60) return s + 's ago';
    return Math.floor(s / 60) + 'm ago';
  }

  function paintStatus() {
    statusEl.classList.toggle('live', !failing && updatedAt !== null);
    statusEl.classList.toggle('stale', failing);
    if (updatedAt === null) {
      statusText.textContent = failing ? "Can't reach the price server. Retrying…" : 'Connecting…';
    } else if (failing) {
      statusText.textContent = "Can't reach the price server. Showing prices from " + ago(Date.now() - updatedAt) + '.';
    } else {
      statusText.textContent = 'Live · ' + (source ? source + ' · ' : '') + 'updated ' + ago(Date.now() - updatedAt);
    }
  }

  function showMessage(text) {
    message.hidden = !text;
    message.textContent = text || '';
  }

  // --- Fetch loop --------------------------------------------------------------------
  async function load() {
    clearTimeout(timer);
    try {
      const res = await fetch(API + '/api/prices', { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      coins = data.coins || [];
      updatedAt = Date.parse(data.updatedAt) || Date.now();
      refreshMs = Math.max(3000, Number(data.refreshMs) || 15000);
      source = data.source || null;
      failing = Boolean(data.stale);
      showMessage('');
      render();
    } catch (err) {
      failing = true;
      if (coins.length === 0) showMessage('Prices are not available yet. This page will keep trying.');
    }
    paintStatus();
    if (!document.hidden) timer = setTimeout(load, failing ? 10000 : refreshMs);
  }

  if (!API) {
    showMessage('This site is not connected yet. In Netlify, set the API_URL environment variable to your Railway backend address, then redeploy.');
    statusText.textContent = 'Not connected';
    return;
  }

  sortEl.addEventListener('change', render);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
  setInterval(paintStatus, 1000);
  load();
})();
