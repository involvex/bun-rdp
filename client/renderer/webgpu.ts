/**
 * WebGPU renderer — low latency, GPU-accelerated
 * Falls back gracefully if WebGPU is not available
 */
export class WebGPURenderer {
  private device: GPUDevice | null = null;

  async init(canvas: HTMLCanvasElement) {
    if (!navigator.gpu) {
      console.warn('[renderer] WebGPU not supported, use CanvasRenderer instead');
      return false;
    }
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) return false;
    this.device = await adapter.requestDevice();
    const context = canvas.getContext('webgpu') as GPUCanvasContext;
    context.configure({
      device: this.device,
      format: navigator.gpu.getPreferredCanvasFormat(),
    });
    console.log('[renderer] WebGPU ready');
    return true;
  }

  renderFrame(_data: Uint8Array, _width: number, _height: number) {
    // TODO: upload texture, render fullscreen quad
  }

  get isReady() { return this.device !== null; }
}
