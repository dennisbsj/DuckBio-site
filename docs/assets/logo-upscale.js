/* Non-destructive high-quality enlargement of the approved DuckBio artwork.
   The six originals are preserved; no replacement artwork is generated.
   The approved shared sprite has 80x80px source cells, so this can improve
   displayed smoothing and edge clarity but cannot invent missing details. */
(() => {
  "use strict";
  const tileSize = 80;
  const tilePositions = {
    "logo-limsduck": [0, 0],
    "logo-ducknote": [1, 0],
    "logo-ducktrain": [2, 0],
    "logo-methduck": [0, 1],
    "logo-duckman": [2, 1]
  };
  const icons = Array.from(document.querySelectorAll("img.product-icon"));
  if (!icons.length) return;

  const getImage = (url) => new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not load original DuckBio artwork"));
    image.src = url;
  });
  const createCanvas = (size) => {
    const c = document.createElement("canvas");
    c.width = c.height = size;
    return c;
  };

  function enlarge(source) {
    /* Repeated high-quality interpolation avoids the rough native 80px
       enlargement and maintains the exact duck, glasses, colours and details. */
    const steps = [160, 320, 640, 800];
    let previous = source;
    for (const size of steps) {
      const enlarged = createCanvas(size);
      const ctx = enlarged.getContext("2d", { willReadFrequently: size === 800 });
      if (!ctx) return null;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(previous, 0, 0, size, size);
      previous = enlarged;
    }

    const ctx = previous.getContext("2d", { willReadFrequently: true });
    if (!ctx) return previous.toDataURL("image/png");
    const w = previous.width;
    const pixels = ctx.getImageData(0, 0, w, w);
    const data = pixels.data;
    const original = new Uint8ClampedArray(data);
    /* Conservative 5-tap unsharp mask at output resolution: crisp edges
       without the harsh pixelated look or changes to the approved design. */
    const strength = 0.24;
    for (let y = 1; y < w - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const idx = (y * w + x) * 4;
        for (let channel = 0; channel < 3; channel++) {
          const i = idx + channel;
          const neighbours = (
            original[i - 4] + original[i + 4] +
            original[i - w * 4] + original[i + w * 4]
          ) / 4;
          data[i] = Math.max(0, Math.min(255,
            Math.round(original[i] + strength * (original[i] - neighbours))
          ));
        }
      }
    }
    ctx.putImageData(pixels, 0, 0);
    return previous.toDataURL("image/png");
  }

  function apply(img, url) {
    if (!url) return;
    img.src = url;
    img.style.backgroundImage = "none";
    img.style.backgroundPosition = "initial";
    img.style.backgroundSize = "auto";
    img.dataset.resolutionEnhanced = "true";
  }

  async function enhanceLogo(img, sprite) {
    let original;
    if (img.classList.contains("logo-cytoduck")) {
      original = await getImage(img.currentSrc || img.src);
      const source = createCanvas(144);
      source.getContext("2d")?.drawImage(original, 0, 0, 144, 144);
      apply(img, enlarge(source));
      return;
    }
    const cls = Object.keys(tilePositions).find(c => img.classList.contains(c));
    if (!cls || !sprite) return;
    const [col, row] = tilePositions[cls];
    const crop = createCanvas(tileSize);
    crop.getContext("2d")?.drawImage(
      sprite, col * tileSize, row * tileSize, tileSize, tileSize,
      0, 0, tileSize, tileSize
    );
    apply(img, enlarge(crop));
  }

  (async () => {
    try {
      const needsSprite = icons.some(img =>
        Object.keys(tilePositions).some(cls => img.classList.contains(cls))
      );
      const sprite = needsSprite
        ? await getImage("assets/icons/duckbio-approved-sprite.webp?v=approved-20261029")
        : null;
      await Promise.all(icons.map(img => enhanceLogo(img, sprite)));
    } catch (e) {
      /* Existing original logos remain visible if canvas is unavailable. */
      console.warn("DuckBio logo enhancement unavailable; using originals.", e);
    }
  })();
})();