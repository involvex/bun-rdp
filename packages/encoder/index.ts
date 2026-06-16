import { mfplat, mfreadwrite } from 'bun-win32';

/**
 * H.264 encoder via Windows Media Foundation
 */
export class H264Encoder {
  private encoder: unknown = null;
  private width: number;
  private height: number;
  private bitrate: number;
  private fps: number;

  constructor(width: number, height: number, bitrate = 2_000_000, fps = 30) {
    this.width = width;
    this.height = height;
    this.bitrate = bitrate;
    this.fps = fps;
  }

  async init() {
    mfplat.MFStartup(mfplat.MF_VERSION);

    const attributes = mfplat.MFCreateAttributes();
    attributes.SetUINT32(mfreadwrite.MF_READWRITE_ENABLE_HARDWARE_TRANSFORMS, 1);
    attributes.SetGUID(mfreadwrite.MF_MT_SUBTYPE, mfreadwrite.MFVideoFormat_H264);
    attributes.SetUINT32(mfreadwrite.MF_MT_AVG_BITRATE, this.bitrate);
    attributes.SetUINT64(mfreadwrite.MF_MT_FRAME_RATE,
      (BigInt(this.fps) << 32n) | BigInt(1));
    attributes.SetUINT64(mfreadwrite.MF_MT_FRAME_SIZE,
      (BigInt(this.width) << 32n) | BigInt(this.height));

    this.encoder = mfreadwrite.MFCreateSinkWriterFromURL(null, null, attributes);
    console.log(`[encoder] H.264 init OK — ${this.width}x${this.height} @ ${this.fps}fps`);
  }

  /** Encode a raw BGRA frame → H.264 Annex-B bytes */
  encodeFrame(_bgraData: Uint8Array): Uint8Array | null {
    // TODO: Feed frame into MF SinkWriter, retrieve encoded sample
    return null;
  }

  dispose() {
    mfplat.MFShutdown?.();
    this.encoder = null;
  }
}
