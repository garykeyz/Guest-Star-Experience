#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import os
import plistlib
import re
import shutil
import struct
import subprocess
import tarfile
import tempfile
import zipfile
from pathlib import Path

from PIL import Image, ImageDraw


APP_NAME = "Guest Star.app"
BUNDLE_ID = "com.gstarxp.guest-star"
MINIMUM_MACOS = "11.0"


def arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Construye Guest Star Universal para Mac Intel y Apple Silicon."
        )
    )
    parser.add_argument("--node-arm64-tarball", required=True, type=Path)
    parser.add_argument("--node-x64-tarball", required=True, type=Path)
    parser.add_argument("--stem-engine-root", required=True, type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    return parser.parse_args()


def run(command: list[str], cwd: Path | None = None) -> None:
    subprocess.run(command, cwd=cwd, check=True)


def write_info_plist(path: Path, version: str) -> None:
    version_number = int(re.sub(r"\D", "", version) or "1")
    payload = {
        "CFBundleDevelopmentRegion": "es",
        "CFBundleDisplayName": "Guest Star",
        "CFBundleExecutable": "GuestStarBridge",
        "CFBundleIconFile": "AppIcon.icns",
        "CFBundleIdentifier": BUNDLE_ID,
        "CFBundleInfoDictionaryVersion": "6.0",
        "CFBundleName": "Guest Star",
        "CFBundlePackageType": "APPL",
        "CFBundleShortVersionString": version,
        "CFBundleSupportedPlatforms": ["MacOSX"],
        "CFBundleVersion": str(version_number),
        "LSArchitecturePriority": ["arm64", "x86_64"],
        "LSMinimumSystemVersion": MINIMUM_MACOS,
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


def extract_node(node_tarball: Path, runtime_dir: Path) -> Path:
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
        node_member = min(node_members, key=lambda item: len(Path(item.name).parts))
        license_member = min(
            license_members,
            key=lambda item: len(Path(item.name).parts),
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
    if node_path.read_bytes()[:4] not in {b"\xcf\xfa\xed\xfe", b"\xca\xfe\xba\xbe"}:
        raise RuntimeError("El ejecutable incluido no parece ser Mach-O para macOS.")
    return node_path


def copy_bridge_source(bridge_root: Path, destination: Path) -> None:
    destination.mkdir(parents=True, exist_ok=True)
    for folder in ("src", "public"):
        shutil.copytree(bridge_root / folder, destination / folder)
    for filename in ("package.json", "README.md", "config.example.json"):
        shutil.copy2(bridge_root / filename, destination / filename)


def copy_stem_engine(source: Path, destination: Path) -> None:
    source = source.resolve()
    required = (
        "package.json",
        "node_modules/demucs/dist/cli.js",
        "node_modules/ffmpeg-static/ffmpeg",
        "node_modules/ffprobe-static/bin/darwin/arm64/ffprobe",
        "node_modules/ffprobe-static/bin/darwin/x64/ffprobe",
        "node_modules/onnxruntime-node/bin/napi-v6/darwin/arm64/onnxruntime_binding.node",
        "node_modules/onnxruntime-node/bin/napi-v6/darwin/x64/onnxruntime_binding.node",
    )
    missing = [relative for relative in required if not (source / relative).is_file()]
    if missing:
        raise RuntimeError(
            "El motor Stems IA Universal no está completo: " + ", ".join(missing)
        )
    shutil.copytree(source, destination)

    # The npm packages also contain Linux and Windows runtimes. The Mac release
    # keeps both Darwin architectures and removes unrelated binaries only.
    runtime_root = destination / "node_modules" / "onnxruntime-node" / "bin" / "napi-v6"
    for platform in ("linux", "win32"):
        platform_root = runtime_root / platform
        if platform_root.exists():
            shutil.rmtree(platform_root)
    ffprobe_root = destination / "node_modules" / "ffprobe-static" / "bin"
    for platform_root in ffprobe_root.iterdir():
        if platform_root.name != "darwin" and platform_root.is_dir():
            shutil.rmtree(platform_root)

    run([
        "lipo",
        str(destination / "node_modules" / "ffmpeg-static" / "ffmpeg"),
        "-verify_arch",
        "arm64",
        "x86_64",
    ])


def write_bundle_build_id(bridge_dir: Path) -> str:
    digest = hashlib.sha256()
    for path in sorted(bridge_dir.rglob("*")):
        if not path.is_file() or path.name == ".bundle-build":
            continue
        digest.update(path.relative_to(bridge_dir).as_posix().encode("utf-8"))
        digest.update(b"\0")
        digest.update(path.read_bytes())
        digest.update(b"\0")
    build_id = digest.hexdigest()
    (bridge_dir / ".bundle-build").write_text(f"{build_id}\n", encoding="utf-8")
    return build_id


def compile_universal_launcher(source: Path, destination: Path) -> None:
    run(
        [
            "xcrun",
            "clang",
            "-arch",
            "arm64",
            "-arch",
            "x86_64",
            f"-mmacosx-version-min={MINIMUM_MACOS}",
            "-Os",
            "-Wall",
            "-Wextra",
            str(source),
            "-o",
            str(destination),
        ]
    )
    destination.chmod(0o755)
    run(["lipo", str(destination), "-verify_arch", "arm64", "x86_64"])


def sign_and_verify_app(app_bundle: Path, node_arm64: Path, node_x64: Path) -> None:
    run(["lipo", str(node_arm64), "-verify_arch", "arm64"])
    run(["lipo", str(node_x64), "-verify_arch", "x86_64"])
    for executable in (node_arm64, node_x64):
        run(
            [
                "codesign",
                "--force",
                "--sign",
                "-",
                "--timestamp=none",
                str(executable),
            ]
        )
    run(
        [
            "codesign",
            "--force",
            "--deep",
            "--sign",
            "-",
            "--timestamp=none",
            str(app_bundle),
        ]
    )
    run(["codesign", "--verify", "--deep", "--strict", "--verbose=2", str(app_bundle)])
    run(["plutil", "-lint", str(app_bundle / "Contents" / "Info.plist")])


def prepare_distribution(
    distribution: Path,
    app_bundle: Path,
    readme: Path,
    installation_guide: Path,
) -> Path:
    if distribution.exists():
        shutil.rmtree(distribution)
    distribution.mkdir(parents=True)
    distributed_app = distribution / APP_NAME
    # Both paths live in the same staging volume. A rename preserves every
    # signature/xattr without keeping a second full copy of both Node runtimes,
    # which also prevents the macOS release runner from exhausting its disk.
    app_bundle.rename(distributed_app)
    run(
        [
            "codesign",
            "--verify",
            "--deep",
            "--strict",
            "--verbose=2",
            str(distributed_app),
        ]
    )
    shutil.copy2(readme, distribution / "LEEME.txt")
    shutil.copy2(installation_guide, distribution / "INSTALACION-OTRA-MAC.txt")
    return distributed_app


def create_disk_image(distribution: Path, output_path: Path, version: str) -> None:
    if output_path.exists():
        output_path.unlink()
    applications_link = distribution / "Applications"
    if applications_link.exists() or applications_link.is_symlink():
        applications_link.unlink()
    os.symlink("/Applications", applications_link)
    run(
        [
            "hdiutil",
            "create",
            "-volname",
            f"Guest Star {version}",
            "-srcfolder",
            str(distribution),
            "-ov",
            "-format",
            "UDZO",
            str(output_path),
        ]
    )
    run(["hdiutil", "verify", str(output_path)])
    applications_link.unlink()


def create_zip(distribution: Path, output_path: Path) -> None:
    if output_path.exists():
        output_path.unlink()
    run(
        [
            "/usr/bin/ditto",
            "-c",
            "-k",
            "--sequesterRsrc",
            str(distribution),
            str(output_path),
        ]
    )
    run(["unzip", "-tq", str(output_path)])
    executable_name = f"{APP_NAME}/Contents/MacOS/GuestStarBridge"
    with zipfile.ZipFile(output_path) as archive:
        try:
            info = archive.getinfo(executable_name)
        except KeyError as error:
            raise RuntimeError("El ZIP no contiene la aplicación esperada.") from error
        mode = (info.external_attr >> 16) & 0o777
        if mode & 0o111 == 0:
            raise RuntimeError("El ZIP perdió el permiso ejecutable del iniciador.")
    with tempfile.TemporaryDirectory(prefix="guest-star-zip-check-") as temp:
        extracted_root = Path(temp)
        run(["/usr/bin/ditto", "-x", "-k", str(output_path), str(extracted_root)])
        extracted_app = extracted_root / APP_NAME
        run(
            [
                "codesign",
                "--verify",
                "--deep",
                "--strict",
                "--verbose=2",
                str(extracted_app),
            ]
        )
        run(
            [
                "lipo",
                str(extracted_app / "Contents" / "MacOS" / "GuestStarBridge"),
                "-verify_arch",
                "arm64",
                "x86_64",
            ]
        )
        for relative in (
            "Contents/Resources/runtime/node-arm64/node",
            "Contents/Resources/runtime/node-x64/node",
            "Contents/MacOS/GuestStarBridge.sh",
        ):
            path = extracted_app / relative
            if not path.is_file() or not os.access(path, os.X_OK):
                raise RuntimeError(f"El ZIP no conservó el ejecutable {relative}.")


def main() -> None:
    args = arguments()
    bridge_root = Path(__file__).resolve().parent.parent
    version = json.loads((bridge_root / "package.json").read_text())["version"]
    launcher_source = bridge_root / "macos" / "GuestStarBridge"
    if f'APP_VERSION="{version}"' not in launcher_source.read_text():
        raise RuntimeError("La versión del iniciador no coincide con package.json.")
    output_dir = args.output_dir.resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    staging = output_dir / "macos-installer-staging"
    app_bundle = staging / APP_NAME
    contents = app_bundle / "Contents"
    resources = contents / "Resources"
    macos_dir = contents / "MacOS"

    if staging.exists():
        shutil.rmtree(staging)
    resources.mkdir(parents=True)
    macos_dir.mkdir(parents=True)

    compile_universal_launcher(
        bridge_root / "macos" / "GuestStarLauncher.c",
        macos_dir / "GuestStarBridge",
    )
    shutil.copy2(launcher_source, macos_dir / "GuestStarBridge.sh")
    (macos_dir / "GuestStarBridge.sh").chmod(0o755)
    shutil.copy2(
        bridge_root / "macos" / "GuestStarWindow.js",
        resources / "GuestStarWindow.js",
    )
    write_info_plist(contents / "Info.plist", version)
    write_icns(resources / "AppIcon.icns", staging)
    node_arm64 = extract_node(
        args.node_arm64_tarball.resolve(),
        resources / "runtime" / "node-arm64",
    )
    node_x64 = extract_node(
        args.node_x64_tarball.resolve(),
        resources / "runtime" / "node-x64",
    )
    copy_bridge_source(bridge_root, resources / "bridge")
    copy_stem_engine(
        args.stem_engine_root,
        resources / "bridge" / "stem-engine",
    )
    bundle_build_id = write_bundle_build_id(resources / "bridge")
    sign_and_verify_app(app_bundle, node_arm64, node_x64)

    distribution = staging / "distribution"
    distributed_app = prepare_distribution(
        distribution,
        app_bundle,
        bridge_root / "macos" / "LEEME.txt",
        bridge_root / "macos" / "INSTALACION-OTRA-MAC.txt",
    )
    dmg_path = output_dir / f"Guest-Star-Universal-v{version}.dmg"
    zip_path = output_dir / f"Guest-Star-Universal-v{version}-app.zip"
    create_disk_image(distribution, dmg_path, version)
    create_zip(distribution, zip_path)

    print(
        json.dumps(
            {
                "app": str(distributed_app),
                "dmg": str(dmg_path),
                "zip": str(zip_path),
                "version": version,
                "bundleBuildId": bundle_build_id,
                "architectures": ["arm64", "x86_64"],
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
