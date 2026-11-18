import { seek } from './record.js';

const frameRate = 30;
const frameTime = 1_000_000 / frameRate;

function configuration(canvas) {
    return { codec: 'vp8', width: canvas.width, height: canvas.height, bitrate: 5_000_000,
        framerate: frameRate, latencyMode: 'realtime' };
}

export async function canEncodeFrames(canvas) {
    if (!('VideoEncoder' in window) || !('VideoFrame' in window)) return false;
    try {
        return (await VideoEncoder.isConfigSupported(configuration(canvas))).supported;
    } catch {
        return false;
    }
}

// IVF is the simple container FFmpeg accepts for VP8 packets from WebCodecs.
function ivf(frames, width, height) {
    const header = new Uint8Array(32);
    const view = new DataView(header.buffer);
    header.set([68, 75, 73, 70]); // DKIF
    view.setUint16(6, 32, true);
    header.set([86, 80, 56, 48], 8); // VP80
    view.setUint16(12, width, true);
    view.setUint16(14, height, true);
    view.setUint32(16, frameRate, true);
    view.setUint32(20, 1, true);
    view.setUint32(24, frames.length, true);
    return new Blob([header, ...frames.flatMap(({ bytes, timestamp }) => {
        const packet = new DataView(new ArrayBuffer(12));
        packet.setUint32(0, bytes.length, true);
        packet.setBigUint64(4, BigInt(Math.round(timestamp / frameTime)), true);
        return [packet.buffer, bytes];
    })], { type: 'application/octet-stream' });
}

function nextFrame(signal) {
    return new Promise((resolve, reject) => {
        function abort() {
            clearTimeout(timer);
            reject(signal.reason);
        }
        const timer = setTimeout(() => {
            signal.removeEventListener('abort', abort);
            resolve();
        }, 1000 / frameRate);
        signal.addEventListener('abort', abort, { once: true });
    });
}

export async function recordFrames({ canvas, media, draw, signal, start, end }) {
    await seek(media, start);
    signal.throwIfAborted();
    const frames = [];
    let error;
    const encoder = new VideoEncoder({
        output(chunk) {
            const bytes = new Uint8Array(chunk.byteLength);
            chunk.copyTo(bytes);
            frames.push({ bytes, timestamp: chunk.timestamp });
        },
        error(reason) { error = reason; }
    });
    const begin = performance.now();
    let lastTimestamp = -1;
    let lastChange = begin;
    try {
        encoder.configure(configuration(canvas));
        await media.play();

        while (!media.ended && media.currentTime < end) {
            signal.throwIfAborted();
            if (error) throw error;
            const timestamp = Math.max(0, Math.floor((media.currentTime - start) * frameRate));
            if (timestamp > lastTimestamp && encoder.encodeQueueSize < 7) {
                draw();
                const frame = new VideoFrame(canvas, {
                    timestamp: Math.round(timestamp * frameTime), duration: Math.round(frameTime)
                });
                try {
                    encoder.encode(frame, { keyFrame: lastTimestamp < 0 || timestamp % 60 === 0 });
                } finally {
                    frame.close();
                }
                lastTimestamp = timestamp;
                lastChange = performance.now();
            } else if (performance.now() - lastChange > 12_000) {
                throw new Error('Frame capture stalled');
            }
            await nextFrame(signal);
        }

        await encoder.flush();
        if (error) throw error;
        if (!frames.length) throw new Error('No video frames captured');
        return ivf(frames, canvas.width, canvas.height);
    } finally {
        if (encoder.state !== 'closed') encoder.close();
        media.pause();
    }
}
