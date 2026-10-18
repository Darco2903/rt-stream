import fs from "fs";
import os from "os";
import path from "path";
import { RTStream } from "../../src/index.js";

const CHUNK = 100;
// 100 bytes per 50ms
const BITRATE = (CHUNK * 8 * 1000) / 50;

let dir: string;
let file: string;
const data = Buffer.from(Array.from({ length: 450 }, (_, i) => i % 256));

beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "rt-stream-"));
    file = path.join(dir, "data.bin");
    fs.writeFileSync(file, data);
});

afterAll(async () => {
    // destroy() does not close the underlying fs.ReadStream, let pending opens settle first
    await new Promise((r) => setTimeout(r, 50));
    fs.rmSync(dir, { recursive: true, force: true });
});

function readAll(rt: RTStream): Promise<{ chunks: Buffer[]; times: number[] }> {
    const chunks: Buffer[] = [];
    const times: number[] = [];
    const start = Date.now();
    return new Promise((resolve, reject) => {
        rt.stream.on("data", (chunk: Buffer) => {
            chunks.push(chunk);
            times.push(Date.now() - start);
        });
        rt.stream.on("end", () => resolve({ chunks, times }));
        rt.stream.on("error", reject);
    });
}

describe("RTStream", () => {
    it("exposes its configuration", () => {
        const rt = new RTStream(file, BITRATE, CHUNK);
        expect(rt.input).toBe(file);
        expect(rt.bitrate).toBe(BITRATE);
        expect(rt.chunkSize).toBe(CHUNK);
        rt.destroy();
    });

    it("streams the whole file in fixed-size chunks", async () => {
        const { chunks } = await readAll(new RTStream(file, BITRATE, CHUNK));

        expect(chunks.map((c) => c.length)).toEqual([100, 100, 100, 100, 50]);
        expect(Buffer.concat(chunks)).toEqual(data);
    });

    it("paces chunks according to the bitrate", async () => {
        const { times } = await readAll(new RTStream(file, BITRATE, CHUNK));

        // first chunk is immediate, the next 4 are spaced ~50ms apart
        expect(times[0]).toBeLessThan(40);
        expect(times[times.length - 1]).toBeGreaterThanOrEqual(180);
    });

    it("seeks to a byte offset", async () => {
        const rt = new RTStream(file, BITRATE, CHUNK);
        rt.seek(250);
        const { chunks } = await readAll(rt);

        expect(Buffer.concat(chunks)).toEqual(data.subarray(250));
    });

    it("keeps listeners attached across a seek", async () => {
        const rt = new RTStream(file, BITRATE, CHUNK);
        const result = readAll(rt);
        await new Promise((r) => setTimeout(r, 10));
        rt.seek(400);
        const { chunks } = await result;

        expect(Buffer.concat(chunks).subarray(-50)).toEqual(data.subarray(400));
    });

    it("pauses and resumes", async () => {
        const rt = new RTStream(file, BITRATE, CHUNK);
        rt.stream.on("data", () => {});
        expect(rt.paused).toBe(false);

        rt.pause();
        expect(rt.paused).toBe(true);

        rt.resume();
        expect(rt.paused).toBe(false);
        rt.destroy();
    });
});
