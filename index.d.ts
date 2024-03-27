/**
 * @module rt-stream
 */
declare module "rt-stream" {
    import { Transform } from "stream";

    declare class RTStream extends Transform {
        /**
         * Create a new RTStream
         *
         * @param {number} fd File descriptor
         * @param {number} bitrate Bitrate in bytes per second
         * @param {number} chunkSize Chunk size in bytes
         */
        constructor(fd: number, bitrate: number, chunkSize: number): RTStream;

        /**
         * Resume the stream
         */
        public resume(): void;

        /**
         * Pause the stream
         */
        public pause(): void;

        /**
         * Seek to a position in the stream
         *
         * @param {number} bytes Position in bytes
         */
        public seek(bytes: number): void;

        public on(event: "data", listener: (chunk: Buffer) => void): this;
    }
}
