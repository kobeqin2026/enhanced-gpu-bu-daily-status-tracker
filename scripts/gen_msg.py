#!/usr/bin/env python3
"""Generate a genuine Outlook .msg that OPENS in Outlook — by mirroring a known-good template.

ROOT CAUSE (solved 2026-09-24): Prior attempts hand-rolled the __properties_version1.0
property table and rebuilt the CFB container from scratch. Every local reader
(extract_msg / olefile / compoundfiles) reported "valid", yet real Outlook still rejected the
file — those readers don't emulate the strict checks Outlook performs on the property stream /
storage tree. The reliable fix is to STOP inventing structure: clone a genuine, Outlook-open
.msg (msg_template.msg) byte-for-byte and only substitute the subject/body streams and the
two property-table length fields. The resulting file is structurally indistinguishable from a
mail Outlook itself created, so it opens.

This module is pure stdlib + the vendored extract_msg.OleWriter (see ./vendor/) for the CFB
rebuild.

Usage (unchanged): gen_msg.py - <out.msg> reads {subject, body, sender} JSON from stdin.
"""
import struct
import sys
import os
import io

_THIS_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _THIS_DIR)
sys.path.insert(0, os.path.join(_THIS_DIR, 'vendor'))
import red_black_dict_mod  # noqa: E402,F401
from extract_msg.ole_writer import OleWriter  # noqa: E402

#: The known-good template (a minimal, Outlook-openable IPM.Note with no attachments).
_TEMPLATE_PATH = os.path.join(_THIS_DIR, 'msg_template.msg')


def u16(t):
    """UTF-16LE bytes WITHOUT a trailing NUL — matches how real Outlook writes stream bodies."""
    return t.encode('utf-16-le')


def ansi(t):
    return t.encode('cp1252', errors='replace')


def _prop_tags_block(prop_bytes):
    """Yield (offset, tag) for each 16-byte property entry in a __properties_version1.0 stream."""
    off = 32
    while off + 16 <= len(prop_bytes):
        e = prop_bytes[off:off + 16]
        tag = e[3::-1].hex().upper()
        yield off, tag
        off += 16


def _patch_property_lengths(prop_bytes, subject_utf16, body_utf16):
    """Update the length fields for subject(0x0037)/body(0x1000) PT_UNICODE entries.

    Real Outlook stores the entry length as the stream byte count (+2 for the surrogate/terminator
    accounting used by Outlook). We set length = len(utf16)+2 and reserved = 3 to match.
    """
    b = bytearray(prop_bytes)
    for off, tag in _prop_tags_block(prop_bytes):
        if tag == '0037001F':
            struct.pack_into('<I', b, off + 8, len(subject_utf16) + 2)
            struct.pack_into('<I', b, off + 12, 3)
        elif tag == '1000001F':
            struct.pack_into('<I', b, off + 8, len(body_utf16) + 2)
            struct.pack_into('<I', b, off + 12, 3)
    return bytes(b)


def _fix_empty_streams(raw):
    """Set the start sector of size-zero directory entries to 0 (not ENDOFCHAIN).

    Empty streams (size 0) must have start=0; ENDOFCHAIN(0xFFFFFFFE) is what strict readers
    (Outlook) reject. Walk the directory via the FAT and patch type==STREAM, size==0 entries.
    """
    d = bytearray(raw)
    def _u16(o): return struct.unpack_from('<H', d, o)[0]
    def _u32(o): return struct.unpack_from('<I', d, o)[0]
    sector = 1 << _u16(30)
    fat = []
    for i in range(_u32(44)):
        base = 512 + i * sector
        for j in range(sector // 4):
            fat.append(_u32(base + j * 4))
    cur = _u32(48)
    for _ in range(4096):
        if cur >= 0xFFFFFFFE or cur >= len(d) // sector:
            break
        base = 512 + cur * sector
        for k in range(sector // 128):
            o = base + k * 128
            if _u32(o + 120) == 0 and _u32(o + 116) == 0xFFFFFFFE:
                struct.pack_into('<I', d, o + 116, 0)
        cur = fat[cur] if cur < len(fat) else 0xFFFFFFFE
    return bytes(d)


# Property tags whose streams must NOT be carried into the clone: the RTF body (0x1009)
# and its HTML/InSync relatives. Outlook prefers RTF/HTML over the plain body (0x1000), so a
# stale RTF copied from the template makes Outlook show the template's old content instead of
# the substituted body (the "email shows Test" bug). Dropping them yields a clean plain-text mail.
_DROP_PROP_IDS = {0x1009, 0x100A, 0x1013}


def _drop_property_entries(prop_bytes, drop_ids):
    """Rebuild a __properties_version1.0 stream without entries whose property id is in drop_ids.

    Entry layout (16 bytes, after the 32-byte header): tag(4) reserved(4) len(4) reserved(4);
    property id = high 16 bits of tag = bytes[2:4] little-endian.
    """
    head = prop_bytes[:32]
    tail = prop_bytes[32:]
    out = bytearray(head)
    dropped = 0
    for off in range(0, len(tail), 16):
        e = tail[off:off + 16]
        if len(e) < 16:
            break
        pid = struct.unpack_from('<H', e, 2)[0]
        if pid in drop_ids:
            dropped += 1
            continue
        out += e
    if dropped:
        print('[gen_msg] dropped %d RTF/HTML property entr%s' % (dropped, 'y' if dropped == 1 else 'ies'))
    return bytes(out)


def make_msg(subject, body_text, sender='gpu-tracker@birentech.com'):
    """Build an Outlook-openable .msg by mirroring msg_template.msg.

    Copies every stream/storage of the template exactly (so Outlook finds every object the
    property stream declares), then substitutes subject(0x0037)/body(0x1000) UTF-16LE streams
    and their property-table length fields. The sender is not used by this mirror — the
    template already carries a valid sender/header structure.
    """
    template = open(_TEMPLATE_PATH, 'rb').read()

    # Unwrap the template into its directory entries so we can copy streams and patch props.
    # We re-list via OleWriter's reader to get every path, then rebuild.
    import olefile  # vendored under scripts/vendor? no — stdlib. (olefile is present in env.)
    path = _TEMPLATE_PATH
    import importlib
    # olefile may not be importable as stdlib; use a lightweight CFB read via olefile if present
    # else fall back to a manual parse. We'll attempt olefile (bundled with the app environment).
    try:
        import olefile as _ole
    except ImportError:
        _ole = None

    if _ole is not None:
        fr = _ole.OleFileIO(path)
        paths = fr.listdir()
        orig_props = fr.openstream(['__properties_version1.0']).read()
    else:
        # Minimal CFB reader fallback — not expected in production; raise clear error.
        raise RuntimeError('olefile not importable; cannot mirror msg_template.msg')

    new_props = _drop_property_entries(orig_props, _DROP_PROP_IDS)
    new_props = _patch_property_lengths(new_props, u16(subject), u16(body_text))

    ow = OleWriter()
    ow.addEntry('__properties_version1.0', new_props)
    for p in paths:
        if p == ['__properties_version1.0']:
            continue
        ref = '/'.join(p)
        if ref == '__substg1.0_0037001F':
            data = u16(subject)
        elif ref == '__substg1.0_1000001F':
            data = u16(body_text)
        elif ref == '__substg1.0_10090102' or ref == '__substg1.0_100A0102' or ref == '__substg1.0_10130102':
            # drop stale RTF/HTML body + sync flag (Outlook would prefer them over the plain body)
            continue
        else:
            data = fr.openstream(p).read()
        ow.addEntry(ref, data)
    fr.close()

    buf = io.BytesIO()
    ow.write(buf)
    out = _fix_empty_streams(buf.getvalue())
    return out


def main(argv):
    if not argv or len(argv) < 2:
        print('usage: gen_msg.py <subject> <body> <out.msg> [sender]', file=sys.stderr)
        print('   or: printf JSON | gen_msg.py - <out.msg>', file=sys.stderr)
        return 2
    subject = argv[1]
    if subject == '-':
        out = argv[2]
        payload = json.load(sys.stdin)
        subject = payload.get('subject', '')
        body = payload.get('body', '')
        sender = payload.get('sender', 'gpu-tracker@birentech.com')
    else:
        body = argv[2]
        out = argv[3]
        sender = argv[4] if len(argv) > 4 else 'gpu-tracker@birentech.com'
    data = make_msg(subject, body, sender)
    with open(out, 'wb') as f:
        f.write(data)
    print('wrote %s (%d bytes)' % (out, len(data)))
    return 0


import json  # noqa: E402


if __name__ == '__main__':
    sys.exit(main(sys.argv))