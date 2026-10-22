"""Convert the ETH-XGaze ResNet-18 gaze model by hysts (ptgaze) to ONNX for the browser.

Output: public/models/eth-xgaze-r18.onnx  (input "input" float32 [1,3,224,224], output "gaze" float32 [1,2] = pitch, yaw in rad)

Model:   https://huggingface.co/hysts/ptgaze-eth-xgaze-resnet18 (model.safetensors, 44.8 MB)
         timm resnet18(num_classes=2), state-dict keys match timm 1:1 (ptgaze/models/__init__.py).
Licence: code + weights MIT (hysts). The weights were trained on ETH-XGaze, whose research agreement restricts the
         DATASET to non-commercial research use. Fine for this non-commercial prototype; assess before any commercial use.
Input:   face patch from the "revisiting data normalization" warp (Zhang et al. ETRA 2018, ETH-XGaze settings:
         normalised camera f=960, 224x224, distance 0.6 m), RGB, x/255, ImageNet mean/std (ptgaze/transforms.py).
Output:  normalised-camera pitch/yaw; vector = -[cos p sin y, sin p, cos p cos y]; back to camera with v @ R_norm.
         The browser side of this lives in src/lib/vision/{normalize,gaze-worker}.ts.

Formats written (the app ships only --out):
  fp32       44.7 MB  reference
  fp16w      22.4 MB  fp16 weights + Cast->fp32 at load (ORT folds the casts; compute stays fp32 on WebGPU and WASM)
  fp16       22.4 MB  full fp16 graph with fp32 I/O (keep_io_types); needs shader-f16 on WebGPU, not supported on WASM
  --format picks which one is written to --out (default fp16w, decided by browser measurement, see header of
  src/lib/vision/gaze-worker.ts).

Run (uv, CPU only, ~1 min):
  uv venv /tmp/gaze-venv --python 3.12
  uv pip install --python /tmp/gaze-venv/bin/python --extra-index-url https://download.pytorch.org/whl/cpu \
      --index-strategy unsafe-best-match torch timm safetensors onnx onnxruntime onnxconverter-common numpy
  /tmp/gaze-venv/bin/python scripts/convert-gaze.py [--format fp16w|fp16|fp32] [--out public/models/eth-xgaze-r18.onnx]
It downloads the weights (or pass --weights model.safetensors), exports opset 17 and checks parity
PyTorch vs onnxruntime for every format (max abs diff, rad), then writes --out.
"""

import argparse
import hashlib
import pathlib
import sys
import urllib.request
import warnings

warnings.filterwarnings("ignore", message=".*will be truncated.*")  # fp16 conversion of tiny weights
warnings.filterwarnings("ignore", category=DeprecationWarning)  # legacy TorchScript exporter (opset 17)

import numpy as np
import onnx
import onnxruntime as ort
import timm
import torch
from onnx import helper, numpy_helper
from safetensors.torch import load_file

URL = "https://huggingface.co/hysts/ptgaze-eth-xgaze-resnet18/resolve/main/model.safetensors"
SHA256 = "d1c91b2aa6a0c73856c16890d337afdecdb05563ed52182dfdb77742f1c856bc"
ROOT = pathlib.Path(__file__).resolve().parent.parent
MEAN = np.array([0.485, 0.456, 0.406], np.float32).reshape(1, 3, 1, 1)
STD = np.array([0.229, 0.224, 0.225], np.float32).reshape(1, 3, 1, 1)


def fetch(path: pathlib.Path | None, cache: pathlib.Path) -> pathlib.Path:
    if path:
        return path
    cache.mkdir(parents=True, exist_ok=True)
    dest = cache / "eth-xgaze-resnet18.safetensors"
    if not dest.exists():
        print("download", URL)
        urllib.request.urlretrieve(URL, dest)
    digest = hashlib.sha256(dest.read_bytes()).hexdigest()
    if digest != SHA256:
        sys.exit(f"sha256 mismatch: {digest}")
    return dest


def to_fp16_weights(model: onnx.ModelProto) -> onnx.ModelProto:
    """Store float initializers as fp16 and cast them back to fp32 at the top of the graph."""
    m = onnx.ModelProto()
    m.CopyFrom(model)
    g = m.graph
    casts, keep = [], []
    for init in g.initializer:
        if init.data_type != onnx.TensorProto.FLOAT or numpy_helper.to_array(init).size < 16:
            keep.append(init)
            continue
        arr = numpy_helper.to_array(init).astype(np.float16)
        h = numpy_helper.from_array(arr, init.name + "__fp16")
        keep.append(h)
        casts.append(helper.make_node("Cast", [h.name], [init.name], to=onnx.TensorProto.FLOAT, name=init.name + "__cast"))
    del g.initializer[:]
    g.initializer.extend(keep)
    nodes = list(g.node)
    del g.node[:]
    g.node.extend(casts + nodes)
    onnx.checker.check_model(m)
    return m


def to_fp16(model: onnx.ModelProto) -> onnx.ModelProto:
    from onnxconverter_common import float16

    return float16.convert_float_to_float16(model, keep_io_types=True)


def run(path_or_bytes, x: np.ndarray) -> np.ndarray:
    sess = ort.InferenceSession(path_or_bytes, providers=["CPUExecutionProvider"])
    return sess.run(None, {"input": x})[0]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--weights", type=pathlib.Path)
    ap.add_argument("--format", choices=["fp32", "fp16w", "fp16"], default="fp16w")
    ap.add_argument("--out", type=pathlib.Path, default=ROOT / "public/models/eth-xgaze-r18.onnx")
    ap.add_argument("--work", type=pathlib.Path, default=pathlib.Path("/tmp/convert-gaze"))
    ap.add_argument("--all", action="store_true", help="also write every format into --work")
    a = ap.parse_args()

    weights = fetch(a.weights, a.work)
    net = timm.create_model("resnet18", num_classes=2, pretrained=False)
    net.load_state_dict(load_file(str(weights)), strict=True)
    net.eval()

    a.work.mkdir(parents=True, exist_ok=True)
    fp32_path = a.work / "eth-xgaze-r18.fp32.onnx"
    dummy = torch.zeros(1, 3, 224, 224)
    torch.onnx.export(
        net, (dummy,), str(fp32_path), input_names=["input"], output_names=["gaze"],
        opset_version=17, do_constant_folding=True, dynamo=False,
    )
    fp32 = onnx.load(str(fp32_path))
    fp32.doc_string = "ETH-XGaze ResNet-18 (hysts/ptgaze, MIT). Input RGB ImageNet-normalised 224x224 normalised face; output pitch,yaw (rad)."
    for k, v in {"source": URL, "license": "MIT (weights); trained on ETH-XGaze (non-commercial research dataset)"}.items():
        helper.set_model_props(fp32, {**{p.key: p.value for p in fp32.metadata_props}, k: v})
    onnx.checker.check_model(fp32)

    # Parity inputs: random noise in the normalised range plus a smooth "image-like" pattern.
    rng = np.random.default_rng(0)
    xs = [((rng.random((1, 3, 224, 224), dtype=np.float32) - MEAN) / STD).astype(np.float32)]
    yy, xx = np.mgrid[0:224, 0:224].astype(np.float32) / 224
    smooth = np.stack([0.5 + 0.4 * np.sin(6 * xx), 0.5 + 0.4 * np.cos(5 * yy), 0.5 + 0.3 * np.sin(4 * (xx + yy))])[None]
    xs.append(((smooth - MEAN) / STD).astype(np.float32))

    with torch.no_grad():
        refs = [net(torch.from_numpy(x)).numpy() for x in xs]
    variants = {"fp32": fp32, "fp16w": to_fp16_weights(fp32), "fp16": to_fp16(fp32)}
    for name, model in variants.items():
        data = model.SerializeToString()
        diffs = [float(np.abs(run(data, x) - r).max()) for x, r in zip(xs, refs)]
        print(f"{name:6s} {len(data) / 1e6:6.1f} MB  max|onnx - torch| = {max(diffs):.2e} rad ({np.degrees(max(diffs)):.4f} deg)")
        if a.all:
            onnx.save(model, str(a.work / f"eth-xgaze-r18.{name}.onnx"))
        if name == "fp32" and max(diffs) > 1e-4:
            sys.exit("fp32 parity failed")
    for x, r in zip(xs, refs):
        print("torch pitch/yaw", np.round(r[0], 5))

    a.out.parent.mkdir(parents=True, exist_ok=True)
    onnx.save(variants[a.format], str(a.out))
    print("wrote", a.out, f"({a.out.stat().st_size / 1e6:.1f} MB, {a.format})")


if __name__ == "__main__":
    main()
