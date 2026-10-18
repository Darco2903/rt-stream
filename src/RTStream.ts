import { Readable } from "stream";
import { open, type FileHandle } from "fs/promises";
import { ConstantBitrate, Mp3, type MediaFormat } from "./formats.js";

export interface RTStreamOptions {
    /**
     * Constant bitrate in bits per second, for any file type.
     * Omit it to time MPEG audio (MP3) frames from their headers, which handles variable bitrate.
     */
    bitrate?: number;
    /** Maximum bytes per chunk, default 32_000. MP3 chunks hold whole frames, at least one. */
    chunkSize?: number;
    /** Seconds of media sent at once on start and after each seek, so clients can buffer. Default 0. */
    burst?: number;
    /** Start position in seconds, default 0. */
    start?: number;
}

/** Reads a media file at playback speed. */
export class RTStream extends Readable {
    public readonly path: string;
    public readonly chunkSize: number;
    public readonly burst: number;

    private format: MediaFormat;
    private fh?: FileHandle;
    private position = 0; // file offset of the next chunk
    private seekTarget: number | null = null;

    private mediaStart = 0; // media time at which the playback clock started
    private mediaSent = 0; // media seconds sent since the clock started
    private clockStart: number | null = null; // timestamp at which the playback clock started
    private pausedAt: number | null = null;

    private generation = 0; // bumped by seek() to discard in-flight reads
    private wake?: () => void;

    constructor(path: string, { bitrate, chunkSize = 32_000, burst = 0, start = 0 }: RTStreamOptions = {}) {
        if (bitrate !== undefined && !(bitrate > 0 && Number.isFinite(bitrate))) {
            throw new RangeError("RTStream: bitrate must be a positive number");
        }
        if (!Number.isInteger(chunkSize) || chunkSize <= 0) {
            throw new RangeError("RTStream: chunkSize must be a positive integer");
        }
        assertTime(burst, "burst");
        assertTime(start, "start");

        super({ highWaterMark: 0 });
        this.path = path;
        this.chunkSize = chunkSize;
        this.burst = burst;
        this.format = bitrate === undefined ? new Mp3() : new ConstantBitrate(bitrate);
        if (start > 0) {
            this.seekTarget = start;
            this.mediaStart = start;
        }
    }

    /** Media time (seconds) of the data sent so far, burst included. */
    public get currentTime(): number {
        return this.mediaStart + this.mediaSent;
    }

    public get playing(): boolean {
        return this.pausedAt === null;
    }

    /** Stops playback. Unrelated to `pause()`, which is Readable flow control. */
    public stop(): void {
        if (!this.playing) return;
        this.pausedAt = Date.now();
        this.kick();
    }

    /** Resumes playback where it stopped. */
    public play(): void {
        if (this.playing) return;
        if (this.clockStart !== null) this.clockStart += Date.now() - this.pausedAt!;
        this.pausedAt = null;
        this.kick();
    }

    /** Jumps to `time` seconds (MP3: the frame starting at or before it) and sends a new burst. */
    public seek(time: number): void {
        assertTime(time, "time");
        this.seekTarget = time;
        this.restartClock(time);
        this.generation++;
        this.kick();
    }

    override _construct(callback: (err?: Error | null) => void): void {
        open(this.path, "r").then(
            (fh) => {
                this.fh = fh; // closed by _destroy, which waits for this callback
                callback();
            },
            (err) => callback(this.destroyed ? null : err),
        );
    }

    override async _read(): Promise<void> {
        try {
            for (;;) {
                const generation = this.generation;

                if (this.seekTarget !== null) {
                    const { position, time } = await this.format.locate(this.seekTarget, this.readAt);
                    if (this.destroyed) return;
                    if (generation !== this.generation) continue;

                    this.seekTarget = null;
                    this.position = position;
                    this.format.reset();
                    this.restartClock(time);
                }

                const size = this.chunkSize + this.format.lookahead;
                const buf = await this.readAt(this.position, size);
                if (this.destroyed) return;
                if (generation !== this.generation) continue;

                const chunk = this.format.nextChunk(buf, this.chunkSize, buf.length < size);
                if (chunk.length === 0) {
                    if (chunk.skip === 0) {
                        this.push(null);
                        return;
                    }
                    this.position += chunk.skip;
                    continue;
                }

                this.clockStart ??= this.pausedAt ?? Date.now();
                await this.waitUntilDue(generation);
                if (this.destroyed) return;
                if (generation !== this.generation) continue;

                this.position += chunk.skip + chunk.length;
                this.mediaSent += chunk.duration;
                this.push(buf.subarray(chunk.skip, chunk.skip + chunk.length));
                return;
            }
        } catch (err) {
            if (!this.destroyed) this.destroy(err as Error);
        }
    }

    override _destroy(err: Error | null, callback: (err?: Error | null) => void): void {
        this.kick();
        const fh = this.fh;
        this.fh = undefined;
        if (!fh) return callback(err);
        fh.close().then(
            () => callback(err),
            (closeErr) => callback(err ?? closeErr),
        );
    }

    private readAt = async (position: number, length: number): Promise<Buffer> => {
        if (!this.fh) throw new Error("RTStream: file is closed");
        const buf = Buffer.allocUnsafe(length);
        const { bytesRead } = await this.fh.read(buf, 0, length, position);
        return bytesRead === length ? buf : buf.subarray(0, bytesRead);
    };

    private restartClock(time: number): void {
        this.mediaStart = time;
        this.mediaSent = 0;
        this.clockStart = this.pausedAt ?? Date.now();
    }

    /** Waits until the next chunk is due, or until a seek or destroy makes it stale. */
    private async waitUntilDue(generation: number): Promise<void> {
        for (;;) {
            if (this.destroyed || generation !== this.generation) return;

            let delay = Infinity; // stopped: wait for play(), seek() or destroy()
            if (this.playing) {
                const due = this.clockStart! + Math.max(0, this.mediaSent - this.burst) * 1000;
                delay = due - Date.now();
                if (delay <= 0) return;
            }

            await new Promise<void>((resolve) => {
                const timer = delay === Infinity ? undefined : setTimeout(resolve, delay);
                this.wake = () => {
                    clearTimeout(timer);
                    resolve();
                };
            });
        }
    }

    private kick(): void {
        const wake = this.wake;
        this.wake = undefined;
        wake?.();
    }
}

function assertTime(value: number, name: string): void {
    if (!(value >= 0 && Number.isFinite(value))) {
        throw new RangeError(`RTStream: ${name} must be a non-negative number of seconds`);
    }
}
