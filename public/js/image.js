/**
 * Prepares a photo for upload: phone photos are often 3-12 MB (and HEIC on
 * iPhones), which is slow on mobile data and too big to send. We redraw the
 * photo onto a canvas at a sharp size and send a JPEG of a few hundred KB.
 * Big enough for Gemini to read handwriting, small enough to upload quickly.
 */
const MAX_SIDE = 2000;

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({ img, url });
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('This photo could not be opened. Please take the photo again with the camera.'));
    };
    img.src = url;
  });
}

/**
 * @param {File} file
 * @param {{ maxSide?: number, quality?: number }} [opts]
 * @returns {Promise<Blob>} a JPEG
 */
export async function prepareImage(file, { maxSide = MAX_SIDE, quality = 0.85 } = {}) {
  if (!file.type.startsWith('image/') && !/\.(heic|heif)$/i.test(file.name)) {
    throw new Error('Please choose a photo.');
  }
  const { img, url } = await loadImage(file);
  try {
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.round(img.naturalWidth * scale);
    const h = Math.round(img.naturalHeight * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const g = canvas.getContext('2d');
    g.fillStyle = '#fff'; // transparent PNGs become white, not black
    g.fillRect(0, 0, w, h);
    g.drawImage(img, 0, 0, w, h);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (!blob) throw new Error('This photo could not be prepared. Please try again.');
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}
