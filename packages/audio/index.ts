/**
 * Audio capture — WASAPI loopback (system audio)
 * Encodes to Opus via libopus (bun-win32 / bun:ffi)
 *
 * Flow:
 *   WASAPI loopback device
 *     → IAudioCaptureClient (PCM float32, 48 kHz, stereo)
 *     → Opus encoder (960 samples/frame = 20 ms @ 48 kHz)
 *     → Uint8Array (Opus packet)
 *     → AUDIO protocol message → WebSocket broadcast
 *
 * References:
 *   https://learn.microsoft.com/en-us/windows/win32/coreaudio/loopback-recording
 *   https://opus-codec.org/docs/opus_api-1.3.1/group__opus__encoder.html
 */
import { dlopen, FFIType, ptr, toArrayBuffer } from 'bun:ffi';
import { audioclient, mmdeviceapi } from '../win32-compat';

// ─── Opus constants ────────────────────────────────────────────────────────────
const OPUS_OK = 0;
const OPUS_APPLICATION_VOIP = 2048;
const OPUS_APPLICATION_AUDIO = 2049;
const OPUS_SET_BITRATE_REQUEST = 4002;
const SAMPLE_RATE = 48000;
const CHANNELS = 2;
const FRAME_SIZE = 960; // 20 ms @ 48 kHz
const MAX_PACKET_SIZE = 4000; // bytes

// ─── Opus FFI ─────────────────────────────────────────────────────────────────
let _opus: ReturnType<typeof dlopen> | null = null;

function opus() {
  if (_opus) return _opus;
  // opus.dll must be in PATH or same directory as the server binary
  _opus = dlopen('opus', {
    opus_encoder_create: {
      args: [FFIType.i32, FFIType.i32, FFIType.i32, FFIType.ptr],
      returns: FFIType.ptr,
    },
    opus_encoder_ctl: {
      args: [FFIType.ptr, FFIType.i32, FFIType.i32],
      returns: FFIType.i32,
    },
    opus_encode_float: {
      args: [FFIType.ptr, FFIType.ptr, FFIType.i32, FFIType.ptr, FFIType.i32],
      returns: FFIType.i32,
    },
    opus_encoder_destroy: {
      args: [FFIType.ptr],
      returns: FFIType.void,
    },
    opus_strerror: {
      args: [FFIType.i32],
      returns: FFIType.cstring,
    },
  });
  return _opus;
}

// ─── WASAPILoopback ────────────────────────────────────────────────────────────

export interface AudioConfig {
  bitrate?: number; // Opus bitrate bits/s (default 96_000)
  application?: 'voip' | 'audio';
  onPacket: (packet: Uint8Array, timestamp: number) => void;
}

export class WASAPILoopback {
  private encoder: bigint | null = null; // OpusEncoder*
  private client: unknown = null;
  private capture: unknown = null;
  private running = false;
  private cfg: AudioConfig;

  constructor(cfg: AudioConfig) {
    this.cfg = cfg;
  }

  async init(): Promise<void> {
    // ── Init COM + WASAPI ─────────────────────────────────────────────────
    const enumerator = mmdeviceapi.CoCreateInstance(
      mmdeviceapi.CLSID_MMDeviceEnumerator,
      null,
      mmdeviceapi.CLSCTX_ALL,
      mmdeviceapi.IID_IMMDeviceEnumerator
    );

    // Get default render (playback) device for loopback
    const device = enumerator.GetDefaultAudioEndpoint(mmdeviceapi.eRender, mmdeviceapi.eConsole);

    this.client = device.Activate(mmdeviceapi.IID_IAudioClient, mmdeviceapi.CLSCTX_ALL, null);

    const ac = this.client as ReturnType<typeof audioclient.IAudioClient.prototype.Activate>;

    // WASAPI loopback — AUDCLNT_STREAMFLAGS_LOOPBACK
    const AUDCLNT_STREAMFLAGS_LOOPBACK = 0x00020000;
    const REFTIMES_PER_MS = 10_000n;
    const bufferDuration = REFTIMES_PER_MS * 200n; // 200 ms buffer

    const wfx = {
      wFormatTag: 3, // WAVE_FORMAT_IEEE_FLOAT
      nChannels: CHANNELS,
      nSamplesPerSec: SAMPLE_RATE,
      wBitsPerSample: 32,
      nBlockAlign: CHANNELS * 4,
      nAvgBytesPerSec: SAMPLE_RATE * CHANNELS * 4,
      cbSize: 0,
    };

    ac.Initialize(
      audioclient.AUDCLNT_SHAREMODE_SHARED,
      AUDCLNT_STREAMFLAGS_LOOPBACK,
      bufferDuration,
      0n,
      wfx,
      null
    );

    this.capture = ac.GetService(mmdeviceapi.IID_IAudioCaptureClient);

    // ── Init Opus encoder ─────────────────────────────────────────────────
    const errBuf = Buffer.alloc(4);
    const app =
      (this.cfg.application ?? 'audio') === 'voip' ? OPUS_APPLICATION_VOIP : OPUS_APPLICATION_AUDIO;

    this.encoder = opus().symbols.opus_encoder_create(SAMPLE_RATE, CHANNELS, app, errBuf) as bigint;

    const err = errBuf.readInt32LE(0);
    if (err !== OPUS_OK) {
      const msg = opus().symbols.opus_strerror(err);
      throw new Error(`opus_encoder_create failed: ${msg} (${err})`);
    }

    // Set bitrate
    const bitrate = this.cfg.bitrate ?? 96_000;
    opus().symbols.opus_encoder_ctl(this.encoder, OPUS_SET_BITRATE_REQUEST, bitrate);

    console.log(
      `[audio] WASAPI loopback + Opus ready — ${SAMPLE_RATE}Hz ${CHANNELS}ch ${bitrate / 1000}kbps`
    );
  }

  start(): void {
    if (this.running) return;
    this.running = true;

    const ac = this.client as ReturnType<typeof audioclient.IAudioClient.prototype.Activate>;
    const cap = this.capture as ReturnType<typeof mmdeviceapi.IMMDevice.prototype.Activate>;
    ac.Start();

    const pcmBuf = new Float32Array(FRAME_SIZE * CHANNELS);
    const outBuf = Buffer.alloc(MAX_PACKET_SIZE);
    let pcmFilled = 0;

    const tick = () => {
      if (!this.running) return;

      try {
        // Drain all available capture packets
        let frames: number;
        let _flags: number;
        let data: Float32Array;
        while (
          (({
            frames,
            flags: _flags,
            data,
          } = (
            cap as unknown as {
              GetBuffer(): {
                frames: number;
                flags: number;
                data: Float32Array;
              };
            }
          ).GetBuffer()),
          frames > 0)
        ) {
          // Accumulate into pcmBuf
          let src = 0;
          while (src < frames && pcmFilled < FRAME_SIZE) {
            for (let ch = 0; ch < CHANNELS; ch++) {
              pcmBuf[pcmFilled * CHANNELS + ch] = data[src * CHANNELS + ch] ?? 0;
            }
            src++;
            pcmFilled++;
          }

          (cap as unknown as { ReleaseBuffer(n: number): void }).ReleaseBuffer(frames);

          // Encode when we have a full Opus frame
          if (pcmFilled >= FRAME_SIZE) {
            const encodedBytes = opus().symbols.opus_encode_float(
              this.encoder,
              ptr(pcmBuf),
              FRAME_SIZE,
              outBuf,
              MAX_PACKET_SIZE
            ) as number;

            if (encodedBytes > 0) {
              const packet = new Uint8Array(outBuf.buffer, 0, encodedBytes);
              this.cfg.onPacket(packet.slice(), Date.now());
            }
            pcmFilled = 0;
          }
        }
      } catch {
        /* silence gap */
      }

      setTimeout(tick, 10); // poll every 10 ms
    };

    tick();
    console.log('[audio] Capture started');
  }

  stop(): void {
    this.running = false;
    const ac = this.client as ReturnType<typeof audioclient.IAudioClient.prototype.Activate>;
    ac?.Stop();
  }

  dispose(): void {
    this.stop();
    if (this.encoder) {
      opus().symbols.opus_encoder_destroy(this.encoder);
      this.encoder = null;
    }
    _opus?.close();
    _opus = null;
  }
}
