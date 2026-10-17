export const PART_SIZE = 5 * 1024 * 1024;
export class PartBuffer {
  private pending = new Blob([]);
  push(blob: Blob): Blob[] {
    this.pending = new Blob([this.pending, blob]);
    const parts: Blob[] = [];
    while (this.pending.size >= PART_SIZE) { parts.push(this.pending.slice(0, PART_SIZE)); this.pending = this.pending.slice(PART_SIZE); }
    return parts;
  }
  flush(): Blob | undefined { const final = this.pending; this.pending = new Blob([]); return final.size ? final : undefined; }
}
