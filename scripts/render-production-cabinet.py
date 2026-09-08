"""Render the approved Crimson LIGHT cabinet, without baking in the live UI.

Run with system Python (Pillow required):
    python scripts\\render-production-cabinet.py --blender PATH_TO_BLENDER

The source .blend files are never modified. Only front-camera RGBA WebP slices
and their projected geometry are published to assets/cabinet/v1.
"""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys


ROOT = Path(__file__).resolve().parents[1]
SOURCES = ROOT / "tools" / "cabinet-mockups" / "rendered"
OUTPUT = ROOT / "assets" / "cabinet" / "v1"
REFERENCE = (900, 1280)
SCALE = 2
PARTS = {
    "hood": (102, 19, 798, 164),
    "frame": (102, 164, 798, 864),
    "deck": (102, 864, 798, 988),
    "apron": (102, 988, 798, 1242),
    "manual": (102, 988, 798, 1242),
}
SYMBOLS = (
    "Speaker icon", "Sound arc", "Theme sun", "Sun ray",
    "Pause bars", "Leaderboard icon",
)
PAPER = ("Individual paper", "Outward curled")
GLASS = "Convex CRT / undistorted front projection"


def project_geometry(scene):
    from bpy_extras.object_utils import world_to_camera_view
    from mathutils import Vector

    def project(point):
        uv = world_to_camera_view(scene, scene.camera, point)
        return (uv.x * REFERENCE[0], (1 - uv.y) * REFERENCE[1])

    bezel = scene.objects["Rounded CRT bezel"]
    ring_size = len(bezel.data.vertices) // 4
    # Ring 1 is the dense inner FRONT perimeter, not the outer or rear ring.
    opening = [
        project(bezel.matrix_world @ vertex.co)
        for vertex in bezel.data.vertices[ring_size:2 * ring_size]
    ]
    left = min(p[0] for p in opening)
    right = max(p[0] for p in opening)
    top = min(p[1] for p in opening)
    bottom = max(p[1] for p in opening)
    contour = [
        [round((x - left) / (right - left) * 100, 6),
         round((y - top) / (bottom - top) * 100, 6)]
        for x, y in opening
    ]
    controls = {}
    for name, action in (("sound", "sound"), ("theme", "theme"),
                         ("top 10", "leaderboard"), ("pause", "pause")):
        cap = scene.objects[f"Domed {name} button"]
        rotation = cap.matrix_world.to_quaternion()
        center = cap.matrix_world.translation + rotation @ Vector((0, 0, .0105))
        x, y = project(center)
        points = [project(cap.matrix_world @ vertex.co) for vertex in cap.data.vertices]
        controls[action] = {
            "centerPercent": [round((x - 102) / 696 * 100, 6),
                              round((y - 864) / 124 * 100, 6)],
            "capSizePercent": [
                round((max(p[0] for p in points) - min(p[0] for p in points)) / 696 * 100, 6),
                round((max(p[1] for p in points) - min(p[1] for p in points)) / 124 * 100, 6),
            ],
        }
    return {
        "version": 1,
        "finish": "crimson-light",
        "environments": ["light", "dark"],
        "referenceRender": {"width": 900, "height": 1280},
        "render": {"width": 1800, "height": 2560, "scale": 2},
        "camera": {"location": [0, -6, .837], "target": [0, 0, .837], "orthoScale": 1.94},
        "parts": {
            name: {
                "referenceCrop": list(box),
                "width": box[2] - box[0], "height": box[3] - box[1],
                "pixelWidth": (box[2] - box[0]) * SCALE,
                "pixelHeight": (box[3] - box[1]) * SCALE,
                "files": {theme: f"{name}-{theme}.webp" for theme in ("light", "dark")},
            }
            for name, box in PARTS.items()
        },
        "screen": {
            "relativeTo": "frame",
            "leftPercent": round((left - 102) / 696 * 100, 6),
            "topPercent": round((top - 164) / 700 * 100, 6),
            "widthPercent": round((right - left) / 696 * 100, 6),
            "heightPercent": round((bottom - top) / 700 * 100, 6),
            "referenceBounds": [round(v, 6) for v in (left, top, right, bottom)],
            "contourPercent": contour,
            "clipPath": "polygon(" + ", ".join(f"{x:.6f}% {y:.6f}%" for x, y in contour) + ")",
        },
        "controls": {"relativeTo": "deck", "buttons": controls},
        "manual": {"relativeTo": "apron", "leftPercent": 0, "topPercent": 0,
                   "widthPercent": 100, "heightPercent": 100,
                   "occlusion": "Hardware holdout; full apron-sized transparent layer."},
    }


def render_worker(environment, work, samples):
    import bpy
    from mathutils import Vector

    source = SOURCES / f"finish-crimson-light-{environment}.blend"
    bpy.ops.wm.open_mainfile(filepath=str(source))
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = samples
    scene.cycles.use_denoising = True
    scene.render.threads_mode = "FIXED"
    scene.render.threads = 8
    scene.render.resolution_x, scene.render.resolution_y = (1800, 2560)
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.image_settings.color_depth = "8"
    scene.render.use_border = False
    scene.render.use_compositing = False
    scene.render.use_sequencer = False
    camera = scene.camera
    camera.data.type = "ORTHO"
    camera.location = (0, -6, .837)
    camera.rotation_euler = (
        Vector((0, 0, .837)) - camera.location
    ).to_track_quat("-Z", "Y").to_euler()
    camera.data.ortho_scale = 1.94
    for obj in scene.objects:
        obj.is_holdout = False
        if obj.name.startswith(SYMBOLS):
            obj.hide_render = False
        if obj.name.startswith(("Button legend", "Marquee wordmark")):
            obj.hide_render = True
        if obj.name.startswith(PAPER):
            obj.hide_render = True
    scene.objects["Leaderboard icon"].data.size = .035

    # Use the existing curved glass as a true holdout, cutting the backing away
    # while leaving the physical front bezel and its rounded edge in place.
    scene.objects[GLASS].is_holdout = True
    scene.objects[GLASS].hide_render = False
    cover = scene.objects["Outward curled magazine cover"]
    cover_path = SOURCES / "manual-cover.png"
    if cover_path.exists():
        for node in cover.data.materials[0].node_tree.nodes:
            if node.type == "TEX_IMAGE":
                node.image = bpy.data.images.load(str(cover_path), check_existing=False)
    bpy.context.view_layer.update()
    metadata = project_geometry(scene)
    (work / f"geometry-{environment}.json").write_text(
        json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
    scene.render.filepath = str(work / f"hardware-{environment}.png")
    bpy.ops.render.render(write_still=True)

    hardware = [
        obj for obj in scene.objects
        if obj.type in {"MESH", "CURVE", "FONT"} and not obj.hide_render
    ]
    for obj in hardware:
        obj.is_holdout = True
    for obj in scene.objects:
        if obj.name.startswith(PAPER):
            obj.hide_render = False
            obj.is_holdout = False
    # Only the apron is needed for paper, but keep the full-image coordinate
    # system so both passes produce exactly the same full-apron crop.
    scene.render.use_border = True
    scene.render.use_crop_to_border = False
    scene.render.border_min_x = 102 / 900
    scene.render.border_max_x = 798 / 900
    scene.render.border_min_y = 1 - 1242 / 1280
    scene.render.border_max_y = 1 - 988 / 1280
    scene.render.filepath = str(work / f"paper-{environment}.png")
    bpy.ops.render.render(write_still=True)


def validate_assets(metadata):
    from PIL import Image, ImageChops, ImageDraw, ImageFilter

    screen = metadata["screen"]
    left, top, right, bottom = screen["referenceBounds"]
    polygon = [
        ((left - 102 + x / 100 * (right - left)) * SCALE,
         (top - 164 + y / 100 * (bottom - top)) * SCALE)
        for x, y in screen["contourPercent"]
    ]
    mask = Image.new("L", (1392, 1400))
    ImageDraw.Draw(mask).polygon(polygon, fill=255)
    # Exclude the antialiased boundary and the rounded-over bezel lip.
    interior = mask.filter(ImageFilter.MinFilter(21))
    for environment in ("light", "dark"):
        for part, info in metadata["parts"].items():
            with Image.open(OUTPUT / f"{part}-{environment}.webp") as image:
                assert image.mode == "RGBA", (part, environment, image.mode)
                assert image.size == (info["pixelWidth"], info["pixelHeight"])
                alpha = image.getchannel("A")
                assert alpha.getextrema()[1] == 255, (part, environment, alpha.getextrema())
                if part in {"frame", "manual"}:
                    assert alpha.getextrema()[0] == 0
                if part == "frame":
                    assert ImageChops.multiply(alpha, interior).getbbox() is None, \
                        "The live game aperture contains baked/opaque pixels"
                    # Both cabinet sides must remain solid, not a frame-wide cutout.
                    for x in (32, image.width - 33):
                        assert alpha.getpixel((x, image.height // 2)) == 255
                if part == "manual":
                    assert alpha.getbbox() is not None
                    assert alpha.getbbox()[2] < image.width * .6
    return True


def make_preview(destination):
    from PIL import Image, ImageDraw

    sheet = Image.new("RGB", (1140, 1040), "#d9d3c6")
    draw = ImageDraw.Draw(sheet)
    for index, environment in enumerate(("light", "dark")):
        background = "#e8e3d8" if environment == "light" else "#171a1f"
        cabinet = Image.new("RGBA", (1392, 2446), background)
        for part in ("hood", "frame", "deck", "apron", "manual"):
            image = Image.open(OUTPUT / f"{part}-{environment}.webp").convert("RGBA")
            cabinet.alpha_composite(image, (0, (PARTS[part][1] - 19) * SCALE))
        mini = cabinet.resize((484, 850), Image.Resampling.LANCZOS)
        sheet.paste(mini.convert("RGB"), (index * 570 + 43, 24))
        deck = Image.open(OUTPUT / f"deck-{environment}.webp").convert("RGBA")
        plate = Image.new("RGBA", deck.size, background)
        plate.alpha_composite(deck)
        plate = plate.resize((556, 99), Image.Resampling.LANCZOS)
        sheet.paste(plate.convert("RGB"), (index * 570 + 7, 912))
        draw.text((index * 570 + 20, 890), f"{environment}: physical button symbols", fill="#252929")
    sheet.save(destination)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--blender", default=os.environ.get("BLENDER") or shutil.which("blender"))
    parser.add_argument("--samples", type=int, choices=(32, 40), default=40)
    parser.add_argument("--preview", action="store_true", help="Also emit an inspection-only contact sheet")
    parser.add_argument("--validate-only", action="store_true")
    parser.add_argument("--blender-worker", choices=("light", "dark"), help=argparse.SUPPRESS)
    parser.add_argument("--work", type=Path, help=argparse.SUPPRESS)
    arguments = parser.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else None)
    if arguments.blender_worker:
        render_worker(arguments.blender_worker, arguments.work, arguments.samples)
        return
    if arguments.validate_only:
        metadata = json.loads((OUTPUT / "geometry.json").read_text(encoding="utf-8"))
        validate_assets(metadata)
        print("Validated all ten RGBA WebP slices and the transparent live-screen aperture.")
        return
    if not arguments.blender:
        parser.error("Provide --blender PATH or set BLENDER")
    from PIL import Image

    OUTPUT.mkdir(parents=True, exist_ok=True)
    work = OUTPUT / ".render-work"
    work.mkdir(exist_ok=True)
    for environment in ("light", "dark"):
        log_path = work / f"{environment}.log"
        command = [
            str(arguments.blender), "--background", "--threads", "8",
            "--python-exit-code", "1",
            "--python", str(Path(__file__).resolve()), "--",
            "--blender-worker", environment, "--work", str(work),
            "--samples", str(arguments.samples),
        ]
        print(f"Rendering Crimson LIGHT / {environment} environment", flush=True)
        with log_path.open("w", encoding="utf-8") as log:
            result = subprocess.run(command, stdout=log, stderr=subprocess.STDOUT, cwd=ROOT)
        if result.returncode:
            raise RuntimeError(log_path.read_text(encoding="utf-8")[-8000:])
        for part, box in PARTS.items():
            source = "paper" if part == "manual" else "hardware"
            with Image.open(work / f"{source}-{environment}.png") as full:
                image = full.convert("RGBA").crop(tuple(v * SCALE for v in box))
                image.save(OUTPUT / f"{part}-{environment}.webp",
                           format="WEBP", quality=88, method=6, alpha_quality=100, exact=True)
    metadata = json.loads((work / "geometry-light.json").read_text(encoding="utf-8"))
    dark_metadata = json.loads((work / "geometry-dark.json").read_text(encoding="utf-8"))
    assert metadata == dark_metadata, "Lighting variants must have identical projected geometry"
    validate_assets(metadata)
    metadata["render"]["samples"] = arguments.samples
    metadata["render"]["denoise"] = True
    (OUTPUT / "geometry.json").write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
    if arguments.preview:
        make_preview(OUTPUT / "inspection.png")
    shutil.rmtree(work)
    total = sum(path.stat().st_size for path in OUTPUT.glob("*.webp"))
    print(f"Validated 10 transparent slices; WebP total {total:,} bytes; {OUTPUT}")


if __name__ == "__main__":
    main()
