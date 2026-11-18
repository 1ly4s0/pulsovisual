const SEGMENT = 0x18538067;
const INFO = 0x1549a966;
const TIMESTAMP_SCALE = 0x2ad7b1;
const DURATION = 0x4489;

function readVint(bytes, offset, isId = false) {
    const first = bytes[offset];
    if (!first) throw new Error('Invalid WebM header');
    let marker = 0x80;
    let width = 1;
    while (!(first & marker)) {
        marker >>= 1;
        width++;
    }
    if (offset + width > bytes.length || (isId && width > 4)) throw new Error('Incomplete WebM header');
    let value = BigInt(isId ? first : first & (marker - 1));
    for (let index = 1; index < width; index++) value = value * 256n + BigInt(bytes[offset + index]);
    const unknown = !isId && value === (1n << BigInt(7 * width)) - 1n;
    if (!unknown && value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('WebM element too large');
    return { width, value: unknown ? null : Number(value) };
}

function findElement(bytes, from, limit, wanted) {
    for (let cursor = from; cursor < limit;) {
        const id = readVint(bytes, cursor, true);
        const sizeOffset = cursor + id.width;
        const size = readVint(bytes, sizeOffset);
        const start = sizeOffset + size.width;
        const end = size.value === null ? null : start + size.value;
        if (id.value === wanted) return { sizeOffset, width: size.width, size: size.value, start, end };
        if (end === null || end > limit) break;
        cursor = end;
    }
    return null;
}

function writeSize(size, minimumWidth) {
    let width = minimumWidth;
    while (BigInt(size) >= (1n << BigInt(7 * width)) - 1n) width++;
    const bytes = new Uint8Array(width);
    let encoded = BigInt(size) | (1n << BigInt(7 * width));
    for (let index = width - 1; index >= 0; index--) {
        bytes[index] = Number(encoded & 255n);
        encoded >>= 8n;
    }
    return bytes;
}

function readScale(bytes, element) {
    if (!element || element.size === null) return 1_000_000;
    let scale = 0;
    for (let index = element.start; index < element.end; index++) scale = scale * 256 + bytes[index];
    return scale || 1_000_000;
}

export async function writeWebmDuration(blob, seconds) {
    // MediaRecorder writes stream headers before it knows the final duration.
    // Only the Info header changes. Keep the encoded clusters as original Blob slices.
    const bytes = new Uint8Array(await blob.slice(0, 256 * 1024).arrayBuffer());
    const segment = findElement(bytes, 0, bytes.length, SEGMENT);
    const info = segment && findElement(bytes, segment.start, bytes.length, INFO);
    if (!info || info.end === null || info.end > bytes.length) return blob;
    const current = findElement(bytes, info.start, info.end, DURATION);
    const scale = readScale(bytes, findElement(bytes, info.start, info.end, TIMESTAMP_SCALE));
    const ticks = seconds * 1e9 / scale;

    if (current) {
        if (current.size !== 4 && current.size !== 8) return blob;
        const value = new DataView(bytes.buffer, current.start, current.size);
        const duration = current.size === 4 ? value.getFloat32(0) : value.getFloat64(0);
        if (Number.isFinite(duration) && duration > 0) return blob;
        if (current.size === 4) value.setFloat32(0, ticks);
        else value.setFloat64(0, ticks);
        return new Blob([bytes.slice(0, current.end), blob.slice(current.end)], { type: blob.type });
    }

    const duration = new Uint8Array([0x44, 0x89, 0x88, 0, 0, 0, 0, 0, 0, 0, 0]);
    new DataView(duration.buffer).setFloat64(3, ticks);
    const infoSize = writeSize(info.size + duration.length, info.width);
    const offset = duration.length + infoSize.length - info.width;
    const segmentSize = segment.size === null
        ? bytes.slice(segment.sizeOffset, segment.start)
        : writeSize(segment.size + offset, segment.width);
    return new Blob([
        bytes.slice(0, segment.sizeOffset),
        segmentSize,
        bytes.slice(segment.start, info.sizeOffset),
        infoSize,
        bytes.slice(info.start, info.end),
        duration,
        blob.slice(info.end)
    ], { type: blob.type });
}
