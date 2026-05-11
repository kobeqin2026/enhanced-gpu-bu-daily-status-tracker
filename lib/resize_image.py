#!/usr/bin/env python3
"""Image resize/compression helper for vision API.
Reads image from stdin (base64), resizes to max_width x max_height,
outputs compressed base64 to stdout.
Usage: echo "base64_data" | python3 resize_image.py [max_width] [max_quality]"""
import sys, base64, io

try:
    from PIL import Image
except ImportError:
    print("Pillow not installed", file=sys.stderr)
    sys.exit(1)

max_width = int(sys.argv[1]) if len(sys.argv) > 1 else 1200
max_quality = int(sys.argv[2]) if len(sys.argv) > 2 else 85

try:
    data = sys.stdin.buffer.read()
    img_data = base64.b64decode(data)
    img = Image.open(io.BytesIO(img_data))
    
    # Resize if wider than max_width (maintain aspect ratio)
    if img.width > max_width:
        ratio = max_width / img.width
        new_height = int(img.height * ratio)
        img = img.resize((max_width, new_height), Image.LANCZOS)
    
    # Convert to RGB if necessary (PNG with transparency -> JPG)
    if img.mode in ('RGBA', 'LA', 'P'):
        background = Image.new('RGB', img.size, (255, 255, 255))
        if img.mode == 'P':
            img = img.convert('RGBA')
        background.paste(img, mask=img.split()[-1] if 'A' in img.mode else None)
        img = background
    
    # Save as JPEG with quality compression
    output = io.BytesIO()
    img.save(output, format='JPEG', quality=max_quality)
    result = base64.b64encode(output.getvalue()).decode('ascii')
    print(result)
except Exception as e:
    print(f"Error: {e}", file=sys.stderr)
    sys.exit(1)
