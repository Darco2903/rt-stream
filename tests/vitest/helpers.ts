import fs from "fs";
import os from "os";
import path from "path";

// MPEG-1 layer III, 48 kHz: every frame lasts 1152 / 48000 = 24ms
export const FRAME_DURATION = 0.024;
const BITRATE_INDEX: Record<number, number> = { 32: 1, 64: 5, 128: 9, 320: 14 };

/** A valid MPEG-1 layer III 48 kHz stereo frame, payload filled with `fill`. */
export function frame(kbps: number, fill = 0): Buffer {
    const length = (144 * kbps * 1000) / 48000;
    const buf = Buffer.alloc(length, fill);
    buf[0] = 0xff;
    buf[1] = 0xfb;
    buf[2] = (BITRATE_INDEX[kbps] << 4) | (1 << 2);
    buf[3] = 0x00;
    return buf;
}

/** Frame `k` of a fixture, payload filled with `k + 1` so frames can be told apart. */
export function frames(kbps: number[]): Buffer[] {
    return kbps.map((rate, k) => frame(rate, k + 1));
}

export function id3v2(payload: number): Buffer {
    const header = Buffer.from([0x49, 0x44, 0x33, 3, 0, 0, 0, 0, 0, 0]);
    header[6] = (payload >> 21) & 0x7f;
    header[7] = (payload >> 14) & 0x7f;
    header[8] = (payload >> 7) & 0x7f;
    header[9] = payload & 0x7f;
    return Buffer.concat([header, Buffer.alloc(payload)]);
}

export function tempDir(): { file: (name: string, data: Buffer) => string; cleanup: () => Promise<void> } {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rt-stream-"));
    return {
        file(name, data) {
            const file = path.join(dir, name);
            fs.writeFileSync(file, data);
            return file;
        },
        async cleanup() {
            fs.rmSync(dir, { recursive: true, force: true });
        },
    };
}
