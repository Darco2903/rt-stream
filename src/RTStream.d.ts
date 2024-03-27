import { Transform } from "stream";

export class RTStream extends Transform {
    private #fd: number;
    private #buffer: Buffer;
    private #bitrate: number;
    private #chunkSize: number;
    private #delay: number;
    private #bytesSend: number;
    private #sendTimeout: number;
    private #sendTimeoutStart: number;
    private #elapsedDelay: number;
    private #paused: boolean;

    constructor(fd: number, bitrate: number, chunkSize: number): RTStream;

    private #calculateDelay(): number;
    private #stream(): void;
    private #send(): void;
    private #read(): Promise<void>;
    public resume(): void;
    public pause(): void;
    public seek(time: number): void;
}
