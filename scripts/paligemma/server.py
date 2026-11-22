"""
PaliGemma 로컬 OCR 서버 - 디스코드 봇의 /관리자 데이터적재 이미지 자동 인식용 (무료, PC에서 실행)

  python scripts/paligemma/server.py            # http://127.0.0.1:8765
  POST /ocr   {"image": "<base64>", "tiles_x": 2, "tiles_y": 5}
           -> {"model": "...", "tiles": [{"row": 0, "col": 0, "text": "..."}, ...]}
  GET  /health -> {"ok": true, "model": "...", "device": "cpu"}

PaliGemma는 448px 정사각형으로 이미지를 줄여서 보기 때문에, 1920x1080 결과 화면을 통째로 넣으면
글자가 뭉개진다. 그래서 이미지를 tiles_x x tiles_y 조각(약간 겹치게)으로 나눠 조각마다 "ocr"을 실행한다.

환경 변수
  PALIGEMMA_MODEL   기본 google/paligemma2-3b-mix-448  (Hugging Face에서 사용 약관 동의 필요)
  PALIGEMMA_HOST    기본 127.0.0.1
  PALIGEMMA_PORT    기본 8765
  PALIGEMMA_DEVICE  기본 자동 (cuda > mps > cpu)
  PALIGEMMA_DTYPE   기본 자동 (cuda=bfloat16, mps=float16, cpu=float32). RAM이 부족하면 bfloat16 (메모리 절반, CPU에선 더 느릴 수 있음)
  HF_TOKEN          Hugging Face 토큰 (모델 다운로드용, `huggingface-cli login`으로 대신 가능)
"""

import base64
import io
import json
import os
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from PIL import Image

MODEL_ID = os.environ.get("PALIGEMMA_MODEL", "google/paligemma2-3b-mix-448")
HOST = os.environ.get("PALIGEMMA_HOST", "127.0.0.1")
PORT = int(os.environ.get("PALIGEMMA_PORT", "8765"))
MAX_TILES = 24
OVERLAP = 0.15  # 조각끼리 겹치는 비율 (경계에 걸린 글자 보완)
MAX_BODY_BYTES = 12 * 1024 * 1024


def split_tiles(image, tiles_x, tiles_y, overlap=OVERLAP):
    """이미지를 tiles_x x tiles_y 조각으로 나눈다. (row, col, crop) 목록, 행 우선 순서"""
    width, height = image.size
    tile_w = width / tiles_x
    tile_h = height / tiles_y
    pad_w = tile_w * overlap
    pad_h = tile_h * overlap
    tiles = []
    for row in range(tiles_y):
        for col in range(tiles_x):
            left = max(0, int(col * tile_w - pad_w))
            top = max(0, int(row * tile_h - pad_h))
            right = min(width, int((col + 1) * tile_w + pad_w))
            bottom = min(height, int((row + 1) * tile_h + pad_h))
            tiles.append((row, col, image.crop((left, top, right, bottom))))
    return tiles


class PaliGemmaOcr:
    """PaliGemma 모델을 한 번만 올려두고 조각별 OCR을 한다. (동시에 한 요청씩)"""

    def __init__(self, model_id):
        import torch
        from transformers import AutoProcessor, PaliGemmaForConditionalGeneration

        self.torch = torch
        self.model_id = model_id
        self.device = os.environ.get("PALIGEMMA_DEVICE") or (
            "cuda" if torch.cuda.is_available() else "mps" if torch.backends.mps.is_available() else "cpu"
        )
        # GPU는 bfloat16(메모리 절약), CPU는 float32(호환성). 3B 모델 기준 CPU float32는 RAM 12GB+, bfloat16은 6GB+.
        dtypes = {"float32": torch.float32, "bfloat16": torch.bfloat16, "float16": torch.float16}
        default = "bfloat16" if self.device == "cuda" else "float16" if self.device == "mps" else "float32"
        self.dtype = dtypes[os.environ.get("PALIGEMMA_DTYPE", default)]
        print(f"[paligemma] 모델 불러오는 중: {model_id} ({self.device}, {self.dtype}) ...", flush=True)
        started = time.time()
        self.processor = AutoProcessor.from_pretrained(model_id)
        self.model = (
            PaliGemmaForConditionalGeneration.from_pretrained(model_id, torch_dtype=self.dtype).to(self.device).eval()
        )
        self.lock = threading.Lock()
        print(f"[paligemma] 준비 완료 ({time.time() - started:.0f}초)", flush=True)

    def ocr(self, image, prompt="ocr", max_new_tokens=256):
        torch = self.torch
        inputs = self.processor(text=prompt, images=image.convert("RGB"), return_tensors="pt")
        inputs = inputs.to(self.device)
        if "pixel_values" in inputs:
            inputs["pixel_values"] = inputs["pixel_values"].to(self.dtype)
        input_len = inputs["input_ids"].shape[-1]
        with self.lock, torch.inference_mode():
            output = self.model.generate(**inputs, max_new_tokens=max_new_tokens, do_sample=False)
        return self.processor.decode(output[0][input_len:], skip_special_tokens=True).strip()


def make_handler(engine):
    class Handler(BaseHTTPRequestHandler):
        def _send(self, status, payload):
            body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            if self.path == "/health":
                return self._send(200, {"ok": True, "model": engine.model_id, "device": engine.device})
            return self._send(404, {"error": "not found"})

        def do_POST(self):
            if self.path != "/ocr":
                return self._send(404, {"error": "not found"})
            length = int(self.headers.get("Content-Length") or 0)
            if length <= 0 or length > MAX_BODY_BYTES:
                return self._send(413, {"error": "image too large or empty"})
            try:
                req = json.loads(self.rfile.read(length))
                image = Image.open(io.BytesIO(base64.b64decode(req["image"])))
                tiles_x = max(1, int(req.get("tiles_x", 2)))
                tiles_y = max(1, int(req.get("tiles_y", 5)))
                if tiles_x * tiles_y > MAX_TILES:
                    return self._send(400, {"error": f"too many tiles (max {MAX_TILES})"})
            except Exception as err:  # 잘못된 요청 (이미지 아님 등)
                return self._send(400, {"error": f"bad request: {err}"})
            try:
                started = time.time()
                tiles = [
                    {"row": row, "col": col, "text": engine.ocr(crop)}
                    for row, col, crop in split_tiles(image, tiles_x, tiles_y)
                ]
                print(f"[paligemma] OCR {len(tiles)}조각 {time.time() - started:.1f}초", flush=True)
                return self._send(200, {"model": engine.model_id, "tiles": tiles})
            except Exception as err:
                print(f"[paligemma] OCR 실패: {err}", file=sys.stderr, flush=True)
                return self._send(500, {"error": f"ocr failed: {err}"})

        def log_message(self, fmt, *args):  # 기본 접속 로그는 끈다
            pass

    return Handler


def main():
    engine = PaliGemmaOcr(MODEL_ID)
    server = ThreadingHTTPServer((HOST, PORT), make_handler(engine))
    print(f"[paligemma] http://{HOST}:{PORT} 에서 대기 중 (Ctrl+C로 종료)", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
