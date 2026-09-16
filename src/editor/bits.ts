/**
 * Writing and reading a progress key, one bit at a time.
 *
 * Its own module because two very different things now share it — the fact
 * bitfield and the script section — and because a bit stream is the kind of code
 * that is either exactly right or silently wrong, which is an argument for
 * testing it alone rather than through whatever is using it.
 *
 * Bits go out most-significant first and the stream is padded with zeros to a
 * multiple of five at the end, which is what makes a key of `n` bits the same
 * string whether the writer knew about later sections or not. That is the
 * property that lets a version 1 key still be read by the version 2 reader.
 */

/**
 * Crockford's base32: no I, L, O or U.
 *
 * The first three because a key copied off a screenshot or read down a phone
 * must not turn a 1 into an I, and the U because it keeps accidental profanity
 * out of a string the game hands to strangers.
 */
export const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const BITS_PER_CHAR = 5;

/** What a misread character most likely was. */
const CONFUSED: Record<string, string> = { I: "1", L: "1", O: "0", U: "V" };

export class BitWriter {
  private readonly bits: number[] = [];

  /** Write `width` bits of `value`, most significant first. */
  write(value: number, width: number): void {
    for (let b = width - 1; b >= 0; b--) this.bits.push((value >>> b) & 1);
  }

  writeBit(on: boolean): void {
    this.bits.push(on ? 1 : 0);
  }

  /** Write bytes, length-prefixed by the caller. */
  writeBytes(bytes: Uint8Array): void {
    for (const byte of bytes) this.write(byte, 8);
  }

  /** The base32 body, zero-padded to a character boundary. */
  toBase32(): string {
    const out: string[] = [];
    for (let i = 0; i < this.bits.length; i += BITS_PER_CHAR) {
      let value = 0;
      for (let b = 0; b < BITS_PER_CHAR; b++) value = value * 2 + (this.bits[i + b] ?? 0);
      out.push(ALPHABET[value]!);
    }
    return out.join("");
  }
}

/** Thrown when a key claims more than it carries. Caught and reported, never logged. */
export class KeyDamaged extends Error {}

export class BitReader {
  private readonly bits: number[] = [];
  private at = 0;

  constructor(base32: string) {
    for (const c of base32) {
      const value = ALPHABET.indexOf(c);
      for (let b = BITS_PER_CHAR - 1; b >= 0; b--) this.bits.push((value >> b) & 1);
    }
  }

  /** Bits left, so a reader can tell "the key ended" from "the key lied". */
  get remaining(): number {
    return this.bits.length - this.at;
  }

  read(width: number): number {
    if (this.remaining < width) throw new KeyDamaged("that key is missing its end");
    let value = 0;
    for (let b = 0; b < width; b++) value = value * 2 + this.bits[this.at++]!;
    return value;
  }

  readBit(): boolean {
    return this.read(1) === 1;
  }

  readBytes(count: number): Uint8Array {
    const out = new Uint8Array(count);
    for (let i = 0; i < count; i++) out[i] = this.read(8);
    return out;
  }
}

/**
 * One character over the body, so a mistyped key is refused rather than obeyed.
 *
 * The failure it exists for: without a checksum a single wrong character is a
 * *valid* key for different progress, and the player is silently handed somebody
 * else's game.
 */
export function checksum(body: string): string {
  let sum = 0;
  for (const c of body) sum = (sum * 31 + ALPHABET.indexOf(c)) % ALPHABET.length;
  return ALPHABET[sum]!;
}

/** Fours, because that is how people read a code back to each other. */
export function group(s: string): string {
  return (s.match(/.{1,4}/g) ?? []).join("-");
}

/**
 * Strip everything that is not information: case, spaces, the dashes the
 * encoder added, and the four characters Crockford leaves out because they are
 * the ones people mistype.
 */
export function normalise(key: string): string {
  return [...key.trim().toUpperCase().replace(/[\s-]/g, "")]
    .map((c) => CONFUSED[c] ?? c)
    .join("");
}
