import { MAX_BITRATE, MAX_FRAME_LENGTH, id3v2Size, isInfoFrame, parseFrameHeader, type FrameHeader } from "./mpeg.js";

export interface Chunk {
    /** bytes to drop before the chunk (tags, garbage) */
    skip: number;
    /** chunk length in bytes, 0 if no chunk starts within the buffer */
    length: number;
    /** chunk duration in seconds */
    duration: number;
}

export type ReadAt = (position: number, length: number) => Promise<Buffer>;

export interface MediaFormat {
    /** Bytes `nextChunk` needs past `maxLength` to find chunk boundaries. */
    readonly lookahead: number;
    /**
     * Cuts the next chunk, at most `maxLength` bytes and `maxDuration` seconds, out of `buf`,
     * which holds the file data at the current position.
     * `eof` is true when `buf` reaches the end of the file.
     * Returns `{ skip: 0, length: 0 }` once there is nothing left to send.
     */
    nextChunk(buf: Buffer, maxLength: number, maxDuration: number, eof: boolean): Chunk;
    /** Upper bound of the bytes a chunk of `duration` seconds can take. */
    maxBytes(duration: number): number;
    /** Finds the chunk boundary at or before media time `time` (seconds). */
    locate(time: number, readAt: ReadAt): Promise<{ position: number; time: number }>;
    /** Called after jumping to a position returned by `locate`. */
    reset(): void;
}

/** Fixed byte rate, works with any file. */
export class ConstantBitrate implements MediaFormat {
    readonly lookahead = 0;

    constructor(readonly bitrate: number) {}

    public nextChunk(buf: Buffer, maxLength: number, maxDuration: number): Chunk {
        const length = Math.min(buf.length, maxLength, this.maxBytes(maxDuration));
        return { skip: 0, length, duration: (length * 8) / this.bitrate };
    }

    public maxBytes(duration: number): number {
        return Math.max(1, Math.floor((duration * this.bitrate) / 8));
    }

    public async locate(time: number): Promise<{ position: number; time: number }> {
        const position = Math.floor((time * this.bitrate) / 8);
        return { position, time: (position * 8) / this.bitrate };
    }

    public reset(): void {}
}

const SCAN_BLOCK = 64 * 1024;
const EPSILON = 1e-9;

/** MPEG audio (MP3) timed from frame headers, so variable bitrate files play at the right speed. */
export class Mp3 implements MediaFormat {
    public readonly lookahead = 2 * MAX_FRAME_LENGTH + 4;

    /** First accepted frame, later frames must share its version, layer and sample rate. */
    private locked: FrameHeader | null = null;
    /** Whether the current position is known to be a frame boundary. */
    private synced = false;

    /** Seek index: start position and time of every frame scanned so far. */
    private index = {
        positions: [] as number[],
        times: [] as number[],
        position: 0,
        time: 0,
        done: false,
        scanner: null as Mp3 | null,
    };

    public nextChunk(buf: Buffer, maxLength: number, maxDuration: number, eof: boolean): Chunk {
        let i = 0;
        let first: FrameHeader | null = null;

        while (!first) {
            if (i + 4 > buf.length) {
                if (eof && !this.locked && this.index.positions.length === 0) {
                    throw new Error("No MPEG audio frames found");
                }
                return { skip: eof ? buf.length : i, length: 0, duration: 0 };
            }

            const tag = id3v2Size(buf, i);
            if (tag) {
                this.synced = false;
                return { skip: i + tag, length: 0, duration: 0 };
            }

            const header = parseFrameHeader(buf, i);
            const verdict = header && this.matches(header) ? this.verify(buf, i, header, eof) : "no";
            if (verdict === "more") return { skip: i, length: 0, duration: 0 };
            if (verdict === "yes") {
                first = header;
            } else {
                this.synced = false;
                i++;
            }
        }

        this.locked ??= first;

        if (i + first.length > buf.length) {
            // truncated last frame
            const length = buf.length - i;
            return { skip: i, length, duration: (first.duration * length) / first.length };
        }

        let length = first.length;
        let duration = isInfoFrame(buf, i, first) ? 0 : first.duration;
        for (;;) {
            const header = parseFrameHeader(buf, i + length);
            if (!header || !this.matches(header)) break;
            if (length + header.length > maxLength || i + length + header.length > buf.length) break;
            if (duration + header.duration > maxDuration + EPSILON) break;
            length += header.length;
            duration += header.duration;
        }

        this.synced = true;
        return { skip: i, length, duration };
    }

    public async locate(time: number, readAt: ReadAt): Promise<{ position: number; time: number }> {
        const index = this.index;
        while (!index.done && index.time <= time + EPSILON) await this.scanBlock(readAt);

        const { positions, times } = index;
        if (positions.length === 0 || time >= index.time - EPSILON) {
            return { position: index.position, time: index.time };
        }

        let lo = 0;
        let hi = times.length - 1;
        while (lo < hi) {
            const mid = (lo + hi + 1) >> 1;
            if (times[mid] <= time + EPSILON) lo = mid;
            else hi = mid - 1;
        }
        return { position: positions[lo], time: times[lo] };
    }

    public maxBytes(duration: number): number {
        return Math.ceil((duration * MAX_BITRATE) / 8) + MAX_FRAME_LENGTH;
    }

    public reset(): void {
        this.synced = false;
    }

    private matches(header: FrameHeader): boolean {
        const locked = this.locked;
        return (
            !locked ||
            (header.version === locked.version &&
                header.layer === locked.layer &&
                header.sampleRate === locked.sampleRate)
        );
    }

    /** Checks a candidate frame against the header that should follow it, to reject false syncs. */
    private verify(buf: Buffer, i: number, header: FrameHeader, eof: boolean): "yes" | "no" | "more" {
        if (this.synced && i === 0) return "yes";

        const next = i + header.length;
        if (next + 4 <= buf.length) {
            const following = parseFrameHeader(buf, next);
            return following &&
                following.version === header.version &&
                following.layer === header.layer &&
                following.sampleRate === header.sampleRate
                ? "yes"
                : "no";
        }
        if (eof) return next === buf.length ? "yes" : "no";
        return i === 0 ? "yes" : "more";
    }

    private async scanBlock(readAt: ReadAt): Promise<void> {
        const index = this.index;
        const scanner = (index.scanner ??= new Mp3());
        const buf = await readAt(index.position, SCAN_BLOCK);
        const eof = buf.length < SCAN_BLOCK;

        let offset = 0;
        while (eof ? offset < buf.length : buf.length - offset >= scanner.lookahead) {
            const chunk = scanner.nextChunk(buf.subarray(offset), 0, 0, eof);
            offset += chunk.skip;
            if (chunk.length === 0) {
                if (chunk.skip === 0) break;
                continue;
            }
            index.positions.push(index.position + offset);
            index.times.push(index.time);
            index.time += chunk.duration;
            offset += chunk.length;
        }

        index.position += offset;
        if (eof) index.done = true;
    }
}
