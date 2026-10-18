/** MPEG audio (MP3, MP2, MP1) frame header parsing. */

export interface FrameHeader {
    /** 1 = MPEG-1, 2 = MPEG-2, 2.5 = MPEG-2.5 */
    version: 1 | 2 | 2.5;
    layer: 1 | 2 | 3;
    /** bits per second */
    bitrate: number;
    sampleRate: number;
    /** frame length in bytes, header included */
    length: number;
    /** frame duration in seconds */
    duration: number;
}

/** Largest possible frame (MPEG-2 layer II, 160 kbps, 8 kHz, padded). */
export const MAX_FRAME_LENGTH = 2881;

// kbps, indexed by bitrate index (0 = free format, unsupported)
const BITRATES = {
    v1l1: [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
    v1l2: [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
    v1l3: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
    v2l1: [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
    v2l23: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};

const SAMPLE_RATES = {
    1: [44100, 48000, 32000],
    2: [22050, 24000, 16000],
    2.5: [11025, 12000, 8000],
};

/** Parses the 4-byte frame header at `offset`, or returns null if it isn't a valid header. */
export function parseFrameHeader(buf: Buffer, offset = 0): FrameHeader | null {
    if (offset + 4 > buf.length) return null;

    const b1 = buf[offset + 1];
    const b2 = buf[offset + 2];
    if (buf[offset] !== 0xff || (b1 & 0xe0) !== 0xe0) return null;

    const versionBits = (b1 >> 3) & 0b11;
    const layerBits = (b1 >> 1) & 0b11;
    const bitrateIndex = b2 >> 4;
    const sampleRateIndex = (b2 >> 2) & 0b11;
    const padding = (b2 >> 1) & 1;

    if (versionBits === 0b01 || layerBits === 0b00) return null;
    if (bitrateIndex === 0 || bitrateIndex === 0b1111 || sampleRateIndex === 0b11) return null;

    const version = versionBits === 0b11 ? 1 : versionBits === 0b10 ? 2 : 2.5;
    const layer = (4 - layerBits) as 1 | 2 | 3;

    const table =
        version === 1
            ? layer === 1
                ? BITRATES.v1l1
                : layer === 2
                  ? BITRATES.v1l2
                  : BITRATES.v1l3
            : layer === 1
              ? BITRATES.v2l1
              : BITRATES.v2l23;

    const bitrate = table[bitrateIndex] * 1000;
    const sampleRate = SAMPLE_RATES[version][sampleRateIndex];
    const samples = layer === 1 ? 384 : layer === 3 && version !== 1 ? 576 : 1152;

    const length =
        layer === 1
            ? (Math.floor((12 * bitrate) / sampleRate) + padding) * 4
            : Math.floor(((samples / 8) * bitrate) / sampleRate) + padding;

    return { version, layer, bitrate, sampleRate, length, duration: samples / sampleRate };
}

/** Size of the ID3v2 tag at `offset` (header and footer included), 0 if there is none. */
export function id3v2Size(buf: Buffer, offset = 0): number {
    if (offset + 10 > buf.length) return 0;
    if (buf.toString("latin1", offset, offset + 3) !== "ID3") return 0;

    const size = buf.subarray(offset + 6, offset + 10);
    if (size.some((b) => b & 0x80)) return 0;

    const hasFooter = (buf[offset + 5] & 0x10) !== 0;
    return 10 + ((size[0] << 21) | (size[1] << 14) | (size[2] << 7) | size[3]) + (hasFooter ? 10 : 0);
}

/** Whether the layer III frame at `offset` is a Xing, Info or VBRI header frame, which decoders don't play. */
export function isInfoFrame(buf: Buffer, offset: number, header: FrameHeader): boolean {
    if (header.layer !== 3) return false;

    const hasCrc = (buf[offset + 1] & 1) === 0;
    const mono = buf[offset + 3] >> 6 === 0b11;
    const sideInfo = header.version === 1 ? (mono ? 17 : 32) : mono ? 9 : 17;
    const xing = offset + 4 + (hasCrc ? 2 : 0) + sideInfo;
    const tag = (at: number) => (at + 4 <= buf.length ? buf.toString("latin1", at, at + 4) : "");

    return tag(xing) === "Xing" || tag(xing) === "Info" || tag(offset + 36) === "VBRI";
}
