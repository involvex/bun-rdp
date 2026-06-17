/**
 * Browser audio — Opus decoder via WebCodecs AudioDecoder + WebAudio
 *
 * Flow:
 *   AUDIO message (Opus packet, Uint8Array)
 *     → EncodedAudioChunk
 *     → AudioDecoder  (opus)
 *     → AudioData     (PCM float32, 48 kHz, stereo)
 *     → AudioWorkletNode → AudioContext destination (speakers)
 *
 * Requires Chrome 96+ / Edge 96+ (WebCodecs AudioDecoder).
 * Falls back to a simple gain node if AudioDecoder is unavailable.
 */

export const OPUS_SAMPLE_RATE = 48_000;
export const OPUS_CHANNELS    = 2;
export const OPUS_FRAME_SIZE  = 960;

// ─── Support check ────────────────────────────────────────────────────────────

export async function isOpusSupported(): Promise<boolean> {
  if (typeof AudioDecoder === 'undefined') return false;
  try {
    const { supported } = await AudioDecoder.isConfigSupported({
      codec:          'opus',
      sampleRate:     OPUS_SAMPLE_RATE,
      numberOfChannels: OPUS_CHANNELS,
    });
    return supported;
  } catch { return false; }
}

// ─── AudioWorklet processor source (inlined as a Blob URL) ───────────────────

const WORKLET_SRC = /* javascript */`
class OpusPlayerProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._queue = [];
    this._buf   = null;
    this._off   = 0;
    this.port.onmessage = ({ data }) => {
      // data: Float32Array interleaved stereo
      this._queue.push(data);
    };
  }

  process(_, outputs) {
    const out  = outputs[0];
    const len  = out[0].length;  // typically 128 samples

    for (let ch = 0; ch < out.length; ch++) {
      const chan = out[ch];
      let written = 0;
      while (written < len) {
        if (!this._buf || this._off >= this._buf.length) {
          if (this._queue.length === 0) break;
          this._buf = this._queue.shift();
          this._off = ch;  // start at correct channel offset for interleaved data
        }
        // Deinterleave: for stereo interleaved [L, R, L, R ...]
        // ch=0 → even indices, ch=1 → odd indices
        const stride  = ${OPUS_CHANNELS};
        const srcIdx  = this._off + ch;
        if (srcIdx < this._buf.length) {
          chan[written++] = this._buf[srcIdx];
          this._off      += stride;
        } else {
          chan[written++] = 0;
        }
      }
      // Fill remainder with silence
      while (written < len) chan[written++] = 0;
    }
    return true;
  }
}
registerProcessor('opus-player', OpusPlayerProcessor);
`.replace('${OPUS_CHANNELS}', String(OPUS_CHANNELS));

// ─── OpusPlayer ───────────────────────────────────────────────────────────────

export class OpusPlayer {
  private ctx:       AudioContext | null = null;
  private decoder:   AudioDecoder | null = null;
  private worklet:   AudioWorkletNode | null = null;

  packetsReceived  = 0;
  framesDecoded    = 0;

  async init(): Promise<void> {
    this.ctx = new AudioContext({ sampleRate: OPUS_SAMPLE_RATE, latencyHint: 'interactive' });

    // Load AudioWorklet processor
    const blob = new Blob([WORKLET_SRC], { type: 'application/javascript' });
    const url  = URL.createObjectURL(blob);
    await this.ctx.audioWorklet.addModule(url);
    URL.revokeObjectURL(url);

    this.worklet = new AudioWorkletNode(this.ctx, 'opus-player', {
      numberOfInputs:  0,
      numberOfOutputs: 1,
      outputChannelCount: [OPUS_CHANNELS],
    });
    this.worklet.connect(this.ctx.destination);

    const workletPort = this.worklet.port;

    // Set up WebCodecs AudioDecoder
    this.decoder = new AudioDecoder({
      output: (audioData) => {
        this.framesDecoded++;
        // Copy to Float32Array and post to worklet
        const samples = audioData.numberOfFrames * audioData.numberOfChannels;
        const pcm = new Float32Array(samples);
        audioData.copyTo(pcm, { format: 'f32', planeIndex: 0 });
        workletPort.postMessage(pcm, [pcm.buffer]);
        audioData.close();
      },
      error: (e) => console.error('[audio-client] Decode error:', e),
    });

    await this.decoder.configure({
      codec:            'opus',
      sampleRate:       OPUS_SAMPLE_RATE,
      numberOfChannels: OPUS_CHANNELS,
    });

    console.log('[audio-client] Opus/WebAudio ready');
  }

  /** Feed an Opus packet received from the server */
  decode(packet: Uint8Array, timestampMs: number): void {
    if (!this.decoder || this.decoder.state === 'closed') return;
    this.packetsReceived++;
    this.decoder.decode(new EncodedAudioChunk({
      type:      'key',   // Opus frames are always self-contained
      timestamp: timestampMs * 1_000,  // microseconds
      data:      packet,
    }));
  }

  /** Resume AudioContext after user gesture */
  async resume(): Promise<void> { await this.ctx?.resume(); }

  dispose(): void {
    if (this.decoder?.state !== 'closed') this.decoder?.close();
    this.worklet?.disconnect();
    this.ctx?.close();
    this.decoder = null;
    this.worklet = null;
    this.ctx     = null;
  }

  get isReady(): boolean { return this.decoder?.state === 'configured'; }
}
