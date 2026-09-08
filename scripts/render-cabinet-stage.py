"""Production v2 cabinet: independent narrow bezel and a real camera approach.

The approved Crimson LIGHT shell, hardware and booklet remain untouched.
The display becomes nearly wall-to-wall, flat and square, with a small recessed
physical lip. Arrival shows the unpowered object, not a simulated CSS rotation.
Only assets/cabinet/v2 and new development .blend files are written.

Usage: python scripts\\render-cabinet-stage.py --blender PATH_TO_BLENDER
Use --keep-work to retain passes for --prepare-only or --stage-only iteration.
"""
import argparse
import importlib.util
import json
import math
import os
from pathlib import Path
import shutil
import subprocess
import sys

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "tools" / "cabinet-mockups" / "rendered"
OUTPUT = ROOT / "assets" / "cabinet" / "v2"
WORK = OUTPUT / ".render-work"
BEZEL = "Rounded CRT bezel"
GLASS = "Convex CRT / undistorted front projection"
FLOOR = "V2 room floor shadow catcher"
FRAME_COUNT = 8
INTRO_LOCATION = (3.4, -6, 1.45)
INTRO_SCALE = 2.9
TARGET = (0, 0, .837)


def original():
    spec = importlib.util.spec_from_file_location(
        "approved_cabinet", ROOT / "scripts" / "render-production-cabinet.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def perimeter(width, height, radius):
    points = []
    for x, z, angle in (
        (width / 2 - radius, height / 2 - radius, 0),
        (-width / 2 + radius, height / 2 - radius, 90),
        (-width / 2 + radius, -height / 2 + radius, 180),
        (width / 2 - radius, -height / 2 + radius, 270),
    ):
        for index in range(13):
            theta = math.radians(angle + index * 90 / 12)
            points.append((x + radius * math.cos(theta), z + radius * math.sin(theta)))
    return points


def replace_display(scene):
    import bpy
    from mathutils import Matrix

    center = .837 + (640 - 514) * 1.94 / 1280
    outer = perimeter(1.0064, 1.036, .017)
    inner = perimeter(.996, 1.020, .011)
    count = len(inner)
    vertices = [
        (x, y, z + center)
        for ring, y in ((outer, -.206), (inner, -.203),
                        (inner, -.181), (outer, -.180))
        for x, z in ring
    ]
    faces = [
        (a * count + i, a * count + (i + 1) % count,
         b * count + (i + 1) % count, b * count + i)
        for a, b in ((0, 1), (1, 2), (2, 3), (3, 0))
        for i in range(count)
    ]
    bezel = scene.objects[BEZEL]
    material = bezel.data.materials[0]
    mesh = bpy.data.meshes.new("V2 separate recessed lip geometry")
    mesh.from_pydata(vertices, [], faces)
    mesh.materials.append(material)
    bezel.data = mesh
    bezel.matrix_world = Matrix.Identity(4)
    bezel.modifiers.clear()
    bevel = bezel.modifiers.new("Submillimetre lip edge", "BEVEL")
    bevel.width = .0006
    bevel.segments = 3
    bezel.modifiers.new("Weighted physical normals", "WEIGHTED_NORMAL")
    bezel["production_layer"] = "bezel"
    bezel["independent_of_shell"] = True
    bezel["aperture_width_metres"] = .996
    bezel["aperture_height_metres"] = 1.020

    # The glass extends underneath the lip. Its holdout therefore meets opaque
    # bezel pixels, rather than leaving an antialiasing seam between two layers.
    edge = perimeter(1.004, 1.028, .014)
    vertices = [(0, -.195, center)] + [(x, -.192, z + center) for x, z in edge]
    faces = [(0, index + 1, (index + 1) % len(edge) + 1) for index in range(len(edge))]
    glass = scene.objects[GLASS]
    mesh = bpy.data.meshes.new("V2 nearly planar unpowered display")
    mesh.from_pydata(vertices, [], faces)
    glass.data = mesh
    glass.matrix_world = Matrix.Identity(4)
    glass.modifiers.clear()
    material = bpy.data.materials.new("V2 unpowered graphite glass")
    material.use_nodes = True
    shader = material.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = (.006, .009, .011, 1)
    shader.inputs["Roughness"].default_value = .30
    shader.inputs["Metallic"].default_value = .05
    shader.inputs["Coat Weight"].default_value = .22
    shader.inputs["Coat Roughness"].default_value = .24
    mesh.materials.append(material)


def aim(scene, location, scale):
    from mathutils import Vector
    scene.camera.location = location
    scene.camera.rotation_euler = (
        Vector(TARGET) - scene.camera.location).to_track_quat("-Z", "Y").to_euler()
    scene.camera.data.type = "ORTHO"
    scene.camera.data.ortho_scale = scale


def setup(scene, samples, resolution=(1800, 2560)):
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = samples
    scene.cycles.use_denoising = True
    scene.render.threads_mode = "FIXED"
    scene.render.threads = 8
    scene.render.resolution_x, scene.render.resolution_y = resolution
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.image_settings.color_depth = "8"
    scene.render.use_border = False
    scene.render.use_compositing = False
    scene.render.use_sequencer = False


def render(scene, name, border=None):
    import bpy
    scene.render.use_border = border is not None
    scene.render.use_crop_to_border = False
    if border:
        left, top, right, bottom = border
        scene.render.border_min_x = left / 900
        scene.render.border_max_x = right / 900
        scene.render.border_min_y = 1 - bottom / 1280
        scene.render.border_max_y = 1 - top / 1280
    scene.render.filepath = str(WORK / f"{name}.png")
    bpy.ops.render.render(write_still=True)
    print("STAGE_RENDER_COMPLETE", name, flush=True)


def camera_metadata(scene, ground):
    from bpy_extras.object_utils import world_to_camera_view
    from mathutils import Vector
    uv = world_to_camera_view(scene, scene.camera, Vector((0, .0535, ground)))
    return {
        "location": [round(v, 6) for v in scene.camera.location],
        "target": list(TARGET),
        "orthoScale": round(scene.camera.data.ortho_scale, 6),
        "groundAnchor": [round(uv.x * 900, 4), round((1 - uv.y) * 1280, 4)],
        "groundAnchorPercent": [round(uv.x * 100, 6), round((1 - uv.y) * 100, 6)],
    }


def worker(environment, samples, frames, stage_only=False):
    import bpy

    base = original()
    bpy.ops.wm.open_mainfile(filepath=str(SOURCE / f"finish-crimson-light-{environment}.blend"))
    scene = bpy.context.scene
    replace_display(scene)
    setup(scene, samples)
    aim(scene, (0, -6, .837), 1.94)
    for obj in scene.objects:
        obj.is_holdout = False
        obj.visible_camera = True
        if obj.name.startswith(base.SYMBOLS):
            obj.hide_render = False
        if obj.name.startswith(("Button legend", "Marquee wordmark") + base.PAPER):
            obj.hide_render = True
    scene.objects["Leaderboard icon"].data.size = .035
    cover = scene.objects["Outward curled magazine cover"]
    if (SOURCE / "manual-cover.png").exists():
        for node in cover.data.materials[0].node_tree.nodes:
            if node.type == "TEX_IMAGE":
                node.image = bpy.data.images.load(str(SOURCE / "manual-cover.png"), check_existing=False)
    glass, bezel = scene.objects[GLASS], scene.objects[BEZEL]
    glass.is_holdout = True
    bpy.context.view_layer.update()
    metadata = base.project_geometry(scene)
    metadata["version"] = 2
    metadata["render"].update(samples=samples, denoise=True)
    metadata["parts"]["bezel"] = {
        **metadata["parts"]["frame"],
        "files": {theme: f"bezel-{theme}.webp" for theme in ("light", "dark")},
    }
    metadata["bezel"] = {
        "relativeTo": "frame", "independentLayer": True, "objectName": BEZEL,
        "order": ["live-canvas", "frame", "bezel"],
        "innerRadiusMetres": .011, "outerRadiusMetres": .017,
        "lipWidthMetres": .0052, "lipHeightMetres": .008,
        "glassUnderlapMetres": .004,
    }
    screen = metadata["screen"]
    screen["logicalCanvas"] = {"width": 448, "height": 512}
    screen["recommendedFrameAspect"] = (
        448 / 512 * screen["heightPercent"] / screen["widthPercent"])
    metadata["localPreviewOnly"] = False
    (WORK / f"geometry-{environment}.json").write_text(json.dumps(metadata, indent=2), encoding="utf-8")

    bezel.hide_render = True
    if not stage_only:
        render(scene, f"hardware-{environment}")
    bezel.hide_render = False
    hardware = [
        obj for obj in scene.objects
        if obj.type in {"MESH", "CURVE", "FONT"} and not obj.hide_render
    ]
    for obj in hardware:
        obj.is_holdout = obj != bezel
    if not stage_only:
        render(scene, f"bezel-{environment}", base.PARTS["frame"])
    for obj in hardware:
        obj.is_holdout = True
    for obj in scene.objects:
        if obj.name.startswith(base.PAPER):
            obj.hide_render = False
            obj.is_holdout = False
    if not stage_only:
        render(scene, f"paper-{environment}", base.PARTS["apron"])

    for obj in hardware:
        obj.is_holdout = False
    scene.objects["Marquee wordmark"].hide_render = False
    fascia = bpy.data.materials["Marquee fascia"].node_tree.nodes
    for node in fascia:
        if node.type == "BSDF_PRINCIPLED":
            node.inputs["Emission Strength"].default_value = 0
    ground = min(
        (obj.matrix_world @ vertex.co).z
        for obj in scene.objects if obj.type == "MESH" and not obj.hide_render
        for vertex in obj.data.vertices
    )
    bpy.ops.mesh.primitive_plane_add(size=20, location=(0, 0, ground))
    floor = bpy.context.object
    floor.name = FLOOR
    floor.is_shadow_catcher = True
    material = bpy.data.materials.new("V2 quiet room ground")
    material.use_nodes = True
    shader = material.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = (.38, .38, .38, 1)
    shader.inputs["Roughness"].default_value = 1
    floor.data.materials.append(material)
    lights = [
        (obj, obj.location.copy(), obj.data.energy, obj.data.size)
        for obj in scene.objects if obj.type == "LIGHT"
    ]
    world_background = scene.world.node_tree.nodes["Background"]
    world_strength = world_background.inputs["Strength"].default_value

    def arrival_lighting(progress):
        # Higher room lights produce a contained floor shadow. They settle into
        # the existing front lighting as the real camera approaches the cabinet.
        world_background.inputs["Strength"].default_value = world_strength * (.16 + .84 * progress)
        for obj, position, energy, size in lights:
            start = position.copy()
            start.x *= .35
            start.y *= .5
            start.z += 2
            obj.location = start.lerp(position, progress)
            obj.data.energy = energy * (2.8 - 1.8 * progress)
            obj.data.size = size * (.65 + .35 * progress)

    setup(scene, samples, (900, 1280))
    aim(scene, INTRO_LOCATION, INTRO_SCALE)
    arrival_lighting(0)
    bpy.context.view_layer.update()
    intro = {
        "width": 900, "height": 1280,
        "files": {theme: f"intro-{theme}.webp" for theme in ("light", "dark")},
        "shadowFiles": {theme: f"intro-shadow-{theme}.webp" for theme in ("light", "dark")},
        "camera": camera_metadata(scene, ground),
        "groundWorld": [0, .0535, ground],
        "screenPowered": False, "titleBaked": True,
        "shadowSeparate": True,
    }
    floor.hide_render = True
    render(scene, f"intro-{environment}")
    floor.hide_render = False
    visible = [
        obj for obj in scene.objects
        if obj.type in {"MESH", "CURVE", "FONT"} and obj != floor and not obj.hide_render
    ]
    for obj in visible:
        obj.visible_camera = False
    render(scene, f"intro-shadow-{environment}")
    for obj in visible:
        obj.visible_camera = True
    scene.render.use_border = False
    bpy.ops.file.pack_all()
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(
        filepath=str(SOURCE / f"stage-v2-crimson-light-{environment}.blend"))

    sequence = []
    setup(scene, 12, (900, 1280))
    for index in range(frames):
        t = index / (frames - 1)
        progress = 1 - (1 - t) ** 3
        angle = math.atan2(INTRO_LOCATION[0], -INTRO_LOCATION[1]) * (1 - progress)
        distance = math.hypot(*INTRO_LOCATION[:2]) * (1 - progress) + 6 * progress
        location = (distance * math.sin(angle), -distance * math.cos(angle),
                    INTRO_LOCATION[2] * (1 - progress) + .837 * progress)
        scale = INTRO_SCALE * (1 - progress) + 1.94 * progress
        aim(scene, location, scale)
        arrival_lighting(progress)
        bpy.context.view_layer.update()
        name = f"approach-{environment}-{index:02d}"
        render(scene, name)
        sequence.append({
            "index": index, "progress": round(progress, 6),
            "file": f"{name}.webp", "camera": camera_metadata(scene, ground),
        })
    (WORK / f"stage-{environment}.json").write_text(
        json.dumps({"intro": intro, "frames": sequence}, indent=2), encoding="utf-8")


def clean_shadow_matte(image, sequence=False):
    from PIL import Image, ImageChops, ImageDraw

    # Cycles' catcher includes a broad ambient veil and sparse low-sample alpha
    # noise, not just the visible cast shadow. Grade the rendered matte; never
    # synthesize, move, rotate or blur a substitute shadow in image space.
    alpha = image.getchannel("A")
    shadow = alpha.point(lambda value: max(0, round((value - 102) * 255 / 153)))
    if sequence:
        fade = Image.new("L", image.size, 255)
        draw = ImageDraw.Draw(fade)
        for index in range(48):
            amount = round(255 * (index / 47) ** 2 * (3 - 2 * index / 47))
            draw.line((index, 0, index, image.height - 1), fill=amount)
            draw.line((image.width - 1 - index, 0,
                       image.width - 1 - index, image.height - 1), fill=amount)
        vertical = Image.new("L", image.size, 255)
        draw = ImageDraw.Draw(vertical)
        for index in range(24):
            amount = round(255 * (index / 23) ** 2 * (3 - 2 * index / 23))
            draw.line((0, index, image.width - 1, index), fill=amount)
            draw.line((0, image.height - 1 - index,
                       image.width - 1, image.height - 1 - index), fill=amount)
        shadow = ImageChops.multiply(shadow, ImageChops.multiply(fade, vertical))
        red, green, blue, _ = image.split()
        neutral = ImageChops.lighter(ImageChops.lighter(red, green), blue).point(
            lambda value: 255 if value == 0 else 0)
        # Preserve the cabinet's colored, antialiased silhouette exactly.
        shadow = Image.composite(shadow, alpha, neutral)
    image.putalpha(shadow)
    return image


def package():
    from PIL import Image

    base = original()
    metadata = json.loads((WORK / "geometry-light.json").read_text(encoding="utf-8"))
    assert metadata == json.loads((WORK / "geometry-dark.json").read_text(encoding="utf-8"))
    stage = {
        environment: json.loads((WORK / f"stage-{environment}.json").read_text(encoding="utf-8"))
        for environment in ("light", "dark")
    }
    metadata["intro"] = stage["light"]["intro"]
    metadata["intro"]["shadowMatte"] = {
        "source": "Physically rendered Cycles shadow catcher",
        "densityThreshold": 102 / 255,
        "processing": "Ambient veil removed with a linear alpha grade; cabinet image unmodified.",
    }
    metadata["approach"] = {
        "available": bool(stage["light"]["frames"]),
        "width": 900, "height": 1280, "samples": 12,
        "durationMs": 840, "motion": "Actual 3D camera orbit, elevation and orthographic approach",
        "timing": "Frames already contain cubic ease-out; advance them at uniform intervals.",
        "shadowIncluded": True, "screenPowered": False, "titleBaked": True,
        "shadowMatte": "Same alpha grade as intro; neutral shadow-only pixels feather at canvas margins.",
        "finalReferenceCrop": [102, 19, 798, 1242],
        "frames": {environment: stage[environment]["frames"] for environment in ("light", "dark")},
    }
    for environment in ("light", "dark"):
        for part, box in {**base.PARTS, "bezel": base.PARTS["frame"]}.items():
            source = "paper" if part == "manual" else "bezel" if part == "bezel" else "hardware"
            with Image.open(WORK / f"{source}-{environment}.png") as full:
                image = full.convert("RGBA").crop(tuple(value * 2 for value in box))
                image.save(OUTPUT / f"{part}-{environment}.webp",
                           quality=90, method=6, alpha_quality=100, exact=True)
        names = [f"intro-{environment}", f"intro-shadow-{environment}"]
        names.extend(Path(frame["file"]).stem for frame in stage[environment]["frames"])
        for name in names:
            with Image.open(WORK / f"{name}.png") as full:
                image = full.convert("RGBA")
                if name.startswith("intro-shadow"):
                    image = clean_shadow_matte(image)
                elif name.startswith("approach"):
                    image = clean_shadow_matte(image, sequence=True)
                image.save(OUTPUT / f"{name}.webp",
                           quality=88, method=6, alpha_quality=100, exact=True)
    for environment in ("light", "dark"):
        with Image.open(OUTPUT / f"intro-{environment}.webp") as image:
            metadata["intro"].setdefault("cabinetBounds", {})[environment] = list(
                image.getchannel("A").getbbox())
        with Image.open(OUTPUT / f"intro-shadow-{environment}.webp") as image:
            metadata["intro"].setdefault("shadowBounds", {})[environment] = list(
                image.getchannel("A").point(lambda x: 255 if x > 8 else 0).getbbox())
    active_frames = {
        frame["file"] for environment in ("light", "dark")
        for frame in stage[environment]["frames"]
    }
    for path in OUTPUT.glob("approach-*.webp"):
        if path.name not in active_frames:
            path.unlink()
    manifest = [
        {"file": path.name, "bytes": path.stat().st_size}
        for path in sorted(OUTPUT.glob("*.webp"))
    ]
    metadata["manifest"] = manifest
    metadata["totalWebpBytes"] = sum(item["bytes"] for item in manifest)
    (OUTPUT / "geometry.json").write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
    return metadata


def validate(metadata):
    from PIL import Image, ImageChops, ImageDraw, ImageFilter

    screen = metadata["screen"]
    assert 94 <= screen["widthPercent"] <= 95
    assert 95 <= screen["heightPercent"] <= 97
    left, top, right, bottom = screen["referenceBounds"]
    polygon = [
        ((left - 102 + x / 100 * (right - left)) * 2,
         (top - 164 + y / 100 * (bottom - top)) * 2)
        for x, y in screen["contourPercent"]
    ]
    mask = Image.new("L", (1392, 1400))
    ImageDraw.Draw(mask).polygon(polygon, fill=255)
    interior = mask.filter(ImageFilter.MinFilter(11))
    for environment in ("light", "dark"):
        for part, info in metadata["parts"].items():
            with Image.open(OUTPUT / f"{part}-{environment}.webp") as image:
                assert image.mode == "RGBA"
                assert image.size == (info["pixelWidth"], info["pixelHeight"])
        frame = Image.open(OUTPUT / f"frame-{environment}.webp").convert("RGBA")
        bezel = Image.open(OUTPUT / f"bezel-{environment}.webp").convert("RGBA")
        assert ImageChops.multiply(frame.getchannel("A"), interior).getbbox() is None
        assert ImageChops.multiply(bezel.getchannel("A"), interior).getbbox() is None
        composite = Image.alpha_composite(frame, bezel)
        # The aperture's flat sides have no dark backing leaks or transparent
        # seams outside the narrow physical rim.
        y = composite.height // 2
        x = round((left - 102) * 2)
        assert composite.getpixel((x + 5, y))[3] == 0
        assert composite.getpixel((x - 5, y))[3] == 255
        assert composite.getpixel((15, y))[3] == 255
        assert sum(bezel.getchannel("A").histogram()[1:]) < 150000
        for name in (f"intro-{environment}", f"intro-shadow-{environment}"):
            with Image.open(OUTPUT / f"{name}.webp") as image:
                assert image.mode == "RGBA" and image.size == (900, 1280)
                assert image.getchannel("A").getbbox()
                alpha = image.getchannel("A")
                for edge in ((0, 0, 900, 1), (0, 1279, 900, 1280),
                             (0, 0, 1, 1280), (899, 0, 900, 1280)):
                    assert alpha.crop(edge).getextrema()[1] == 0, \
                        f"{name} exceeds its transparent margins"
        for info in metadata["approach"]["frames"][environment]:
            with Image.open(OUTPUT / info["file"]) as image:
                assert image.mode == "RGBA" and image.size == (900, 1280)
    print("Validated separate bezel, transparent aperture, stage stills and real camera sequence.")


def preview():
    from PIL import Image, ImageDraw

    sheet = Image.new("RGB", (1500, 1130), "#cbc6ba")
    draw = ImageDraw.Draw(sheet)
    for column, environment in enumerate(("light", "dark")):
        background = "#e5e1d8" if environment == "light" else "#242830"
        front = Image.new("RGBA", (1392, 2446), background)
        for part in ("hood", "frame", "bezel", "deck", "apron", "manual"):
            top = original().PARTS["frame" if part == "bezel" else part][1]
            image = Image.open(OUTPUT / f"{part}-{environment}.webp").convert("RGBA")
            front.alpha_composite(image, (0, (top - 19) * 2))
        front = front.resize((410, 720), Image.Resampling.LANCZOS)
        sheet.paste(front.convert("RGB"), (column * 750 + 5, 20))
        intro = Image.new("RGBA", (900, 1280), background)
        for name in ("intro-shadow", "intro"):
            intro.alpha_composite(Image.open(OUTPUT / f"{name}-{environment}.webp").convert("RGBA"))
        intro = intro.resize((324, 461), Image.Resampling.LANCZOS)
        sheet.paste(intro.convert("RGB"), (column * 750 + 420, 120))
        draw.text((column * 750 + 425, 85), f"{environment}: unpowered arrival", fill="#303030")
        for index in (0, 3, 7):
            path = OUTPUT / f"approach-{environment}-{index:02d}.webp"
            if path.exists():
                frame = Image.new("RGBA", (900, 1280), background)
                frame.alpha_composite(Image.open(path).convert("RGBA"))
                frame = frame.resize((238, 338), Image.Resampling.LANCZOS)
                sheet.paste(frame.convert("RGB"), (column * 750 + index // 3 * 248 + 5, 777))
    sheet.save(OUTPUT / "inspection.png")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--blender", default=os.environ.get("BLENDER") or shutil.which("blender"))
    parser.add_argument("--samples", type=int, choices=(32, 40), default=32)
    parser.add_argument("--frames", type=int, choices=(0, 8, 10, 12), default=FRAME_COUNT)
    parser.add_argument("--prepare-only", action="store_true")
    parser.add_argument("--stage-only", action="store_true",
                        help="Reuse front passes and rerender only arrival and approach")
    parser.add_argument("--validate-only", action="store_true")
    parser.add_argument("--preview", action="store_true")
    parser.add_argument("--keep-work", action="store_true",
                        help="Keep intermediate PNG passes for local iteration")
    parser.add_argument("--worker", choices=("light", "dark"), help=argparse.SUPPRESS)
    arguments = parser.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else None)
    if arguments.worker:
        worker(arguments.worker, arguments.samples, arguments.frames, arguments.stage_only)
        return
    if arguments.validate_only:
        validate(json.loads((OUTPUT / "geometry.json").read_text(encoding="utf-8")))
        return
    OUTPUT.mkdir(parents=True, exist_ok=True)
    WORK.mkdir(exist_ok=True)
    if not arguments.prepare_only:
        if not arguments.blender:
            parser.error("Supply --blender or set BLENDER")
        if arguments.stage_only:
            for environment in ("light", "dark"):
                for part in ("hardware", "bezel", "paper"):
                    if not (WORK / f"{part}-{environment}.png").exists():
                        parser.error("--stage-only requires front passes from a --keep-work render")
        for environment in ("light", "dark"):
            command = [
                arguments.blender, "--background", "--threads", "8",
                "--python-exit-code", "1", "--python", str(Path(__file__).resolve()), "--",
                "--worker", environment, "--samples", str(arguments.samples),
                "--frames", str(arguments.frames),
            ]
            if arguments.stage_only:
                command.append("--stage-only")
            log_path = WORK / f"{environment}.log"
            print(f"Rendering v2 cabinet / {environment}", flush=True)
            with log_path.open("w", encoding="utf-8") as log:
                result = subprocess.run(command, stdout=log, stderr=subprocess.STDOUT, cwd=ROOT)
            if result.returncode:
                raise RuntimeError(log_path.read_text(encoding="utf-8")[-10000:])
    metadata = package()
    validate(metadata)
    if arguments.preview:
        preview()
    if not arguments.keep_work:
        shutil.rmtree(WORK)
    print(f"ASSETS {len(metadata['manifest'])}; WEBP_BYTES {metadata['totalWebpBytes']}; {OUTPUT}")


if __name__ == "__main__":
    main()
