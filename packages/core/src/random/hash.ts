/**
 * Deterministic, non-cryptographic hashing used for seeding streams and for
 * memoising pipeline stages. All functions are pure and produce identical
 * results on every JavaScript engine (32-bit integer arithmetic only).
 */

/** cyrb128: 128-bit hash of a string, returned as four 32-bit unsigned ints. */
export function hash128(str: string): [number, number, number, number] {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  // Finalise so that similar inputs diverge.
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

/** cyrb53: 53-bit hash of a string as a non-negative safe integer. */
export function hash53(str: string, seed = 0): number {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/** Hex string of a 128-bit hash. */
export function hashHex(str: string): string {
  return hash128(str)
    .map((n) => n.toString(16).padStart(8, '0'))
    .join('');
}

/**
 * Stable serialisation: object keys sorted, typed arrays encoded by kind and
 * bytes, `undefined` dropped, so structurally equal values hash equally
 * regardless of construction order.
 */
export function stableStringify(value: unknown): string {
  const out: string[] = [];
  write(value, out);
  return out.join('');
}

function write(value: unknown, out: string[]): void {
  if (value === null || value === undefined) {
    out.push('null');
    return;
  }
  switch (typeof value) {
    case 'number':
      out.push(Number.isFinite(value) ? String(value) : 'null');
      return;
    case 'string':
      out.push(JSON.stringify(value));
      return;
    case 'boolean':
      out.push(value ? 'true' : 'false');
      return;
    case 'bigint':
      out.push(`"${value.toString()}n"`);
      return;
    case 'object':
      break;
    default:
      throw new TypeError(`Cannot stably serialise a ${typeof value}`);
  }
  if (ArrayBuffer.isView(value)) {
    const view = value as ArrayBufferView & { constructor: { name: string } };
    const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
    out.push(`{"$typed":"${view.constructor.name}","$bytes":"`);
    // Hash the bytes rather than emitting them all; keeps stage keys short.
    let h1 = 0x811c9dc5;
    let h2 = 0x01000193;
    for (let i = 0; i < bytes.length; i++) {
      h1 = Math.imul(h1 ^ bytes[i]!, 16777619);
      h2 = Math.imul(h2 + bytes[i]!, 2246822519) ^ (h2 >>> 15);
    }
    out.push(`${bytes.length}:${(h1 >>> 0).toString(16)}${(h2 >>> 0).toString(16)}"}`);
    return;
  }
  if (Array.isArray(value)) {
    out.push('[');
    for (let i = 0; i < value.length; i++) {
      if (i > 0) out.push(',');
      write(value[i], out);
    }
    out.push(']');
    return;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  out.push('{');
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i]!;
    if (i > 0) out.push(',');
    out.push(JSON.stringify(k), ':');
    write(obj[k], out);
  }
  out.push('}');
}

/** Content hash of any JSON-like value (see `stableStringify`). */
export function contentHash(value: unknown): string {
  return hashHex(stableStringify(value));
}
