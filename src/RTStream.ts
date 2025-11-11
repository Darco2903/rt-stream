import fs from "fs";
import { Transform } from "stream";

export class RTStream extends Transform {
    protected _fd: number;
    protected _buffer: Buffer;
    protected _bitrate: number;
    protected _chunkSize: number;
    protected _delay: number;
    protected _bytesSent: number;
    protected _sendTimeout: NodeJS.Timeout | null;
    protected _sendTimeoutStart: number;
    protected _elapsedDelay: number;
    protected _paused: boolean;

    constructor(fd: number, bitrate: number, chunkSize: number = 32_000) {
        super();
        this._fd = fd;
        this._bitrate = bitrate;
        this._chunkSize = chunkSize;
        this._buffer = Buffer.alloc(chunkSize);
        this._delay = this._calculateDelay(chunkSize);
        this._bytesSent = 0;
        this._sendTimeout = null;
        this._sendTimeoutStart = 0;
        this._elapsedDelay = 0;
        this._paused = false;
        this._stream(this._delay);
    }

    protected _calculateDelay(chunkSize: number): number {
        return (chunkSize / (this._bitrate / 8)) * 1000;
    }

    protected _stream(delay: number): void {
        this._sendTimeoutStart = Date.now();
        this._sendTimeout = setTimeout(async () => {
            await this._read();
            this._send();
            // const elapsed = Date.now() - this.#sendTimeoutStart;
            // const diff = elapsed - delay;
            // console.log("delay", delay, "real delay", elapsed, "diff", diff);
            const diff = Date.now() - this._sendTimeoutStart - delay;
            this._stream(this._delay - diff);
        }, delay);
    }

    protected _send(): void {
        this._elapsedDelay = 0;
        this.read(this._chunkSize);
        this._bytesSent += this._chunkSize;
        // console.log("send", this.#buffer.length, this.#buffer);
    }

    public _read(): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            fs.read(this._fd, this._buffer, 0, this._chunkSize, this._bytesSent, (err, bytesRead, buffer) => {
                if (err) {
                    console.error(err);
                    reject(err);
                    return;
                }

                if (bytesRead !== 0) this.push(buffer);
                resolve();
            });
        });
    }

    public resume(): this {
        if (!this._paused) {
            // console.log("TRStream: already resumed");
            return this;
        }
        this._paused = false;
        const remaining = this._delay - this._elapsedDelay;
        this._stream(remaining);
        // console.log("delay:", this.#delay, "elapsed:", this.#elapsedDelay, "remaining:", remaining);
        return this;
    }

    public pause(): this {
        if (this._paused) {
            // console.log("TRStream: already paused");
            return this;
        }
        this._paused = true;
        this._elapsedDelay += Date.now() - this._sendTimeoutStart;
        if (this._sendTimeout) {
            clearTimeout(this._sendTimeout);
            this._sendTimeout = null;
        }
        // console.log("pause elapsed:", this.#elapsedDelay);
        return this;
    }

    public seek(offset: number): void {
        this._bytesSent = offset;
    }
}
