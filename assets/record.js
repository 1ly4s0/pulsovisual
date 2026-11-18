export function recordingFormat() {
    if (!('MediaRecorder' in window) || !HTMLCanvasElement.prototype.captureStream) return null;
    // Some Chromium encoders accept MP4 but silently omit full-size portrait frames.
    const options = [
        { mime: 'video/webm;codecs=vp8,opus', extension: 'webm' },
        { mime: 'video/webm;codecs=vp9,opus', extension: 'webm' },
        { mime: 'video/webm', extension: 'webm' },
        { mime: 'video/mp4', extension: 'mp4' }
    ];
    return options.find(option => MediaRecorder.isTypeSupported(option.mime)) ?? null;
}

export async function seek(media, time) {
    if (!media.seeking && Math.abs(media.currentTime - time) < .003) return;
    await new Promise((resolve, reject) => {
        function cleanup() {
            clearTimeout(timeout);
            media.removeEventListener('seeked', ready);
            media.removeEventListener('error', fail);
        }

        function ready() {
            cleanup();
            resolve();
        }

        function fail() {
            cleanup();
            reject(new Error('Could not seek the media'));
        }

        const timeout = setTimeout(fail, 10_000);
        media.addEventListener('seeked', ready, { once: true });
        media.addEventListener('error', fail, { once: true });
        media.currentTime = time;
    });
}

export async function recordCanvas({ canvas, media, audioTrack, draw, signal, start, end }) {
    const format = recordingFormat();
    if (!format) throw new Error('This browser cannot record canvas video');
    await seek(media, start);
    signal.throwIfAborted();
    // Keep the recorder independent of the layout and sizing of the preview canvas.
    const recording = document.createElement('canvas');
    recording.width = canvas.width;
    recording.height = canvas.height;
    const drawing = recording.getContext('2d', { alpha: false });
    const stream = recording.captureStream(30);
    const videoTrack = stream.getVideoTracks()[0];
    stream.addTrack(audioTrack);
    function paintFrame() {
        draw();
        videoTrack.requestFrame?.();
        drawing.drawImage(canvas, 0, 0);
    }
    try {
        const recorder = new MediaRecorder(stream, { mimeType: format.mime, videoBitsPerSecond: 6_000_000 });
        const parts = [];
        let failure;
        let lastTime = media.currentTime;
        let lastAdvance = performance.now();

        const result = await new Promise((resolve, reject) => {
            function stop(error) {
                failure ??= error;
                if (recorder.state !== 'inactive') recorder.stop();
            }

            function abort() {
                stop(signal.reason);
            }

            function ended() {
                draw();
                stop();
            }

            function failed() {
                stop(new Error('Playback failed while recording'));
            }

            const frameTimer = setInterval(() => {
                if (media.currentTime >= end) {
                    ended();
                    return;
                }
                paintFrame();
            }, 1000 / 30);
            const watchdog = setInterval(() => {
                if (media.currentTime > lastTime) {
                    lastTime = media.currentTime;
                    lastAdvance = performance.now();
                } else if (performance.now() - lastAdvance > 12_000) {
                    failed();
                }
            }, 1000);

            function cleanup() {
                clearInterval(watchdog);
                clearInterval(frameTimer);
                media.removeEventListener('ended', ended);
                media.removeEventListener('error', failed);
                signal.removeEventListener('abort', abort);
            }

            recorder.addEventListener('dataavailable', event => {
                if (event.data.size) parts.push(event.data);
            });
            recorder.addEventListener('error', event => {
                cleanup();
                reject(event.error);
            }, { once: true });
            recorder.addEventListener('stop', () => {
                cleanup();
                if (failure) reject(failure);
                else if (!parts.length) reject(new Error('Recording contains no data'));
                else resolve(new Blob(parts, { type: recorder.mimeType || format.mime }));
            }, { once: true });

            media.addEventListener('ended', ended, { once: true });
            media.addEventListener('error', failed, { once: true });
            signal.addEventListener('abort', abort, { once: true });
            try {
                recorder.start(1000);
                paintFrame();
                media.play().catch(error => stop(error));
            } catch (error) {
                cleanup();
                reject(error);
            }
        });

        return { blob: result, extension: format.extension };
    } finally {
        for (const track of stream.getVideoTracks()) track.stop();
        stream.removeTrack(audioTrack);
    }
}
