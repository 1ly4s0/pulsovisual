import { announce, bindControls, bindFileInput, byId, copy, download, filename, formatTime, setFileName } from './ui.js';
import { recordCanvas, recordingFormat, seek } from './record.js';
import { encodeMedia } from './mp4.js';
import { canEncodeFrames, recordFrames } from './frame-recorder.js';
import { acceptsImage, acceptsAudio, draw, looks, readSettings, sizeFor, suffix } from './effect.js';

const canvas = byId('preview');
const drawing = canvas.getContext('2d', { alpha: false });
const controls = byId('settings');
const play = byId('listen');
const save = byId('save');
const cancel = byId('cancel-render');
const scrub = byId('seek');
const studio = byId('studio');
const formatInput = byId('export-format');
const progress = byId('export-progress');
const trim = byId('trim');
const comparison = byId('comparison');
const demoButton = byId('demo');
const theme = document.documentElement.dataset.theme;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const lookButtons = [...controls.querySelectorAll('[data-look]')];
const demos = {
    vhs: ['demo-scene.webp', 'Última tarde.webp', 'Last Light.webp', 'image/webp'],
    pulse: ['demo-track.mp3', 'Después de medianoche.mp3', 'After Midnight.mp3', 'audio/mpeg'],
    vertical: ['demo-clip.webm', 'Bosque en movimiento.webm', 'Forest in Motion.webm', 'video/webm']
};
let demoArt;
let previewPointer;
let asset;
let context;
let graph;
let frame;
let busy = false;
let capture;

function resize() {
    const { width, height } = sizeFor(asset?.element ?? demoArt, readSettings());
    if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
        canvas.style.aspectRatio = width + ' / ' + height;
    }
}

function render(forExport = false) {
    const media = asset?.element ?? demoArt;
    const background = byId('background')?.selectedImage;
    draw(drawing, media, readSettings(), {
        width: canvas.width,
        height: canvas.height,
        time: media?.currentTime ?? (acceptsAudio && !reducedMotion.matches ? performance.now() / 1000 : 0),
        comparison: forExport || capture || !comparison ? 0 : Number(comparison.value) / 100,
        guides: !forExport && !capture && byId('safe-area')?.checked,
        analyser: graph?.analyser,
        background
    });
}

function updateTransport() {
    const media = asset?.element;
    if (!(media instanceof HTMLMediaElement)) return;
    if (!scrub.matches(':active')) scrub.value = media.currentTime;
    byId('elapsed').textContent = formatTime(media.currentTime) + ' / ' + formatTime(media.duration);
    const active = !media.paused && !media.ended;
    play.textContent = active ? copy('Pause', 'Pausar') : copy('Play', 'Reproducir');
    play.dataset.playing = String(active);
}

function animate() {
    cancelAnimationFrame(frame);
    if (!capture) render();
    updateTransport();
    const media = asset?.element;
    if ((media instanceof HTMLMediaElement && !media.paused && !media.ended) ||
        (!asset && acceptsAudio && !reducedMotion.matches)) {
        frame = requestAnimationFrame(animate);
    }
}

function setBusy(value) {
    busy = value;
    const timed = asset?.element instanceof HTMLMediaElement;
    controls.disabled = value;
    formatInput.disabled = value;
    demoButton.disabled = value;
    if (trim) trim.disabled = value;
    if (comparison) comparison.disabled = value;
    byId('file').disabled = value;
    play.disabled = value || !timed;
    save.disabled = value || !asset || timed && !recordingFormat() && !('VideoEncoder' in window);
    scrub.disabled = value || !timed;
    cancel.hidden = !capture;
    progress.hidden = !capture;
    studio.dataset.busy = String(value);
    byId('export-format-row').hidden = Boolean(asset && !timed);
    const format = asset && !timed ? 'PNG' : formatInput.value.toUpperCase();
    save.textContent = copy('Download ', 'Descargar ') + format;
}

async function openMedia(file) {
    const url = URL.createObjectURL(file);
    try {
        if (acceptsImage && (file.type.startsWith('image/') || /\.(png|jpe?g|webp|avif|gif)$/i.test(file.name))) {
            const img = new Image();
            img.src = url;
            await img.decode();
            return { file, element: img, url };
        }

        const element = document.createElement(acceptsAudio ? 'audio' : 'video');
        element.playsInline = true;
        element.preload = 'auto';
        await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('Media took too long to open')), 15_000);
            element.addEventListener('loadeddata', () => {
                clearTimeout(timeout);
                resolve();
            }, { once: true });
            element.addEventListener('error', () => {
                clearTimeout(timeout);
                reject(new Error('Unsupported media'));
            }, { once: true });
            element.src = url;
        });
        if (!Number.isFinite(element.duration) || element.duration <= 0) throw new Error('Unknown media duration');
        if (!acceptsAudio && !element.videoWidth) throw new Error('Expected a video');
        return { file, element, url };
    } catch (error) {
        URL.revokeObjectURL(url);
        throw error;
    }
}

function releasePrevious() {
    if (!asset) return;
    if (asset.element instanceof HTMLMediaElement) {
        asset.element.pause();
        asset.element.removeAttribute('src');
        asset.element.load();
    }
    graph?.source.disconnect();
    graph?.analyser.disconnect();
    graph?.monitor.disconnect();
    graph = undefined;
    URL.revokeObjectURL(asset.url);
}

async function load(file) {
    if (busy) return;
    setBusy(true);
    announce(copy('Opening your file…', 'Abriendo tu archivo…'));
    try {
        const next = await openMedia(file);
        releasePrevious();
        asset = next;
        const media = next.element;
        studio.classList.add('has-file');
        byId('preview-label').textContent = copy('Preview', 'Vista previa');
        if (media instanceof HTMLMediaElement) {
            scrub.max = media.duration;
            scrub.value = 0;
            media.addEventListener('play', animate);
            media.addEventListener('pause', animate);
            media.addEventListener('seeked', animate);
            media.addEventListener('ended', animate);
            setFileName(file, formatTime(media.duration) + (media.videoWidth ? ' · ' + media.videoWidth + ' × ' + media.videoHeight : ''));
        } else {
            setFileName(file, media.naturalWidth + ' × ' + media.naturalHeight);
        }
        byId('transport').hidden = !(media instanceof HTMLMediaElement);
        if (trim) {
            trim.hidden = !(media instanceof HTMLVideoElement);
            if (!trim.hidden) {
                byId('trim-in').value = '0';
                byId('trim-out').value = media.duration.toFixed(3);
                for (const field of trim.querySelectorAll('input')) field.max = media.duration;
            }
        }
        resize();
        animate();
        announce('');
        if (media instanceof HTMLMediaElement && !recordingFormat() && !('VideoEncoder' in window)) {
            announce(copy('This browser can preview the file. Open this page in a browser with video recording to export.', 'Este navegador puede mostrar la vista previa. Para exportarla, abre la página en un navegador compatible con la grabación de vídeo.'));
        }
    } catch {
        announce(copy('Could not open that file. Try a compatible format or a shorter clip.', 'No se pudo abrir el archivo. Prueba con un formato compatible o un clip más corto.'), true);
    } finally {
        setBusy(false);
    }
}

function connectAudio(media) {
    context ??= new AudioContext();
    if (graph) return graph;
    const source = context.createMediaElementSource(media);
    const analyser = context.createAnalyser();
    const monitor = context.createGain();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = .72;
    source.connect(analyser).connect(monitor).connect(context.destination);
    graph = { source, analyser, monitor };
    return graph;
}

play.addEventListener('click', async () => {
    const media = asset.element;
    if (!media.paused) {
        media.pause();
        return;
    }
    try {
        connectAudio(media);
        await context.resume();
        if (media.ended) await seek(media, 0);
        await media.play();
    } catch {
        announce(copy('Playback could not start.', 'No se pudo iniciar la reproducción.'), true);
    }
});

scrub.addEventListener('input', () => {
    asset.element.currentTime = Number(scrub.value);
});

function selectLook() {
    for (const button of lookButtons) {
        const look = looks[Number(button.dataset.look)];
        const selected = Object.entries(look).every(([id, value]) => byId(id).value === String(value));
        button.setAttribute('aria-pressed', String(selected));
    }
}

controls.addEventListener('input', () => {
    selectLook();
    resize();
    render();
});
for (const button of lookButtons) {
    button.addEventListener('click', () => {
        for (const [id, value] of Object.entries(looks[Number(button.dataset.look)])) byId(id).value = value;
        controls.dispatchEvent(new Event('input', { bubbles: true }));
    });
}
if (comparison) {
    comparison.addEventListener('input', () => {
        document.querySelector('output[for="comparison"]').textContent = comparison.value + '%';
        comparison.style.setProperty('--fill', comparison.value + '%');
        render();
    });
}

formatInput.addEventListener('change', () => setBusy(false));
const nativeFormat = recordingFormat();
if (nativeFormat?.extension === 'mp4') formatInput.querySelector('[value="webm"]').disabled = true;

if (theme === 'vertical') {
    canvas.addEventListener('pointerdown', event => {
        if ((!asset && !demoArt) || busy || event.button !== 0) return;
        previewPointer = {
            id: event.pointerId, x: event.clientX, y: event.clientY,
            left: Number(byId('position-x').value), top: Number(byId('position-y').value)
        };
        canvas.setPointerCapture(event.pointerId);
    });
    canvas.addEventListener('pointermove', event => {
        if (previewPointer?.id !== event.pointerId || busy) return;
        byId('position-x').value = Math.round(previewPointer.left - (event.clientX - previewPointer.x) / canvas.clientWidth * 100);
        byId('position-y').value = Math.round(previewPointer.top - (event.clientY - previewPointer.y) / canvas.clientHeight * 100);
        controls.dispatchEvent(new Event('input', { bubbles: true }));
    });
    canvas.addEventListener('lostpointercapture', () => { previewPointer = undefined; });
}

demoButton.addEventListener('click', async () => {
    if (busy) return;
    const [path, es, en, type] = demos[theme];
    setBusy(true);
    announce(copy('Opening the demo…', 'Abriendo la demo…'));
    try {
        const response = await fetch(new URL(path, import.meta.url));
        if (!response.ok) throw new Error('Could not load sample');
        const file = new File([await response.blob()], copy(en, es), { type });
        setBusy(false);
        await load(file);
        if (acceptsAudio && asset?.file === file) play.click();
    } catch {
        setBusy(false);
        announce(copy('Could not open the demo. You can still use your own files.', 'No se pudo abrir la demo. Puedes usar tus propios archivos.'), true);
    }
});

if (!acceptsAudio) {
    const art = new Image();
    art.src = new URL('demo-scene.webp', import.meta.url);
    art.decode().then(() => {
        if (asset) return;
        demoArt = art;
        studio.classList.add('has-demo-scene');
        resize();
        render();
    }).catch(() => {});
}

const backgroundInput = byId('background');
if (backgroundInput) {
    backgroundInput.addEventListener('change', async () => {
        const file = backgroundInput.files[0];
        const url = file ? URL.createObjectURL(file) : '';
        try {
            const image = file ? new Image() : null;
            if (image) {
                image.src = url;
                await image.decode();
            }
            if (backgroundInput.files[0] !== file) return;
            backgroundInput.selectedImage = image;
            render();
            announce('');
        } catch {
            announce(copy('Could not open the background image.', 'No se pudo abrir la imagen de fondo.'), true);
        } finally {
            if (url) URL.revokeObjectURL(url);
        }
    });
}

function exportImage() {
    return new Promise((resolve, reject) => {
        render(true);
        canvas.toBlob(blob => {
            render();
            if (blob) resolve(blob);
            else reject(new Error('Canvas could not create a PNG'));
        }, 'image/png');
    });
}

async function checkVideo(blob) {
    const video = document.createElement('video');
    const url = URL.createObjectURL(blob);
    try {
        await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('Video metadata timed out')), 10_000);
            video.addEventListener('loadedmetadata', () => {
                clearTimeout(timeout);
                if (video.videoWidth !== canvas.width || video.videoHeight !== canvas.height ||
                    !Number.isFinite(video.duration) || video.duration <= 0) {
                    reject(new Error('Recording has no full-size video track'));
                } else {
                    resolve();
                }
            }, { once: true });
            video.addEventListener('error', () => {
                clearTimeout(timeout);
                reject(new Error('Recorded video is unreadable'));
            }, { once: true });
            video.preload = 'metadata';
            video.src = url;
        });
    } finally {
        video.removeAttribute('src');
        video.load();
        URL.revokeObjectURL(url);
    }
}

function getTrim(media) {
    if (!trim || trim.hidden) return { start: 0, end: media.duration };
    const startInput = byId('trim-in');
    const endInput = byId('trim-out');
    const start = startInput.valueAsNumber;
    const end = Math.min(media.duration, endInput.valueAsNumber);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) {
        throw new Error('invalid-trim');
    }
    return { start, end };
}

async function exportVideo(media) {
    const { start, end } = getTrim(media);
    const wanted = formatInput.value;
    const { analyser, monitor } = connectAudio(media);
    await context.resume();
    const previousTime = media.currentTime;
    media.pause();
    monitor.gain.value = 0;
    const drawFrame = () => {
        render();
        progress.value = Math.max(0, Math.min(100, (media.currentTime - start) / (end - start) * 100));
    };
    const signal = capture.signal;
    const frameOptions = { canvas, media, draw: drawFrame, signal, start, end };
    const canRecordFrames = await canEncodeFrames(canvas);
    announce(copy('Recording the video. Keep this tab visible.', 'Grabando el vídeo. Mantén esta pestaña visible.'));

    async function encode(input) {
        progress.removeAttribute('value');
        announce(copy('Loading the video encoder…', 'Cargando el codificador de vídeo…'));
        const blob = await encodeMedia(input, signal, update => {
            if (update.stage) announce(copy('Preparing your ' + wanted.toUpperCase() + '…', 'Preparando tu ' + wanted.toUpperCase() + '…'));
            else progress.value = update.progress;
        });
        return { blob, extension: wanted };
    }

    async function recordAndMux() {
        const frames = await recordFrames(frameOptions);
        // Mux directly from the original file to preserve the selected audio, including a trim.
        return encode({ blob: frames, source: asset.file, start, duration: end - start, extension: wanted });
    }

    async function recordNative() {
        const destination = context.createMediaStreamDestination();
        const audioTrack = destination.stream.getAudioTracks()[0];
        analyser.connect(destination);
        try {
            return await recordCanvas({ ...frameOptions, audioTrack });
        } finally {
            media.pause();
            analyser.disconnect(destination);
            audioTrack.stop();
        }
    }

    try {
        let result;
        if (canRecordFrames && (wanted === 'mp4' || !recordingFormat())) {
            result = await recordAndMux();
        } else {
            try {
                result = await recordNative();
                if (result.extension === 'webm') {
                    const { writeWebmDuration } = await import('./webm-duration.js');
                    result.blob = await writeWebmDuration(result.blob, end - start);
                    if (wanted === 'mp4') result = await encode({ blob: result.blob, extension: wanted });
                }
                await checkVideo(result.blob);
            } catch (error) {
                if (!canRecordFrames || signal.aborted) throw error;
                result = await recordAndMux();
            }
        }
        await checkVideo(result.blob);
        signal.throwIfAborted();
        return result;
    } finally {
        media.pause();
        monitor.gain.value = 1;
        await seek(media, previousTime).catch(() => {});
    }
}

save.addEventListener('click', async () => {
    if (!asset || busy) return;
    const media = asset.element;
    if (media instanceof HTMLMediaElement) {
        capture = new AbortController();
        progress.value = 0;
    }
    setBusy(true);
    announce(copy('Preparing your download…', 'Preparando la descarga…'));
    try {
        const result = capture ? await exportVideo(media) : { blob: await exportImage(), extension: 'png' };
        download(result.blob, filename(asset.file, suffix, result.extension));
        announce(copy('Your download has started.', 'La descarga ha comenzado.'));
    } catch (error) {
        if (error.name === 'AbortError') announce(copy('Export canceled.', 'Exportación cancelada.'));
        else if (error.message === 'invalid-trim') announce(copy('Choose an end time after the start.', 'Elige un final posterior al inicio.'), true);
        else if (error.message === 'encoder-load') announce(copy('The video encoder could not load. Check your connection and try again.', 'No se pudo cargar el codificador de vídeo. Comprueba tu conexión y vuelve a intentarlo.'), true);
        else announce(copy('Could not export this file. Try a shorter clip or another browser.', 'No se pudo exportar el archivo. Prueba con un clip más corto u otro navegador.'), true);
    } finally {
        capture = undefined;
        setBusy(false);
        animate();
    }
});

cancel.addEventListener('click', () => capture?.abort());
bindControls();
bindFileInput(load);
setBusy(false);
selectLook();
resize();
animate();
reducedMotion.addEventListener('change', animate);
