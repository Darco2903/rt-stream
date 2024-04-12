# Real Time Stream

## Introduction

The purpose of this module is to provide a stream that acts like a media player to read media files. It was originally made to stream live audio to a Web Application.

## Features

-   Read a file at the same speed as a media application would
-   Pause and resume the stream
-   Seek to a specific position in the file (forwards and backwards)

## Example

```js
const fs = require("fs");
const rtStream = require("rt-stream");

const bitrate = 320_000;
const chunkSize = 32_000;
const file = fs.openSync("audio-320kbps.mp3", "r");

const rtStream = new rtStream(file, bitrate, chunkSize);

rtStream.seek(256_000); // Seek to 256_000 bytes

rtStream.on("data", (chunk) => {
    // Every 800ms (32_000 / (320_000 / 8) = 0.8s)
    console.log("Chunk size: " + chunk.length); // 32_000
});
```
