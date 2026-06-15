#!/usr/bin/env python3
"""
read_card.py — Extract and read the text on the small card tucked into the
flower bouquet in a photo.

Pipeline:
  1. Crop the card region from the full-resolution photo.
  2. Upscale + enhance (grayscale, contrast, sharpen) to make the small,
     slightly out-of-focus handwriting/print legible.
  3. Run OCR (tesseract via pytesseract) if available.
  4. Always emit an enhanced crop PNG so a human (or a vision model) can
     verify the text by eye.

Usage:
  python3 read_card.py <image_path> [--box L T R B]
"""
import argparse
import sys
from PIL import Image, ImageOps, ImageFilter, ImageEnhance


def enhance(crop: Image.Image, scale: int = 4) -> Image.Image:
    """Upscale and sharpen a small text crop for OCR / human reading."""
    g = ImageOps.grayscale(crop)
    g = g.resize((g.width * scale, g.height * scale), Image.LANCZOS)
    g = ImageOps.autocontrast(g, cutoff=1)
    g = ImageEnhance.Contrast(g).enhance(1.6)
    g = g.filter(ImageFilter.UnsharpMask(radius=2, percent=180, threshold=2))
    return g


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("image")
    # Default box is tuned to the card in this specific photo (1179x2556).
    ap.add_argument("--box", nargs=4, type=int,
                    default=[300, 815, 820, 1255],
                    metavar=("L", "T", "R", "B"))
    ap.add_argument("--out", default="card_enhanced.png")
    args = ap.parse_args()

    im = Image.open(args.image).convert("RGB")
    crop = im.crop(tuple(args.box))
    big = enhance(crop)
    big.save(args.out)
    print(f"[+] saved enhanced crop -> {args.out} ({big.size[0]}x{big.size[1]})")

    try:
        import pytesseract
        text = pytesseract.image_to_string(big, config="--psm 6")
        print("\n[OCR] --------------------------------------------")
        print(text.strip() or "(tesseract returned no text)")
        print("--------------------------------------------------")
    except Exception as e:  # noqa: BLE001
        print(f"[!] OCR unavailable ({e}); inspect {args.out} visually.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
