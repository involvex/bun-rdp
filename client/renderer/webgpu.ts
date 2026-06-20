/**
 * WebGPU renderer — renders decoded VideoFrames via a fullscreen quad.
 * Falls back to Canvas 2D if WebGPU is unavailable.
 */

export class WebGPURenderer {
  private device: GPUDevice | null = null;
  private context: GPUCanvasContext | null = null;
  private pipeline: GPURenderPipeline | null = null;
  private sampler: GPUSampler | null = null;
  private bindGroup: GPUBindGroup | null = null;
  private texture: GPUTexture | null = null;
  private canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
  }

  async init(width: number, height: number): Promise<boolean> {
    if (!navigator.gpu) {
      console.warn('[webgpu] Not supported');
      return false;
    }

    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) {
      console.warn('[webgpu] No adapter');
      return false;
    }

    this.device = await adapter.requestDevice();
    this.context = this.canvas.getContext('webgpu') as GPUCanvasContext;
    this.canvas.width = width;
    this.canvas.height = height;

    const fmt = navigator.gpu.getPreferredCanvasFormat();
    this.context.configure({ device: this.device, format: fmt, alphaMode: 'opaque' });

    // ── Shaders: fullscreen textured quad ────────────────────────────────
    const wgsl = /* wgsl */ `
      @group(0) @binding(0) var tex:     texture_2d<f32>;
      @group(0) @binding(1) var samp:    sampler;

      struct VertOut { @builtin(position) pos: vec4f, @location(0) uv: vec2f };

      @vertex fn vs(@builtin(vertex_index) id: u32) -> VertOut {
        // Two triangles covering the clip space [-1,1]
        var positions = array<vec2f, 6>(
          vec2(-1.0, -1.0), vec2( 1.0, -1.0), vec2(-1.0,  1.0),
          vec2(-1.0,  1.0), vec2( 1.0, -1.0), vec2( 1.0,  1.0)
        );
        var uvs = array<vec2f, 6>(
          vec2(0.0, 1.0), vec2(1.0, 1.0), vec2(0.0, 0.0),
          vec2(0.0, 0.0), vec2(1.0, 1.0), vec2(1.0, 0.0)
        );
        var out: VertOut;
        out.pos = vec4f(positions[id], 0.0, 1.0);
        out.uv  = uvs[id];
        return out;
      }

      @fragment fn fs(in: VertOut) -> @location(0) vec4f {
        return textureSample(tex, samp, in.uv);
      }
    `;

    const shaderModule = this.device.createShaderModule({ code: wgsl });

    this.sampler = this.device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
    });

    // Placeholder texture — replaced every frame
    this.texture = this.device.createTexture({
      size: [width, height, 1],
      format: 'rgba8unorm',
      usage:
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_DST |
        GPUTextureUsage.RENDER_ATTACHMENT,
    });

    const bindGroupLayout = this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: {} },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
      ],
    });

    this.bindGroup = this.device.createBindGroup({
      layout: bindGroupLayout,
      entries: [
        { binding: 0, resource: this.texture.createView() },
        { binding: 1, resource: this.sampler },
      ],
    });

    this.pipeline = this.device.createRenderPipeline({
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
      vertex: { module: shaderModule, entryPoint: 'vs' },
      fragment: { module: shaderModule, entryPoint: 'fs', targets: [{ format: fmt }] },
      primitive: { topology: 'triangle-list' },
    });

    console.log('[webgpu] Ready');
    return true;
  }

  /**
   * Render a VideoFrame (from WebCodecs decoder).
   * The frame is uploaded to the GPU texture and rendered via the fullscreen quad.
   */
  renderFrame(frame: VideoFrame): void {
    if (!this.device || !this.pipeline || !this.context || !this.texture) return;

    // Upload VideoFrame → GPU texture (zero-copy on supported platforms)
    this.device.queue.copyExternalImageToTexture(
      { source: frame, flipY: false },
      { texture: this.texture },
      [frame.displayWidth, frame.displayHeight]
    );

    const cmd = this.device.createCommandEncoder();
    const pass = cmd.beginRenderPass({
      colorAttachments: [
        {
          view: this.context.getCurrentTexture().createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup!);
    pass.draw(6);
    pass.end();
    this.device.queue.submit([cmd.finish()]);
  }

  get isReady(): boolean {
    return this.device !== null;
  }

  dispose(): void {
    this.texture?.destroy();
    this.device = null;
    this.pipeline = null;
    this.context = null;
  }
}
