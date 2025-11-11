import { Transform } from "stream";

export class FixedChunkTransform extends Transform {
    private chunkSize: number;
    private buffers: Buffer[];
    private totalLength: number;

    constructor(chunkSize: number) {
        super();
        this.chunkSize = chunkSize;
        this.buffers = [];
        this.totalLength = 0;
    }

    _transform(chunk: Buffer, _encoding: BufferEncoding, callback: Function) {
        this.buffers.push(chunk);
        this.totalLength += chunk.length;

        while (this.totalLength >= this.chunkSize) {
            let out = Buffer.allocUnsafe(this.chunkSize);
            let offset = 0;

            while (offset < this.chunkSize) {
                let buf = this.buffers[0];
                let need = this.chunkSize - offset;

                if (buf.length <= need) {
                    buf.copy(out, offset);
                    offset += buf.length;
                    this.buffers.shift();
                } else {
                    buf.copy(out, offset, 0, need);
                    this.buffers[0] = buf.subarray(need);
                    offset += need;
                }
            }

            this.totalLength -= this.chunkSize;
            this.push(out);
        }

        callback();
    }

    _flush(callback: Function) {
        if (this.totalLength > 0) {
            if (this.buffers.length === 1) {
                this.push(this.buffers[0]);
            } else {
                this.push(Buffer.concat(this.buffers));
            }
        }
        callback();
    }
}
