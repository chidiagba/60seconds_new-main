#!/usr/bin/env python3
"""Check 64-bit ELF LOAD alignment in an APK/AAB/AAR, plus APK ZIP alignment.

Usage: python3 scripts/check-android-page-alignment.py path/to/release.apk
See https://developer.android.com/guide/practices/page-sizes
"""
import json
import struct
import sys
import zipfile
from pathlib import Path


def check_archive(path):
    libraries, errors = [], []
    with zipfile.ZipFile(path) as archive, open(path, 'rb') as raw:
        for entry in archive.infolist():
            if not entry.filename.endswith('.so'):
                continue
            if not any(f'/{abi}/' in entry.filename for abi in ('arm64-v8a', 'x86_64')):
                continue
            data = archive.read(entry)
            if data[:5] != b'\x7fELF\x02':
                errors.append(f'{entry.filename}: expected 64-bit ELF')
                continue
            endian = '<' if data[5] == 1 else '>'
            phoff = struct.unpack_from(endian + 'Q', data, 32)[0]
            phsize, phnum = struct.unpack_from(endian + 'HH', data, 54)
            segments, writable_ranges, relro_ends = [], [], []
            for i in range(phnum):
                kind, flags, offset, address, _, _, mem_size, alignment = struct.unpack_from(
                    endian + 'IIQQQQQQ', data, phoff + i * phsize)
                if kind == 1:  # PT_LOAD
                    segments.append(alignment)
                    if flags & 2:  # PF_W
                        writable_ranges.append((address, address + mem_size))
                    if alignment < 16384 or (address - offset) % 16384:
                        errors.append(f'{entry.filename}: LOAD is not 16 KB aligned')
                elif kind == 0x6474e552:  # PT_GNU_RELRO
                    relro_ends.append(address + mem_size)
            for end in relro_ends:
                protected_end = (end + 16383) // 16384 * 16384
                # An isolated RELRO LOAD may end between pages. It is unsafe
                # only if rounding protection covers bytes that must be writable.
                if any(max(start, end) < min(stop, protected_end)
                       for start, stop in writable_ranges):
                    errors.append(f'{entry.filename}: RELRO overlaps writable data on 16 KB pages')
            if not segments:
                errors.append(f'{entry.filename}: no LOAD segments')
            result = {'library': entry.filename, 'load_alignments': segments,
                      'relro_ends': relro_ends}
            if path.suffix == '.apk' and entry.compress_type == zipfile.ZIP_STORED:
                raw.seek(entry.header_offset + 26)
                name_size, extra_size = struct.unpack('<HH', raw.read(4))
                offset = entry.header_offset + 30 + name_size + extra_size
                result['zip_data_offset'] = offset
                if offset % 16384:
                    errors.append(f'{entry.filename}: ZIP data is not 16 KB aligned')
            libraries.append(result)
    if not libraries:
        errors.append('No 64-bit native libraries found')
    return {'archive': str(path), 'passed': not errors,
            'libraries_checked': len(libraries), 'errors': errors, 'libraries': libraries}


if __name__ == '__main__':
    report = check_archive(Path(sys.argv[1]))
    print(json.dumps(report, indent=2))
    sys.exit(0 if report['passed'] else 1)
