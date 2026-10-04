"""Export the Rigify fighter to a small, game-ready GLB for three.js.

Rigify parents its DEF bones through ORG/MCH control bones and splits every limb
into twist segments. The game only needs a plain deform skeleton, so this script
rebuilds one from the DEF rest positions, merges twist segments into their parent
bone, rebinds the Body mesh, and exports only that mesh and skeleton.

Bone names use underscores because three.js strips '.' from node names.

Usage (Windows Blender from WSL):
  "/mnt/c/Program Files/Blender Foundation/Blender 5.1/blender.exe" -b \
    "C:\\path\\to\\StormHacks_Base.blend" --python tools/blender/export_fighter.py -- \
    "C:\\path\\to\\apps\\web\\public\\models\\fighter.glb"
"""

import sys
import math

import bpy

out_path = sys.argv[sys.argv.index("--") + 1]

SOURCE_RIG = "rig"
SOURCE_MESH = "Body"

# new bone: (head DEF bone, tail DEF bone, parent new bone, merged DEF groups)
BONES = {
    "hips": ("DEF-spine", "DEF-spine", None, ["DEF-spine", "DEF-pelvis.L", "DEF-pelvis.R"]),
    "spine": ("DEF-spine.001", "DEF-spine.001", "hips", ["DEF-spine.001"]),
    "chest": ("DEF-spine.002", "DEF-spine.002", "spine", ["DEF-spine.002"]),
    "upper_chest": ("DEF-spine.003", "DEF-spine.003", "chest", ["DEF-spine.003"]),
    "neck": ("DEF-spine.004", "DEF-spine.005", "upper_chest", ["DEF-spine.004", "DEF-spine.005"]),
    "head": ("DEF-spine.006", "DEF-spine.006", "neck", ["DEF-spine.006"]),
}
for side in ("L", "R"):
    BONES.update(
        {
            f"shoulder_{side}": (f"DEF-shoulder.{side}", f"DEF-shoulder.{side}", "upper_chest", [f"DEF-shoulder.{side}"]),
            f"upper_arm_{side}": (
                f"DEF-upper_arm.{side}",
                f"DEF-upper_arm.{side}.001",
                f"shoulder_{side}",
                [f"DEF-upper_arm.{side}", f"DEF-upper_arm.{side}.001"],
            ),
            f"forearm_{side}": (
                f"DEF-forearm.{side}",
                f"DEF-forearm.{side}.001",
                f"upper_arm_{side}",
                [f"DEF-forearm.{side}", f"DEF-forearm.{side}.001"],
            ),
            f"hand_{side}": (f"DEF-hand.{side}", f"DEF-hand.{side}", f"forearm_{side}", [f"DEF-hand.{side}"]),
            f"thigh_{side}": (
                f"DEF-thigh.{side}",
                f"DEF-thigh.{side}.001",
                "hips",
                [f"DEF-thigh.{side}", f"DEF-thigh.{side}.001"],
            ),
            f"shin_{side}": (
                f"DEF-shin.{side}",
                f"DEF-shin.{side}.001",
                f"thigh_{side}",
                [f"DEF-shin.{side}", f"DEF-shin.{side}.001"],
            ),
            f"foot_{side}": (f"DEF-foot.{side}", f"DEF-foot.{side}", f"shin_{side}", [f"DEF-foot.{side}"]),
            f"toe_{side}": (f"DEF-toe.{side}", f"DEF-toe.{side}", f"foot_{side}", [f"DEF-toe.{side}"]),
        }
    )

# The .blend may have been saved mid-edit; vertex groups can't change in Edit Mode.
if bpy.context.object and bpy.context.object.mode != "OBJECT":
    bpy.ops.object.mode_set(mode="OBJECT")

src_rig = bpy.data.objects[SOURCE_RIG]
body = bpy.data.objects[SOURCE_MESH]
src_bones = src_rig.data.bones

# Build the clean armature from DEF rest positions (armature space == world here).
arm_data = bpy.data.armatures.new("FighterSkeleton")
fighter = bpy.data.objects.new("Fighter", arm_data)
bpy.context.scene.collection.objects.link(fighter)
fighter.matrix_world = src_rig.matrix_world.copy()
bpy.context.view_layer.objects.active = fighter
bpy.ops.object.mode_set(mode="EDIT")
for name, (head_src, tail_src, parent, _groups) in BONES.items():
    bone = arm_data.edit_bones.new(name)
    bone.head = src_bones[head_src].head_local
    bone.tail = src_bones[tail_src].tail_local
    bone.align_roll(src_bones[head_src].matrix_local.to_3x3().col[2])
for name, (_head, _tail, parent, _groups) in BONES.items():
    if parent:
        arm_data.edit_bones[name].parent = arm_data.edit_bones[parent]
bpy.ops.object.mode_set(mode="OBJECT")

# Merge DEF vertex groups into the new bone names.
weights = {name: {} for name in BONES}
group_index = {g.name: g.index for g in body.vertex_groups}
target_of = {
    group: name for name, (_h, _t, _p, groups) in BONES.items() for group in groups
}
missing = sorted(set(group_index) - set(target_of))
if missing:
    raise SystemExit(f"Unmapped vertex groups: {missing}")
index_to_target = {group_index[g]: target_of[g] for g in group_index}
for vertex in body.data.vertices:
    for element in vertex.groups:
        target = index_to_target[element.group]
        weights[target][vertex.index] = weights[target].get(vertex.index, 0) + element.weight
for group in list(body.vertex_groups):
    body.vertex_groups.remove(group)
for name, per_vertex in weights.items():
    group = body.vertex_groups.new(name=name)
    for index, weight in per_vertex.items():
        group.add([index], min(weight, 1.0), "REPLACE")

world = body.matrix_world.copy()
body.parent = fighter
body.matrix_world = world
for modifier in body.modifiers:
    if modifier.type == "ARMATURE":
        modifier.object = fighter

# The camera-baked skin needs non-overlapping UVs; the source mesh has none.
bpy.ops.object.select_all(action="DESELECT")
body.select_set(True)
bpy.context.view_layer.objects.active = body
if not body.data.uv_layers:
    body.data.uv_layers.new(name="UVMap")
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.select_all(action="SELECT")
bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.02)
bpy.ops.object.mode_set(mode="OBJECT")

bpy.ops.object.select_all(action="DESELECT")
fighter.select_set(True)
body.select_set(True)
bpy.ops.export_scene.gltf(
    filepath=out_path,
    export_format="GLB",
    use_selection=True,
    export_yup=True,
    export_texcoords=True,
    export_skins=True,
    export_animations=False,
    export_materials="NONE",
    export_apply=False,
)
print(f"Exported {len(BONES)} bones to {out_path}")
