export function cover(drawing, image, width, height, zoom = 1, x = .5, y = .5) {
    const imageWidth = image.videoWidth || image.naturalWidth;
    const imageHeight = image.videoHeight || image.naturalHeight;
    const scale = Math.max(width / imageWidth, height / imageHeight) * zoom;
    const drawnWidth = imageWidth * scale;
    const drawnHeight = imageHeight * scale;
    drawing.drawImage(image, (width - drawnWidth) * x, (height - drawnHeight) * y, drawnWidth, drawnHeight);
}

export function contain(drawing, image, width, height, zoom = 1, x = .5, y = .5) {
    const imageWidth = image.videoWidth || image.naturalWidth;
    const imageHeight = image.videoHeight || image.naturalHeight;
    const scale = Math.min(width / imageWidth, height / imageHeight) * zoom;
    const drawnWidth = imageWidth * scale;
    const drawnHeight = imageHeight * scale;
    drawing.drawImage(image, (width - drawnWidth) * x, (height - drawnHeight) * y, drawnWidth, drawnHeight);
}
