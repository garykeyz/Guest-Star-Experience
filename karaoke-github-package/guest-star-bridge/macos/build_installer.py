#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import plistlib
import re
import shutil
import stat
import struct
import subprocess
import tarfile
from pathlib import Path

import pycdlib
from PIL import Image, ImageDraw


APP_NAME = "Guest Star Bridge.app"
BUNDLE_ID = "com.gstarxp.guest-star-bridge"


def arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Construye la app y una imagen montable para macOS Apple Silicon."
    )
    parser.add_argument("--node-tarball", required=True, type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    return parser.parse_args()


def write_info_plist(path: Path, version: str) -> None:
    version_number = int(re.sub(r"\D", "", version) or "1")
    payload = {
        "CFBundleDevelopmentRegion": "es",
        "CFBundleDisplayName": "Guest Star Bridge",
        "CFBundleExecutable": "GuestStarBridge",
        "CFBundleIconFile": "AppIcon.icns",
        "CFBundleIdentifier": BUNDLE_ID,
        "CFBundleInfoDictionaryVersion": "6.0",
        "CFBundleName": "Guest Star Bridge",
        "CFBundlePackageType": "APPL",
        "CFBundleShortVersionString": version,
        "CFBundleVersion": str(version_number),
        "LSArchitecturePriority": ["arm64"],
        "LSMinimumSystemVersion": "11.0",
        "LSMultipleInstancesProhibited": True,
        "NSAppTransportSecurity": {"NSAllowsLocalNetworking": True},
        "NSHighResolutionCapable": True,
    }
    with path.open("wb") as handle:
        plistlib.dump(payload, handle, sort_keys=True)


def render_icon(size: int) -> Image.Image:
    scale = size / 1024
    image = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    gradient = Image.new("RGBA", (size, size))
    pixels = gradient.load()
    for y in range(size):
        position = y / max(1, size - 1)
        red = int(26 + (218 - 26) * position)
        green = int(13 + (44 - 13) * position)
        blue = int(44 + (255 - 44) * position)
        for x in range(size):
            pixels[x, y] = (red, green, blue, 255)
    mask = Image.new("L", (size, size), 0)
    mask_draw = ImageDraw.Draw(mask)
    mask_draw.rounded_rectangle(
        (48 * scale, 48 * scale, 976 * scale, 976 * scale),
        radius=220 * scale,
        fill=255,
    )
    image.paste(gradient, (0, 0), mask)

    draw = ImageDraw.Draw(image)
    draw.ellipse(
        (182 * scale, 182 * scale, 842 * scale, 842 * scale),
        fill=(9, 6, 15, 122),
    )
    draw.rounded_rectangle(
        (335 * scale, 211 * scale, 689 * scale, 717 * scale),
        radius=177 * scale,
        fill=(241, 255, 250, 255),
    )
    line_width = max(2, int(90 * scale))
    draw.arc(
        (269 * scale, 363 * scale, 755 * scale, 791 * scale),
        start=0,
        end=180,
        fill=(255, 255, 255, 255),
        width=line_width,
    )
    draw.line(
        (512 * scale, 760 * scale, 512 * scale, 884 * scale),
        fill=(255, 255, 255, 255),
        width=line_width,
    )
    draw.line(
        (372 * scale, 899 * scale, 652 * scale, 899 * scale),
        fill=(255, 255, 255, 255),
        width=line_width,
    )
    star = [
        (795, 184),
        (818, 242),
        (876, 265),
        (818, 288),
        (795, 346),
        (772, 288),
        (714, 265),
        (772, 242),
    ]
    draw.polygon(
        [(x * scale, y * scale) for x, y in star],
        fill=(255, 220, 99, 255),
    )
    draw.ellipse(
        (184 * scale, 266 * scale, 232 * scale, 314 * scale),
        fill=(115, 249, 208, 255),
    )
    draw.ellipse(
        (794 * scale, 699 * scale, 856 * scale, 761 * scale),
        fill=(255, 220, 99, 255),
    )
    return image


def write_icns(output_path: Path, work_dir: Path) -> None:
    icon_specs = [
        ("icp4", 16),
        ("icp5", 32),
        ("icp6", 64),
        ("ic07", 128),
        ("ic08", 256),
        ("ic09", 512),
        ("ic10", 1024),
        ("ic11", 32),
        ("ic12", 64),
        ("ic13", 256),
        ("ic14", 512),
    ]
    chunks: list[bytes] = []
    for index, (kind, size) in enumerate(icon_specs):
        png_path = work_dir / f"icon-{index}-{size}.png"
        render_icon(size).save(png_path, format="PNG")
        data = png_path.read_bytes()
        chunks.append(kind.encode("ascii") + struct.pack(">I", len(data) + 8) + data)
    body = b"".join(chunks)
    output_path.write_bytes(b"icns" + struct.pack(">I", len(body) + 8) + body)


def extract_node(node_tarball: Path, runtime_dir: Path) -> None:
    runtime_dir.mkdir(parents=True, exist_ok=True)
    with tarfile.open(node_tarball, "r:gz") as archive:
        members = archive.getmembers()
        node_members = [
            member
            for member in members
            if member.isfile() and member.name.endswith("/bin/node")
        ]
        license_members = [
            member
            for member in members
            if member.isfile()
            and member.name.endswith("/LICENSE")
            and len(Path(member.name).parts) <= 2
        ]
        if not node_members or not license_members:
            raise RuntimeError("El paquete de Node no contiene los archivos requeridos.")
        node_member = min(node_members, key=lambda member: len(Path(member.name).parts))
        license_member = min(
            license_members,
            key=lambda member: len(Path(member.name).parts),
        )
        node_source = archive.extractfile(node_member)
        license_source = archive.extractfile(license_member)
        if node_source is None or license_source is None:
            raise RuntimeError("El paquete de Node no contiene los archivos requeridos.")
        node_path = runtime_dir / "node"
        with node_path.open("wb") as handle:
            shutil.copyfileobj(node_source, handle)
        with (runtime_dir / "NODE-LICENSE.txt").open("wb") as handle:
            shutil.copyfileobj(license_source, handle)
    node_path.chmod(0o755)
    magic = node_path.read_bytes()[:4]
    if magic not in {b"\xcf\xfa\xed\xfe", b"\xca\xfe\xba\xbe"}:
        raise RuntimeError("El ejecutable incluido no parece ser Mach-O para macOS.")


def copy_bridge_source(bridge_root: Path, destination: Path) -> None:
    destination.mkdir(parents=True, exist_ok=True)
    for folder in ("src", "public"):
        shutil.copytree(bridge_root / folder, destination / folder)
    for filename in ("package.json", "README.md", "config.example.json"):
        shutil.copy2(bridge_root / filename, destination / filename)


def add_tree_to_iso(
    iso: pycdlib.PyCdlib,
    source_root: Path,
    iso_root: str,
    joliet_root: str,
) -> None:
    mappings: dict[Path, tuple[str, str]] = {
        source_root: (iso_root, joliet_root)
    }
    directory_counter = 0
    file_counter = 0

    for current, directories, files in os.walk(source_root):
        current_path = Path(current)
        current_iso, current_joliet = mappings[current_path]
        directories.sort()
        files.sort()

        for name in directories:
            directory_counter += 1
            path = current_path / name
            iso_name = f"D{directory_counter:06d}"
            iso_path = f"{current_iso}/{iso_name}"
            joliet_path = f"{current_joliet}/{name}"
            iso.add_directory(
                iso_path=iso_path,
                rr_name=name,
                joliet_path=joliet_path,
                file_mode=stat.S_IMODE(path.stat().st_mode),
            )
            mappings[path] = (iso_path, joliet_path)

        for name in files:
            file_counter += 1
            path = current_path / name
            extension = re.sub(r"[^A-Z0-9]", "", path.suffix.upper().lstrip("."))[:3]
            extension = extension or "BIN"
            iso_name = f"F{file_counter:06d}.{extension};1"
            iso.add_file(
                str(path),
                iso_path=f"{current_iso}/{iso_name}",
                rr_name=name,
                joliet_path=f"{current_joliet}/{name}",
                file_mode=stat.S_IMODE(path.stat().st_mode),
            )


def create_disk_image(app_bundle: Path, readme: Path, output_path: Path) -> None:
    iso = pycdlib.PyCdlib()
    iso.new(
        interchange_level=3,
        vol_ident="GSTAR_BRIDGE",
        app_ident_str="Guest Star Bridge for Apple Silicon",
        joliet=3,
        rock_ridge="1.09",
    )
    iso.add_directory(
        iso_path="/GSTARAPP",
        rr_name=APP_NAME,
        joliet_path=f"/{APP_NAME}",
        file_mode=0o755,
    )
    add_tree_to_iso(iso, app_bundle, "/GSTARAPP", f"/{APP_NAME}")
    iso.add_file(
        str(readme),
        iso_path="/LEEME.TXT;1",
        rr_name="LEEME.txt",
        joliet_path="/LEEME.txt",
        file_mode=0o644,
    )
    iso.add_symlink(
        symlink_path="/APPS",
        rr_symlink_name="Applications",
        rr_path="/Applications",
    )
    iso.write(str(output_path))
    iso.close()


def create_zip(app_bundle: Path, output_path: Path) -> None:
    if output_path.exists():
        output_path.unlink()
    subprocess.run(
        ["zip", "-q", "-r", "-y", str(output_path), app_bundle.name],
        cwd=app_bundle.parent,
        check=True,
    )


def main() -> None:
    args = arguments()
    bridge_root = Path(__file__).resolve().parent.parent
    version = json.loads((bridge_root / "package.json").read_text())["version"]
    output_dir = args.output_dir.resolve()
    staging = output_dir / "macos-installer-staging"
    app_bundle = staging / APP_NAME
    contents = app_bundle / "Contents"
    resources = contents / "Resources"
    macos_dir = contents / "MacOS"

    if staging.exists():
        shutil.rmtree(staging)
    staging.mkdir(parents=True)
    resources.mkdir(parents=True)
    macos_dir.mkdir(parents=True)

    launcher = bridge_root / "macos" / "GuestStarBridge"
    shutil.copy2(launcher, macos_dir / "GuestStarBridge")
    (macos_dir / "GuestStarBridge").chmod(0o755)
    shutil.copy2(
        bridge_root / "macos" / "GuestStarWindow.js",
        resources / "GuestStarWindow.js",
    )
    write_info_plist(contents / "Info.plist", version)
    write_icns(resources / "AppIcon.icns", staging)
    extract_node(args.node_tarball.resolve(), resources / "runtime")
    copy_bridge_source(bridge_root, resources / "bridge")

    dmg_path = output_dir / f"Guest-Star-Bridge-M1-v{version}.dmg"
    zip_path = output_dir / f"Guest-Star-Bridge-M1-v{version}-app.zip"
    if dmg_path.exists():
        dmg_path.unlink()
    create_disk_image(
        app_bundle,
        bridge_root / "macos" / "LEEME.txt",
        dmg_path,
    )
    create_zip(app_bundle, zip_path)

    print(
        json.dumps(
            {
                "app": str(app_bundle),
                "dmg": str(dmg_path),
                "zip": str(zip_path),
                "version": version,
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
