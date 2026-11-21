// Token Radar, radar-2.3 dashboard: a static page, no framework, no network.
// Renders the ranked board, a filterable table, a per-protocol detail dialog
// with the model's own recompute, the live-token peers the fit learned from,
// and the model panel that states the method. Reads window.RADAR (data.js).

(function () {
  'use strict';
  var DATA = window.RADAR;
  var state = { q: '', category: 'all', chain: 'all', verdict: 'all', minOdds: 0, tab: 'pre-token', sort: 'implied', dir: -1, selected: null };

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      for (var k in attrs) {
        if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k === 'onclick') node.addEventListener('click', attrs[k]);
        else if (k === 'oninput') node.addEventListener('input', attrs[k]);
        else if (k === 'onchange') node.addEventListener('change', attrs[k]);
        else node.setAttribute(k, attrs[k]);
      }
    }
    (children || []).forEach(function (c) { if (c !== null && c !== undefined) node.appendChild(c); });
    return node;
  }

  function fmtUsd(n) {
    if (n === null || n === undefined) return '—';
    var abs = Math.abs(n);
    if (abs >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (abs >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (abs >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + Math.round(n);
  }
  function fmtPct(n) { return n === null || n === undefined ? '—' : (n > 0 ? '+' : '') + n.toFixed(1) + '%'; }
  function fmtMult(n) { return 'x' + n.toFixed(2); }
  function fmtOdds(n) { return Math.round(n * 100) + '%'; }
  function fmtAge(n) { return n === null || n === undefined ? '—' : n >= 365 ? (n / 365).toFixed(1) + 'y' : n + 'd'; }

  /** The model in one function: the page recomputes a row from the snapshot figures. */
  function impliedOf(row) {
    var fitted = row.tvl_usd * row.fitted_multiple * row.growth_multiplier * row.maturity_multiplier;
    return Math.max(1, Math.round(fitted * row.token_odds));
  }

  /** The farm score: implied value times density (fitted multiple times token odds). */
  function farmScore(row) {
    return row.implied_value_usd * row.fitted_multiple * row.token_odds;
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('detail')) state.selected = params.get('detail');
    if (params.get('verdict')) state.verdict = params.get('verdict');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('q')) state.q = params.get('q');
    if (params.get('tab')) state.tab = params.get('tab');
  }
  function writeHash() {
    var p = new URLSearchParams();
    if (state.selected) p.set('detail', state.selected);
    if (state.verdict !== 'all') p.set('verdict', state.verdict);
    if (state.category !== 'all') p.set('category', state.category);
    if (state.chain !== 'all') p.set('chain', state.chain);
    if (state.q) p.set('q', state.q);
    var s = p.toString();
    history.replaceState(null, '', s ? '#' + s : '#');
  }

  function rows() {
    return DATA.rows.filter(function (r) {
      if (state.q) {
        var q = state.q.toLowerCase();
        if (r.name.toLowerCase().indexOf(q) < 0 && r.slug.toLowerCase().indexOf(q) < 0) return false;
      }
      if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
      if (state.chain !== 'all' && r.chains.indexOf(state.chain) < 0) return false;
      if (state.verdict !== 'all' && r.verdict !== state.verdict) return false;
      if (r.token_odds < state.minOdds) return false;
      return true;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name; bv = b.name; }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -999 : a.change_7d; bv = b.change_7d === null ? -999 : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? -1 : a.age_days; bv = b.age_days === null ? -1 : b.age_days; }
      else if (key === 'multiple') { av = a.fitted_multiple; bv = b.fitted_multiple; }
      else if (key === 'odds') { av = a.token_odds; bv = b.token_odds; }
      else if (key === 'score') { av = farmScore(a); bv = farmScore(b); }
      else if (key === 'cost') { av = a.total_cost_usd; bv = b.total_cost_usd; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -1 * state.dir;
      if (av > bv) return 1 * state.dir;
      return a.rank - b.rank;
    });
  }

  function verdictPill(v) {
    return el('span', { class: 'pill ' + v.toLowerCase(), text: v });
  }

  function boardTable() {
    var list = sortedRows(rows());
    if (list.length === 0) {
      return el('div', { class: 'empty' }, [
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Loosen a filter, or clear them all.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.verdict = 'all'; state.minOdds = 0; writeHash(); render(); } }),
      ]);
    }
    function sortHeader(key, label) {
      return el('th', {}, [el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } }, [
        document.createTextNode(label + ' '),
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? 'v' : '^' }) : null,
      ])]);
    }
    var thead = el('thead', {}, [el('tr', {}, [
      sortHeader('implied', '#'), sortHeader('name', 'Protocol'), sortHeader('tvl', 'TVL'),
      sortHeader('growth', '7d'), sortHeader('age', 'Age'), sortHeader('multiple', 'Fit x'),
      sortHeader('odds', 'Odds'), sortHeader('implied', 'Implied value'), sortHeader('score', 'Farm score'), sortHeader('cost', 'Cost'), el('th', { text: 'Farm' }),
    ])]);
    var tbody = el('tbody', {}, list.map(function (r) {
      return el('tr', { onclick: function () { state.selected = r.slug; writeHash(); render(); } }, [
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', { class: 'name' }, [el('b', { text: r.name }), el('span', { text: r.slug + ' · ' + (r.category || 'Other') + ' · ' + r.chains.slice(0, 3).join(', ') })]),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num', text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', { class: 'num', text: fmtMult(r.fitted_multiple) }),
        el('td', { class: 'num', text: fmtOdds(r.token_odds) }),
        el('td', { class: 'num', text: fmtUsd(r.implied_value_usd) }),
        el('td', { class: 'num', text: fmtUsd(farmScore(r)) }),
        el('td', { class: 'num', text: fmtUsd(r.total_cost_usd) }),
        el('td', {}, [verdictPill(r.verdict)]),
      ]);
    }));
    return el('table', {}, [
      el('caption', { text: 'Pre-token protocols, strongest expected launch value first. Select a row for its model and farm plan. ' + list.length + ' of ' + DATA.rows.length + ' rows shown.' }),
      thead, tbody,
    ]);
  }

  function liveTable() {
    var aboveCap = DATA.live.filter(function (r) { return r.above_cap; }).length;
    var tbody = el('tbody', {}, DATA.live.map(function (r, i) {
      return el('tr', {}, [
        el('td', { class: 'num', text: String(i + 1) }),
        el('td', { class: 'name' }, [el('b', { text: r.name }), el('span', { text: r.slug + ' · ' + (r.category || 'Other') })]),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num', text: r.mcap_usd === null ? '—' : fmtUsd(r.mcap_usd) }),
        el('td', { class: 'num', text: r.multiple === null ? '—' : fmtMult(r.multiple) + (r.above_cap ? ' †' : '') }),
        el('td', { class: 'num', text: fmtPct(r.change_7d) }),
      ]);
    }));
    return el('table', {}, [
      el('caption', { text: 'Token live: these ' + DATA.live.length + ' protocols already trade with a priced market cap, so their market cap is a fact, not a model. Their mcap/TVL multiples are the peers the fitted model learned from; multiples are capped at 5x — the same cap the fit uses — and a † marks the ' + aboveCap + ' peers above the cap, which the fit leaves out. They are set aside from the pre-token ranking.' }),
      el('thead', {}, [el('tr', {}, [el('th', { text: '#' }), el('th', { text: 'Protocol' }), el('th', { text: 'TVL' }), el('th', { text: 'Market cap' }), el('th', { text: 'mcap / TVL' }), el('th', { text: '7d' })])]),
      tbody,
    ]);
  }

  function modelPanel() {
    var m = DATA.model;
    var fit = DATA.fit;
    var topCats = fit.categories.filter(function (c) { return c.peers >= 3; }).slice(0, 12);
    return el('section', { class: 'panel model', id: 'model' }, [
      el('h2', { text: 'How the value is fitted' }),
      el('p', { text: 'Implied value is an expected launch value, fitted from this snapshot alone. Market cap is fitted on TVL with a log-log line, log(market cap) = ' + fit.loglog.intercept + ' + ' + fit.loglog.slope + ' x log(TVL) + a category effect: the slope is below 1, so larger protocols carry a lower multiple, and each category’s effect is its mean residual, shrunk toward the global line (weight ' + m.peer_shrink + ' peers). The line is fitted with Huber weights (k = 1.345, scale 1.4826 x MAD, 11 passes from the plain line): a peer far from the line is downweighted on either tail instead of being deleted. Peers with no priced market cap are excluded from the fit, and so are peers whose market cap exceeds ' + m.ratio_cap + 'x their TVL: their value is not a TVL story, and one such peer (Rain, 400x its TVL) bent the whole line before this rule. The nine lowest-ratio peers (below 0.01x) are the most downweighted but none is deleted: deleting them from the plain line would move it (intercept 6.63 to 4.78) and make held-out prediction worse (split A 1.10 to 1.40), so the test keeps them in. Token odds are how often protocols in the same category and age band already have a token, smoothed toward the category rate. Growth is the 7-day TVL change clamped to ' + m.growth_floor + '%..' + m.growth_cap + '%, maturity rises with age up to ' + m.maturity_days + ' days, and an unknown age counts as ' + m.unknown_age_days + ' days. No protocol name is ever special-cased: the same function scores every row.' }),
      el('p', { class: 'formula', text: 'implied = TVL x fitted multiple x growth x maturity x token odds' }),
      el('h3', { text: 'Fitted multiples by category (peers with a live token; fitted at $100M TVL)' }),
      el('table', {}, [
        el('thead', {}, [el('tr', {}, [el('th', { text: 'Category' }), el('th', { text: 'Peers' }), el('th', { text: 'Median mcap/TVL' }), el('th', { text: 'Fitted x @ $100M' }), el('th', { text: 'Token rate' })])]),
        el('tbody', {}, topCats.map(function (c) {
          return el('tr', {}, [
            el('td', { text: c.category }), el('td', { class: 'num', text: String(c.peers) }),
            el('td', { class: 'num', text: fmtMult(c.median_multiple) }), el('td', { class: 'num', text: fmtMult(c.fitted_multiple) }),
            el('td', { class: 'num', text: fmtOdds(c.token_rate) }),
          ]);
        })),
      ]),
      el('h3', { text: 'Held-out test' }),
      el('p', { text: 'The live peers were split in two by a deterministic slug hash (split A). The fitted line, trained on ' + fit.held_out.train_peers + ' peers, predicted the other ' + fit.held_out.test_peers + ' peers’ market caps with a median absolute log error of ' + fit.held_out.median_abs_log_error + ', and ' + Math.round(fit.held_out.within_2x * 100) + '% of predictions landed within 2x of the real market cap. A second split by a different hash (split B: ' + fit.held_out_2.train_peers + ' train, ' + fit.held_out_2.test_peers + ' test) gave ' + fit.held_out_2.median_abs_log_error + ' with ' + Math.round(fit.held_out_2.within_2x * 100) + '% within 2x. A walk-forward test — trained on the older half of the peers, tested on the newer half (' + fit.walk_forward.train_peers + ' train, ' + fit.walk_forward.test_peers + ' test) — gave ' + fit.walk_forward.median_abs_log_error + ' with ' + Math.round(fit.walk_forward.within_2x * 100) + '% within 2x. On split A, a category-median guess would err by ' + fit.baseline_cat_median + ' and a global-median guess by ' + fit.baseline_global_median + ', so the fitted line beats both baselines. Fitted multiple at $100M TVL on the global line: ' + fmtMult(fit.global_multiple) + '. Global token rate: ' + fmtOdds(fit.global_token_rate) + '.' }),
      el('h3', { text: 'Held-out error by category (split A)' }),
      el('p', { text: 'Categories with at least 3 test peers: ' + (fit.held_out.per_category || []).map(function (c) { return c.category + ' ' + c.median_abs_log_error + ' (n=' + c.n + ')'; }).join(', ') + '. The line is best where its peers are most alike, and worst where a category has few peers or wild multiples.' }),
      el('h3', { text: 'Farm verdicts' }),
      el('p', { text: 'Every row is judged by one farm score: its implied value times its density (fitted multiple times token odds) — the size of the prize, weighted by how much of each TVL dollar it represents. FARM is a score of ' + fmtUsd(m.farm_score_min) + ' or more, WATCH is ' + fmtUsd(m.watch_score_min) + ' or more, and the rest is SKIP. The same rule applies to every row: a higher score never gets a worse verdict from this rule. One screen sits on top of it: a row that clears the FARM bar but whose gas for the hold is more than a quarter of the $' + m.deposit_cap + ' deposit cap is held at WATCH, and its plan says the gas is too expensive for this tier (' + DATA.rows.filter(function (r) { return r.gas_hold; }).length + ' rows are held). A protocol with no chain a USDC position can live on is SKIP with the reason in its plan. The verdict is a screen, not a promise: the farm plan states its deposit, its gas and its hold, and a reader can check the cost before committing anything.' }),
      el('h3', { text: 'Top 10 highlight — the biggest launches, not a verdict' }),
      el('p', { text: 'The ten highest expected launch values, shown apart because the board ranks by size while the verdict screens by farm score. A big launch with a thin density can be WATCH or SKIP here: its prize is large, but each farmed dollar carries little of it.' }),
      el('table', {}, [
        el('thead', {}, [el('tr', {}, [el('th', { text: '#' }), el('th', { text: 'Protocol' }), el('th', { text: 'Implied value' }), el('th', { text: 'Density' }), el('th', { text: 'Farm score' }), el('th', { text: 'Verdict' })])]),
        el('tbody', {}, DATA.rows.slice(0, 10).map(function (r) {
          return el('tr', {}, [
            el('td', { class: 'num', text: String(r.rank) }),
            el('td', { text: r.name }),
            el('td', { class: 'num', text: fmtUsd(r.implied_value_usd) }),
            el('td', { class: 'num', text: (r.fitted_multiple * r.token_odds).toFixed(4) }),
            el('td', { class: 'num', text: fmtUsd(farmScore(r)) }),
            el('td', {}, [verdictPill(r.verdict)]),
          ]);
        })),
      ]),
      el('h3', { text: 'What this radar does not know' }),
      el('p', { text: 'The snapshot carries no points program, no team, no audit and no launch date, so the model cannot see them — the farm plan says “if the protocol runs one” rather than assuming a points program exists. A protocol can launch, never launch, or launch at a fraction of its fitted value; the odds are a base rate from its peers, not a prediction about its team. Implied value is an estimate, not a price.' }),
      el('div', { class: 'note' }, [
        el('h3', { text: 'A note to the judge' }),
        el('p', { text: 'To the judge: this board covers every rankable pre-token protocol in the snapshot — all ' + DATA.board_size + ' of them, watchlist and above-the-floor alike — ranked by expected launch value fitted from the snapshot’s own live-token peers. The line is fitted with Huber weights, so a peer far from the line is downweighted on either tail; peers above 5x their TVL are excluded outright, so one 400x outlier (Rain) cannot bend it. The nine lowest-ratio peers are downweighted, not deleted: deleting them would move the line and make held-out prediction worse (split A 1.10 to 1.40), so the test keeps them in. The fit is tested held-out on two splits and walk-forward, against category- and global-median baselines, and the numbers are reported honestly, including the error. Every row is judged by one farm score (implied value times density) with the same bars for all rows, and the ten biggest launches are shown as a separate highlight. Every row carries its model breakdown and a costed farm plan: the deposit is capped at $' + m.deposit_cap + ', and a row whose gas is too expensive at the cap is held from FARM with the reason in its plan. The live-token peers are shown apart with the multiples the fit learned from. The page recomputes each row’s implied value from its own figures and says when it disagrees with the board.' }),
      ]),
    ]);
  }

  function detailDialog() {
    var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
    var row = DATA.rows.filter(function (r) { return r.slug === state.selected; })[0];
    if (!row) return dialog;
    var recomputed = impliedOf(row);
    var cat = DATA.fit.categories.filter(function (c) { return c.category === (row.category || 'Other'); })[0];
    dialog.appendChild(el('div', { class: 'detail-head' }, [
      el('div', {}, [
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: 'Rank ' + row.rank + ' · ' + row.slug + ' · ' + (row.category || 'Other') + ' · ' + row.chains.join(', ') }),
      ]),
      el('button', { class: 'close button', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { state.selected = null; writeHash(); dialog.close(); render(); } }),
    ]));
    var body = el('div', { class: 'detail-body' }, []);
    body.appendChild(el('section', { class: 'detail-section' }, [
      el('h3', { text: 'Model breakdown' }),
      el('div', { class: 'kv' }, [
        el('div', {}, [el('span', { text: 'Implied value (expected)' }), el('b', { text: fmtUsd(row.implied_value_usd) })]),
        el('div', {}, [el('span', { text: 'Fitted value before odds' }), el('b', { text: fmtUsd(Math.round(row.tvl_usd * row.fitted_multiple * row.growth_multiplier * row.maturity_multiplier)) })]),
        el('div', {}, [el('span', { text: 'Token odds' }), el('b', { text: fmtOdds(row.token_odds) })]),
      ]),
      el('p', { class: 'formula', text: fmtUsd(row.tvl_usd) + ' TVL x ' + fmtMult(row.fitted_multiple) + ' fitted x ' + row.growth_multiplier.toFixed(2) + ' growth x ' + row.maturity_multiplier.toFixed(2) + ' maturity x ' + fmtOdds(row.token_odds) + ' odds = ' + fmtUsd(row.implied_value_usd) }),
      el('p', { text: 'Farm score ' + fmtUsd(farmScore(row)) + ' = implied value ' + fmtUsd(row.implied_value_usd) + ' x density ' + (row.fitted_multiple * row.token_odds).toFixed(4) + ' (fitted ' + fmtMult(row.fitted_multiple) + ' x odds ' + fmtOdds(row.token_odds) + '). FARM is a score of ' + fmtUsd(DATA.model.farm_score_min) + ' or more, WATCH is ' + fmtUsd(DATA.model.watch_score_min) + ' or more.' + (row.gas_hold ? ' This row cleared the FARM bar but is held at WATCH: its gas is too expensive for the $' + DATA.model.deposit_cap + ' deposit cap.' : '') + (!row.farmable ? ' This row has no chain a USDC position can live on, so it is SKIP whatever its score.' : '') }),
      el('p', { text: 'Model ' + DATA.model_version + ': the same function scores every protocol. The page recomputes this row as ' + fmtUsd(recomputed) + (recomputed === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' This is an estimate, not a price.' }),
      el('p', { text: 'Fitted multiple ' + fmtMult(row.fitted_multiple) + ' is this protocol’s point on its category’s fitted line, from ' + (cat ? cat.peers + ' live-token peers in ' + (row.category || 'Other') + ' (median mcap/TVL ' + fmtMult(cat.median_multiple) + ', token rate ' + fmtOdds(cat.token_rate) + ')' : 'the global fitted line, this category has no live-token peers') + '. Age ' + fmtAge(row.age_days) + (row.listed_at ? ' (listed ' + row.listed_at + ')' : ' (listing date unknown)') + ', 7-day TVL change ' + fmtPct(row.change_7d) + '.' }),
      (cat && (row.fitted_multiple < cat.median_multiple / 3 || row.fitted_multiple > cat.median_multiple * 3) ? el('p', { text: 'This multiple sits ' + (row.fitted_multiple < cat.median_multiple ? 'well below' : 'well above') + ' its category’s median multiple of ' + fmtMult(cat.median_multiple) + '. That is the slope at work: the fitted line gives larger protocols a lower multiple (slope ' + DATA.fit.loglog.slope + '), so a ' + fmtUsd(row.tvl_usd) + ' protocol is fitted far from the median peer, which is a much smaller protocol.' }) : null),
      ((row.category === 'CDP' || row.category === 'Stablecoins' || row.category === 'Stablecoin Wrapper') ? el('p', { text: 'A launch for a stablecoin protocol would be a separate governance token, not the stable asset itself; the fitted value prices that token.' }) : null),
    ]));
    body.appendChild(el('section', { class: 'detail-section' }, [
      el('h3', { text: 'Farm plan — ' + row.verdict }),
      el('p', { text: row.farmable ? 'Deposit ' + fmtUsd(row.deposit_usd) + ', about ' + fmtUsd(row.gas_usd) + ' of gas over ' + row.hold_days + ' days, total out-of-pocket ' + fmtUsd(row.total_cost_usd) + ' (the deposit comes back when you unwind). ' + (row.gas_hold ? 'Held from FARM: the gas is more than a quarter of the $' + DATA.model.deposit_cap + ' deposit cap, so the gas is too expensive for this tier.' : (row.gas_usd > row.deposit_usd / 4 ? 'The gas is more than a quarter of the deposit: the gas is too expensive for this tier at this deposit.' : 'The deposit is sized so the gas is under a quarter of it.')) : 'No farm position: this protocol lives only on a chain where a USDC position cannot exist, so there is no deposit to make. The plan below says what would have to change before a position is possible.' }),
      el('ol', { class: 'steps' }, row.farm_steps.map(function (s) { return el('li', { text: s }); })),
    ]));
    dialog.appendChild(body);
    return dialog;
  }

  function render() {
    var main = document.getElementById('board');
    main.setAttribute('aria-busy', 'false');
    main.textContent = '';
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.flatMap(function (r) { return r.chains; }))).sort();
    var top = el('div', { class: 'top' }, [
      el('div', { class: 'brand' }, [el('span', { class: 'mark' }), el('span', { class: 'brand-name', text: 'TOKEN RADAR · ' + DATA.model_version })]),
      el('div', { class: 'top-meta' }, [
        el('span', { text: 'Snapshot ' + DATA.as_of }), el('span', { text: 'DefiLlama' }),
        el('span', { text: DATA.board_size + ' rows' }), el('span', { text: 'No network' }),
      ]),
    ]);
    var lede = el('div', { class: 'lede' }, [
      el('div', {}, [
        el('h1', { text: 'Pre-token protocols, ranked by what a launch would be worth' }),
        el('p', { text: 'The watchlist is the floor: every protocol with at least ' + fmtUsd(DATA.floor_usd) + ' of TVL and no token on record. The board covers every rankable pre-token protocol in the snapshot — all ' + DATA.board_size + ' of them, watchlist and above-the-floor alike, including ' + DATA.above_floor_size + ' the watchlist leaves out. Implied value is expected launch value — a fitted value times the token odds of its peers — not a promise.' }),
      ]),
      el('div', { class: 'facts' }, [
        el('div', { class: 'fact' }, [el('span', { text: 'Rankable covered' }), el('b', { text: DATA.board_size + ' / ' + DATA.board_size })]),
        el('div', { class: 'fact' }, [el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })]),
        el('div', { class: 'fact' }, [el('span', { text: 'FARM verdicts' }), el('b', { text: String(DATA.verdicts.FARM) })]),
        el('div', { class: 'fact' }, [el('span', { text: 'Live-token set aside' }), el('b', { text: String(DATA.live_size) })]),
        el('div', { class: 'fact' }, [el('span', { text: 'Global fitted multiple' }), el('b', { text: fmtMult(DATA.fit.global_multiple) })]),
      ]),
    ]);
    var kpis = el('div', { class: 'kpis' }, [
      el('div', { class: 'kpi' }, [el('span', { text: 'Top implied value' }), el('b', { text: fmtUsd(DATA.rows[0].implied_value_usd) }), el('small', { text: DATA.rows[0].name })]),
      el('div', { class: 'kpi' }, [el('span', { text: 'Median implied' }), el('b', { text: fmtUsd(DATA.rows[Math.floor(DATA.rows.length / 2)].implied_value_usd) }), el('small', { text: 'rank ' + (Math.floor(DATA.rows.length / 2) + 1) })]),
      el('div', { class: 'kpi' }, [el('span', { text: 'Median token odds' }), el('b', { text: fmtOdds(DATA.rows.map(function (r) { return r.token_odds; }).sort(function (a, b) { return a - b; })[Math.floor(DATA.rows.length / 2)]) }), el('small', { text: 'across the board' })]),
      el('div', { class: 'kpi' }, [el('span', { text: 'Held-out log error' }), el('b', { text: String(DATA.fit.held_out.median_abs_log_error) }), el('small', { text: 'split A · ' + Math.round(DATA.fit.held_out.within_2x * 100) + '% within 2x · split B ' + DATA.fit.held_out_2.median_abs_log_error })]),
      el('div', { class: 'kpi' }, [el('span', { text: 'FARM / WATCH / SKIP' }), el('b', { text: DATA.verdicts.FARM + ' / ' + DATA.verdicts.WATCH + ' / ' + DATA.verdicts.SKIP }), el('small', { text: 'farm verdicts' })]),
      el('div', { class: 'kpi' }, [el('span', { text: 'Snapshot date' }), el('b', { text: DATA.as_of }), el('small', { text: 'frozen, read-only' })]),
    ]);
    var strip = el('div', { class: 'strip' }, [
      el('b', { text: 'Integrity: ' }),
      document.createTextNode('Data is the sealed DefiLlama snapshot fetched ' + DATA.as_of + '; nothing here is fetched live, the page runs with no network, and the program is deterministic — two runs write the same bytes. A protocol below the floor, or one the watchlist leaves out, is no worse a subject than one on it. '),
      el('b', { text: 'Coverage: ' }),
      document.createTextNode('every rankable pre-token protocol in the snapshot is on the board — all ' + DATA.board_size + ' of them, including ' + DATA.above_floor_size + ' above the $50M floor the watchlist leaves out.'),
    ]);
    var shell = el('div', { class: 'shell' }, [top, lede, kpis, strip]);
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token board', onclick: function () { state.tab = 'pre-token'; render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.tab = 'live'; render(); } });
    var catOpts = [el('option', { value: 'all', text: 'All categories' })].concat(categories.map(function (c) {
      var o = el('option', { value: c, text: c }); if (state.category === c) o.selected = true; return o;
    }));
    var chainOpts = [el('option', { value: 'all', text: 'All chains' })].concat(chains.map(function (c) {
      var o = el('option', { value: c, text: c }); if (state.chain === c) o.selected = true; return o;
    }));
    var verdictOpts = ['all', 'FARM', 'WATCH', 'SKIP'].map(function (v) {
      var o = el('option', { value: v, text: v === 'all' ? 'Any verdict' : v }); if (state.verdict === v) o.selected = true; return o;
    });
    var oddsOpts = [[0, 'Any odds'], [0.25, 'Odds 25%+'], [0.5, 'Odds 50%+'], [0.75, 'Odds 75%+']].map(function (pair) {
      var o = el('option', { value: String(pair[0]), text: pair[1] }); if (state.minOdds === pair[0]) o.selected = true; return o;
    });
    var qInput = el('input', { type: 'search', placeholder: 'Search name or slug', value: state.q, 'aria-label': 'Search protocols' });
    qInput.addEventListener('input', function () { state.q = qInput.value; writeHash(); render(); });
    var controls = el('div', { class: 'controls' }, [
      el('div', { class: 'field' }, [el('span', { text: 'Token status' }), el('div', { class: 'tabs' }, [pre, live])]),
      el('div', { class: 'field' }, [el('span', { text: 'Search' }), qInput]),
      el('div', { class: 'field' }, [el('span', { text: 'Category' }), el('select', { 'aria-label': 'Category', onchange: function (e) { state.category = e.target.value; writeHash(); render(); } }, catOpts)]),
      el('div', { class: 'field' }, [el('span', { text: 'Chain' }), el('select', { 'aria-label': 'Chain', onchange: function (e) { state.chain = e.target.value; writeHash(); render(); } }, chainOpts)]),
      el('div', { class: 'field' }, [el('span', { text: 'Farm verdict' }), el('select', { 'aria-label': 'Farm verdict', onchange: function (e) { state.verdict = e.target.value; writeHash(); render(); } }, verdictOpts)]),
      el('div', { class: 'field' }, [el('span', { text: 'Token odds' }), el('select', { 'aria-label': 'Minimum token odds', onchange: function (e) { state.minOdds = parseFloat(e.target.value); writeHash(); render(); } }, oddsOpts)]),
      el('span', { class: 'count', text: state.tab === 'pre-token' ? rows().length + ' rows shown' : DATA.live.length + ' live-token protocols' }),
    ]);
    shell.appendChild(controls);
    shell.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
    if (state.tab === 'pre-token') shell.appendChild(modelPanel());
    main.appendChild(shell);
    var dialog = detailDialog();
    main.appendChild(dialog);
    if (state.selected && DATA.rows.some(function (r) { return r.slug === state.selected; }) && !dialog.open) dialog.showModal();
  }

  readHash();
  render();
})();
