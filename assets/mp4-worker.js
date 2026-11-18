const CDNS = [
    'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm/',
    'https://unpkg.com/@ffmpeg/core@0.12.10/dist/esm/'
];

const CORE = {
    script: ['ffmpeg-core.js', '67a48f11645f85439f3fde4f2119042c16b374b910206b7a7a24f342e28dcae3'],
    wasm: ['ffmpeg-core.wasm', '9f57947a5bd530d8f00c5b3f2cb2a3492faa7e5d823315342d6a8656d0a6b7b7']
};

async function getCheckedAsset([name, expectedHash]) {
    for (const base of CDNS) {
        try {
            const response = await fetch(base + name, {
                credentials: 'omit',
                cache: 'force-cache',
                signal: AbortSignal.timeout(45_000)
            });
            if (!response.ok) continue;
            const bytes = await response.arrayBuffer();
            const digest = await crypto.subtle.digest('SHA-256', bytes);
            const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
            if (hash === expectedHash) return bytes;
        } catch {
            // If the first CDN is inaccessible, try the same pinned files on the next one.
        }
    }
    throw new Error('encoder-load');
}

async function openEncoder() {
    const [script, wasmBinary] = await Promise.all([getCheckedAsset(CORE.script), getCheckedAsset(CORE.wasm)]);
    const moduleUrl = URL.createObjectURL(new Blob([script], { type: 'text/javascript' }));
    try {
        const { default: createFFmpegCore } = await import(moduleUrl);
        return await createFFmpegCore({ wasmBinary });
    } finally {
        URL.revokeObjectURL(moduleUrl);
    }
}

self.onmessage = async ({ data }) => {
    try {
        const core = await openEncoder();
        self.postMessage({ stage: 'encoding' });
        core.setProgress(({ progress }) => {
            if (Number.isFinite(progress)) self.postMessage({ progress: Math.max(0, Math.min(100, Math.floor(progress * 100))) });
        });
        const video = data.source ? 'recording.ivf' : 'recording.webm';
        const outputName = 'ready.' + data.extension;
        const inputs = ['-i', video];
        const map = ['-map', '0:v:0', '-map', '0:a:0?'];
        core.FS.writeFile(video, new Uint8Array(await data.blob.arrayBuffer()));
        if (data.source) {
            core.FS.writeFile('original-media', new Uint8Array(await data.source.arrayBuffer()));
            inputs.push('-ss', String(data.start), '-i', 'original-media');
            map[3] = '1:a:0?';
        }
        const codecs = data.extension === 'mp4'
            ? ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
                '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-movflags', '+faststart']
            : ['-c:v', 'copy', '-c:a', 'libopus', '-b:a', '128k'];
        const duration = data.duration ? ['-t', String(data.duration)] : [];
        const status = core.exec(...inputs, ...map, ...duration, ...codecs, outputName);
        if (status !== 0) throw new Error('encoder-conversion');
        const output = core.FS.readFile(outputName);
        self.postMessage({ buffer: output.buffer }, [output.buffer]);
    } catch (error) {
        self.postMessage({ error: error.message === 'encoder-load' ? 'encoder-load' : 'encoder-conversion' });
    }
};
