# Avisos de @ffmpeg/ffmpeg 0.12.15 y @ffmpeg/util 0.12.2

Licencia: MIT. Titular: Jerome Wu (repositorio `ffmpegwasm/ffmpeg.wasm`). Revisión del 16 nov 2026.

## Qué está confirmado

- **@ffmpeg/ffmpeg 0.12.15**: el commit `f78aed147c4185484da8eba1d97c51354a5e3352` tiene el mensaje «RELEASE: @ffmpeg/ffmpeg v0.12.15». En ese commit, `packages/ffmpeg/package.json` dice `"version": "0.12.15"` y `"license": "MIT"`, y `LICENSE` dice «Copyright (c) 2019 Jerome Wu» (1066 bytes, igual que `LICENSE-ffmpeg.txt`).
- **@ffmpeg/util 0.12.2**: el commit `d3c018aa40a241384965268f0506b73f47dee60c` («util v12.2 release») tiene `packages/util/package.json` con `"version": "0.12.2"` y un `LICENSE` con el mismo texto y copyright. El texto es idéntico al de `LICENSE-util.txt`.
- El `LICENSE` de la rama `main` y el del commit del tag `v12.15` (`71aa99d37c02a7b4c435275ca9ef50e612f6efa1`) son idénticos.

## Qué está inferido (no confirmado)

- Que los tarballs publicados en npm (`@ffmpeg/ffmpeg-0.12.15.tgz` y `@ffmpeg/util-0.12.2.tgz`) salen de esos commits. Los registros npm no indican `gitHead`. El vínculo se basa en que la versión y el mensaje de release coinciden.
- Que existan tags `v0.12.15` o `@ffmpeg/util@0.12.2`: no aparecen en la API de tags del repositorio, que solo muestra `v12.15` y tags posteriores con otra convención.

## Hashes de los tarballs (16 nov 2026)

- `@ffmpeg/ffmpeg-0.12.15.tgz`: sha256 `c8a23365fb39b46d3d1d9baa2e74b522d00ce5d57e8b20471ad2665eaad38e3e`; integridad npm `sha512-1C8Obr4GsN3xw+/1Ww6PFM84wSQAGsdoTuTWPOj2OizsRDLT4CXTaVjPhkw6ARyDus1B9X/L2LiXHqYYsGnRFw==`.
- `@ffmpeg/util-0.12.2.tgz`: sha256 `1a37765f61421a6da0dc955a3b5a8872c6a0ce46928d50dfa99ce3a12a85ba1a`; integridad npm `sha512-ouyoW+4JB7WxjeZ2y6KpRvB+dLp7Cp4ro8z0HIVpZVCM7AwFlHa0c4R8Y/a4M3wMqATpYKhC7lSFHQ0T11MEDw==`.
- Los tarballs no incluyen archivo LICENSE; su `package.json` declara `"license": "MIT"`.
