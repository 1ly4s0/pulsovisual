import { byId, number } from './ui.js';
import { cover } from './frame.js';

export const suffix = 'pulsovisual';
export const acceptsImage = false;
export const acceptsAudio = true;
export const looks = [
    { 'visual-mode': 'circle', 'pulse-color': '#f999e2', 'stage-color': '#140d22', intensity: 100, glow: 46 },
    { 'visual-mode': 'bars', 'pulse-color': '#8ce7d7', 'stage-color': '#092433', intensity: 130, glow: 66 },
    { 'visual-mode': 'particles', 'pulse-color': '#f7be92', 'stage-color': '#280c30', intensity: 114, glow: 72 }
];
const bands = new Uint8Array(512);
const levels = new Float32Array(64);

export function readSettings() {
    return {
        style: byId('visual-mode').value,
        aspect: byId('aspect').value,
        color: byId('pulse-color').value,
        background: byId('stage-color').value,
        intensity: number('intensity') / 100,
        glow: number('glow') / 100
    };
}

export function sizeFor(_media, settings) {
    if (settings.aspect === 'vertical') return { width: 720, height: 1280 };
    return { width: 1280, height: 720 };
}

function readBands(analyser, time, intensity) {
    if (analyser) analyser.getByteFrequencyData(bands);
    for (let index = 0; index < levels.length; index++) {
        if (analyser) {
            const start = Math.floor(1 + (index / levels.length) ** 1.7 * 290);
            const end = Math.floor(1 + ((index + 1) / levels.length) ** 1.7 * 290);
            let max = 0;
            for (let bin = start; bin <= end; bin++) max = Math.max(max, bands[bin]);
            levels[index] = Math.min(1, max / 255 * intensity);
        } else {
            // The still illustration previews each layout before the first import.
            levels[index] = .14 + .34 * Math.abs(Math.sin(index * .277 + time * 3) * Math.cos(index * .12));
        }
    }
}

function spectrum(drawing, width, height, color) {
    const start = width * .095;
    const stride = width * .81 / levels.length;
    const baseline = height * .73;
    drawing.fillStyle = color;
    for (let index = 0; index < levels.length; index++) {
        const bar = 3 + levels[index] * height * .45;
        drawing.globalAlpha = .6 + levels[index] * .4;
        drawing.fillRect(start + index * stride, baseline - bar, stride * .62, bar);
    }
    drawing.globalAlpha = 1;
    drawing.strokeStyle = color + '56';
    drawing.beginPath();
    drawing.moveTo(start, baseline + 9);
    drawing.lineTo(width - start, baseline + 9);
    drawing.stroke();
}

function circle(drawing, width, height, color) {
    const span = Math.min(width, height);
    const centerX = width / 2;
    const centerY = height / 2;
    const radius = span * .24;
    drawing.strokeStyle = color;
    drawing.lineWidth = Math.max(2, span * .004);
    for (let index = 0; index < 128; index++) {
        const rotation = index * Math.PI / 64 - Math.PI / 2;
        const level = levels[index < 64 ? index : 127 - index];
        const distance = radius + 4 + level * span * .18;
        const x = Math.cos(rotation);
        const y = Math.sin(rotation);
        drawing.globalAlpha = .48 + level * .52;
        drawing.beginPath();
        drawing.moveTo(centerX + x * radius, centerY + y * radius);
        drawing.lineTo(centerX + x * distance, centerY + y * distance);
        drawing.stroke();
    }
    drawing.globalAlpha = 1;
    drawing.strokeStyle = color + '70';
    drawing.beginPath();
    drawing.arc(centerX, centerY, radius - span * .022, 0, Math.PI * 2);
    drawing.stroke();
}

function particles(drawing, width, height, color, time) {
    const span = Math.min(width, height);
    const centerX = width / 2;
    const centerY = height / 2;
    drawing.fillStyle = color;
    for (let index = 0; index < 230; index++) {
        const angle = index * 2.39996 + time * (.12 + index % 7 * .014);
        const level = levels[index % levels.length];
        const distance = ((index * 37 % 229) / 229 * .36 + .06 + level * .1) * span;
        drawing.globalAlpha = .21 + level * .76;
        drawing.beginPath();
        drawing.arc(centerX + Math.cos(angle) * distance, centerY + Math.sin(angle) * distance,
            1.3 + level * 6, 0, Math.PI * 2);
        drawing.fill();
    }
    drawing.globalAlpha = 1;
}

export function draw(drawing, _media, settings, { width, height, time, analyser, background }) {
    drawing.fillStyle = settings.background;
    drawing.fillRect(0, 0, width, height);
    if (background) {
        drawing.globalAlpha = .65;
        cover(drawing, background, width, height);
        drawing.globalAlpha = 1;
        drawing.fillStyle = '#10082065';
        drawing.fillRect(0, 0, width, height);
    }
    const bloom = drawing.createRadialGradient(width / 2, height / 2, 0, width / 2, height / 2, Math.min(width, height) * .7);
    bloom.addColorStop(0, settings.color + '39');
    bloom.addColorStop(1, settings.color + '00');
    drawing.fillStyle = bloom;
    drawing.fillRect(0, 0, width, height);
    readBands(analyser, time, settings.intensity);
    drawing.save();
    drawing.shadowColor = settings.color;
    drawing.shadowBlur = settings.glow * Math.min(width, height) * .018;
    if (settings.style === 'bars') spectrum(drawing, width, height, settings.color);
    else if (settings.style === 'particles') particles(drawing, width, height, settings.color, time);
    else circle(drawing, width, height, settings.color);
    drawing.restore();
}
