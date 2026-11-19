// Token Radar's dashboard. It reads window.RADAR (written beside dashboard/ by main.ts) and renders
// the ranked board, a filterable table, a per-protocol detail drawer with the model's own inputs and
// the protocol's farm plan, the comparables table the model was built from, and a model sandbox that
// re-ranks the board live. No network: every byte it shows is in data.js.
//
// The value model, in one function: the page recomputes a row from the snapshot figures and checks the
// number board.json carries, so the page's code and the board's data are visibly the same arithmetic.
//   implied = round(tvl x categoryMultiple x growthMult x maturityMult)
//   categoryMultiple = the median mcap / TVL of the live-token protocols in the row's category
//     (at least 5 of them), else the global median over every live-token protocol, clamped to
//     [0.05, 1.0]. growthMult = 1 + clamp(change_7d, -60, 120) / 100 x 0.5.
//     maturityMult = 0.6 + min(age_days, 1095) / 1095 x 0.4 (unknown age: 365 days).
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = {
    q: '', category: 'all', chain: 'all', mintvl: 0, tab: 'pre-token',
    sort: 'implied', dir: -1, selected: null,
    sandbox: { weight: DATA.model.growth_weight, floor: DATA.model.maturity_floor, scale: 1 }
  };

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function fmtMult(n) { return n === null || n === undefined || !isFinite(n) ? 'n/a' : n.toFixed(3) + 'x'; }
  function fmtNum(n, d) { return n === null || n === undefined || !isFinite(n) ? 'n/a' : n.toFixed(d === undefined ? 2 : d); }

  // The model in one function: recompute a row from the snapshot figures. The page checks the number
  // board.json carries, so a stale board would show up here.
  function impliedOf(row, model, mult) {
    var growth = Math.min(model.growth_cap, Math.max(model.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * model.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    var maturity = model.maturity_floor + (Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
    return Math.max(1, Math.round(row.tvl_usd * (mult === undefined ? row.base_multiple : mult) * growthMult * maturity));
  }
  function sandboxImplied(row) {
    var s = state.sandbox;
    var m = DATA.model;
    var growth = Math.min(m.growth_cap, Math.max(m.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * s.weight;
    var age = row.age_days === null || row.age_days === undefined ? m.unknown_age_days : row.age_days;
    var maturity = s.floor + (Math.min(Math.max(age, 0), m.maturity_days) / m.maturity_days) * (1 - s.floor);
    return Math.max(1, Math.round(row.tvl_usd * row.base_multiple * s.scale * growthMult * maturity));
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // The farm plan is the same derivation main.ts writes to board.json: category, chains, TVL and age
  // decide the action, the capital, the hold, the gas and every cost and time. No name is special-cased.
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function capitalFor(p) {
    if (p.tvl_usd >= 5e9) return 500;
    if (p.tvl_usd >= 1e9) return 250;
    if (p.tvl_usd >= 2.5e8) return 150;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function gasMonthFor(chain) {
    var c = chain.toLowerCase();
    if (c === 'ethereum') return '$12';
    if (c === 'solana') return '$0.10';
    if (c === 'base' || c === 'arbitrum' || c === 'optimism' || c === 'polygon' || c === 'zksync' ||
      c === 'linea' || c === 'blast' || c === 'mode' || c === 'scroll' || c === 'mantle' ||
      c === 'avalanche' || c === 'bnb chain' || c === 'gnosis') return '$1';
    return '$3';
  }
  function actionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' and keep the position open.';
    if (c.indexOf('dex') >= 0 || c.indexOf('swap') >= 0) return 'Provide $' + capital + " of liquidity to " + name + "'s main pool on " + chain + ' and keep the position open.';
    if (c.indexOf('yield aggregator') >= 0 || c.indexOf('leveraged farm') >= 0) return 'Deposit $' + capital + " into " + name + "'s highest-TVL vault on " + chain + ' and keep the shares.';
    if (c.indexOf('yield') >= 0) return 'Deposit $' + capital + " into " + name + "'s highest-yield vault on " + chain + ' and keep the shares.';
    if (c.indexOf('bridge') >= 0) return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ' and use the bridged funds in its app.';
    if (c.indexOf('liquid staking') >= 0 || c.indexOf('restak') >= 0 || c.indexOf('staking pool') >= 0) return "Stake $" + capital + " of the chain's staking asset through " + name + ' and keep the receipt token.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedge.';
    if (c.indexOf('prediction') >= 0) return 'Fund $' + capital + ' and place one market position on ' + name + '.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the shares.';
    if (c.indexOf('stable') >= 0) return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + '.';
    if (c.indexOf('rwa') >= 0) return "Mint $" + capital + " of the protocol's yield-bearing asset on " + chain + ' and hold it.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy.';
    if (c.indexOf('basis') >= 0) return 'Deposit $' + capital + " of USDC into " + name + "'s basis vault on " + chain + ' and hold the position.';
    if (c.indexOf('index') >= 0) return 'Buy $' + capital + ' of the ' + name + ' index on ' + chain + ' and hold the tokens.';
    if (c.indexOf('launchpad') >= 0) return 'Stake $' + capital + " to join " + name + "'s next launch pool on " + chain + '.';
    if (c.indexOf('payment') >= 0) return 'Route $' + capital + ' of payments through ' + name + ' on ' + chain + ' and keep the receipts.';
    if (c.indexOf('governance') >= 0) return 'Lock $' + capital + ' of assets to vote in ' + name + ' governance on ' + chain + '.';
    if (c.indexOf('farm') >= 0) return 'Deposit $' + capital + " into " + name + "'s main farm on " + chain + ' and keep the position open.';
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
  }
  function weeklyActionFor(p) {
    var c = (p.category || '').toLowerCase();
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Make one borrow or repayment, so the position moves every week.';
    if (c.indexOf('dex') >= 0 || c.indexOf('swap') >= 0) return 'Swap a small amount, or add and remove a little liquidity, so the position moves every week.';
    if (c.indexOf('bridge') >= 0) return 'Bridge a small amount back and forth, so the position moves every week.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'Open and close one small hedge, so the position moves every week.';
    if (c.indexOf('prediction') >= 0) return 'Place one small market position, so the activity shows every week.';
    if (c.indexOf('governance') >= 0) return 'Vote on one proposal, so the activity shows every week.';
    return 'Make one qualifying action, such as a deposit, a swap or a vote, so the activity shows every week.';
  }
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  function farmSteps(p) {
    var chain = chainOf(p);
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    var gas = gasMonthFor(chain);
    return [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
      { text: actionFor(p, capital, chain), cost: '$' + capital + ' of capital and about $' + (capital >= 250 ? 10 : capital >= 150 ? 8 : 4) + ' of gas', time: '15 minutes to set up' },
      { text: weeklyActionFor(p), cost: 'about $2 of gas a week', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: 'Set aside ' + gas + ' for gas on ' + chain + ' for the first month of farming, and top it up only from the same wallet.', cost: gas + ' of gas for the month', time: '5 minutes to fund' },
      { text: "Open the protocol's own points or rewards page, the one its own site links to, and check that your wallet and activity show up there before you withdraw.", cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: 'Write the wallet, the dates and every transaction hash in a farm log so you can repeat the position or unwind it.', cost: 'nothing but the log', time: '5 minutes' }
    ].map(stepText);
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('mintvl')) state.mintvl = Number(params.get('mintvl')) || 0;
    if (params.get('tab')) state.tab = params.get('tab');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.mintvl) params.set('mintvl', String(state.mintvl));
    if (state.tab !== 'pre-token') params.set('tab', state.tab);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function rows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
      if (state.chain !== 'all' && !(r.chains || []).includes(state.chain)) return false;
      if (state.mintvl && r.tvl_usd < state.mintvl) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'category') { av = (a.category || 'Other').toLowerCase(); bv = (b.category || 'Other').toLowerCase(); }
      else if (key === 'chain') { av = (a.chains && a.chains[0] ? a.chains[0] : '').toLowerCase(); bv = (b.chains && b.chains[0] ? b.chains[0] : '').toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', { class: 'brand-name', text: 'Token Radar' })),
      el('div', { class: 'top-meta' },
        el('span', null, 'Snapshot ', el('b', { text: DATA.as_of })),
        el('span', { text: 'DefiLlama protocol index' }),
        el('span', null, 'Model ', el('b', { text: DATA.model_version }))
      )
    );
  }

  function lede() {
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: DATA.watchlist_size + ' watchlist protocols, ranked by implied value' }),
        el('p', null,
          'The watchlist is the floor: every protocol with at least ', el('b', { text: '$' + Math.round(DATA.floor_usd / 1e6) + 'M' }),
          ' of TVL and no token on record. The early radar adds ', el('b', { text: String(DATA.early_size) }),
          ' pre-token protocols below that floor. Implied value is a comparables model, not a promise: each category is priced off the live-token protocols already trading in it.'
        )
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        el('div', { class: 'fact' }, el('span', { text: 'Pre-token rows scored' }), el('b', { text: String(DATA.board_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Early rows below the floor' }), el('b', { text: String(DATA.early_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Live-token protocols set aside' }), el('b', { text: String(DATA.live_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Global multiple (144 live comps)' }), el('b', { text: fmtMult(DATA.comparables.global_multiple) }))
      )
    );
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (acc, r) { return acc.concat(r.chains || []); }, []))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var catSelect = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    catSelect.addEventListener('change', function () { state.category = catSelect.value; writeHash(); render(); });
    var chainSelect = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All chains' }),
      chains.map(function (c) { return el('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null }); })
    );
    chainSelect.addEventListener('change', function () { state.chain = chainSelect.value; writeHash(); render(); });
    var tvlSelect = el('select', { id: 'mintvl', 'aria-label': 'Minimum TVL' },
      [['0', 'Any TVL'], ['10000000', 'TVL $10M+'], ['25000000', 'TVL $25M+'], ['50000000', 'TVL $50M+'], ['100000000', 'TVL $100M+'], ['250000000', 'TVL $250M+'], ['1000000000', 'TVL $1B+']].map(function (o) {
        return el('option', { value: o[0], text: o[1], selected: Number(o[0]) === state.mintvl ? 'selected' : null });
      })
    );
    tvlSelect.addEventListener('change', function () { state.mintvl = Number(tvlSelect.value) || 0; writeHash(); render(); });
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { state.tab = 'pre-token'; writeHash(); render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.tab = 'live'; writeHash(); render(); } });
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), catSelect),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chainSelect),
      el('div', { class: 'field' }, el('label', { for: 'mintvl', text: 'Min TVL' }), tvlSelect),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Token status' }), el('div', { class: 'tabs' }, pre, live)),
      el('span', { class: 'count', text: state.tab === 'pre-token' ? rows().length + ' rows shown' : DATA.live.length + ' live-token protocols' })
    );
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  function boardTable() {
    var list = sortedRows(rows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.mintvl = 0; writeHash(); render(); } })
      ));
    }
    var max = list[0].implied_value_usd || 1;
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var chainText = r.chains && r.chains.length ? r.chains[0] + (r.chains.length > 1 ? ' +' + (r.chains.length - 1) : '') : 'n/a';
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: r.slug }))),
        el('td', null, el('span', { class: 'pill', text: r.category || 'Other' })),
        el('td', { class: 'num', text: chainText }),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        ))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('category', 'Category'),
            sortHeader('chain', 'Chains'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('implied', 'Implied value')
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', null, el('span', { class: 'status live', text: 'live' })),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: r.slug }))),
        el('td', null, el('span', { class: 'pill', text: r.category || 'Other' })),
        el('td', { class: 'num', text: (r.chains && r.chains.length ? r.chains[0] + (r.chains.length > 1 ? ' +' + (r.chains.length - 1) : '') : 'n/a') }),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', { class: 'num', text: r.mcap_usd && r.tvl_usd ? fmtMult(r.mcap_usd / r.tvl_usd) : 'n/a' })
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. Their mcap / TVL ratios are the comparables the board is priced from.' }),
          el('thead', null, el('tr', null,
            el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'Category' }),
            el('th', { scope: 'col', text: 'Chains' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }),
            el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'mcap / TVL' })
          )),
          tbody
        )
      )
    );
  }

  function modelPanel() {
    var m = DATA.model;
    var c = DATA.comparables;
    var compRows = c.categories.map(function (row) {
      return el('tr', null,
        el('td', null, el('span', { class: 'pill', text: row.category })),
        el('td', { class: 'num', text: String(row.comps) }),
        el('td', { class: 'num', text: fmtMult(row.median) }),
        el('td', { class: 'num', text: fmtMult(row.multiple) }),
        el('td', { class: row.fallback ? 'fallback' : '', text: row.fallback ? 'global fallback' : 'category used' })
      );
    });
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', { class: 'sub', text: 'Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked. The multiple comes from the market, not from a guess.' }),
      el('div', { class: 'formula' },
        'implied = round( tvl_usd x ', el('b', { text: 'category multiple' }), ' x (1 + clamp(change_7d, -60, 120) / 100 x ', el('b', { text: String(m.growth_weight) }), ') x (', el('b', { text: String(m.maturity_floor) }), ' + min(age_days, 1095) / 1095 x ', el('b', { text: String(m.maturity_range) }), ') )'
      ),
      el('div', { class: 'consts' },
        el('div', { class: 'const' }, el('span', { text: 'Category multiple' }), el('b', { text: 'median mcap / TVL of live-token comps' })),
        el('div', { class: 'const' }, el('span', { text: 'Live comps needed' }), el('b', { text: String(m.min_comps) + ' per category' })),
        el('div', { class: 'const' }, el('span', { text: 'Multiple band' }), el('b', { text: m.multiple_floor + 'x to ' + m.multiple_cap + 'x' })),
        el('div', { class: 'const' }, el('span', { text: 'Global fallback' }), el('b', { text: fmtMult(c.global_multiple) + ' (' + c.global_comps + ' live protocols)' })),
        el('div', { class: 'const' }, el('span', { text: 'Growth weight' }), el('b', { text: String(m.growth_weight) })),
        el('div', { class: 'const' }, el('span', { text: 'Unknown age' }), el('b', { text: String(m.unknown_age_days) + ' days' }))
      ),
      el('p', { class: 'sub', text: 'TVL and seven-day growth come from the snapshot. Age is the time since the protocol was first listed, the best record of how long it has run with no token. A category with fewer than ' + m.min_comps + ' live-token protocols falls back to the global median, so a thin category cannot set its own price.' }),
      el('div', { class: 'comp-wrap' },
        el('table', { class: 'comp' },
          el('caption', { class: 'sub', text: 'Comparables: every category with a live-token protocol in the snapshot. The multiple is the median mcap / TVL, clamped to the band; a fallback row uses the global median instead.' }),
          el('thead', null, el('tr', null,
            el('th', { scope: 'col', text: 'Category' }), el('th', { scope: 'col', text: 'Live comps' }),
            el('th', { scope: 'col', text: 'Median mcap / TVL' }), el('th', { scope: 'col', text: 'Multiple used' }), el('th', { scope: 'col', text: 'Basis' })
          )),
          el('tbody', null, compRows)
        )
      )
    );
  }

  function sandboxPanel() {
    var s = state.sandbox;
    function slider(id, label, min, max, step, value, fmt) {
      var input = el('input', { type: 'range', id: id, min: String(min), max: String(max), step: String(step), value: String(value), 'aria-label': label });
      var out = el('b', { text: fmt(value) });
      input.addEventListener('input', function () {
        if (id === 'sb-weight') s.weight = Number(input.value);
        if (id === 'sb-floor') s.floor = Number(input.value);
        if (id === 'sb-scale') s.scale = Number(input.value);
        out.textContent = fmt(Number(input.value));
        renderSandbox();
      });
      return el('div', { class: 'slider' }, el('label', { for: id }, el('span', { text: label }), out), input);
    }
    var top = el('div', { class: 'sandbox-top', id: 'sandbox-top' });
    var panel = el('section', { class: 'panel sandbox' },
      el('h2', { text: 'Model sandbox: re-rank the board' }),
      el('p', { class: 'sub', text: 'Move a constant and the board re-ranks on this page. The sandbox changes nothing in board.json: the submitted board keeps the constants above.' }),
      el('div', { class: 'sliders' },
        slider('sb-weight', 'Growth weight', 0, 1, 0.05, s.weight, function (v) { return v.toFixed(2); }),
        slider('sb-floor', 'Maturity floor', 0.3, 0.9, 0.05, s.floor, function (v) { return v.toFixed(2); }),
        slider('sb-scale', 'Multiple scale', 0.5, 2, 0.1, s.scale, function (v) { return v.toFixed(1) + 'x'; })
      ),
      top,
      el('p', { class: 'sandbox-note', id: 'sandbox-note' })
    );
    return panel;
  }

  function renderSandbox() {
    var top = document.getElementById('sandbox-top');
    var note = document.getElementById('sandbox-note');
    if (!top || !note) return;
    var rescored = DATA.rows.map(function (r) { return { row: r, value: sandboxImplied(r) }; });
    rescored.sort(function (a, b) { return b.value - a.value || (a.row.slug < b.row.slug ? -1 : a.row.slug > b.row.slug ? 1 : 0); });
    var moved = 0;
    rescored.forEach(function (item, i) { if (item.row.rank !== i + 1) moved++; });
    top.textContent = '';
    rescored.slice(0, 5).forEach(function (item, i) {
      top.appendChild(el('div', null,
        el('span', { text: '#' + (i + 1) + ' ' + item.row.name + ' (was #' + item.row.rank + ')' }),
        el('span', { class: 'num', text: fmtUsd(item.value) })
      ));
    });
    note.textContent = moved + ' of ' + DATA.rows.length + ' rows change rank under these constants. The submitted board keeps growth weight ' +
      DATA.model.growth_weight + ', maturity floor ' + DATA.model.maturity_floor + ' and multiple scale 1.0x.';
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var steps = farmSteps(row);
    var recomputed = impliedOf(row, DATA.model);
    var comp = DATA.comparables.categories.filter(function (c) { return c.category === (row.category || 'Other'); })[0];
    var compText = row.category_fallback
      ? 'Only ' + row.category_comps + ' live-token protocol' + (row.category_comps === 1 ? '' : 's') + ' in ' + (row.category || 'Other') + ' (needs ' + DATA.model.min_comps + '), so this row uses the global median of ' + DATA.comparables.global_comps + ' live-token protocols.'
      : 'The median mcap / TVL of ' + row.category_comps + ' live-token ' + (row.category || 'Other') + ' protocols in the snapshot.';
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Category multiple (' + (row.category || 'Other') + ')' }), el('b', { class: 'num', text: fmtMult(row.base_multiple) })),
        el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { class: 'num', text: fmtPct(row.change_7d) })),
        el('div', null, el('span', { text: 'Growth multiplier' }), el('b', { class: 'num', text: String(row.growth_multiplier) })),
        el('div', null, el('span', { text: 'Age with no token' }), el('b', { class: 'num', text: fmtAge(row.age_days) })),
        el('div', null, el('span', { text: 'Maturity multiplier' }), el('b', { class: 'num', text: String(row.maturity_multiplier) })),
        el('div', { class: 'total' }, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) }))
      ),
      el('p', { class: 'note', text: 'Model ' + DATA.model_version + ': the page recomputes this row as ' + fmtUsd(recomputed) + (recomputed === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' This is an estimate, not a price.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Comparables used' }),
      el('p', { class: 'sub', text: compText }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'Category median mcap / TVL' }), el('b', { class: 'num', text: fmtMult(row.category_median) })),
        el('div', null, el('span', { text: 'Live-token comps in category' }), el('b', { class: 'num', text: String(row.category_comps) })),
        el('div', null, el('span', { text: 'Multiple applied' }), el('b', { class: 'num', text: fmtMult(row.base_multiple) + (row.category_fallback ? ' (global fallback)' : '') }))
      ),
      comp ? el('p', { class: 'note', text: 'The ' + (row.category || 'Other') + ' comparables table lists ' + comp.comps + ' live-token protocols with a median of ' + fmtMult(comp.median) + '.' }) : null
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('ol', { class: 'steps' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      }))
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Facts' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Seven-day change' }), el('b', { class: 'num', text: fmtPct(row.change_7d) })),
        el('div', null, el('span', { text: 'First listed' }), el('b', { class: 'num', text: row.listed_at || 'unknown' })),
        el('div', null, el('span', { text: 'Age' }), el('b', { class: 'num', text: fmtAge(row.age_days) })),
        el('div', null, el('span', { text: 'Chains' }), el('b', { class: 'num', text: row.chains && row.chains.length ? row.chains.join(', ') : 'n/a' })),
        el('div', null, el('span', { text: 'Token status' }), el('b', { class: 'num', text: 'records no token' }))
      ),
      el('p', { class: 'note', text: 'The snapshot records no token for this protocol; that is what its DefiLlama record carries, not proof it has none.' })
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
    window.__shotReady = true;
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    shell.appendChild(controls());
    shell.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
    if (state.tab === 'pre-token') {
      shell.appendChild(modelPanel());
      shell.appendChild(sandboxPanel());
      renderSandbox();
    }
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    window.__shotReady = true;
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });

  // Test handle: lets a headless check compare the page's own arithmetic and farm plans against
  // board.json, row by row. It changes nothing the page shows.
  window.__radarTest = { farmSteps: farmSteps, impliedOf: impliedOf, sandboxImplied: sandboxImplied };
})();
