# PKG-01 の検証の記録（2026-09-26）

- cwd: `ml/`、interpreter: `ml\.venv\Scripts\python.exe`（Python 3.14.7）
- 対象の SHA-256（作業ツリーの raw bytes）: `scripts/models/verify.py` 57e38facdfe858eef0db09169a3d2456445c3419a304f197b96c2cdf93a67c64、`scripts/models/test_verify.py` 3666b0e3379b43812316e088b5ba87022890363f618d55cf36e6d51a1bd1f6ea、`resources/models/manifest.json` aab77c230080f9b11ed6d1d3115052a6ef7b8c2c9729677e441e638a40d5a0a0

## pytest（exit 0）

````text
...............................................                          [100%]
47 passed in 2.87s
```

## ruff check（exit 0）

````text
All checks passed!
```

## ruff format --check（exit 0）

````text
2 files already formatted
```

## 実 manifest の照合 `verify.py`（exit 0）

````text
{
  "verified": true,
  "payloads": [
    {
      "sourcePath": "vendor/models/mobilenet_v3_large-5c1a4163.pth",
      "payloadPath": "resources/models/mobilenet_v3_large-5c1a4163.pth",
      "sha256": "5c1a416349c4cf298f2a6a5e2600ed0ee55e604713578f5e74e6bc8bcaef7997",
      "byteSize": 22132113
    },
    {
      "sourcePath": "vendor/models/ssdlite320_mobilenet_v3_large_coco-a79551df.pth",
      "payloadPath": "resources/models/ssdlite320_mobilenet_v3_large_coco-a79551df.pth",
      "sha256": "a79551df90c79834bcd3bb3845ef9d966b5449a3a9b2833ae8404778ca5d65d2",
      "byteSize": 14069355
    },
    {
      "sourcePath": "vendor/models/_spike/siglip/model.safetensors",
      "payloadPath": "resources/models/siglip-base-patch16-224/model.safetensors",
      "sha256": "2c63cb7d1f2e95ba501893cbb8faeb4ea9a3af295498d35097126228659c2af8",
      "byteSize": 812672320
    },
    {
      "sourcePath": "vendor/models/_spike/owlvit-b32/model.safetensors",
      "payloadPath": "resources/models/owlvit-base-patch32/model.safetensors",
      "sha256": "4dbe0399f0b7d7c8dddf1535a98769cc30743bebc877aea681998c8d984ce52b",
      "byteSize": 612983940
    }
  ]
}
```

## JSON Schema の検査 `node --test ..\scripts\models\manifest-schema.test.mjs`（exit 0）

````text
ℹ tests 45
ℹ pass 45
ℹ fail 0
```
