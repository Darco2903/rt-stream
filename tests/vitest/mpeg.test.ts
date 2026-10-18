import { id3v2Size, isInfoFrame, parseFrameHeader } from "../../src/mpeg.js";
import { frame, id3v2 } from "./helpers.js";

const header = (...bytes: number[]) => Buffer.from(bytes);

describe("parseFrameHeader", () => {
    it("parses MPEG-1 layer III", () => {
        expect(parseFrameHeader(header(0xff, 0xfb, 0x90, 0x00))).toEqual({
            version: 1,
            layer: 3,
            bitrate: 128_000,
            sampleRate: 44100,
            length: 417,
            duration: 1152 / 44100,
        });
        expect(parseFrameHeader(header(0xff, 0xfb, 0x92, 0x00))?.length).toBe(418); // padded
    });

    it("parses MPEG-2 layer III", () => {
        expect(parseFrameHeader(header(0xff, 0xf3, 0x80, 0x00))).toMatchObject({
            version: 2,
            layer: 3,
            bitrate: 64_000,
            sampleRate: 22050,
            length: 208,
            duration: 576 / 22050,
        });
    });

    it("parses MPEG-2.5 and layers I and II", () => {
        expect(parseFrameHeader(header(0xff, 0xe3, 0x84, 0x00))).toMatchObject({ version: 2.5, sampleRate: 12000 });
        expect(parseFrameHeader(header(0xff, 0xff, 0x10, 0x00))).toMatchObject({ layer: 1, length: 32 });
        expect(parseFrameHeader(header(0xff, 0xfd, 0x10, 0x00))).toMatchObject({ layer: 2, length: 104 });
    });

    it("reads at an offset", () => {
        expect(parseFrameHeader(header(0, 0, 0xff, 0xfb, 0x90, 0x00), 2)?.length).toBe(417);
    });

    it.each([
        ["bad sync", [0xff, 0x1b, 0x90, 0x00]],
        ["reserved version", [0xff, 0xeb, 0x90, 0x00]],
        ["reserved layer", [0xff, 0xf9, 0x90, 0x00]],
        ["free format bitrate", [0xff, 0xfb, 0x00, 0x00]],
        ["bad bitrate", [0xff, 0xfb, 0xf0, 0x00]],
        ["reserved sample rate", [0xff, 0xfb, 0x9c, 0x00]],
        ["truncated", [0xff, 0xfb, 0x90]],
    ])("rejects %s", (_, bytes) => {
        expect(parseFrameHeader(Buffer.from(bytes))).toBeNull();
    });
});

describe("id3v2Size", () => {
    it("returns the full tag size", () => {
        expect(id3v2Size(id3v2(257))).toBe(267);
    });

    it("counts the footer", () => {
        const tag = id3v2(257);
        tag[5] = 0x10;
        expect(id3v2Size(tag)).toBe(277);
    });

    it("returns 0 without a tag", () => {
        expect(id3v2Size(frame(128))).toBe(0);
        expect(id3v2Size(Buffer.from("ID3"))).toBe(0);
    });
});

describe("isInfoFrame", () => {
    it.each(["Xing", "Info"])("detects a %s frame", (tag) => {
        const buf = frame(128);
        buf.write(tag, 36, "latin1"); // 4-byte header + 32 bytes of stereo side info
        expect(isInfoFrame(buf, 0, parseFrameHeader(buf)!)).toBe(true);
    });

    it("ignores audio frames", () => {
        const buf = frame(128);
        expect(isInfoFrame(buf, 0, parseFrameHeader(buf)!)).toBe(false);
    });
});
