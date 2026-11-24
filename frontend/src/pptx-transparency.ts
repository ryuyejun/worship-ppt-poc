const DRAWING_NS = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const OFFICE_REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PACKAGE_REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';

async function makeColorKeyTransparent(bytes: Uint8Array, mimeType: string) {
  const bitmap = await createImageBitmap(new Blob([bytes.slice().buffer as ArrayBuffer], { type: mimeType }));
  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('PPT 이미지 투명도를 처리할 수 없습니다.');
    context.drawImage(bitmap, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    const data = pixels.data;

    // OOXML clrChange has no direct equivalent in the browser renderer. Unmatte
    // the keyed white background into alpha while retaining antialiased edges.
    for (let offset = 0; offset < data.length; offset += 4) {
      const originalAlpha = data[offset + 3];
      if (originalAlpha === 0) continue;
      const minimum = Math.min(data[offset], data[offset + 1], data[offset + 2]);
      const alpha = Math.round(originalAlpha * (255 - minimum) / 255);
      if (alpha === 0) {
        data[offset] = data[offset + 1] = data[offset + 2] = data[offset + 3] = 0;
        continue;
      }
      data[offset] = Math.round((data[offset] - minimum) * 255 / alpha);
      data[offset + 1] = Math.round((data[offset + 1] - minimum) * 255 / alpha);
      data[offset + 2] = Math.round((data[offset + 2] - minimum) * 255 / alpha);
      data[offset + 3] = alpha;
    }
    context.putImageData(pixels, 0, 0);
    const png = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('PPT 이미지 투명도를 저장할 수 없습니다.')), 'image/png');
    });
    return new Uint8Array(await png.arrayBuffer());
  } finally {
    bitmap.close();
  }
}

function isWhiteToTransparentChange(blip: Element) {
  const change = Array.from(blip.getElementsByTagNameNS(DRAWING_NS, 'clrChange'))[0];
  if (!change) return false;
  const from = change.getElementsByTagNameNS(DRAWING_NS, 'clrFrom')[0]
    ?.getElementsByTagNameNS(DRAWING_NS, 'srgbClr')[0];
  const to = change.getElementsByTagNameNS(DRAWING_NS, 'clrTo')[0]
    ?.getElementsByTagNameNS(DRAWING_NS, 'srgbClr')[0];
  const sourceColor = from?.getAttribute('val')?.replace(/^#/, '').toLowerCase();
  const targetColor = to?.getAttribute('val')?.replace(/^#/, '').toLowerCase();
  const targetAlpha = to?.getElementsByTagNameNS(DRAWING_NS, 'alpha')[0]?.getAttribute('val');
  return sourceColor === 'ffffff' && targetColor === 'ffffff' && targetAlpha === '0';
}

function resolveRelationshipTarget(slidePath: string, target: string) {
  if (/^[a-z][a-z\d+.-]*:/i.test(target)) return null;
  const resolved = new URL(target, `https://pptx.local/${slidePath}`).pathname.slice(1);
  return resolved.startsWith('ppt/media/') ? resolved : null;
}

/**
 * Converts PPT's white-to-transparent picture effect into PNG alpha so the
 * browser slide renderer preserves lyric and score overlays on top of artwork.
 */
export async function preparePptxTransparency(bytes: Uint8Array) {
  const { default: JSZip } = await import('jszip');
  const zip = await JSZip.loadAsync(bytes);
  let changed = false;
  const slidePaths = Object.keys(zip.files).filter(path => /^ppt\/slides\/slide\d+\.xml$/.test(path));

  for (const slidePath of slidePaths) {
    const slideFile = zip.file(slidePath);
    const baseName = slidePath.split('/').pop()!;
    const relsPath = `ppt/slides/_rels/${baseName}.rels`;
    const relsFile = zip.file(relsPath);
    if (!slideFile || !relsFile) continue;

    const slideDocument = new DOMParser().parseFromString(await slideFile.async('string'), 'application/xml');
    const relsDocument = new DOMParser().parseFromString(await relsFile.async('string'), 'application/xml');
    if (slideDocument.querySelector('parsererror') || relsDocument.querySelector('parsererror')) continue;

    const originalRelationships = new Map(Array.from(relsDocument.getElementsByTagNameNS(PACKAGE_REL_NS, 'Relationship')).map(relationship => [
      relationship.getAttribute('Id') ?? '', relationship.getAttribute('Target') ?? '',
    ]));
    const updatedRelationships = new Map<string, string>();
    const processedImages = new Map<string, string>();
    let slideChanged = false;

    for (const blip of Array.from(slideDocument.getElementsByTagNameNS(DRAWING_NS, 'blip'))) {
      if (!isWhiteToTransparentChange(blip)) continue;
      const relationshipId = blip.getAttributeNS(OFFICE_REL_NS, 'embed');
      const target = relationshipId ? originalRelationships.get(relationshipId) : undefined;
      if (!target) continue;
      const imagePath = resolveRelationshipTarget(slidePath, target);
      if (!imagePath || !/\.(?:png|jpe?g)$/i.test(imagePath)) continue;

      let transparentPath = processedImages.get(imagePath);
      if (!transparentPath) {
        const imageFile = zip.file(imagePath);
        if (!imageFile) continue;
        const mimeType = /\.png$/i.test(imagePath) ? 'image/png' : 'image/jpeg';
        const imageBytes = await imageFile.async('uint8array');
        const transparentImage = await makeColorKeyTransparent(imageBytes, mimeType);
        transparentPath = imagePath.replace(/\.(?:png|jpe?g)$/i, '-yebit-alpha.png');
        zip.file(transparentPath, transparentImage);
        processedImages.set(imagePath, transparentPath);
      }
      updatedRelationships.set(relationshipId!, `../media/${transparentPath.split('/').pop()}`);
      blip.getElementsByTagNameNS(DRAWING_NS, 'clrChange')[0]?.remove();
      slideChanged = true;
    }

    if (slideChanged) {
      for (const relationship of Array.from(relsDocument.getElementsByTagNameNS(PACKAGE_REL_NS, 'Relationship'))) {
        const replacement = updatedRelationships.get(relationship.getAttribute('Id') ?? '');
        if (replacement) relationship.setAttribute('Target', replacement);
      }
      zip.file(slidePath, new XMLSerializer().serializeToString(slideDocument));
      zip.file(relsPath, new XMLSerializer().serializeToString(relsDocument));
      changed = true;
    }
  }

  return changed ? zip.generateAsync({ type: 'uint8array' }) : bytes;
}
