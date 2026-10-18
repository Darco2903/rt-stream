import { ConstantBitrate, Mp3, type MediaFormat } from "../../src/formats.js";
import { FRAME_DURATION, frame, frames, id3v2 } from "./helpers.js";

/** Runs a format over a whole file, returning the chunks with their absolute offsets. */
function drain(format: MediaFormat, file: Buffer, maxLength: number) {
    const chunks: { offset: number; length: number; duration: number }[] = [];
    let position = 0;
    for (;;) {
        const buf = file.subarray(position, position + maxLength + format.lookahead);
        const chunk = format.nextChunk(buf, maxLength, position + buf.length >= file.length);
        if (chunk.length === 0) {
            if (chunk.skip === 0) return chunks;
            position += chunk.skip;
            continue;
        }
        chunks.push({ offset: position + chunk.skip, length: chunk.length, duration: chunk.duration });
        position += chunk.skip + chunk.length;
    }
}

const readAt = (file: Buffer) => async (position: number, length: number) => file.subarray(position, position + length);

describe("ConstantBitrate", () => {
    it("cuts fixed-size chunks timed by the bitrate", () => {
        const chunks = drain(new ConstantBitrate(8000), Buffer.alloc(250), 100);
        expect(chunks).toEqual([
            { offset: 0, length: 100, duration: 0.1 },
            { offset: 100, length: 100, duration: 0.1 },
            { offset: 200, length: 50, duration: 0.05 },
        ]);
    });

    it("locates a time", async () => {
        expect(await new ConstantBitrate(8000).locate(0.25)).toEqual({
            position: 250,
            time: 0.25,
        });
    });
});

describe("Mp3", () => {
    it("groups whole frames up to maxLength", () => {
        const file = Buffer.concat(frames([320, 32, 32, 320, 32]));
        const chunks = drain(new Mp3(), file, 1100);

        expect(chunks.map((c) => c.length)).toEqual([960 + 96, 96 + 960, 96]);
        expect(chunks.map((c) => c.duration)).toEqual([2, 2, 1].map((n) => expect.closeTo(n * FRAME_DURATION)));
    });

    it("times frames, not bytes", () => {
        const file = Buffer.concat(frames([320, 32]));
        const [big, small] = drain(new Mp3(), file, 1);

        expect(big.length).toBe(10 * small.length);
        expect(big.duration).toBe(small.duration);
    });

    it("sends at least one frame when maxLength is smaller", () => {
        const chunks = drain(new Mp3(), Buffer.concat(frames([320, 320])), 10);
        expect(chunks.map((c) => c.length)).toEqual([960, 960]);
    });

    it("skips ID3v2 tags, ID3v1 tags and garbage", () => {
        const tag = id3v2(300);
        const garbage = Buffer.from([0x00, 0xff, 0xfb, 0x90, 0x00, 0x12, 0xff, 0x00]); // contains a false sync
        const audio = Buffer.concat(frames([128, 128, 128]));
        const id3v1 = Buffer.concat([Buffer.from("TAG"), Buffer.alloc(125, 0xff)]);
        const file = Buffer.concat([tag, garbage, audio, id3v1]);

        const chunks = drain(new Mp3(), file, 100_000);

        expect(chunks).toEqual([
            { offset: tag.length + garbage.length, length: audio.length, duration: expect.closeTo(3 * FRAME_DURATION) },
        ]);
    });

    it("gives the Xing frame no duration", () => {
        const xing = frame(128);
        xing.write("Xing", 36, "latin1");
        const chunks = drain(new Mp3(), Buffer.concat([xing, frame(128)]), 1);

        expect(chunks.map((c) => c.duration)).toEqual([0, FRAME_DURATION]);
    });

    it("sends a truncated last frame", () => {
        const file = Buffer.concat([frame(128), frame(128).subarray(0, 100)]);
        const chunks = drain(new Mp3(), file, 1);

        expect(chunks.map((c) => c.length)).toEqual([384, 100]);
    });

    it("throws when there are no frames", () => {
        expect(() => drain(new Mp3(), Buffer.from("not an mp3 file at all"), 100)).toThrow("No MPEG audio frames");
    });

    it("locates the frame starting at or before a time", async () => {
        const audio = frames([320, 32, 128, 32, 320]);
        const file = Buffer.concat([id3v2(50), ...audio]);
        const start = (k: number) => 60 + audio.slice(0, k).reduce((sum, f) => sum + f.length, 0);
        const mp3 = new Mp3();

        expect(await mp3.locate(0, readAt(file))).toEqual({ position: start(0), time: 0 });
        expect(await mp3.locate(0.05, readAt(file))).toEqual({ position: start(2), time: expect.closeTo(0.048) });
        expect(await mp3.locate(0.072, readAt(file))).toEqual({ position: start(3), time: expect.closeTo(0.072) });
        expect(await mp3.locate(10, readAt(file))).toEqual({ position: file.length, time: expect.closeTo(0.12) });
    });

    it("locates across scan blocks", async () => {
        const audio = frames(Array.from({ length: 200 }, (_, k) => (k % 2 ? 320 : 32))); // ~103 KB
        const file = Buffer.concat(audio);
        const position = audio.slice(0, 150).reduce((sum, f) => sum + f.length, 0);

        expect(await new Mp3().locate(150 * FRAME_DURATION, readAt(file))).toEqual({
            position,
            time: expect.closeTo(150 * FRAME_DURATION),
        });
    });
});
