# Minimal extract_msg vendored package for OleWriter only.
# The full extract_msg __init__ pulls the READ side (attachments/msg_classes/structures),
# which we do NOT need and which requires extra deps (compressed_rtf, etc.). We only use
# ole_writer.OleWriter to BUILD a genuine Outlook .msg. Keep this __init__ EMPTY so
# `from vendor.extract_msg.ole_writer import OleWriter` works without the reader's deps.