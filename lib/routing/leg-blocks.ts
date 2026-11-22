// Which Mapbox Matrix requests cover the street times still missing. Pure, no fetch.
//
// One request takes at most 25 coordinates (driving profile) and is billed per element
// (sources × destinations). Points are split in chunks of 12; a block pairs one chunk as sources
// with one chunk as destinations, so it never has more than 24 coordinates, and blocks whose legs
// are all known are skipped.

export const CHUNK = 12;
/** At most this many requests per call: 60 points need 25. */
export const MAX_BLOCKS = 25;

export type Block = { sources: number[]; destinations: number[] };

/** [known] answers whether the leg from point i to point j is already cached. */
export function missingBlocks(count: number, known: (from: number, to: number) => boolean): Block[] {
  const chunks: number[][] = [];
  for (let start = 0; start < count; start += CHUNK)
    chunks.push(Array.from({ length: Math.min(CHUNK, count - start) }, (_, i) => start + i));
  const blocks: Block[] = [];
  for (const sources of chunks) for (const destinations of chunks) {
    if (sources.some(i => destinations.some(j => i !== j && !known(i, j)))) blocks.push({ sources, destinations });
  }
  return blocks.slice(0, MAX_BLOCKS);
}

/** The coordinates one block sends, and where its sources and destinations sit among them. */
export function blockRequest(block: Block) {
  const points = [...new Set([...block.sources, ...block.destinations])];
  const position = new Map(points.map((point, index) => [point, index]));
  return {
    points,
    sources: block.sources.map(point => position.get(point)!),
    destinations: block.destinations.map(point => position.get(point)!),
  };
}
