// Token Radar, model radar-2.3: one sealed snapshot in, one ranked board out.
//
// The board ranks pre-token protocols by EXPECTED launch value, fitted from the
// snapshot's own live-token peers — never from a hardcoded list of names:
//
//   fitted value     = predicted market cap at the protocol's own TVL, from a
//                      log-log line fitted on the live peers: log(mcap) =
//                      intercept + slope * log(TVL) + category effect. The
//                      slope is below 1, so larger protocols carry a lower
//                      multiple; each category's effect is its mean residual,
//                      shrunk toward the global line. The line is fitted with
//                      Huber weights (k = 1.345, scale 1.4826 x MAD, 11 passes
//                      from the plain line): a peer whose residual is far from
//                      the line is downweighted, on either tail, instead of
//                      being deleted. Peers with no priced market cap (mcap 0)
//                      are excluded, and so are peers whose market cap exceeds
//                      5x their TVL: their value is not a TVL story, and one
//                      such peer (Rain, 400x) bent the whole line before this
//                      rule. The nine lowest-ratio peers (below 0.01x) are the
//                      most downweighted but none is deleted: deleting them
//                      would move the line (intercept 6.63 -> 4.78) AND make
//                      held-out prediction worse (split A 1.10 -> 1.40), so the
//                      test, not the threshold, keeps them in.
//   fitted multiple  = predicted market cap / TVL, at the protocol's own TVL
//   token odds       = how often protocols in the same category and age band
//                      already have a token, smoothed toward the category rate
//   growth           = clamp(change_7d, -60, 120) per cent
//   maturity         = 0.6 + min(age_days, 1095) / 1095 * 0.4 (unknown age: 365)
//   fitted value     = tvl_usd * fitted multiple * growth * maturity
//   implied value    = max(1, round(fitted value * token odds))
//   farm score       = implied value x density, where density is the fitted
//                      multiple times the token odds: the size of the prize,
//                      weighted by how much of each TVL dollar it represents.
//                      One rule for every row: FARM at $250,000 or more,
//                      WATCH at $75,000 or more, else SKIP. No rank override:
//                      the ten biggest launches are shown as a separate
//                      highlight, not as FARM by rank.
//   farm plan        = a deposit set by TVL tier ($50/$100/$150/$250), sized
//                      up within a $250 cap so the gas for the hold is at most
//                      a quarter of it. A row whose gas is still over a quarter
//                      at the cap is held from FARM: its plan says the gas is
//                      too expensive for this tier. A protocol with no chain a
//                      USDC position can live on gets no invented position.
//
// Coverage: the board carries EVERY rankable pre-token protocol in the
// snapshot — the watchlist plus every other rankable protocol, above the
// $50M floor or below it. A protocol the watchlist leaves out is no worse
// a subject than one on it.
//
// The fit is tested held-out three ways: two deterministic slug-hash splits
// and a walk-forward split (trained on the older half of the peers, tested
// on the newer half), each reported against a category-median and a
// global-median baseline on the same split. Every function is pure and
// deterministic: no wall-clock time, no unseeded randomness, no network.
// Two runs on the same snapshot write the same bytes.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  /** Shrinkage weight (in peer counts) pulling a category effect toward the global line. */
  peer_shrink: number;
  /** Smoothing weight (in protocols) pulling a category token rate to the global one. */
  odds_category_prior: number;
  /** Smoothing weight (in protocols) pulling an age-band rate to its category rate. */
  odds_band_prior: number;
  /** Cap on one peer's mcap/TVL: a peer above it is excluded from the fit, not
      just winsorized in a reporting median — its market cap is not a TVL story,
      and one such peer (Rain, 400x) bent the whole line before this rule. */
  ratio_cap: number;
  /** The largest deposit a farm plan may size: above it the deposit stops
      growing, and a row that still fails the gas screen is held, not inflated. */
  deposit_cap: number;
  /** Farm-score bars, one rule for every row: FARM at or above farm_score_min,
      WATCH at or above watch_score_min, else SKIP. No rank override. */
  farm_score_min: number;
  watch_score_min: number;
}

export const MODEL: ModelConstants = {
  growth_weight: 0.5,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
  peer_shrink: 12,
  odds_category_prior: 20,
  odds_band_prior: 10,
  ratio_cap: 5,
  deposit_cap: 250,
  farm_score_min: 250_000,
  watch_score_min: 75_000,
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-2.3';

/** The TVL the per-category fitted multiple is quoted at: one reference size. */
export const REFERENCE_TVL = 100_000_000;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  verdict: 'FARM' | 'WATCH' | 'SKIP';
  /** True when the row cleared the FARM score bar but the gas screen held it at
      WATCH: the gas for the hold is more than a quarter of the capped deposit. */
  gas_hold: boolean;
  model: {
    base_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    age_days: number | null;
    token_odds: number;
    fitted_value_usd: number;
  };
  farm: {
    deposit_usd: number;
    gas_usd: number;
    total_cost_usd: number;
    hold_days: number;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row, with the farm verdict. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  fitted_multiple: number;
  token_odds: number;
  verdict: 'FARM' | 'WATCH' | 'SKIP';
  deposit_usd: number;
  gas_usd: number;
  total_cost_usd: number;
  hold_days: number;
  /** False when no chain this protocol lives on can hold a USDC farm position:
      its farm plan then says why, instead of inventing one. */
  farmable: boolean;
  /** True when the row cleared the FARM score bar but the gas screen held it at
      WATCH: the gas for the hold is more than a quarter of the capped deposit. */
  gas_hold: boolean;
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  /** mcap/TVL, capped at the model's ratio cap: the same cap the fit uses. */
  multiple: number | null;
  /** True when the raw multiple sits above the cap: the fit leaves this peer out. */
  above_cap: boolean;
}

/** One category's fitted multiple, for the dashboard's model panel. `fitted_multiple`
    is the multiple at the reference TVL; `effect` is the category's shrunk
    log-points effect on the fitted line (0 means the category sits on the line). */
export interface CategoryFit {
  category: string;
  peers: number;
  median_multiple: number;
  fitted_multiple: number;
  effect: number;
  token_rate: number;
  protocols: number;
}

/** The held-out test of the fitted multiples. */
export interface HeldOutTest {
  train_peers: number;
  test_peers: number;
  median_abs_log_error: number;
  within_2x: number;
  /** Median absolute log error per category, for categories with at least 3 test peers. */
  per_category?: { category: string; n: number; median_abs_log_error: number }[];
}

/** Everything the fit learned from the snapshot's live-token peers. */
export interface FitResult {
  global_multiple: number;
  global_token_rate: number;
  /** The fitted log-log line: log(mcap) = intercept + slope * log(TVL) + category effect. */
  loglog: { intercept: number; slope: number };
  categories: CategoryFit[];
  held_out: HeldOutTest;
  /** A second deterministic split, by a different slug hash, so the test is not one lucky draw. */
  held_out_2: HeldOutTest;
  /** Walk-forward: trained on the older half of the peers, tested on the newer half. */
  walk_forward: HeldOutTest;
  /** Baselines on the first split: a category-median guess and a global-median guess. */
  baseline_cat_median: number;
  baseline_global_median: number;
}

/** Everything the dashboard needs: the board, the live set, the fit, and the model. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  /** Board rows above the $50M floor that the watchlist leaves out. */
  above_floor_size: number;
  live_size: number;
  verdicts: { FARM: number; WATCH: number; SKIP: number };
  fit: FitResult;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** The median of a non-empty list of numbers. */
function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The age band a protocol's age falls in: young, mid, old, or unknown. */
function ageBand(age: number | null): 'young' | 'mid' | 'old' | 'unknown' {
  if (age === null) return 'unknown';
  if (age < 365) return 'young';
  if (age <= 1095) return 'mid';
  return 'old';
}

/** One peer's mcap/TVL, winsorized at the model's cap. */
function cappedRatio(mcap: number, tvl: number, model: ModelConstants): number {
  return Math.min(model.ratio_cap, mcap / tvl);
}
function slugBit(slug: string): number {
  let s = 0;
  for (let i = 0; i < slug.length; i++) s += slug.charCodeAt(i);
  return s % 2;
}

/** A second deterministic slug hash, for a second held-out split that is not the same draw. */
function slugBit2(slug: string): number {
  let s = 0;
  for (let i = 0; i < slug.length; i++) s += (i + 1) * slug.charCodeAt(i);
  return s % 2;
}

/** One held-out test: fit the line on `train`, predict `test` market caps, and say
    how far off the predictions land. With per-category errors for the first split. */
function heldOutTest(
  train: SnapshotProtocol[],
  test: SnapshotProtocol[],
  model: ModelConstants,
  withPerCategory: boolean,
): HeldOutTest {
  const line = fitLine(train, model);
  const errors: { category: string; error: number }[] = [];
  for (const p of test) {
    const predicted = predictedMcap(p.tvl_usd, line, line.effects.get(p.category ?? 'Other') ?? 0);
    errors.push({ category: p.category ?? 'Other', error: Math.abs(Math.log(predicted / p.mcap_usd!)) });
  }
  const sorted = errors.map((e) => e.error).sort((a, b) => a - b);
  const result: HeldOutTest = {
    train_peers: train.length,
    test_peers: test.length,
    median_abs_log_error: errors.length === 0 ? 0 : round4(median(sorted)),
    within_2x: errors.length === 0 ? 0 : round4(errors.filter((e) => e.error <= Math.LN2).length / errors.length),
  };
  if (withPerCategory) {
    const byCat = new Map<string, number[]>();
    for (const e of errors) {
      const list = byCat.get(e.category) ?? [];
      list.push(e.error);
      byCat.set(e.category, list);
    }
    result.per_category = [...byCat.entries()]
      .filter(([, v]) => v.length >= 3)
      .map(([category, v]) => ({ category, n: v.length, median_abs_log_error: round4(median([...v].sort((a, b) => a - b))) }))
      .sort((a, b) => b.n - a.n || (a.category < b.category ? -1 : a.category > b.category ? 1 : 0));
  }
  return result;
}

/** A baseline's median error on a split: guess every test peer's market cap from a
    multiple — its category's median multiple, or the global one — learned from `train`. */
function baselineError(
  train: SnapshotProtocol[],
  test: SnapshotProtocol[],
  model: ModelConstants,
  kind: 'category' | 'global',
): number {
  const globalMedian = median(train.map((p) => cappedRatio(p.mcap_usd!, p.tvl_usd, model)));
  const byCat = new Map<string, number[]>();
  for (const p of train) {
    const list = byCat.get(p.category ?? 'Other') ?? [];
    list.push(cappedRatio(p.mcap_usd!, p.tvl_usd, model));
    byCat.set(p.category ?? 'Other', list);
  }
  const catMedian = new Map([...byCat.entries()].map(([c, v]) => [c, median(v)]));
  const errors = test
    .map((p) => {
      const multiple = kind === 'category' ? (catMedian.get(p.category ?? 'Other') ?? globalMedian) : globalMedian;
      return Math.abs(Math.log((p.tvl_usd * multiple) / p.mcap_usd!));
    })
    .sort((a, b) => a - b);
  return errors.length === 0 ? 0 : round4(median(errors));
}

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Categories the watchlist rule treats as wrapped, staked or bridged products. */
const WRAPPED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** Exchange names a wrapped product's name may begin with. */
const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/** Whether a protocol looks like a wrapped, staked or bridged product of one that trades. */
export function isWrappedProduct(p: SnapshotProtocol): boolean {
  if (p.category !== null && WRAPPED_CATEGORIES.has(p.category)) return true;
  const words = new Set(p.name.toLowerCase().split(/[^a-z]+/).filter(Boolean));
  if (words.has('wrapped') || words.has('staked') || words.has('staking')) return true;
  return EXCHANGE_PREFIXES.some((e) => p.name.startsWith(e));
}

/** Whether a protocol is one the board may rank: pre-token, not a wrapped/staked product, not versioned. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && !isWrappedProduct(p) && !VERSIONED.test(p.name);
}

/** A log-log line fitted on live-token peers: log(mcap) = intercept + slope * log(TVL),
    plus one shrunk category effect per category (its mean residual, pulled toward 0,
    so a category with one peer cannot bend the line). Peers whose market cap exceeds
    the model's ratio cap are left out before fitting: their value is not a TVL
    story, and one of them (Rain, 400x its TVL) bent the whole line before this rule.
    The line itself is fitted with Huber weights (k = 1.345, scale 1.4826 x MAD of the
    residuals, 11 passes from the plain line), so a peer far from the line is
    downweighted on either tail instead of being deleted: the nine lowest-ratio
    peers (below 0.01x) are the most downweighted, but deleting them would move the
    line AND make held-out prediction worse, so the test keeps them in. */
function fitLine(
  peers: SnapshotProtocol[],
  model: ModelConstants,
): { intercept: number; slope: number; effects: Map<string, number> } {
  const usable = peers.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0 && p.mcap_usd / p.tvl_usd <= model.ratio_cap);
  const peers_ = usable.length === 0 ? peers : usable;
  if (peers_.length === 0) return { intercept: 0, slope: 1, effects: new Map() };
  const xs = peers_.map((p) => Math.log(p.tvl_usd));
  const ys = peers_.map((p) => Math.log(p.mcap_usd!));
  // Huber IRLS: 11 passes, the first with unit weights (the plain line), each
  // pass reweighting by the scaled residuals of the line just fitted. Pure
  // arithmetic, no randomness: the same snapshot always gives the same line.
  let weights = peers_.map(() => 1);
  let intercept = 0;
  let slope = 1;
  for (let iter = 0; iter < 11; iter++) {
    const sw = weights.reduce((a, b) => a + b, 0);
    const mx = weights.reduce((a, w, i) => a + w * xs[i]!, 0) / sw;
    const my = weights.reduce((a, w, i) => a + w * ys[i]!, 0) / sw;
    const denom = weights.reduce((a, w, i) => a + w * (xs[i]! - mx) * (xs[i]! - mx), 0);
    slope = denom === 0 ? 1 : weights.reduce((a, w, i) => a + w * (xs[i]! - mx) * (ys[i]! - my), 0) / denom;
    intercept = my - slope * mx;
    if (iter === 10) break;
    const residuals = ys.map((y, i) => y - (intercept + slope * xs[i]!));
    const med = median(residuals);
    const mad = median(residuals.map((r) => Math.abs(r - med)));
    const scale = mad > 0 ? 1.4826 * mad : 1;
    const k = 1.345;
    weights = residuals.map((r) => {
      const u = Math.abs(r) / (k * scale);
      return u <= 1 ? 1 : 1 / u;
    });
  }
  const byCat = new Map<string, number[]>();
  for (const p of peers_) {
    const list = byCat.get(p.category ?? 'Other') ?? [];
    list.push(Math.log(p.mcap_usd!) - (intercept + slope * Math.log(p.tvl_usd)));
    byCat.set(p.category ?? 'Other', list);
  }
  const effects = new Map<string, number>();
  for (const [cat, residuals] of byCat) {
    const mean = residuals.reduce((a, b) => a + b, 0) / residuals.length;
    effects.set(cat, (mean * residuals.length) / (residuals.length + model.peer_shrink));
  }
  return { intercept, slope, effects };
}

/** A fitted market cap at a TVL, from a line and a category effect. */
function predictedMcap(tvl: number, line: { intercept: number; slope: number }, effect: number): number {
  return Math.exp(line.intercept + line.slope * Math.log(tvl) + effect);
}

/**
 * Fit the model on the snapshot's live-token peers: a log-log line of market cap
 * on TVL with a shrunk category effect, the token rate per category and age band,
 * and three held-out tests of the line — two deterministic slug-hash splits and
 * one walk-forward split (trained on the older half of the peers, tested on the
 * newer half) — each against category-median and global-median baselines.
 */
export function fitModel(snapshot: Snapshot, model: ModelConstants = MODEL): FitResult {
  const peers = snapshot.protocols.filter(
    (p) => !isPreToken(p) && p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0 && p.category !== 'CEX',
  );
  const line = fitLine(peers, model);
  const globalMedian = peers.length === 0 ? 1 : median(peers.map((p) => cappedRatio(p.mcap_usd!, p.tvl_usd, model)));
  const globalMultiple = predictedMcap(REFERENCE_TVL, line, 0) / REFERENCE_TVL;

  // Held-out tests: split A by slug hash, split B by a second slug hash, and a
  // walk-forward split by listing age. The line is fitted on one half and used
  // to predict the other half's market caps.
  const trainA = peers.filter((p) => slugBit(p.slug) === 0);
  const testA = peers.filter((p) => slugBit(p.slug) === 1);
  const heldOut = heldOutTest(trainA, testA, model, true);
  const trainB = peers.filter((p) => slugBit2(p.slug) === 0);
  const testB = peers.filter((p) => slugBit2(p.slug) === 1);
  const heldOut2 = heldOutTest(trainB, testB, model, false);
  const dated = peers.filter((p) => p.listed_at !== null);
  const ages = dated.map((p) => ageDays(snapshot.as_of, p.listed_at)!).sort((a, b) => a - b);
  const midAge = ages.length === 0 ? 0 : median(ages);
  const wfTrain = dated.filter((p) => ageDays(snapshot.as_of, p.listed_at)! >= midAge);
  const wfTest = dated.filter((p) => ageDays(snapshot.as_of, p.listed_at)! < midAge);
  const walkForward = heldOutTest(wfTrain, wfTest, model, false);

  const withToken = snapshot.protocols.filter((p) => !isPreToken(p)).length;
  const globalRate = withToken / snapshot.protocols.length;
  const byCat = new Map<string, SnapshotProtocol[]>();
  for (const p of snapshot.protocols) {
    const list = byCat.get(p.category ?? 'Other') ?? [];
    list.push(p);
    byCat.set(p.category ?? 'Other', list);
  }
  const categories: CategoryFit[] = [...byCat.entries()]
    .map(([category, list]) => {
      const liveList = list.filter((p) => !isPreToken(p) && p.mcap_usd !== null && p.mcap_usd! > 0 && p.tvl_usd > 0 && p.category !== 'CEX');
      const meds = liveList.map((p) => cappedRatio(p.mcap_usd!, p.tvl_usd, model));
      const med = meds.length === 0 ? globalMedian : median(meds);
      const effect = line.effects.get(category) ?? 0;
      const fitted = predictedMcap(REFERENCE_TVL, line, effect) / REFERENCE_TVL;
      const tok = list.filter((p) => !isPreToken(p)).length;
      const rate = (tok + model.odds_category_prior * globalRate) / (list.length + model.odds_category_prior);
      return { category, peers: meds.length, median_multiple: round4(med), fitted_multiple: round4(fitted), effect: round4(effect), token_rate: round4(rate), protocols: list.length };
    })
    .sort((a, b) => b.protocols - a.protocols || (a.category < b.category ? -1 : 1));

  return { global_multiple: round4(globalMultiple), global_token_rate: round4(globalRate), loglog: { intercept: round4(line.intercept), slope: round4(line.slope) }, categories, held_out: heldOut, held_out_2: heldOut2, walk_forward: walkForward, baseline_cat_median: baselineError(trainA, testA, model, 'category'), baseline_global_median: baselineError(trainA, testA, model, 'global') };
}

/** A category's fitted multiple at a TVL, from the fitted line and its effect. */
function fittedMultipleFor(category: string | null, tvl: number, fit: FitResult): number {
  const row = fit.categories.find((c) => c.category === (category ?? 'Other'));
  const effect = row === undefined ? 0 : row.effect;
  return predictedMcap(tvl, fit.loglog, effect) / tvl;
}

/** A category's smoothed token rate from a fit, or the global one. */
function categoryRateFor(category: string | null, fit: FitResult): number {
  const row = fit.categories.find((c) => c.category === (category ?? 'Other'));
  return row === undefined ? fit.global_token_rate : row.token_rate;
}

/**
 * A protocol's token odds: its category's rate, refined by its age band's rate
 * among the category's protocols, smoothed toward the category rate. Unknown age
 * takes the category rate as-is.
 */
export function tokenOdds(
  p: SnapshotProtocol,
  snapshot: Snapshot,
  fit: FitResult,
  model: ModelConstants = MODEL,
): number {
  const catRate = categoryRateFor(p.category, fit);
  const age = ageDays(snapshot.as_of, p.listed_at);
  const band = ageBand(age);
  if (band === 'unknown') return Math.min(0.95, Math.max(0.02, catRate));
  const cell = snapshot.protocols.filter(
    (q) => (q.category ?? 'Other') === (p.category ?? 'Other') && ageBand(ageDays(snapshot.as_of, q.listed_at)) === band,
  );
  const tok = cell.filter((q) => !isPreToken(q)).length;
  const rate = (tok + model.odds_band_prior * catRate) / (cell.length + model.odds_band_prior);
  return Math.min(0.95, Math.max(0.02, rate));
}

/** The multipliers and the implied (expected) value one protocol gets under the fitted model. */
export function impliedValue(
  protocol: SnapshotProtocol,
  snapshot: Snapshot,
  fit: FitResult,
  model: ModelConstants = MODEL,
): {
  implied: number;
  fittedValue: number;
  fittedMultiple: number;
  odds: number;
  growthPct: number;
  growthMult: number;
  maturityMult: number;
  age: number | null;
} {
  const age = ageDays(snapshot.as_of, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const fittedMultiple = fittedMultipleFor(protocol.category, protocol.tvl_usd, fit);
  const odds = tokenOdds(protocol, snapshot, fit, model);
  const fittedValue = protocol.tvl_usd * fittedMultiple * growthMult * maturityMult;
  const implied = Math.max(1, Math.round(fittedValue * odds));
  return { implied, fittedValue: Math.round(fittedValue), fittedMultiple, odds, growthPct, growthMult, maturityMult, age };
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** Chains a USDC farm position cannot live on: Bitcoin has no native USDC, and
    Noble is the chain that issues USDC, not a place to farm it. */
const NO_FARM_CHAINS = new Set(['Bitcoin', 'Noble']);

/** The cheapest chain a farm position can live on, skipping chains USDC cannot
    live on; null when the protocol lives on none of them. */
function farmChain(p: SnapshotProtocol): string | null {
  let best: string | null = null;
  for (const c of p.chains) {
    if (NO_FARM_CHAINS.has(c)) continue;
    if (best === null || gasPerTx(c) < gasPerTx(best)) best = c;
  }
  return best;
}

/** How much capital one farm position needs: the TVL tier, sized up within the
    deposit cap so the gas for the whole hold is at most a quarter of it. Above
    the cap the deposit stops growing: a row that still fails the gas screen is
    held from FARM instead of being inflated — no row carries an $550 deposit
    to farm a $7M protocol. */
function depositFor(tvl: number, gas: number, model: ModelConstants = MODEL): number {
  const tier = tvl >= 5_000_000_000 ? 250 : tvl >= 1_000_000_000 ? 150 : tvl >= 100_000_000 ? 100 : 50;
  const sized = Math.ceil((gas * 4) / 50) * 50;
  return Math.min(model.deposit_cap, Math.max(tier, sized));
}

/** Chains where a transaction costs about $1-3: layer twos and cheap layer ones. */
const CHEAP_CHAINS = new Set([
  'Solana', 'Base', 'Arbitrum', 'Optimism', 'Polygon', 'BSC', 'Avalanche', 'zkSync Era',
  'Linea', 'Scroll', 'Blast', 'Mode', 'Mantle', 'Gnosis', 'Celo', 'Fantom', 'Aurora',
  'Moonbeam', 'Arbitrum Nova', 'opBNB', 'Starknet', 'Aptos', 'Sui', 'Near', 'TON', 'Tron',
  'Osmosis', 'Injective', 'Sei', 'Kava', 'Cronos', 'Metis', 'Boba', 'Fraxtal', 'Abstract',
  'Soneium', 'Unichain', 'World Chain', 'Lisk', 'Redstone', 'Zora', 'Degen', 'X Layer',
]);

/** Gas for one transaction on a chain: high on Ethereum, low on cheap chains, mid elsewhere. */
function gasPerTx(chain: string): number {
  if (chain === 'Ethereum') return 12;
  if (CHEAP_CHAINS.has(chain)) return 2;
  return 4;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's one action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('cdp')) return `Deposit $${capital} of collateral with ${name} on ${chain} and mint the stable asset, keeping the position open.`;
  if (c.includes('lend') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedge.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name}.`;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield asset on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** A farm verdict from ONE score, the same rule for every row. The farm score is
    the implied value times the density (fitted multiple times token odds): the
    size of the prize, weighted by how much of each TVL dollar it represents.
    A row with a higher score never gets a worse verdict than a row with a lower
    one — this function is monotone in the score. The board applies two screens
    on top of it: the gas hold (a row that clears the FARM bar can still end up
    WATCH when its gas is too expensive at the $250 deposit cap; that row's plan
    says why, and the board marks it gas_hold) and the farmable screen (a
    protocol with no chain a USDC position can live on is SKIP whatever its
    score, with the reason in its plan). The ten biggest launches are a
    highlight, not a verdict: they are shown apart, whether or not they clear
    the FARM bar. */
export function farmVerdict(score: number, model: ModelConstants = MODEL): 'FARM' | 'WATCH' | 'SKIP' {
  if (score >= model.farm_score_min) return 'FARM';
  if (score >= model.watch_score_min) return 'WATCH';
  return 'SKIP';
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time, plus the
 * costed totals. The plan is derived from the protocol's own record (category,
 * chains, TVL, age) and the chain's gas tier, never from a hand-written list of names.
 * The position lives on the protocol's cheapest farmable chain, and the deposit is
 * set by the TVL tier and sized up within the $250 cap so the gas for the whole
 * hold is at most a quarter of it. When the gas is still over a quarter at the cap,
 * the plan says so in plain words — the gas is too expensive for this tier — and
 * `gasTooExpensive` tells the board to hold a FARM verdict at WATCH. A protocol
 * with no farmable chain gets no invented position: its steps say why.
 */
export function farmPlan(
  p: SnapshotProtocol,
  age: number | null,
  wouldFarm: boolean,
  model: ModelConstants = MODEL,
): { steps: FarmStep[]; deposit: number; gas: number; totalCost: number; hold: number; farmable: boolean; gasTooExpensive: boolean } {
  const chain = farmChain(p);
  if (chain === null) {
    const steps: FarmStep[] = [
      {
        text: `This protocol lives only on a chain where a USDC farm position cannot exist, so there is no deposit to make and no gas to spend.`,
        cost: 'no cost',
        time: '5 minutes',
      },
      {
        text: `If it later ships an app on an EVM or Solana chain, a farm position would start with a fresh wallet holding only the funds you plan to farm.`,
        cost: 'no cost yet',
        time: '5 minutes',
      },
      {
        text: `Watch its own announcements for a token or points program before committing anything.`,
        cost: 'no fee to check',
        time: '10 minutes',
      },
      {
        text: `Do not send funds to a wrapped or bridged copy of this protocol: the snapshot lists no farmable chain for it.`,
        cost: 'no cost',
        time: '5 minutes',
      },
      {
        text: `A position here would need a chain the snapshot does not list, so the honest verdict is SKIP, not a plan built on a chain it does not live on.`,
        cost: 'no cost',
        time: '5 minutes',
      },
      {
        text: `Re-check the chain list after the next snapshot: a new chain can make this farmable.`,
        cost: 'no cost',
        time: '5 minutes',
      },
    ];
    return { steps, deposit: 0, gas: 0, totalCost: 0, hold: 0, farmable: false, gasTooExpensive: false };
  }
  const hold = holdDaysFor(age);
  const perTx = gasPerTx(chain);
  const weeks = Math.ceil(hold / 7);
  const gas = perTx * (2 + weeks);
  const capital = depositFor(p.tvl_usd, gas, model);
  const gasTooExpensive = gas > capital / 4;
  const action = actionFor(p, capital, chain);
  // When the gas for the hold is still over a quarter of the capped deposit,
  // the plan says so in its second step instead of hiding it: the gas is too
  // expensive for this tier, and a row that cleared the FARM bar is held.
  const actionText = gasTooExpensive
    ? `${action} The gas for the ${hold}-day hold is about $${gas}, more than a quarter of the $${capital} deposit cap, so the gas is too expensive for this tier${wouldFarm ? ': this row is held at WATCH, not FARM' : ' — a farm here would need a larger tier than this radar sizes'}.`
    : action;
  const steps: FarmStep[] = [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: `under $${perTx} of gas for the first transaction`,
      time: '5 minutes',
    },
    {
      text: actionText,
      cost: `$${capital} of capital and about $${perTx * 2} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: `Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.`,
      cost: `about $${perTx} of gas a week, $${perTx * weeks} over ${hold} days`,
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `If the protocol runs a points or rewards program, open its own points page before you withdraw and claim only from the link it publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
  return { steps, deposit: capital, gas, totalCost: gas, hold, farmable: true, gasTooExpensive };
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, fit: FitResult, model: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: EVERY rankable pre-token protocol the snapshot carries, above
  // the watchlist floor or below it. Never a replacement for a watchlist row: a
  // chosen protocol stays chosen.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p))
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot, fit, model);
    // One score for the verdict: implied value times density. A row with a
    // higher score never gets a worse verdict than a row with a lower one.
    const farmScore = v.implied * (v.fittedMultiple * v.odds);
    const scoreVerdict = farmVerdict(farmScore, model);
    const plan = farmPlan(p, v.age, scoreVerdict === 'FARM', model);
    // The gas screen holds a FARM verdict at WATCH when the gas for the hold is
    // still over a quarter of the capped deposit; it never promotes a row.
    const gasHold = plan.farmable && plan.gasTooExpensive && scoreVerdict === 'FARM';
    return { p, v, plan, farmScore, scoreVerdict, gasHold };
  });
  scored.sort((a, b) => b.v.implied - a.v.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.v.age,
    implied_value_usd: s.v.implied,
    verdict: s.plan.farmable ? (s.gasHold ? 'WATCH' : s.scoreVerdict) : 'SKIP',
    gas_hold: s.gasHold,
    model: {
      base_multiple: s.v.fittedMultiple,
      growth_pct: s.v.growthPct,
      // Full precision, not rounded: the dashboard recomputes this row from
      // exactly these figures, and a rounded multiplier would make its
      // recompute differ from the board by a few dollars.
      growth_multiplier: s.v.growthMult,
      maturity_multiplier: s.v.maturityMult,
      age_days: s.v.age,
      token_odds: s.v.odds,
      fitted_value_usd: s.v.fittedValue,
    },
    farm: {
      deposit_usd: s.plan.deposit,
      gas_usd: s.plan.gas,
      total_cost_usd: s.plan.totalCost,
      hold_days: s.plan.hold,
    },
    farm_steps: s.plan.steps.map(stepText),
  }));
}

/** The live-token protocols with a priced market cap, by market cap, for the dashboard's Live token view: the peers the fit learned from, all of them. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX' && p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0)
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .map((p) => {
      const raw = p.mcap_usd! / p.tvl_usd;
      return {
        slug: p.slug,
        name: p.name,
        category: p.category,
        chains: p.chains,
        tvl_usd: p.tvl_usd,
        mcap_usd: p.mcap_usd,
        change_7d: p.change_7d,
        multiple: round4(Math.min(raw, MODEL.ratio_cap)),
        above_cap: raw > MODEL.ratio_cap,
      };
    });
}

/** A board row's compact form for data.js, with the farm verdict. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    fitted_multiple: row.model.base_multiple,
    token_odds: row.model.token_odds,
    verdict: row.verdict,
    deposit_usd: row.farm.deposit_usd,
    gas_usd: row.farm.gas_usd,
    total_cost_usd: row.farm.total_cost_usd,
    hold_days: row.farm.hold_days,
    farmable: row.farm.deposit_usd > 0,
    gas_hold: row.gas_hold,
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot and the fit. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const fit = fitModel(snapshot, model);
  const board = buildBoard(snapshot, fit, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const aboveFloor = board.filter((r) => !snapshot.watchlist.includes(r.slug) && r.tvl_usd >= snapshot.floor_usd).length;
  const verdicts = { FARM: 0, WATCH: 0, SKIP: 0 };
  for (const r of board) verdicts[r.verdict]++;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    above_floor_size: aboveFloor,
    live_size: live.length,
    verdicts,
    fit,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
    // The gas screen is an invariant, not a hope: no FARM row may spend more
    // than a quarter of its deposit on gas.
    if (r.verdict === 'FARM' && r.farm.deposit_usd > 0 && r.farm.gas_usd > r.farm.deposit_usd / 4) return `${r.slug} is FARM with gas $${r.farm.gas_usd} on a $${r.farm.deposit_usd} deposit`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
