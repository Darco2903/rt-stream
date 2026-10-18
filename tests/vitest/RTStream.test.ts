import { Writable } from "stream";
import { RTStream, type RTStreamOptions } from "../../src/index.js";
import { FRAME_DURATION, frames, id3v2, tempDir } from "./helpers.js";

const FRAME_MS = FRAME_DURATION * 1000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const tmp = tempDir();
afterAll(tmp.cleanup);

// constant bitrate: 100 bytes every 50ms
const CBR = { bitrate: (100 * 8 * 1000) / 50, chunkSize: 100 };
const raw = Buffer.from(Array.from({ length: 450 }, (_, i) => i % 256));
const rawFile = tmp.file("raw.bin", raw);

// variable bitrate: 5 big frames then 15 small ones, 24ms each
const vbrFrames = frames([320, 320, 320, 320, 320, ...Array(15).fill(32)]);
const vbrFile = tmp.file("vbr.mp3", Buffer.concat([id3v2(100), ...vbrFrames]));

interface Received {
    chunks: Buffer[];
    times: number[];
}

function play(file: string, options: RTStreamOptions, control?: (rt: RTStream) => unknown): Promise<Received> {
    const rt = new RTStream(file, options);
    const chunks: Buffer[] = [];
    const times: number[] = [];
    const start = Date.now();
    rt.on("data", (chunk: Buffer) => {
        chunks.push(chunk);
        times.push(Date.now() - start);
    });
    control?.(rt);
    return new Promise((resolve, reject) => {
        rt.on("end", () => resolve({ chunks, times }));
        rt.on("error", reject);
    });
}

const gaps = (times: number[]) => times.slice(1).map((t, i) => t - times[i]);

describe("RTStream", () => {
    describe("constant bitrate", () => {
        it("streams the whole file in chunks paced by the bitrate", async () => {
            const { chunks, times } = await play(rawFile, CBR);

            expect(chunks.map((c) => c.length)).toEqual([100, 100, 100, 100, 50]);
            expect(Buffer.concat(chunks)).toEqual(raw);
            expect(times[0]).toBeLessThan(30);
            expect(times.at(-1)).toBeGreaterThanOrEqual(195);
            expect(times.at(-1)).toBeLessThan(260);
        });

        it("seeks by time", async () => {
            const { chunks } = await play(rawFile, { ...CBR, start: 0.125 }); // 250 bytes in
            expect(Buffer.concat(chunks)).toEqual(raw.subarray(250));
        });
    });

    describe("mp3", () => {
        it("sends whole frames, dropping tags", async () => {
            const { chunks } = await play(vbrFile, { chunkSize: 1 });
            expect(chunks).toEqual(vbrFrames);
        });

        it("paces variable bitrate frames by duration, not size", async () => {
            const { times } = await play(vbrFile, { chunkSize: 1 });

            // the 960-byte frames take as long as the 96-byte ones
            expect(times[5]).toBeGreaterThanOrEqual(5 * FRAME_MS - 2);
            expect(times[5]).toBeLessThan(5 * FRAME_MS + 40);
            expect(times[19]).toBeGreaterThanOrEqual(19 * FRAME_MS - 2);
            expect(times[19]).toBeLessThan(19 * FRAME_MS + 60);
        });

        it("seeks to the frame starting at or before the time", async () => {
            const { chunks } = await play(vbrFile, { chunkSize: 1, start: 0.1 }); // frame 4 starts at 96ms
            expect(chunks).toEqual(vbrFrames.slice(4));
        });

        it("errors on a file without frames", async () => {
            const text = tmp.file("text.mp3", Buffer.from("definitely not audio"));
            await expect(play(text, {})).rejects.toThrow("No MPEG audio frames found");
        });
    });

    describe("burst", () => {
        it("sends the first seconds at once, then plays in real time", async () => {
            const { times } = await play(vbrFile, { chunkSize: 1, burst: 0.2 });
            const burst = times.filter((t) => t < 15).length;

            // frames starting at or before 200ms: 0..8, frame 9 at 216ms is due 16ms in
            expect(burst).toBeGreaterThanOrEqual(8);
            expect(burst).toBeLessThanOrEqual(9);
            expect(times[19]).toBeGreaterThanOrEqual(19 * FRAME_MS - 200 - 2);
            expect(times[19]).toBeLessThan(19 * FRAME_MS - 200 + 60);
        });

        it("bursts again after a seek", async () => {
            const { chunks, times } = await play(vbrFile, { chunkSize: 1, burst: 0.1 }, async (rt) => {
                await sleep(150);
                rt.seek(0);
            });
            const seekAt = times.findIndex((t, i) => i > 0 && chunks[i].equals(vbrFrames[0]));

            expect(seekAt).toBeGreaterThan(0);
            expect(times[seekAt + 4] - times[seekAt]).toBeLessThan(15);
            expect(chunks.slice(seekAt)).toEqual(vbrFrames);
        });
    });

    describe("stop and play", () => {
        it("keeps the pace across several stops", async () => {
            const { chunks, times } = await play(rawFile, CBR, async (rt) => {
                await sleep(70);
                rt.stop();
                expect(rt.playing).toBe(false);
                await sleep(100);
                rt.play();
                await sleep(60);
                rt.stop();
                await sleep(100);
                rt.play();
            });

            expect(Buffer.concat(chunks)).toEqual(raw);
            for (const gap of gaps(times)) expect(gap).toBeGreaterThanOrEqual(45);
            expect(times.at(-1)).toBeGreaterThanOrEqual(395);
            expect(times.at(-1)).toBeLessThan(470);
        });

        it("works while piped into a slow consumer", async () => {
            const rt = new RTStream(rawFile, CBR);
            const received: Buffer[] = [];
            const sink = new Writable({
                highWaterMark: 1,
                write(chunk, _encoding, callback) {
                    received.push(chunk);
                    setTimeout(callback, 80);
                },
            });
            rt.pipe(sink);
            await sleep(60);
            rt.stop();
            await sleep(30);
            rt.play();
            await new Promise((resolve, reject) => {
                sink.on("finish", resolve);
                rt.on("error", reject);
            });

            expect(Buffer.concat(received)).toEqual(raw);
        });
    });

    it("reports the media time sent", async () => {
        const rt = new RTStream(vbrFile, { chunkSize: 1, start: 0.1 });
        expect(rt.currentTime).toBe(0.1);
        await new Promise((resolve) => rt.once("data", resolve));
        expect(rt.currentTime).toBeCloseTo(4 * FRAME_DURATION + FRAME_DURATION);
        rt.destroy();
    });

    it("emits errors for missing files", async () => {
        await expect(play("/nonexistent/file.mp3", {})).rejects.toMatchObject({ code: "ENOENT" });
    });

    it("emits close when destroyed, even after seeks", async () => {
        const rt = new RTStream(rawFile, CBR);
        rt.resume();
        for (let i = 0; i < 5; i++) {
            rt.seek(i * 0.01);
            await sleep(5);
        }
        const closed = new Promise((resolve) => rt.on("close", resolve));
        rt.destroy();
        await closed;
        expect(rt.destroyed).toBe(true);
    });

    it.each<[string, RTStreamOptions]>([
        ["chunkSize 0", { chunkSize: 0 }],
        ["negative bitrate", { bitrate: -1 }],
        ["NaN burst", { burst: NaN }],
        ["negative start", { start: -1 }],
    ])("rejects %s", (_, options) => {
        expect(() => new RTStream(rawFile, options)).toThrow(RangeError);
    });

    it("ignores open errors after an early destroy", async () => {
        const rt = new RTStream("/nonexistent/file.mp3");
        const errors: Error[] = [];
        rt.on("error", (err) => errors.push(err));
        rt.destroy();
        await new Promise((resolve) => rt.on("close", resolve));
        expect(errors).toEqual([]);
    });

    it("rejects negative seeks", () => {
        const rt = new RTStream(rawFile, CBR);
        expect(() => rt.seek(-1)).toThrow(RangeError);
        rt.destroy();
    });
});
