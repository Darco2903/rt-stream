import { Readable } from "stream";
import { FixedChunkTransform } from "../../src/index.js";

function collect(input: Buffer[], chunkSize: number): Promise<Buffer[]> {
    const out: Buffer[] = [];
    const stream = Readable.from(input).pipe(new FixedChunkTransform(chunkSize));
    return new Promise((resolve, reject) => {
        stream.on("data", (chunk: Buffer) => out.push(chunk));
        stream.on("end", () => resolve(out));
        stream.on("error", reject);
    });
}

describe("FixedChunkTransform", () => {
    it("re-chunks input into fixed-size chunks", async () => {
        const data = Buffer.from(Array.from({ length: 25 }, (_, i) => i));
        const input = [data.subarray(0, 3), data.subarray(3, 14), data.subarray(14, 15), data.subarray(15)];

        const out = await collect(input, 10);

        expect(out.map((c) => c.length)).toEqual([10, 10, 5]);
        expect(Buffer.concat(out)).toEqual(data);
    });

    it("splits a single large chunk", async () => {
        const data = Buffer.alloc(35, 7);
        const out = await collect([data], 10);

        expect(out.map((c) => c.length)).toEqual([10, 10, 10, 5]);
        expect(Buffer.concat(out)).toEqual(data);
    });

    it("emits no trailing chunk when input is an exact multiple", async () => {
        const out = await collect([Buffer.alloc(20)], 10);
        expect(out.map((c) => c.length)).toEqual([10, 10]);
    });

    it("emits nothing for empty input", async () => {
        expect(await collect([], 10)).toEqual([]);
    });
});
