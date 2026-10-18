# Real Time Stream

## Introduction

The purpose of this module is to provide a stream that acts like a media player to read media files. It was originally made to stream live audio to a Web Application.

## Features

- Read a file at the same speed as a media application would
- MP3 files are timed from their frame headers, so variable bitrate (VBR) files play at the right speed
- Initial burst, so web clients can fill their buffer before real-time pacing starts
- Stop and resume playback
- Seek to a position in seconds

## Installation

```sh
npm install @darco2903/rt-stream
```

## Example

```ts
import { RTStream } from "@darco2903/rt-stream";

const stream = new RTStream("audio.mp3", { burst: 2 });

stream.on("data", (chunk) => {
    // the first 2 seconds of audio arrive at once, then chunks follow at playback speed
});

stream.seek(90); // jump to 1:30, sends a new burst
stream.stop(); // stop playback
stream.play(); // resume where it stopped
```

`RTStream` is a `Readable`, so it can be piped, for example into an HTTP response:

```ts
http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "audio/mpeg" });
    new RTStream("audio.mp3", { burst: 2 }).pipe(res);
});
```

## Options

| Option      | Default  | Description                                                                                                                                              |
| ----------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bitrate`   | -        | Constant bitrate in bits per second, for any file type. Omit it for MP3 files: frames are then timed from their headers, which handles variable bitrate. |
| `chunkSize` | `32_000` | Maximum bytes per chunk. MP3 chunks hold whole frames, at least one.                                                                                     |
| `burst`     | `0`      | Seconds of media sent at once on start and after each seek.                                                                                              |
| `start`     | `0`      | Start position in seconds.                                                                                                                               |

## API

- `seek(time)`: jumps to `time` seconds and sends a new burst. MP3 seeks land on the frame starting at or before `time`.
- `stop()` / `play()`: stops and resumes playback. These are separate from `pause()` / `resume()`, which are `Readable` flow control.
- `playing`: whether playback is running.
- `currentTime`: media time in seconds of the data sent so far, burst included.

ID3 tags and data between frames are not sent. If the client stalls, the stream catches up by sending the late chunks at once. `seek()` has no effect once the stream has ended.

## Migrating from 1.x

- `new RTStream(path, bitrate, chunkSize)` becomes `new RTStream(path, { bitrate, chunkSize })`. Omit `bitrate` for MP3 files.
- `rtStream.stream` is gone: the `RTStream` itself is the stream.
- `seek()` takes seconds instead of bytes.
- `pause()` / `resume()` for playback become `stop()` / `play()`.
- `RTStreamTransform` and `FixedChunkTransform` are no longer exported.
