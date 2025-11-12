import fs from "fs";
import { RTStreamTransform } from "./RTStreamTransform.js";
import { FixedChunkTransform } from "./FixedChunkTransform.js";

type HandlerMap = Map<string | symbol, Function[]>;

export class RTStream {
    protected _input: string;
    public get input(): string {
        return this._input;
    }

    protected _bitrate: number;
    public get bitrate(): number {
        return this._bitrate;
    }

    protected _chunkSize: number;
    public get chunkSize(): number {
        return this._chunkSize;
    }

    protected _rtStream: RTStreamTransform;
    public get stream(): RTStreamTransform {
        return this._rtStream;
    }

    constructor(input: string, bitrate: number, chunkSize: number = 32_000) {
        this._input = input;
        this._bitrate = bitrate;
        this._chunkSize = chunkSize;
        this._rtStream = this.initializeRTStream(0);
    }

    protected get _FixedChunkTransform(): FixedChunkTransform {
        return new FixedChunkTransform(this._chunkSize);
    }

    protected get _RTStreamTransform(): RTStreamTransform {
        return new RTStreamTransform(this._bitrate, this._chunkSize);
    }

    protected initializeRTStream(offset: number): RTStreamTransform {
        const stream = fs.createReadStream(this._input, { start: offset });
        return stream.pipe(this._FixedChunkTransform).pipe(this._RTStreamTransform);
    }

    public resume(): void {
        if (!this._rtStream) {
            throw new Error("RTStream: rtStream is not initialized");
        }
        this._rtStream.resume();
    }

    public pause(): void {
        if (!this._rtStream) {
            throw new Error("RTStream: rtStream is not initialized");
        }
        this._rtStream.pause();
    }

    protected getListenersMap(stream: RTStreamTransform): HandlerMap {
        const handlersByEvent = new Map<string | symbol, Function[]>();
        for (const event of stream.eventNames()) {
            const list = stream.listeners(event);
            switch (event) {
                case "close":
                case "error":
                case "prefinish":
                case "finish":
                case "drain":
                case "unpipe":
                    list.shift(); // remove first listener (usually internal)
            }

            handlersByEvent.set(event, list);
        }
        // console.log("Current listeners:", handlersByEvent);
        return handlersByEvent;
    }

    protected setListenersFromMap(stream: RTStreamTransform, handlersByEvent: HandlerMap): void {
        for (const [event, handlers] of handlersByEvent.entries()) {
            for (const handler of handlers) stream.on(event, handler as any);
        }
    }

    public seek(offset: number): void {
        const currentStream = this._rtStream;
        const handlersByEvent = this.getListenersMap(currentStream);

        currentStream.removeAllListeners();
        currentStream.unpipe();
        currentStream.destroy();

        this._rtStream = this.initializeRTStream(offset);
        this.setListenersFromMap(this._rtStream, handlersByEvent);
    }
}
