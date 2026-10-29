import { randomUUID } from 'node:crypto';

/** Live fixtures only. Download once, then exercise the normal upload paths. */
export async function downloadTestImage({ seed = randomUUID(), width = 1200, height = 1600 }: {
  seed?: string;
  width?: number;
  height?: number;
} = {}): Promise<Buffer> {
  const url = `https://picsum.photos/seed/${encodeURIComponent(seed)}/${width}/${height}.jpg`;
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Picsum fixture failed: ${response.status} ${url}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (response.headers.get('content-type')?.split(';')[0] !== 'image/jpeg'
    || bytes.length < 4 || bytes.length > 10 * 1024 * 1024
    || bytes.readUInt16BE(0) !== 0xffd8 || bytes.readUInt16BE(bytes.length - 2) !== 0xffd9) {
    throw new Error(`Picsum returned an invalid JPEG fixture: ${url}`);
  }
  // Content-addressed uploads must stay unique when a test deletes its object.
  // A JPEG comment preserves the photograph while isolating concurrent runs.
  const comment = Buffer.from(randomUUID());
  const segment = Buffer.from([0xff, 0xfe, 0, comment.length + 2]);
  return Buffer.concat([bytes.subarray(0, -2), segment, comment, bytes.subarray(-2)]);
}
