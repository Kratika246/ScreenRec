export async function uploadPartWithRetry(
  blob: Blob,
  getUrl: () => Promise<string>,
  put: (url: string, init: RequestInit) => Promise<Response> = fetch,
  wait: (ms: number) => Promise<void> = ms => new Promise(resolve => setTimeout(resolve, ms)),
): Promise<string> {
  let last: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const url = await getUrl();
      const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 60000);
      let response: Response;
      try { response = await put(url, { method: 'PUT', body: blob, signal: controller.signal }); }
      finally { clearTimeout(timeout); }
      if (!response.ok) throw new Error(`Upload failed (${response.status})`);
      const etag = response.headers.get('ETag');
      if (!etag) throw new Error('S3 did not expose the part ETag.');
      return etag;
    } catch (error) {
      last = error;
      if (attempt < 3) await wait(1000 * 2 ** attempt);
    }
  }
  throw last;
}
export class UploadQueue {
  private lanes: Promise<void>[] = [Promise.resolve(), Promise.resolve()];
  private cursor = 0;
  private error: unknown;
  add(job: () => Promise<void>) {
    const lane = this.cursor++ % 2;
    this.lanes[lane] = this.lanes[lane]!.then(job).catch(error => { this.error ??= error; });
  }
  async drain() {
    await Promise.all(this.lanes);
    if (this.error) throw this.error;
  }
}
