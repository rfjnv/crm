"""Перевод звука между частотами: звонок Telegram (48 кГц) ↔ агент ElevenLabs (обычно 16 кГц)."""

import numpy as np


def pcm_rate(fmt: str | None, default: int) -> int:
    """'pcm_16000' → 16000. Другие форматы (ulaw) не поддерживаем — оставляем прежнюю частоту."""
    if fmt and fmt.startswith('pcm_'):
        try:
            return int(fmt[4:])
        except ValueError:
            pass
    return default


def resample(pcm: bytes, src: int, dst: int) -> bytes:
    """PCM 16 бит моно. Вниз — сглаживание и прореживание, вверх — линейная интерполяция."""
    if src == dst or not pcm:
        return pcm
    x = np.frombuffer(pcm[: len(pcm) // 2 * 2], dtype=np.int16).astype(np.float32)
    if src > dst and src % dst == 0:
        k = src // dst
        # Простой фильтр против наложения частот: среднее по окну k, потом каждый k-й отсчёт.
        smoothed = np.convolve(x, np.ones(k, dtype=np.float32) / k, mode='same')
        y = smoothed[::k]
    else:
        n_out = int(round(len(x) * dst / src))
        if n_out <= 0:
            return b''
        y = np.interp(np.linspace(0, len(x) - 1, n_out), np.arange(len(x)), x)
    return np.clip(y, -32768, 32767).astype(np.int16).tobytes()
