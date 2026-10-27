#pragma once
#include <functional>
#include <istream>
#include <memory>
#include <string>

namespace gsv {
struct LyricSegment { double start=0,end=0; std::string text,language; float noSpeechProbability=0; };
// Batch-only, independent of the audio device. Input is little-endian mono
// Float32 PCM at 16000 Hz. At most 30 seconds of decoded input are resident.
// Segment timing is ASR timing, not forced alignment of authoritative lyrics.
class LyricsExtractor {
  struct Impl;
  std::unique_ptr<Impl> impl_;
public:
  LyricsExtractor(const std::string& model,const std::string& language="auto",int threads=2);
  ~LyricsExtractor();
  LyricsExtractor(const LyricsExtractor&)=delete;
  bool extract(std::istream& pcm,const std::function<void(const LyricSegment&)>& emit,
               const std::function<bool()>& cancelled={},const std::function<void(double)>& progress={});
};
}
