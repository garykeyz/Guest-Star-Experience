#include "../macos/GSLobbyWaveform.h"
#include <assert.h>
#include <stdio.h>
#include <string.h>
#include <pthread.h>

static GSLobbyWaveform concurrent;
static void *write_frames(void *ignored) {
  (void)ignored;
  float buffer[128]; float *channels[] = {buffer};
  for (unsigned i = 0; i < 50000; i++) {
    for (unsigned frame = 0; frame < 128; frame++) buffer[frame] = i & 1 ? .25f : .75f;
    GSLobbyWaveformCapture(&concurrent, channels, 1, 128);
  }
  return NULL;
}

int main(void) {
  GSLobbyWaveform wave; GSLobbyWaveformInit(&wave);
  assert(atomic_is_lock_free(&wave.sequence) && atomic_is_lock_free(&wave.peaks[0]));
  float output[64]; assert(GSLobbyWaveformRead(&wave, output) == 0);
  float left[512], right[512], original[512];
  for (unsigned frame = 0; frame < 512; frame++) left[frame] = frame / 512.f;
  memcpy(original, left, sizeof(left));
  memset(right, 0, sizeof(right));
  float *channels[] = {left, right};
  GSLobbyWaveformCapture(&wave, channels, 2, 512);
  assert(GSLobbyWaveformRead(&wave, output) == 2);
  for (unsigned bin = 0; bin < 64; bin++) assert(fabsf(output[bin] - (bin * 8 + 7) / 512.f) < .0001f);
  assert(memcmp(original, left, sizeof(left)) == 0);
  right[0] = -.9f;
  GSLobbyWaveformCapture(&wave, channels, 2, 512);
  assert(GSLobbyWaveformRead(&wave, output) == 4 && output[0] > .899f);
  memset(left, 0, sizeof(left)); memset(right, 0, sizeof(right));
  GSLobbyWaveformCapture(&wave, channels, 2, 512);
  assert(GSLobbyWaveformRead(&wave, output) == 6);
  for (unsigned bin = 0; bin < 64; bin++) assert(output[bin] == 0);
  left[0] = NAN; left[1] = INFINITY; left[2] = -3;
  GSLobbyWaveformCapture(&wave, channels, 2, 512);
  assert(GSLobbyWaveformRead(&wave, output) && output[0] == 1);
  GSLobbyWaveformCapture(&wave, channels, 2, 1);
  assert(GSLobbyWaveformRead(&wave, output));

  GSLobbyWaveformInit(&concurrent);
  pthread_t thread; assert(pthread_create(&thread, NULL, write_frames, NULL) == 0);
  unsigned valid = 0;
  for (unsigned attempt = 0; attempt < 100000; attempt++) {
    if (!GSLobbyWaveformRead(&concurrent, output)) continue;
    valid++;
    for (unsigned bin = 1; bin < 64; bin++) assert(output[bin] == output[0]);
  }
  assert(pthread_join(thread, NULL) == 0);
  assert(valid > 0);
  puts("PASS: real PCM bins, stereo, silence, bounds, read-only buffers, lock-free coherent snapshots");
  return 0;
}
