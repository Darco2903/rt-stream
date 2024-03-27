const fs = require("fs");
const { Transform } = require("stream");

class RTStream extends Transform {
    /** @type {number} */
    #fd;
    /** @type {Buffer} */
    #buffer;
    /** @type {number} */
    #bitrate;
    /** @type {number} */
    #chunkSize;
    /** @type {number} */
    #delay;
    /** @type {number} */
    #bytesSend = 0;
    /** @type {number} */
    #sendTimeout;
    /** @type {number} */
    #sendTimeoutStart;
    /** @type {number} */
    #elapsedDelay;
    /** @type {boolean} */
    #paused = false;

    constructor(fd, bitrate, chunkSize = 32_000) {
        super();
        this.#fd = fd;
        this.#bitrate = bitrate;
        this.#chunkSize = chunkSize;
        this.#buffer = Buffer.alloc(chunkSize);
        this.#delay = this.#calculateDelay(chunkSize);
        this.#sendTimeoutStart = null;
        this.#elapsedDelay = 0;
        this.#stream(this.#delay);
    }

    #calculateDelay(chunkSize) {
        return (chunkSize / (this.#bitrate / 8)) * 1000;
    }

    #stream(delay) {
        this.#sendTimeoutStart = Date.now();
        this.#sendTimeout = setTimeout(async () => {
            await this.#read();
            this.#send();
            // const elapsed = Date.now() - this.#sendTimeoutStart;
            // const diff = elapsed - delay;
            // console.log("delay", delay, "real delay", elapsed, "diff", diff);
            const diff = Date.now() - this.#sendTimeoutStart - delay;
            this.#stream(this.#delay - diff);
        }, delay);
    }

    #send() {
        this.#elapsedDelay = 0;
        this.read(this.#chunkSize);
        this.#bytesSend += this.#chunkSize;
        // console.log("send", this.#buffer.length, this.#buffer);
    }

    #read() {
        return new Promise((resolve, reject) => {
            fs.read(this.#fd, this.#buffer, 0, this.#chunkSize, this.#bytesSend, (err, bytesRead, buffer) => {
                if (err) {
                    console.error(err);
                    reject(err);
                    return;
                }

                if (bytesRead !== 0) this.push(buffer);
                resolve();
            });
        });
    }

    resume() {
        if (!this.#paused) {
            // console.log("TRStream: already resumed");
            return;
        }
        this.#paused = false;
        const remaining = this.#delay - this.#elapsedDelay;
        this.#stream(remaining);
        // console.log("delay:", this.#delay, "elapsed:", this.#elapsedDelay, "remaining:", remaining);
    }

    pause() {
        if (this.#paused) {
            // console.log("TRStream: already paused");
            return;
        }
        this.#paused = true;
        this.#elapsedDelay += Date.now() - this.#sendTimeoutStart;
        clearTimeout(this.#sendTimeout);
        // console.log("pause elapsed:", this.#elapsedDelay);
    }

    seek(offset) {
        this.#bytesSend = offset;
    }
}

module.exports = {
    RTStream,
};
