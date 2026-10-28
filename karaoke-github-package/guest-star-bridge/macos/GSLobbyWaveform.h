#ifndef GS_LOBBY_WAVEFORM_H
#define GS_LOBBY_WAVEFORM_H

#include <stdint.h>
#include <stdatomic.h>
#include <math.h>

#define GS_LOBBY_WAVEFORM_BARS 64
// Single render-thread writer, main-thread reader. No locks, allocation or
// audio-buffer writes. Atomic cells make even interrupted reads race-free.
typedef struct {
  _Atomic(uint32_t) sequence;
  _Atomic(uint32_t) peaks[GS_LOBBY_WAVEFORM_BARS];
} GSLobbyWaveform;

static inline void GSLobbyWaveformInit(GSLobbyWaveform *wave) {
  atomic_init(&wave->sequence, 0);
  for (uint32_t bin = 0; bin < GS_LOBBY_WAVEFORM_BARS; bin++) atomic_init(&wave->peaks[bin], 0);
}

static inline void GSLobbyWaveformCapture(GSLobbyWaveform *wave, float *const *channels, uint32_t channelCount, uint32_t frames) {
  if (!channels || !channelCount || !frames) return;
  atomic_fetch_add_explicit(&wave->sequence, 1, memory_order_seq_cst);
  for (uint32_t bin = 0; bin < GS_LOBBY_WAVEFORM_BARS; bin++) {
    const uint32_t start = (uint32_t)((uint64_t)frames * bin / GS_LOBBY_WAVEFORM_BARS);
    uint32_t end = (uint32_t)((uint64_t)frames * (bin + 1) / GS_LOBBY_WAVEFORM_BARS);
    if (end <= start) end = start + 1;
    float peak = 0;
    for (uint32_t channel = 0; channel < channelCount; channel++) {
      if (!channels[channel]) continue;
      for (uint32_t frame = start; frame < end; frame++) {
        const float sample = fabsf(channels[channel][frame]);
        if (isfinite(sample) && sample > peak) peak = sample;
      }
    }
    atomic_store_explicit(&wave->peaks[bin], (uint32_t)(fminf(1, peak) * 65535), memory_order_seq_cst);
  }
  atomic_fetch_add_explicit(&wave->sequence, 1, memory_order_seq_cst);
}

static inline uint32_t GSLobbyWaveformRead(const GSLobbyWaveform *wave, float *peaks) {
  for (uint32_t attempt = 0; attempt < 2; attempt++) {
    const uint32_t before = atomic_load_explicit(&wave->sequence, memory_order_seq_cst);
    if (!before || (before & 1)) continue;
    for (uint32_t bin = 0; bin < GS_LOBBY_WAVEFORM_BARS; bin++) {
      peaks[bin] = (float)atomic_load_explicit(&wave->peaks[bin], memory_order_seq_cst) / 65535;
    }
    if (before == atomic_load_explicit(&wave->sequence, memory_order_seq_cst)) return before;
  }
  return 0;
}

#endif
