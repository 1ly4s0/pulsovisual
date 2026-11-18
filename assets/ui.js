export const spanish = document.documentElement.lang === 'es';
export const copy = (en, es) => spanish ? es : en;
export const byId = id => document.getElementById(id);

export function download(blob, name) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 45_000);
}

export function filename(file, suffix, extension) {
    return file.name.replace(/\.[^/.]+$/, '') + '-' + suffix + '.' + extension;
}

export function announce(message, isError = false) {
    const status = byId('status');
    status.textContent = message;
    status.dataset.error = String(isError);
}

export function bindFileInput(load) {
    const input = byId('file');
    const studio = byId('studio');

    input.addEventListener('change', () => {
        const file = input.files[0];
        input.value = '';
        if (file) load(file);
    });
    studio.addEventListener('dragover', event => {
        if (!event.dataTransfer.types.includes('Files')) return;
        event.preventDefault();
        if (!input.disabled) studio.classList.add('dragging');
    });
    studio.addEventListener('dragleave', event => {
        if (!studio.contains(event.relatedTarget)) studio.classList.remove('dragging');
    });
    studio.addEventListener('drop', event => {
        event.preventDefault();
        studio.classList.remove('dragging');
        const file = event.dataTransfer.files[0];
        if (file && !input.disabled) load(file);
    });
}

export function formatTime(seconds) {
    return Math.floor(seconds / 60) + ':' + String(Math.floor(seconds % 60)).padStart(2, '0');
}

export function setFileName(file, detail = '') {
    const label = byId('filename');
    label.textContent = file ? file.name : copy('Choose a file', 'Elige un archivo');
    label.title = file?.name ?? '';
    if (detail) byId('file-detail').textContent = detail;
}

export function bindControls() {
    const controls = byId('settings');
    const update = () => {
        for (const input of controls.querySelectorAll('input[type="range"]')) {
            const output = controls.querySelector('output[for="' + input.id + '"]');
            const value = Number(input.value);
            const prefix = input.hasAttribute('data-signed') && value > 0 ? '+' : '';
            output.textContent = prefix + input.value + (input.dataset.unit ?? '');
            const position = (value - Number(input.min)) / (Number(input.max) - Number(input.min));
            input.style.setProperty('--fill', position * 100 + '%');
        }
    };
    controls.addEventListener('input', update);
    update();
}

export function number(id) {
    return Number(byId(id).value);
}
