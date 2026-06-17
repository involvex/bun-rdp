/**
 * Adaptive Bitrate Controller
 *
 * Adjusts encoder bitrate based on measured round-trip time (RTT).
 * Uses an AIMD algorithm (Additive Increase / Multiplicative Decrease):
 *   - RTT within target band  → increase bitrate by STEP_UP
 *   - RTT above warning band  → decrease bitrate by factor STEP_DOWN
 *   - RTT above critical band → drop to MIN_BITRATE immediately
 *
 * The controller emits a new bitrate recommendation via onBitrateChange()
 * whenever the bitrate changes. Wire it to H264Encoder.setBitrate().
 */

export interface ABRConfig {
  /** Starting bitrate in bits/s (default: 2_000_000) */
  initialBitrate?:  number;
  /** Minimum bitrate (default: 500_000 = 500 kbps) */
  minBitrate?:      number;
  /** Maximum bitrate (default: 8_000_000 = 8 Mbps) */
  maxBitrate?:      number;
  /** Target RTT ms — below this, increase quality (default: 60) */
  targetRttMs?:     number;
  /** Warning RTT ms — above this, reduce quality (default: 120) */
  warningRttMs?:    number;
  /** Critical RTT ms — above this, drop to min (default: 250) */
  criticalRttMs?:   number;
  /** Called whenever a new bitrate is recommended */
  onBitrateChange?: (newBitrate: number) => void;
}

interface RttSample { rtt: number; ts: number; }

export class AdaptiveBitrateController {
  private bitrate:    number;
  private minBitrate: number;
  private maxBitrate: number;
  private targetRtt:  number;
  private warnRtt:    number;
  private critRtt:    number;
  private onBitrateChange?: (b: number) => void;

  private samples:    RttSample[] = [];
  private readonly WINDOW_MS  = 5_000;   // sliding RTT window
  private readonly STEP_UP    = 1.10;    // +10 % per evaluation
  private readonly STEP_DOWN  = 0.75;    // -25 % per evaluation
  private readonly EVAL_MS    = 2_000;   // evaluate every 2 s
  private lastEval = 0;

  /** Current bitrate recommendation */
  get currentBitrate() { return this.bitrate; }

  constructor(cfg: ABRConfig = {}) {
    this.bitrate    = cfg.initialBitrate  ?? 2_000_000;
    this.minBitrate = cfg.minBitrate      ?? 500_000;
    this.maxBitrate = cfg.maxBitrate      ?? 8_000_000;
    this.targetRtt  = cfg.targetRttMs     ?? 60;
    this.warnRtt    = cfg.warningRttMs    ?? 120;
    this.critRtt    = cfg.criticalRttMs   ?? 250;
    this.onBitrateChange = cfg.onBitrateChange;
  }

  /**
   * Record a new RTT measurement (from PING/PONG round-trip).
   * Call this every time a PONG is received.
   */
  addSample(rttMs: number): void {
    const now = Date.now();
    this.samples.push({ rtt: rttMs, ts: now });
    // Prune old samples outside sliding window
    this.samples = this.samples.filter(s => now - s.ts <= this.WINDOW_MS);
    this._maybeEvaluate(now);
  }

  /** Force an immediate evaluation (e.g. on reconnect) */
  evaluate(): void { this._evaluate(); }

  private _maybeEvaluate(now: number): void {
    if (now - this.lastEval >= this.EVAL_MS) {
      this._evaluate();
      this.lastEval = now;
    }
  }

  private _evaluate(): void {
    if (this.samples.length === 0) return;
    const avg = this.samples.reduce((s, x) => s + x.rtt, 0) / this.samples.length;
    const p95 = this._percentile(95);
    const probe = Math.max(avg, p95);

    let newBitrate = this.bitrate;

    if (probe > this.critRtt) {
      newBitrate = this.minBitrate;
    } else if (probe > this.warnRtt) {
      newBitrate = Math.max(this.minBitrate, Math.round(this.bitrate * this.STEP_DOWN));
    } else if (probe < this.targetRtt) {
      newBitrate = Math.min(this.maxBitrate, Math.round(this.bitrate * this.STEP_UP));
    }

    if (newBitrate !== this.bitrate) {
      console.log(`[abr] RTT avg=${avg.toFixed(0)}ms p95=${p95.toFixed(0)}ms → ${(newBitrate/1000).toFixed(0)}kbps`);
      this.bitrate = newBitrate;
      this.onBitrateChange?.(newBitrate);
    }
  }

  private _percentile(p: number): number {
    const sorted = [...this.samples].sort((a, b) => a.rtt - b.rtt);
    const idx    = Math.floor((p / 100) * sorted.length);
    return sorted[Math.min(idx, sorted.length - 1)].rtt;
  }

  /** Stats snapshot for the HUD */
  stats(): { avgRtt: number; p95Rtt: number; bitrate: number } {
    if (this.samples.length === 0) return { avgRtt: 0, p95Rtt: 0, bitrate: this.bitrate };
    const avg = this.samples.reduce((s, x) => s + x.rtt, 0) / this.samples.length;
    return { avgRtt: Math.round(avg), p95Rtt: Math.round(this._percentile(95)), bitrate: this.bitrate };
  }
}
