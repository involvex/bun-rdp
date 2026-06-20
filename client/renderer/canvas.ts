/**
 * Canvas 2D renderer — simple, works everywhere
 */
export class CanvasRenderer {
  private ctx: CanvasRenderingContext2D;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
  }

  renderFrame(data: Uint8Array, width: number, height: number) {
    // Assumes data is raw RGBA after decoding
    const imageData = new ImageData(new Uint8ClampedArray(data.buffer), width, height);
    this.canvas.width = width;
    this.canvas.height = height;
    this.ctx.putImageData(imageData, 0, 0);
  }
}
