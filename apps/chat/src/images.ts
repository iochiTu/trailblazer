/**
 * Turns a picked, dropped or pasted image into base64 for the chat API.
 *
 * The image is redrawn on a canvas: large photos are scaled down (vision models don't need more
 * than ~1600 px, and uploads stay small on mobile data), the camera's rotation is applied, and
 * metadata such as GPS position is left behind. The server checks and cleans it again.
 */

export const MAX_IMAGES = 3;
/** Server limit per image (decoded); keep in sync with MAX_CHAT_IMAGE_BYTES. */
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_SIDE = 1568;

export interface PendingImage {
  id: string;
  name: string;
  /** Base64 without the `data:` prefix. */
  data: string;
}

export class ImageError extends Error {
  constructor(readonly code: "imageUnsupported" | "imageTooBig") {
    super(code);
  }
}

export const isImageFile = (file: File) => file.type.startsWith("image/") && file.type !== "image/svg+xml";

/** Image files among dropped or pasted items. */
export function imageFiles(list: FileList | null | undefined): File[] {
  return Array.from(list ?? []).filter(isImageFile);
}

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
}

function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

let counter = 0;

export async function prepareImage(file: File): Promise<PendingImage> {
  if (!isImageFile(file)) throw new ImageError("imageUnsupported");
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    // Formats the browser can't decode (e.g. HEIC outside Safari).
    throw new ImageError("imageUnsupported");
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new ImageError("imageUnsupported");
  // JPEG has no transparency: put transparent areas (logos, screenshots) on white.
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  for (const quality of [0.85, 0.7, 0.5]) {
    const blob = await toBlob(canvas, quality);
    if (blob && blob.size <= MAX_BYTES) {
      return { id: `img${++counter}`, name: file.name || "image.jpg", data: await toBase64(blob) };
    }
  }
  throw new ImageError("imageTooBig");
}
