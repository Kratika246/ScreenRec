import { frameSlots } from './frame-slots';

export class FrameSampler {
  private timer?: ReturnType<typeof setInterval>;
  private pending = new Map<number, { blob: Blob; timestamp: number }>();
  private running?: Promise<void>;
  private encoding = false;
  private index = 0;
  private stopped = false;
  private deadline = false;
  private canvas = document.createElement('canvas');
  constructor(
    private source: HTMLVideoElement,
    private active: () => boolean,
    private seconds: () => number,
    private upload: (slot: number, timestamp: number, blob: Blob) => Promise<void>,
  ) {}
  start() { void this.sample(); this.timer = setInterval(() => { if (this.active()) void this.sample(); }, 10000); }
  private async sample() {
    if (this.encoding || this.deadline || !this.source.videoWidth) return;
    this.encoding = true;
    try {
      const scale = Math.min(1, 1600 / this.source.videoWidth, 900 / this.source.videoHeight);
      this.canvas.width = Math.round(this.source.videoWidth * scale);
      this.canvas.height = Math.round(this.source.videoHeight * scale);
      this.canvas.getContext('2d')!.drawImage(this.source, 0, 0, this.canvas.width, this.canvas.height);
      const timestamp = Math.max(0, Math.round(this.seconds() * 1000));
      let image: Blob | null = null;
      for (const quality of [.65, .45, .25]) {
        image = await new Promise(resolve => this.canvas.toBlob(resolve, 'image/jpeg', quality));
        if (image && image.size <= 200000) break;
      }
      if (!image || image.size > 200000 || this.deadline) return;
      for (const slot of frameSlots(this.index++)) this.pending.set(slot, { blob: image, timestamp });
      this.pump();
    } catch (error) { console.warn('Screen snapshot unavailable', error); }
    finally { this.encoding = false; }
  }
  private pump() {
    if (this.running || this.deadline) return;
    this.running = (async () => {
      while (this.pending.size && !this.deadline) {
        const [slot, value] = this.pending.entries().next().value!;
        this.pending.delete(slot);
        try { await this.upload(slot, value.timestamp, value.blob); }
        catch (error) { console.warn('Screen snapshot upload failed; video upload continues', error); }
      }
    })().finally(() => { this.running = undefined; if (this.pending.size && !this.deadline) this.pump(); });
  }
  async stop() {
    if (this.stopped) return;
    this.stopped = true; clearInterval(this.timer);
    // Drawing happens before awaiting JPEG encoding, so tracks can stop now.
    const final = this.sample();
    await Promise.race([
      (async () => { await final; while (this.running) await this.running; })(),
      new Promise(resolve => setTimeout(resolve, 2000)),
    ]);
    this.deadline = true; this.pending.clear();
  }
  cancel() { clearInterval(this.timer); this.deadline = true; this.pending.clear(); }
}
