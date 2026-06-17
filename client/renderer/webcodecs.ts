/**
 * H.264 decoder for the browser using the WebCodecs API.
 *
 * WebCodecs is available in Chrome 94+, Edge 94+, and Chrome Android 108+.
 * Falls back gracefully with isSupported() check.
 *
 * Ref: https://developer.mozilla.org/en-US/docs/Web/API/VideoDecoder
 *
 * Flow:
 *   Uint8Array (Annex-B)
 *     → EncodedVideoChunk
 *     → VideoDecoder  (H.264 / avc1.42E01E baseline)
 *     → VideoFrame    (GPU-accelerated)
 *     → drawImage() on Canvas   OR   WebGPU texture upload
 */

// ─── Support check ────────────────────────────────────────────────────────────

/** H.264 Baseline profile codec string used for WebCodecs */
export const H264_CODEC = 'avc1.42E01E';

/**
 * Check if the browser supports H.264 decoding via WebCodecs.
 * Call this before creating a WebCodecsDecoder instance.
 */
export async function isWebCodecsSupported(): Promise<boolean> {
  if (typeof VideoDecoder === 'undefined') return false;
  try {
    const { supported } = await VideoDecoder.isConfigSupported({
      codec: H264_CODEC,
      hardwareAcceleration: 'prefer-hardware',
    });
    return supported;
  } catch {
    return false;
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DecoderConfig {
  /** Canvas element to render decoded frames onto */
  canvas: HTMLCanvasElement;
  /** Called on every decoded frame (optional — use for custom rendering) */
  onFrame?: (frame: VideoFrame) => void;
  /** Called on decode errors */
  onError?: (e: Error) => void;
  /** Prefer hardware decoding (default: true) */
  hwAccel?: boolean;
  /** Optimise for low latency (default: true) */
  latencyMode?: 'realtime' | 'quality';
}

// ─── Decoder class ────────────────────────────────────────────────────────────

export class WebCodecsDecoder {
  private decoder:  VideoDecoder | null = null;
  private canvas:   HTMLCanvasElement;
  private ctx2d:    CanvasRenderingContext2D | null = null;
  private cfg:      DecoderConfig;

  /** Number of frames decoded successfully */
  framesDecoded = 0;
  /** Number of decode errors */
  errors        = 0;

  constructor(cfg: DecoderConfig) {
    this.cfg    = cfg;
    this.canvas = cfg.canvas;
    this.ctx2d  = cfg.canvas.getContext('2d');
  }

  // ── Init ──────────────────────────────────────────────────────────────────

  async init(width: number, height: number): Promise<void> {
    this.canvas.width  = width;
    this.canvas.height = height;

    this.decoder = new VideoDecoder({
      output: (frame) => this._onFrame(frame),
      error:  (e)     => this._onError(e),
    });

    await this.decoder.configure({
      codec:               H264_CODEC,
      codedWidth:          width,
      codedHeight:         height,
      hardwareAcceleration: (this.cfg.hwAccel ?? true)
        ? 'prefer-hardware'
        : 'prefer-software',
      latencyMode:         this.cfg.latencyMode ?? 'realtime',
      optimizeForLatency:  (this.cfg.latencyMode ?? 'realtime') === 'realtime',
    });

    console.log(`[decoder] WebCodecs H.264 ready — ${width}x${height}`);
  }

  // ── Decode ────────────────────────────────────────────────────────────────

  /**
   * Feed an Annex-B encoded frame into the decoder.
   * @param data     Raw Annex-B bytes (Uint8Array)
   * @param keyframe Whether this is a keyframe (IDR)
   * @param timestampMs Presentation timestamp in milliseconds
   */
  decode(data: Uint8Array, keyframe: boolean, timestampMs: number): void {
    if (!this.decoder || this.decoder.state === 'closed') return;

    const chunk = new EncodedVideoChunk({
      type:      keyframe ? 'key' : 'delta',
      timestamp: timestampMs * 1_000,  // WebCodecs uses microseconds
      duration:  0,
      data:      data,
    });

    this.decoder.decode(chunk);
  }

  // ── Frame output ──────────────────────────────────────────────────────────

  private _onFrame(frame: VideoFrame): void {
    this.framesDecoded++;

    // Custom handler first
    if (this.cfg.onFrame) {
      this.cfg.onFrame(frame);
      frame.close();
      return;
    }

    // Default: draw to canvas
    if (this.ctx2d) {
      this.ctx2d.drawImage(frame, 0, 0);
    }
    frame.close();  // MUST close to release GPU memory
  }

  private _onError(e: Error): void {
    this.errors++;
    console.error('[decoder] WebCodecs error:', e);
    this.cfg.onError?.(e);
  }

  // ── Flush & reset ─────────────────────────────────────────────────────────

  /** Flush pending frames (call after last decode(), before seeking) */
  async flush(): Promise<void> {
    if (this.decoder?.state === 'configured') {
      await this.decoder.flush();
    }
  }

  /**
   * Reset decoder state.
   * Use after a stream discontinuity (e.g. reconnect, seek).
   * The next frame MUST be a keyframe.
   */
  async reset(width: number, height: number): Promise<void> {
    this.decoder?.reset();
    await this.init(width, height);
    console.log('[decoder] Reset — next frame must be a keyframe');
  }

  dispose(): void {
    if (this.decoder?.state !== 'closed') this.decoder?.close();
    this.decoder = null;
  }

  get isReady(): boolean {
    return this.decoder?.state === 'configured';
  }
}

// ─── WebGPU texture upload helper ────────────────────────────────────────────

/**
 * Upload a VideoFrame directly to a WebGPU texture (zero-copy on GPU).
 * Use this instead of drawImage() for the WebGPU rendering path.
 */
export function uploadFrameToWebGPU(
  device:  GPUDevice,
  texture: GPUTexture,
  frame:   VideoFrame
): void {
  // copyExternalImageToTexture is the fast path — no readback to CPU
  device.queue.copyExternalImageToTexture(
    { source: frame, flipY: false },
    { texture },
    { width: frame.displayWidth, height: frame.displayHeight }
  );
}
