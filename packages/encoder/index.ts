/**
 * H.264 Encoder — Windows Media Foundation pipeline
 *
 * Flow:
 *   BGRA frame (CPU)
 *     → BGRA→NV12 color-space conversion  (convertBGRAtoNV12)
 *     → IMFSample (NV12)
 *     → MF H.264 encoder (hardware or software)
 *     → Annex-B NAL units
 *     → Uint8Array  (ready for WebSocket broadcast)
 *
 * References:
 *   https://learn.microsoft.com/en-us/windows/win32/medfound/h-264-video-encoder
 *   https://learn.microsoft.com/en-us/windows/win32/medfound/sink-writer
 */
import { mfplat, mfreadwrite, mftransform } from '../win32-compat';

// ─── Constants ────────────────────────────────────────────────────────────────

/** MF attribute GUIDs */
const MF_MT_MAJOR_TYPE = '{48eba18e-f8c9-4687-bf11-0a74c9f96a8f}';
const MF_MT_SUBTYPE = '{f7e34c9a-42e8-4714-b74b-cb29d72c35e5}';
const MF_MT_FRAME_SIZE = '{1652c33d-d6b2-4012-b834-72030849a37d}';
const MF_MT_FRAME_RATE = '{c459a2e8-3d2c-4e44-b132-fee5156c7bb0}';
const MF_MT_AVG_BITRATE = '{20332624-fb0d-4d9e-bd0d-cbf6786c102e}';
const MF_MT_INTERLACE_MODE = '{e2724bb8-e676-4806-b4b2-a8d6efb44ccd}';
const MF_MT_ALL_SAMPLES_INDEPENDENT = '{c9173739-5e56-461c-b713-46fb995cb95f}';
const MF_MT_PIXEL_ASPECT_RATIO = '{c6376a1e-8d0a-4027-be45-6d9a0ad39bb6}';

const MFMediaType_Video = '{73646976-0000-0010-8000-00aa00389b71}';
const MFVideoFormat_H264 = '{34363248-0000-0010-8000-00aa00389b71}';
const MFVideoFormat_NV12 = '{3231564e-0000-0010-8000-00aa00389b71}';
const MFVideoFormat_ARGB32 = '{00000015-0000-0010-8000-00aa00389b71}';

const MF_SINK_WRITER_DISABLE_THROTTLING = '{08b845d8-2b74-4afe-9d53-be16d2d4ae4c}';
const MF_READWRITE_ENABLE_HARDWARE_TRANSFORMS = '{a634a91c-822b-41b9-a494-4de4643612b0}';

// ─── BGRA → NV12 conversion (CPU) ────────────────────────────────────────────

/**
 * Convert a raw BGRA frame to NV12 (YUV 4:2:0 planar).
 * NV12 layout:
 *   [0 .. width*height-1]          — Y  plane  (1 byte/pixel)
 *   [width*height .. *1.5-1]       — UV plane  (2 bytes per 2×2 block, interleaved)
 *
 * BT.601 limited-range coefficients.
 */
export function convertBGRAtoNV12(bgra: Uint8Array, width: number, height: number): Uint8Array {
  const ySize = width * height;
  const uvSize = (width >> 1) * (height >> 1) * 2;
  const nv12 = new Uint8Array(ySize + uvSize);

  // Y plane
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const i = (row * width + col) * 4;
      const b = bgra[i],
        g = bgra[i + 1],
        r = bgra[i + 2];
      // Y = 16 + 65.481*R/255 + 128.553*G/255 + 24.966*B/255
      nv12[row * width + col] = Math.round(16 + 0.257 * r + 0.504 * g + 0.098 * b);
    }
  }

  // UV plane (interleaved Cb/Cr, 2×2 downsampled)
  let uvOff = ySize;
  for (let row = 0; row < height; row += 2) {
    for (let col = 0; col < width; col += 2) {
      // Average 2×2 block
      let r = 0,
        g = 0,
        b = 0;
      for (let dy = 0; dy < 2; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          const i = ((row + dy) * width + (col + dx)) * 4;
          b += bgra[i];
          g += bgra[i + 1];
          r += bgra[i + 2];
        }
      }
      r >>= 2;
      g >>= 2;
      b >>= 2;
      // Cb = 128 - 0.148*R - 0.291*G + 0.439*B
      // Cr = 128 + 0.439*R - 0.368*G - 0.071*B
      nv12[uvOff++] = Math.round(128 - 0.148 * r - 0.291 * g + 0.439 * b); // Cb (U)
      nv12[uvOff++] = Math.round(128 + 0.439 * r - 0.368 * g - 0.071 * b); // Cr (V)
    }
  }

  return nv12;
}

// ─── Annex-B helpers ─────────────────────────────────────────────────────────

const ANNEXB_START_CODE = new Uint8Array([0x00, 0x00, 0x00, 0x01]);

/** Wrap a raw NAL payload with Annex-B start code */
export function annexB(nal: Uint8Array): Uint8Array {
  const out = new Uint8Array(4 + nal.byteLength);
  out.set(ANNEXB_START_CODE, 0);
  out.set(nal, 4);
  return out;
}

// ─── Encoder class ────────────────────────────────────────────────────────────

export interface EncoderConfig {
  width: number;
  height: number;
  fps?: number; // default 30
  bitrate?: number; // bits/s, default 2 000 000
  keyframeInterval?: number; // frames between keyframes, default fps*2
  hwAccel?: boolean; // try hardware encoder first, default true
}

export interface EncodedFrame {
  data: Uint8Array; // H.264 Annex-B
  keyframe: boolean;
  timestamp: number; // presentation timestamp (ms)
  duration: number; // frame duration (ms)
}

export class H264Encoder {
  private writer: unknown = null; // IMFSinkWriter
  private streamIndex = 0;
  private frameIndex = 0;
  private pts = 0n; // 100-ns units (MF time)

  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly bitrate: number;
  readonly keyframeInterval: number;
  private readonly hwAccel: boolean;

  private readonly frameDuration100ns: bigint; // in 100-ns units

  constructor(cfg: EncoderConfig) {
    this.width = cfg.width;
    this.height = cfg.height;
    this.fps = cfg.fps ?? 30;
    this.bitrate = cfg.bitrate ?? 2_000_000;
    this.keyframeInterval = cfg.keyframeInterval ?? this.fps * 2;
    this.hwAccel = cfg.hwAccel ?? true;
    // MF timestamps are in 100-nanosecond units
    this.frameDuration100ns = BigInt(Math.round(10_000_000 / this.fps));
  }

  // ── Init ──────────────────────────────────────────────────────────────────

  async init(): Promise<void> {
    mfplat.MFStartup(mfplat.MF_VERSION);

    // ── Sink writer attributes ────────────────────────────────────────────
    const writerAttrs = mfplat.MFCreateAttributes(2);
    writerAttrs.SetUINT32(MF_READWRITE_ENABLE_HARDWARE_TRANSFORMS, this.hwAccel ? 1 : 0);
    writerAttrs.SetUINT32(MF_SINK_WRITER_DISABLE_THROTTLING, 1);

    // ── Output media type: H.264 ──────────────────────────────────────────
    const outType = mfplat.MFCreateMediaType();
    outType.SetGUID(MF_MT_MAJOR_TYPE, MFMediaType_Video);
    outType.SetGUID(MF_MT_SUBTYPE, MFVideoFormat_H264);
    outType.SetUINT32(MF_MT_AVG_BITRATE, this.bitrate);
    outType.SetUINT32(MF_MT_INTERLACE_MODE, 2); // MFVideoInterlace_Progressive
    outType.SetUINT64(MF_MT_FRAME_SIZE, (BigInt(this.width) << 32n) | BigInt(this.height));
    outType.SetUINT64(MF_MT_FRAME_RATE, (BigInt(this.fps) << 32n) | 1n);
    outType.SetUINT64(MF_MT_PIXEL_ASPECT_RATIO, (1n << 32n) | 1n);

    // ── Input media type: NV12 ────────────────────────────────────────────
    const inType = mfplat.MFCreateMediaType();
    inType.SetGUID(MF_MT_MAJOR_TYPE, MFMediaType_Video);
    inType.SetGUID(MF_MT_SUBTYPE, MFVideoFormat_NV12);
    inType.SetUINT32(MF_MT_INTERLACE_MODE, 2);
    inType.SetUINT64(MF_MT_FRAME_SIZE, (BigInt(this.width) << 32n) | BigInt(this.height));
    inType.SetUINT64(MF_MT_FRAME_RATE, (BigInt(this.fps) << 32n) | 1n);
    inType.SetUINT64(MF_MT_PIXEL_ASPECT_RATIO, (1n << 32n) | 1n);
    inType.SetUINT32(MF_MT_ALL_SAMPLES_INDEPENDENT, 1);

    // ── Create SinkWriter (in-memory byte stream) ─────────────────────────
    const byteStream = mfplat.MFCreateTempFile(
      mfplat.MF_ACCESSMODE_READWRITE,
      mfplat.MF_OPENMODE_DELETE_IF_EXIST,
      mfplat.MF_FILEFLAGS_NONE
    );
    this.writer = mfreadwrite.MFCreateSinkWriterFromMediaSink(
      // Use a fragmented-MP4 or raw H.264 byte stream sink
      mfreadwrite.MFCreateMPEG4MediaSink(byteStream, outType, null),
      writerAttrs
    );

    const w = this.writer as ReturnType<typeof mfreadwrite.MFCreateSinkWriterFromMediaSink>;
    this.streamIndex = w.AddStream(outType);
    w.SetInputMediaType(this.streamIndex, inType, null);
    w.BeginWriting();

    console.log(
      `[encoder] H.264 ready — ${this.width}x${this.height} @ ${this.fps}fps` +
        ` ${this.bitrate / 1000}kbps ${this.hwAccel ? '(hw)' : '(sw)'}`
    );
  }

  // ── Encode one frame ─────────────────────────────────────────────────────

  /**
   * Encode a raw BGRA frame.
   * Returns Annex-B bytes or null if the encoder hasn't produced output yet
   * (MF may buffer a few frames before emitting the first NAL units).
   */
  encodeFrame(bgraData: Uint8Array): EncodedFrame | null {
    if (!this.writer) throw new Error('[encoder] Not initialised — call init() first');

    // 1. BGRA → NV12
    const nv12 = convertBGRAtoNV12(bgraData, this.width, this.height);

    // 2. Wrap in IMFSample
    const buf = mfplat.MFCreateMemoryBuffer(nv12.byteLength);
    const bufPtr = buf.Lock();
    bufPtr.set(nv12);
    buf.Unlock(nv12.byteLength, nv12.byteLength);

    const sample = mfplat.MFCreateSample();
    sample.AddBuffer(buf);
    sample.SetSampleTime(this.pts);
    sample.SetSampleDuration(this.frameDuration100ns);

    const isKeyframe = this.frameIndex % this.keyframeInterval === 0;
    if (isKeyframe) {
      sample.SetUINT32(mftransform.MFSampleExtension_CleanPoint, 1);
    }

    // 3. Feed to SinkWriter
    const w = this.writer as ReturnType<typeof mfreadwrite.MFCreateSinkWriterFromMediaSink>;
    w.WriteSample(this.streamIndex, sample);

    // 4. Pull encoded output
    const encodedBuf = this._drainOutput();

    // Advance counters
    this.pts += this.frameDuration100ns;
    this.frameIndex++;

    if (!encodedBuf) return null;

    return {
      data: encodedBuf,
      keyframe: isKeyframe,
      timestamp: Number(this.pts / 10_000n), // ms
      duration: Number(this.frameDuration100ns / 10_000n),
    };
  }

  /** Pull any available encoded samples from the MF output queue */
  private _drainOutput(): Uint8Array | null {
    const w = this.writer as ReturnType<typeof mfreadwrite.MFCreateSinkWriterFromMediaSink>;
    try {
      const sample = w.GetOutputSample(this.streamIndex);
      if (!sample) return null;

      // Concatenate all buffers in the sample
      const bufCount = sample.GetBufferCount();
      const parts: Uint8Array[] = [];
      for (let i = 0; i < bufCount; i++) {
        const b = sample.GetBufferByIndex(i);
        const ptr = b.Lock();
        const len = b.GetCurrentLength();
        parts.push(new Uint8Array(ptr.buffer, ptr.byteOffset, len));
        b.Unlock();
      }
      if (parts.length === 0) return null;

      // Merge into single Annex-B buffer
      const total = parts.reduce((s, p) => s + p.byteLength, 0);
      const out = new Uint8Array(total);
      let off = 0;
      for (const p of parts) {
        out.set(p, off);
        off += p.byteLength;
      }
      return out;
    } catch {
      return null;
    }
  }

  /** Flush remaining frames and return any buffered output */
  flush(): EncodedFrame[] {
    if (!this.writer) return [];
    const w = this.writer as ReturnType<typeof mfreadwrite.MFCreateSinkWriterFromMediaSink>;
    const results: EncodedFrame[] = [];
    try {
      w.Finalize();
      let buf: Uint8Array | null;
      while ((buf = this._drainOutput()) !== null) {
        results.push({
          data: buf,
          keyframe: false,
          timestamp: Date.now(),
          duration: 0,
        });
      }
    } catch {
      /* ignore finalize errors */
    }
    return results;
  }

  dispose() {
    this.flush();
    this.writer = null;
    mfplat.MFShutdown?.();
  }
}
