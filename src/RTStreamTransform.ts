import { Transform, TransformCallback } from "stream";

export class RTStreamTransform extends Transform {
    protected _delay: number;
    protected _delayFix: number;
    protected _sendTimeout: number;
    protected _sendTimeoutStart: number;
    protected _elapsedDelay: number;
    protected _lastCall: Function | null;

    protected static _calculateDelay(chunkSize: number, bitrate: number): number {
        return (chunkSize / (bitrate / 8)) * 1000;
    }

    constructor(bitrate: number, chunkSize: number = 32_000) {
        super();
        this._delay = RTStreamTransform._calculateDelay(chunkSize, bitrate);
        this._delayFix = 0;
        this._sendTimeout = 0;
        this._sendTimeoutStart = 0;
        this._elapsedDelay = 0;
        this._lastCall = null;
    }

    protected _call(chunk: any, callback: TransformCallback): void {
        const diff = Date.now() - this._sendTimeoutStart - this._delay;
        this._delayFix = this._delay - diff;
        this.push(chunk);
        callback();
    }

    public _transform(chunk: any, encoding: BufferEncoding, callback: TransformCallback): void {
        this._sendTimeoutStart = Date.now();

        if (this._delayFix <= 0) {
            this.push(chunk);
            this._delayFix = this._delay;
            callback();
        } else {
            this._lastCall = this._call.bind(this, chunk, callback);
            this._sendTimeout = setTimeout(this._lastCall, this._delayFix);
        }
    }

    public resume(): this {
        if (!this.isPaused()) {
            // console.log("TRStream: already resumed");
            return super.resume();
        }

        const remaining = this._delay - this._elapsedDelay;
        if (this._lastCall) {
            this._sendTimeoutStart = Date.now() - this._elapsedDelay;
            this._sendTimeout = setTimeout(this._lastCall, remaining);
        }

        // console.log("delay:", this._delay, "elapsed:", this._elapsedDelay, "remaining:", remaining);
        return super.resume();
    }

    public pause(): this {
        if (this.isPaused()) {
            // console.log("TRStream: already paused");
            return super.pause();
        }

        this._elapsedDelay += Date.now() - this._sendTimeoutStart;
        clearTimeout(this._sendTimeout);
        this._sendTimeout = 0;
        // console.log("pause elapsed:", this._elapsedDelay);
        return super.pause();
    }
}
