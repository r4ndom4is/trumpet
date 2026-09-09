"""Apply the approved wide display to all authored cabinet finishes.

Outputs stay in tools/cabinet-mockups/rendered/thin-bezel; originals and released
assets are never changed. Run with --blender PATH, optionally --resume.
"""
import argparse
import hashlib
import importlib.util
from itertools import product
import json
from pathlib import Path
import struct
import subprocess
import sys
import zipfile

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "tools" / "cabinet-mockups" / "rendered"
OUTPUT = SOURCE / "thin-bezel"
FINISHES = ("crimson", "seafoam", "timber", "black-amber", "airmail", "gilt")
TONES = ("light", "dark")


def prepare(finishes, archive=None):
    from PIL import Image, ImageDraw, ImageFont

    sheet = Image.new("RGB", (len(finishes) * 300, 1900))
    draw = ImageDraw.Draw(sheet)
    font = ImageFont.truetype(r"C:\Windows\Fonts\arialbd.ttf", 16)
    small = ImageFont.truetype(r"C:\Windows\Fonts\arial.ttf", 13)
    records = []
    expected_screen = None
    for row, (material, environment) in enumerate(product(TONES, TONES)):
        for column, finish in enumerate(finishes):
            stem = f"finish-{finish}-{material}-{environment}"
            metadata = json.loads((OUTPUT / f"{stem}.json").read_text(encoding="utf-8"))
            assert metadata["sourceSha256"] == hashlib.sha256((SOURCE / metadata["source"]).read_bytes()).hexdigest()
            assert (OUTPUT / f"{stem}.blend").stat().st_size > 100_000
            screen = metadata["screen"]
            if expected_screen is None:
                expected_screen = screen
            assert screen == expected_screen, f"Inconsistent display geometry: {stem}"
            bounds = [value * .8 for value in screen["referenceBounds"]]
            left, top, right, bottom = bounds
            interior = (int(left + 12), int(top + 12), int(right - 12), int(bottom - 12))
            for view in ("front", "angle", "hardware-front"):
                with Image.open(OUTPUT / f"{stem}-{view}.png") as image:
                    assert image.mode == "RGBA" and image.size == (720, 1024)
                    alpha = image.getchannel("A")
                    assert alpha.getextrema() == (0, 255), f"Missing transparency or hardware: {stem}-{view}"
                    if view == "hardware-front":
                        assert alpha.crop(interior).getextrema() == (0, 0), f"Display not open: {stem}"
                        assert alpha.getpixel((int(left - 8), int((top + bottom) / 2))) > 245
                    elif view == "front":
                        assert alpha.crop(interior).getextrema() == (255, 255)
            with Image.open(OUTPUT / f"{stem}-front.png") as image:
                picture = image.convert("RGBA")
            for layer in ("paper", "marquee"):
                with Image.open(SOURCE / f"desktop-{layer}-front.png") as image:
                    picture = Image.alpha_composite(picture, image.convert("RGBA").resize(picture.size, Image.Resampling.LANCZOS))
            x, y = column * 300, row * 475
            ink = "#242424" if environment == "light" else "#dedede"
            draw.rectangle((x, y, x + 300, y + 475), fill="#f7f4ef" if environment == "light" else "#292929")
            picture.thumbnail((285, 415), Image.Resampling.LANCZOS)
            sheet.paste(picture, (x + (300 - picture.width) // 2, y + 47), picture)
            draw.text((x + 12, y + 5), finish, font=font, fill=ink)
            draw.text((x + 12, y + 26), f"{material} finish / {environment} environment", font=small, fill=ink)
            records.append({"stem": stem, "finish": finish, "material": material, "environment": environment})
    sheet.save(OUTPUT / "contact-sheet.jpg", quality=94)
    (OUTPUT / "manifest.json").write_text(json.dumps({"combinations": records, "count": len(records)}, indent=2) + "\n", encoding="utf-8")
    if archive:
        archive.parent.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED) as bundle:
            gallery = (SOURCE / "finish-candidates.html").read_text(encoding="utf-8")
            gallery = gallery.replace('href="phone-layout.html?view=desktop"', 'href="https://r4ndom4is.github.io/trumpet/"')
            gallery = gallery.replace("Back to the desktop cabinet", "Published game")
            bundle.writestr("tools/cabinet-mockups/rendered/finish-candidates.html", gallery)
            assets = [OUTPUT / "contact-sheet.jpg", OUTPUT / "manifest.json"]
            for record in records:
                stem = record["stem"]
                assets.extend(OUTPUT / f"{stem}{suffix}" for suffix in (".blend", ".json", "-front.png", "-angle.png", "-hardware-front.png"))
                assets.extend(SOURCE / f"{stem}{suffix}" for suffix in (".blend", "-front.png", "-angle.png"))
            for finish, material, view in product(finishes, TONES, ("front", "angle")):
                assets.append(SOURCE / f"controls-{finish}-{material}-{view}.svg")
            assets.extend(SOURCE / f"desktop-{layer}-{view}.png" for layer, view in product(("paper", "marquee"), ("front", "angle")))
            assets.extend(ROOT / "scripts" / name for name in ("render-cabinet-finishes.py", "render-cabinet-stage.py", "render-production-cabinet.py"))
            for path in assets:
                bundle.write(path, path.relative_to(ROOT).as_posix())
        with zipfile.ZipFile(archive) as bundle:
            assert bundle.testzip() is None, "Archive integrity failure"
        print("FINISH_ARCHIVE", archive, flush=True)
    print("FINISH_VALIDATED", len(records), "models and", len(records) * 3, "renders", flush=True)


def load_stage():
    spec = importlib.util.spec_from_file_location("cabinet_stage", ROOT / "scripts" / "render-cabinet-stage.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def fingerprint(scene, excluded):
    digest = hashlib.sha256()
    for obj in sorted(scene.objects, key=lambda item: item.name):
        if obj.type != "MESH" or obj.name in excluded:
            continue
        digest.update(obj.name.encode())
        for vertex in obj.data.vertices:
            digest.update(struct.pack("fff", *(obj.matrix_world @ vertex.co)))
    return digest.hexdigest()


def worker(args):
    import bpy

    stage = load_stage()
    base = stage.original()
    OUTPUT.mkdir(exist_ok=True)
    for finish, material, environment in product(args.finishes, TONES, TONES):
        stem = f"finish-{finish}-{material}-{environment}"
        source = SOURCE / f"{stem}.blend"
        source_hash = hashlib.sha256(source.read_bytes()).hexdigest()
        editable_path = f"//{stem}-editable-render.png"
        products = [OUTPUT / f"{stem}{suffix}" for suffix in
                    (".blend", ".json", "-front.png", "-angle.png", "-hardware-front.png")]
        if args.resume and all(path.exists() for path in products):
            saved = json.loads((OUTPUT / f"{stem}.json").read_text(encoding="utf-8"))
            if saved["sourceSha256"] == source_hash and saved["samples"] == args.samples:
                bpy.ops.wm.open_mainfile(filepath=str(OUTPUT / f"{stem}.blend"))
                if bpy.context.scene.render.filepath != editable_path:
                    bpy.context.scene.render.filepath = editable_path
                    bpy.context.preferences.filepaths.save_version = 0
                    bpy.ops.wm.save_as_mainfile(filepath=str(OUTPUT / f"{stem}.blend"))
                print("FINISH_SKIPPED", stem, flush=True)
                continue
        bpy.ops.wm.open_mainfile(filepath=str(source))
        scene = bpy.context.scene
        before = fingerprint(scene, {stage.BEZEL, stage.GLASS})
        screen_material = scene.objects[stage.GLASS].data.materials[0]
        stage.replace_display(scene)
        glass = scene.objects[stage.GLASS]
        glass.data.materials.clear()
        glass.data.materials.append(screen_material)
        # Re-map the existing game texture onto the new planar display.
        vertices = glass.data.vertices
        left, right = min(v.co.x for v in vertices), max(v.co.x for v in vertices)
        bottom, top = min(v.co.z for v in vertices), max(v.co.z for v in vertices)
        uv = glass.data.uv_layers.new(name="Wide display UV")
        for polygon in glass.data.polygons:
            for index in polygon.loop_indices:
                point = vertices[glass.data.loops[index].vertex_index].co
                uv.data[index].uv = ((point.x - left) / (right - left), (point.z - bottom) / (top - bottom))
        stage.setup(scene, args.samples, (720, 1024))
        for obj in scene.objects:
            obj.is_holdout = False
            if obj.name.startswith(base.SYMBOLS):
                obj.hide_render = False
            if obj.name.startswith(("Button legend", "Marquee wordmark") + base.PAPER):
                obj.hide_render = True
        scene.objects["Leaderboard icon"].data.size = .035
        bpy.context.view_layer.update()
        assert fingerprint(scene, {stage.BEZEL, stage.GLASS}) == before, "Unrelated cabinet geometry changed"
        stage.aim(scene, (0, -6, .837), 1.94)
        bpy.context.view_layer.update()
        metadata = base.project_geometry(scene)
        metadata.update(version=2, finish=finish, material=material, environment=environment,
                        source=source.name, sourceSha256=source_hash, unchangedShellSha256=before,
                        localPreviewOnly=True, samples=args.samples)
        metadata["bezel"] = {"objectName": stage.BEZEL, "independentLayer": True,
                             "innerWidthMetres": .996, "innerHeightMetres": 1.020,
                             "lipWidthMetres": .0052, "lipHeightMetres": .008}
        metadata["render"] = {"width": 720, "height": 1024, "scale": .8, "samples": args.samples}
        metadata.pop("environments")
        for part in metadata["parts"].values():
            part.pop("files")
            part["pixelWidth"] = part["width"] * .8
            part["pixelHeight"] = part["height"] * .8
        metadata["screen"]["logicalCanvas"] = {"width": 448, "height": 512}
        metadata["screen"]["recommendedFrameAspect"] = (
            448 / 512 * metadata["screen"]["heightPercent"] / metadata["screen"]["widthPercent"])
        metadata["views"] = {}
        for view, location, scale in (("front", (0, -6, .837), 1.94), ("angle", (2.8, -6, 1.50), 2.14)):
            stage.aim(scene, location, scale)
            scene.render.filepath = str(OUTPUT / f"{stem}-{view}.png")
            bpy.ops.render.render(write_still=True)
            metadata["views"][view] = {"file": f"{stem}-{view}.png", "camera": list(location), "orthoScale": scale}
            print("FINISH_RENDERED", stem, view, flush=True)
        stage.aim(scene, (0, -6, .837), 1.94)
        glass.is_holdout = True
        scene.render.filepath = str(OUTPUT / f"{stem}-hardware-front.png")
        bpy.ops.render.render(write_still=True)
        glass.is_holdout = False
        metadata["hardware"] = {"file": f"{stem}-hardware-front.png", "transparentDisplay": True,
                                "manualAndMarqueeSeparate": True, "physicalControlsBaked": True}
        # Leave each editable model complete, with the manual and marquee visible.
        for obj in scene.objects:
            if obj.name.startswith(("Marquee wordmark",) + base.PAPER):
                obj.hide_render = False
        stage.aim(scene, (0, -6, .837), 1.94)
        scene.render.filepath = editable_path
        bpy.ops.file.pack_all()
        bpy.context.preferences.filepaths.save_version = 0
        bpy.ops.wm.save_as_mainfile(filepath=str(OUTPUT / f"{stem}.blend"))
        assert hashlib.sha256(source.read_bytes()).hexdigest() == source_hash, "Original model was modified"
        (OUTPUT / f"{stem}.json").write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
        print("FINISH_COMPLETE", stem, flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--blender", type=Path)
    parser.add_argument("--samples", type=int, default=24)
    parser.add_argument("--finishes", nargs="+", choices=FINISHES, default=list(FINISHES))
    parser.add_argument("--resume", action="store_true")
    parser.add_argument("--worker", action="store_true")
    parser.add_argument("--prepare-only", action="store_true")
    parser.add_argument("--archive", type=Path, help="Optional portable ZIP including originals, converted models and gallery")
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
    args = parser.parse_args(argv)
    if args.samples < 1:
        parser.error("--samples must be positive")
    if args.worker:
        worker(args)
    elif args.prepare_only:
        prepare(args.finishes, args.archive)
    else:
        if not args.blender or not args.blender.is_file():
            parser.error("--blender must name an existing Blender executable")
        command = [str(args.blender), "--background", "--threads", "8", "--python-exit-code", "1",
                   "--python", str(Path(__file__).resolve()), "--", "--worker", "--samples", str(args.samples),
                   "--finishes", *args.finishes]
        if args.resume:
            command.append("--resume")
        subprocess.run(command, check=True, cwd=ROOT)
        prepare(args.finishes, args.archive)


if __name__ == "__main__":
    main()
