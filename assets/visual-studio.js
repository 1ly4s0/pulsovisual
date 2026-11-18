import { announce, bindControls, bindFileInput, byId, copy, download, filename, formatTime, setFileName } from './ui.js';
import { recordCanvas, recordingFormat, seek } from './record.js';
import { acceptsImage, acceptsAudio, draw, readSettings, sizeFor, suffix } from './effect.js';

const canvas = byId('preview');
const drawing = canvas.getContext('2d', { alpha: false });
const controls = byId('settings');
const play = byId('listen');
const save = byId('save');
const cancel = byId('cancel-render');
const scrub = byId('seek');
const studio = byId('studio');
let asset;
let context;
let graph;
let frame;
let busy = false;
let capture;

function resize() {
    const { width, height } = sizeFor(asset?.element, readSettings());
    if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
        canvas.style.aspectRatio = width + ' / ' + height;
    }
}

function render() {
    const media = asset?.element;
    const background = byId('background')?.selectedImage;
    draw(drawing, media, readSettings(), {
        width: canvas.width,
        height: canvas.height,
        time: media?.currentTime ?? 0,
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
    render();
    updateTransport();
    const media = asset?.element;
    if (media instanceof HTMLMediaElement && !media.paused && !media.ended) {
        frame = requestAnimationFrame(animate);
    }
}

function setBusy(value) {
    busy = value;
    const timed = asset?.element instanceof HTMLMediaElement;
    controls.disabled = value;
    byId('file').disabled = value;
    play.disabled = value || !timed;
    save.disabled = value || !asset || timed && !recordingFormat();
    scrub.disabled = value || !timed;
    cancel.hidden = !capture;
    studio.dataset.busy = String(value);
    if (asset) {
        const format = timed ? recordingFormat()?.extension.toUpperCase() ?? copy('video', 'vídeo') : 'PNG';
        save.textContent = copy('Download ', 'Descargar ') + format;
    }
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
        resize();
        animate();
        announce('');
        if (media instanceof HTMLMediaElement && !recordingFormat()) {
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

controls.addEventListener('input', () => {
    resize();
    render();
});

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
        render();
        canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Canvas could not create a PNG')), 'image/png');
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

async function exportVideo(media) {
    const { analyser, monitor } = connectAudio(media);
    await context.resume();
    const destination = context.createMediaStreamDestination();
    const previousTime = media.currentTime;
    const audioTrack = destination.stream.getAudioTracks()[0];
    media.pause();
    monitor.gain.value = 0;
    analyser.connect(destination);
    const drawFrame = () => {
        render();
        const percentage = Math.floor(media.currentTime / media.duration * 100);
        announce(copy('Recording the video. Keep this tab visible.', 'Grabando el vídeo. Mantén esta pestaña visible.') + ' ' + percentage + '%');
    };
    // The normal preview loop draws into the same canvas as the recorder.
    const report = setInterval(drawFrame, 220);
    try {
        const result = await recordCanvas({ canvas, media, audioTrack, draw: drawFrame, signal: capture.signal });
        if (result.extension === 'webm') {
            const { writeWebmDuration } = await import('./webm-duration.js');
            result.blob = await writeWebmDuration(result.blob, media.duration);
        }
        await checkVideo(result.blob);
        capture.signal.throwIfAborted();
        return result;
    } finally {
        clearInterval(report);
        media.pause();
        monitor.gain.value = 1;
        analyser.disconnect(destination);
        audioTrack.stop();
        await seek(media, previousTime).catch(() => {});
        animate();
    }
}

save.addEventListener('click', async () => {
    if (!asset || busy) return;
    const media = asset.element;
    if (media instanceof HTMLMediaElement) capture = new AbortController();
    setBusy(true);
    announce(copy('Preparing your download…', 'Preparando la descarga…'));
    try {
        const result = capture ? await exportVideo(media) : { blob: await exportImage(), extension: 'png' };
        download(result.blob, filename(asset.file, suffix, result.extension));
        announce(copy('Your download has started.', 'La descarga ha comenzado.'));
    } catch (error) {
        if (error.name === 'AbortError') announce(copy('Export canceled.', 'Exportación cancelada.'));
        else announce(copy('Could not export this file. Try a shorter clip or another browser.', 'No se pudo exportar el archivo. Prueba con un clip más corto u otro navegador.'), true);
    } finally {
        capture = undefined;
        setBusy(false);
    }
});

cancel.addEventListener('click', () => capture?.abort());
bindControls();
bindFileInput(load);
setBusy(false);
resize();
render();
