export function encodeMedia(input, signal, update) {
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
        const worker = new Worker(new URL('./mp4-worker.js', import.meta.url), { type: 'module' });
        const deadline = setTimeout(() => finish(reject, new Error('encoder-timeout')), 15 * 60_000);

        function finish(complete, result) {
            clearTimeout(deadline);
            signal.removeEventListener('abort', abort);
            worker.terminate();
            complete(result);
        }

        function abort() {
            finish(reject, signal.reason);
        }

        signal.addEventListener('abort', abort, { once: true });
        worker.onmessage = ({ data }) => {
            if (data.error) finish(reject, new Error(data.error));
            else if (data.buffer) finish(resolve, new Blob([data.buffer], { type: 'video/' + input.extension }));
            else update(data);
        };
        worker.onerror = () => finish(reject, new Error('encoder-conversion'));
        worker.postMessage(input);
    });
}
