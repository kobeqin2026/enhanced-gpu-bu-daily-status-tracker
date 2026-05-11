#!/usr/bin/env python3
"""GPU Tracker Image Analysis Cache Manager

This script scans JIRA bug attachments and extracts them for AI agent analysis.
Usage:
  python3 scan_images.py <bug_key> [--output /path/to/cache.json]
"""
import sys
import os
import json
import hashlib

CACHE_DIR = os.path.expanduser("~/.hermes/gpu-tracker/image-cache")
CACHE_FILE = os.path.join(CACHE_DIR, "analysis-cache.json")

def load_cache():
    if os.path.exists(CACHE_FILE):
        with open(CACHE_FILE) as f:
            return json.load(f)
    return {}

def save_cache(cache):
    os.makedirs(CACHE_DIR, exist_ok=True)
    with open(CACHE_FILE, 'w') as f:
        json.dump(cache, f, indent=2, ensure_ascii=False)

def url_hash(url):
    return hashlib.md5(url.encode()).hexdigest()[:12]

def scan_bug_attachments(bug_key, attachments):
    """Extract image attachment info for the agent to analyze."""
    cache = load_cache()
    images = []
    for att in attachments:
        h = url_hash(att.get('content', ''))
        if h in cache:
            print(f"  [CACHED] {att.get('filename', '?')}: {cache[h].get('summary', '')[:80]}")
        else:
            images.append({
                'hash': h,
                'url': att.get('content', ''),
                'filename': att.get('filename', ''),
                'mimeType': att.get('mimeType', '')
            })
            print(f"  [NEED ANALYSIS] {att.get('filename', '?')}")
    return images, cache

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("Usage: python3 scan_images.py <bug_key> [--attachments 'json_string']")
        sys.exit(1)
    
    bug_key = sys.argv[1]
    # Read attachments from stdin or file
    if not sys.stdin.isatty():
        data = json.loads(sys.stdin.read())
    else:
        # Try reading from a file
        data = []
    
    images, cache = scan_bug_attachments(bug_key, data)
    print(f"\nBug {bug_key}: {len(images)} images need analysis, {len(data) - len(images)} cached")
