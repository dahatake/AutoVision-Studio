#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import platform
import struct
import sys
import time
from dataclasses import dataclass
from typing import BinaryIO

MAGIC = b"AV"
VERSION = 1
HEADER_FORMAT = ">2sBBHHBBI"
HEADER_SIZE = struct.calcsize(HEADER_FORMAT)
SHAPES: dict[int, tuple[int, int]] = {
    1: (320, 320),
    2: (640, 640),
}
CHANNELS = 3
RESERVED = 0
MAX_BODY = HEADER_SIZE + (640 * 640 * CHANNELS)


@dataclass(frozen=True)
class Header:
    magic: bytes
    version: int
    shape_code: int
    width: int
    height: int
    channels: int
    reserved: int
    frame_index: int


class ProtocolError(Exception):
    pass


def read_exact(stream: BinaryIO, size: int, *, allow_clean_eof: bool = False) -> bytes | None:
    if size < 0:
        raise ProtocolError("negative read size")

    chunks = bytearray()
    while len(chunks) < size:
        block = stream.read(size - len(chunks))
        if block == b"":
            if allow_clean_eof and len(chunks) == 0:
                return None
            raise ProtocolError(f"unexpected EOF while reading {size} bytes")
        chunks.extend(block)
    return bytes(chunks)


def parse_header(data: bytes) -> Header:
    if len(data) != HEADER_SIZE:
        raise ProtocolError(f"invalid header length: {len(data)}")
    unpacked = struct.unpack(HEADER_FORMAT, data)
    return Header(
        magic=unpacked[0],
        version=unpacked[1],
        shape_code=unpacked[2],
        width=unpacked[3],
        height=unpacked[4],
        channels=unpacked[5],
        reserved=unpacked[6],
        frame_index=unpacked[7],
    )


def get_process_rss_bytes() -> tuple[int, int]:
    if os.name == "nt":
        import ctypes
        from ctypes import wintypes

        class ProcessMemoryCountersEx(ctypes.Structure):
            _fields_ = [
                ("cb", wintypes.DWORD),
                ("PageFaultCount", wintypes.DWORD),
                ("PeakWorkingSetSize", ctypes.c_size_t),
                ("WorkingSetSize", ctypes.c_size_t),
                ("QuotaPeakPagedPoolUsage", ctypes.c_size_t),
                ("QuotaPagedPoolUsage", ctypes.c_size_t),
                ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t),
                ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
                ("PagefileUsage", ctypes.c_size_t),
                ("PeakPagefileUsage", ctypes.c_size_t),
                ("PrivateUsage", ctypes.c_size_t),
            ]

        psapi = ctypes.WinDLL("psapi", use_last_error=True)
        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        get_current_process = kernel32.GetCurrentProcess
        get_current_process.restype = wintypes.HANDLE

        get_process_memory_info = psapi.GetProcessMemoryInfo
        get_process_memory_info.argtypes = [
            wintypes.HANDLE,
            ctypes.POINTER(ProcessMemoryCountersEx),
            wintypes.DWORD,
        ]
        get_process_memory_info.restype = wintypes.BOOL

        counters = ProcessMemoryCountersEx()
        counters.cb = ctypes.sizeof(ProcessMemoryCountersEx)
        process_handle = get_current_process()
        success = get_process_memory_info(process_handle, ctypes.byref(counters), counters.cb)
        if not success:
            raise OSError(ctypes.get_last_error(), "GetProcessMemoryInfo failed")
        return int(counters.WorkingSetSize), int(counters.PeakWorkingSetSize)

    import importlib

    resource_module = importlib.import_module("resource")
    getrusage = getattr(resource_module, "getrusage", None)
    rusage_self = getattr(resource_module, "RUSAGE_SELF", None)
    if getrusage is None or rusage_self is None:
        raise OSError("resource.getrusage is unavailable on this platform")

    usage = getrusage(rusage_self)
    rss = int(usage.ru_maxrss)
    if platform.system() == "Darwin":
        rss_bytes = rss
    else:
        rss_bytes = rss * 1024
    return rss_bytes, rss_bytes


def emit(record: dict[str, object]) -> None:
    sys.stdout.write(json.dumps(record, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def validate(header: Header, payload_len: int, seq_expected: int) -> str:
    if header.magic != MAGIC:
        raise ProtocolError("invalid magic")
    if header.version != VERSION:
        raise ProtocolError(f"unsupported version: {header.version}")
    if header.shape_code not in SHAPES:
        raise ProtocolError(f"unsupported shape code: {header.shape_code}")
    expected_width, expected_height = SHAPES[header.shape_code]
    if (header.width, header.height) != (expected_width, expected_height):
        raise ProtocolError(
            f"shape mismatch: {(header.width, header.height)} != {(expected_width, expected_height)}"
        )
    if header.channels != CHANNELS:
        raise ProtocolError(f"unsupported channels: {header.channels}")
    if header.reserved != RESERVED:
        raise ProtocolError(f"reserved must be 0, got {header.reserved}")
    if header.frame_index != seq_expected:
        raise ProtocolError(f"frame index mismatch: {header.frame_index} != {seq_expected}")

    expected_payload = header.width * header.height * CHANNELS
    if payload_len != expected_payload:
        raise ProtocolError(f"payload length mismatch: {payload_len} != {expected_payload}")

    return f"{header.width}x{header.height}"


def main() -> int:
    cpu_start_ns = time.process_time_ns()
    rss_last, rss_peak = get_process_rss_bytes()

    seq = 0
    ok = True
    error_message = ""

    stdin = sys.stdin.buffer

    while True:
        prefix = read_exact(stdin, 4, allow_clean_eof=True)
        if prefix is None:
            break

        body_length = int.from_bytes(prefix, byteorder="big", signed=False)
        service_start_ns = time.perf_counter_ns()

        try:
            if body_length < HEADER_SIZE:
                raise ProtocolError(f"body too short: {body_length}")
            if body_length > MAX_BODY:
                raise ProtocolError(f"body too long: {body_length}")

            body = read_exact(stdin, body_length)
            if body is None:
                raise ProtocolError("unexpected EOF on body")

            header = parse_header(body[:HEADER_SIZE])
            payload = body[HEADER_SIZE:]
            shape = validate(header, len(payload), seq)

            service_ns = time.perf_counter_ns() - service_start_ns
            emit(
                {
                    "type": "ack",
                    "ok": True,
                    "seq": seq,
                    "shape": shape,
                    "body_len": body_length,
                    "payload_len": len(payload),
                    "service_ns": service_ns,
                }
            )
            seq += 1
            rss_last, rss_peak_sample = get_process_rss_bytes()
            rss_peak = max(rss_peak, rss_peak_sample)
        except (ProtocolError, OSError, struct.error, ValueError) as exc:
            ok = False
            error_message = str(exc)
            service_ns = time.perf_counter_ns() - service_start_ns
            emit(
                {
                    "type": "ack",
                    "ok": False,
                    "seq": seq,
                    "error": error_message,
                    "service_ns": service_ns,
                }
            )
            break

    cpu_end_ns = time.process_time_ns()
    emit(
        {
            "type": "summary",
            "ok": ok,
            "frames": seq,
            "cpu_process_ns": cpu_end_ns - cpu_start_ns,
            "rss_last_bytes": rss_last,
            "rss_peak_bytes": rss_peak,
            "error": error_message if not ok else None,
        }
    )
    return 0 if ok else 2


if __name__ == "__main__":
    raise SystemExit(main())
