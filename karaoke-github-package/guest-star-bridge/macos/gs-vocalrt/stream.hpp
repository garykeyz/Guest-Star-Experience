#pragma once
#include <array>
#include <atomic>
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <thread>
#include <chrono>
#include <stdexcept>
#ifdef __APPLE__
#include <pthread.h>
#endif

namespace gsv {
constexpr unsigned maxFrames = 512, queueSlots = 32;
static_assert(std::atomic<uint64_t>::is_always_lock_free);
static_assert(std::atomic<float>::is_always_lock_free);
struct Block {
  uint64_t generation = 0, frame = 0;
  unsigned frames = 0;
  std::array<float, maxFrames * 2> samples{}; // planar L then R, stride maxFrames
};

// Exactly one producer and one consumer. Neither resets the other's index.
template<unsigned Capacity> class Ring {
  std::array<Block, Capacity> slots_{};
  alignas(64) std::atomic<uint64_t> write_{0};
  alignas(64) std::atomic<uint64_t> read_{0};
public:
  bool push(const Block& block) noexcept {
    auto w = write_.load(std::memory_order_relaxed);
    if (w - read_.load(std::memory_order_acquire) == Capacity) return false;
    slots_[w % Capacity] = block;
    write_.store(w + 1, std::memory_order_release);
    return true;
  }
  const Block* front() const noexcept {
    auto r = read_.load(std::memory_order_relaxed);
    return r == write_.load(std::memory_order_acquire) ? nullptr : &slots_[r % Capacity];
  }
  void pop() noexcept { read_.fetch_add(1, std::memory_order_release); }
};

struct Cancellation {
  const std::atomic<uint64_t>& generation;
  const std::atomic<bool>& stopping;
  uint64_t expected;
  bool cancelled() const noexcept {
    return stopping.load(std::memory_order_relaxed) || generation.load(std::memory_order_acquire) != expected;
  }
};
class Estimator {
public:
  virtual ~Estimator() = default;
  virtual void prepare() {} // once on worker startup; load/warm off UI/render
  virtual unsigned outputDelayFrames() const noexcept { return 0; }
  virtual void reset() = 0; // worker thread only
  virtual bool vocals(const Block& input, Block& output, const Cancellation&) = 0;
};

struct Counters {
  std::atomic<uint64_t> renderedFrames{0}, missedFrames{0}, missedCallbacks{0}, inputFull{0}, outputFull{0};
  std::atomic<uint64_t> predictions{0}, failures{0}, invalidBlocks{0}, staleResults{0};
  std::atomic<uint64_t> inferenceNs{0}, maxInferenceNs{0}, resets{0}, lateResults{0};
  std::atomic<uint64_t> preparations{0}, gainChanges{0};
  std::array<std::atomic<uint64_t>,2000> inferenceHistogram{};
  double quantileMs(double q) const noexcept {
    uint64_t count=0;for(auto& bin:inferenceHistogram)count+=bin.load(std::memory_order_relaxed);
    uint64_t target=uint64_t(std::ceil(count*q)),seen=0;if(!target)return 0;
    for(unsigned i=0;i<inferenceHistogram.size();i++){seen+=inferenceHistogram[i].load(std::memory_order_relaxed);if(seen>=target)return (i+1)*.01;}
    return 20; // upper histogram bin saturates; actual max tracked separately
  }
};

// The transport owner calls boundary()/enabled()/playing(), the decoder owner
// calls submit(), the sole audio callback calls render(). A sole worker owns
// the model. Frame positions are SOURCE frames, never wall-clock estimates.
class Stream {
  Ring<queueSlots> input_, output_;
  Estimator& estimator_;
  unsigned frames_, rate_;
  std::atomic<uint64_t> generation_{1}, playhead_{0};
  std::atomic<uint64_t> disableFromGeneration_{0};
  std::atomic<bool> stop_{false}, enabled_{false}, playing_{false}, pressure_{false};
  std::atomic<float> gain_{1};
  std::thread worker_;
  uint64_t audioGeneration_ = 0;
  float wet_ = 0, tailL_ = 0, tailR_ = 0, tailReady_ = 0;
  float audioGain_=1;
  unsigned tailLeft_ = 0;
  void work() noexcept {
#ifdef __APPLE__
    // One non-realtime worker. Native audio render threads retain higher
    // priority; QoS avoids arbitrary timer coalescing on this deadline path.
    pthread_set_qos_class_self_np(QOS_CLASS_USER_INITIATED,0);
#endif
    try { estimator_.prepare(); ++metrics.preparations; }
    catch (...) { ++metrics.failures; }
    uint64_t stateGeneration = 0, nextFrame = 0, validOutputFrom = 0;
    bool hasState = false;
    Block result;
    while (!stop_.load(std::memory_order_acquire)) {
      const Block* block = input_.front();
      if (!block) {
        std::this_thread::sleep_for(std::chrono::microseconds(enabled_.load()&&playing_.load()?250:5000)); continue;
      }
      auto current = generation_.load(std::memory_order_acquire);
      if (block->generation != current || !enabled_.load() || !playing_.load()) {
        input_.pop(); continue;
      }
      // Limit ahead work (about 46 ms normally, 12 ms under pressure).
      auto head = playhead_.load(std::memory_order_acquire);
      const uint64_t ahead = pressure_.load() ? rate_ / 80 : rate_ / 22;
      if (block->frame > head && block->frame - head > ahead) {
        std::this_thread::sleep_for(std::chrono::microseconds(250)); continue;
      }
      if (block->frame + block->frames <= head) {
        hasState = false; input_.pop(); continue;
      }
      bool valid = true;
      for (unsigned c=0;c<2;++c) for (unsigned i=0;i<block->frames;++i)
        valid = valid && std::isfinite(block->samples[c*maxFrames+i]);
      if (!valid) { ++metrics.invalidBlocks; hasState=false; input_.pop(); continue; }
      try {
        const unsigned delay=estimator_.outputDelayFrames();
        if (!hasState || stateGeneration != current || nextFrame != block->frame) {
          estimator_.reset(); ++metrics.resets;
          validOutputFrom=block->frame+delay;
        }
        stateGeneration=current; nextFrame=block->frame+block->frames; hasState=true;
        result.generation=current; result.frame=block->frame>=delay?block->frame-delay:0; result.frames=block->frames;
        Cancellation cancel{generation_, stop_, current};
        auto start = std::chrono::steady_clock::now();
        bool ok = estimator_.vocals(*block, result, cancel);
        auto ns = uint64_t(std::chrono::duration_cast<std::chrono::nanoseconds>(
          std::chrono::steady_clock::now()-start).count());
        metrics.inferenceNs.fetch_add(ns);
        ++metrics.inferenceHistogram[std::min<uint64_t>(1999,ns/10000)];
        auto peak=metrics.maxInferenceNs.load();
        while (peak<ns && !metrics.maxInferenceNs.compare_exchange_weak(peak, ns)) {}
        ++metrics.predictions;
        if (cancel.cancelled()) { ++metrics.staleResults; hasState=false; }
        else {
          // Backend cannot alter transport identity or output shape.
          result.generation=current; result.frame=block->frame>=delay?block->frame-delay:0; result.frames=block->frames;
          for (unsigned c=0;c<2;++c) for (unsigned i=0;i<block->frames;++i)
            ok = ok && std::isfinite(result.samples[c*maxFrames+i]) && std::abs(result.samples[c*maxFrames+i])<=16;
          if (!ok) { ++metrics.failures; hasState=false; }
          else if (block->frame<validOutputFrom) {} // warmup after seek/failure/gap advances state without a fabricated stem
          else if (result.frame+result.frames<=playhead_.load()) ++metrics.lateResults;
          else if (!output_.push(result)) ++metrics.outputFull;
        }
      } catch (...) { ++metrics.failures; hasState=false; }
      input_.pop();
    }
  }
public:
  Counters metrics;
  Stream(Estimator& estimator, unsigned frames, unsigned sampleRate)
    : estimator_(estimator), frames_(frames), rate_(sampleRate) {
    if ((frames!=128 && frames!=256 && frames!=512) || (sampleRate!=44100 && sampleRate!=48000))
      throw std::invalid_argument("GS-VocalRT requires 128/256/512 frames at 44100/48000 Hz");
    worker_=std::thread([this]{work();});
  }
  ~Stream() { stop_.store(true,std::memory_order_release); if(worker_.joinable()) worker_.join(); }
  Stream(const Stream&)=delete;
  // Destructor and model loading must NEVER run on the audio callback.
  uint64_t boundary(uint64_t frame=0) noexcept {
    disableFromGeneration_.store(0);
    auto g=generation_.fetch_add(1,std::memory_order_acq_rel)+1;
    playhead_.store(frame,std::memory_order_release); return g;
  }
  uint64_t generation() const noexcept { return generation_.load(std::memory_order_acquire); }
  void enabled(bool value) noexcept {
    if(enabled_.load()==value)return;
    if(!value){
      // Preserve only the current source's last correction for a 128-frame
      // OFF fade. Seek/skip boundaries clear this marker before publishing.
      disableFromGeneration_.store(generation_.load());enabled_.store(false);
      generation_.fetch_add(1,std::memory_order_acq_rel);
    }else{enabled_.store(true);boundary(playhead_.load());}
  }
  void playing(bool value) noexcept { if(playing_.exchange(value)!=value) boundary(playhead_.load()); }
  void pressure(bool value) noexcept { pressure_.store(value); }
  void vocalGain(float value) noexcept { gain_.store(std::isfinite(value)?std::clamp(value,0.f,1.f):1.f); }
  // Non-blocking submission from a decoder that is ahead of playback. No
  // decoding/inference inside render(), no whole-file PCM and no disk output.
  bool submit(const Block& block) noexcept {
    if(block.frames!=frames_ || block.generation!=generation() || !enabled_.load() || !playing_.load()) return false;
    if(!input_.push(block)) { ++metrics.inputFull; return false; }
    return true;
  }
  void render(const float* left, const float* right, float* outL, float* outR,
              unsigned count, uint64_t frame, uint64_t generation) noexcept {
    renderImpl(left,right,outL,outR,count,frame,generation,false);
  }
  // Gain-independent stems, with the same bounded readiness and OFF fades.
  // Original remains authoritative; two buses conserve it even on failures.
  void renderBuses(const float* left,const float* right,float* vocalL,float* vocalR,
                   float* instrumentalL,float* instrumentalR,unsigned count,
                   uint64_t frame,uint64_t generation,float* availability=nullptr) noexcept {
    renderImpl(left,right,instrumentalL,instrumentalR,count,frame,generation,true,availability);
    for(unsigned i=0;i<count;++i) {
      float l=std::isfinite(left[i])?left[i]:0.f;
      float r=right?(std::isfinite(right[i])?right[i]:0.f):l;
      vocalL[i]=l-instrumentalL[i];vocalR[i]=r-instrumentalR[i];
    }
  }
private:
  void renderImpl(const float* left,const float* right,float* outL,float* outR,
                  unsigned count,uint64_t frame,uint64_t generation,bool buses,float* availability=nullptr) noexcept {
    // Input is the authoritative original audio for exactly this source time.
    // The caller supplies valid buffers even when the inference worker fails.
    if(audioGeneration_!=generation) {
      bool fadeOff=!enabled_.load()&&playing_.load()&&audioGeneration_==disableFromGeneration_.load();
      audioGeneration_=generation;wet_=0;
      if(!fadeOff){tailL_=tailR_=tailReady_=0;tailLeft_=0;audioGain_=buses?0.f:gain_.load();}
    }
    const bool active=generation==this->generation() && enabled_.load() && playing_.load();
    const float gain=buses?0.f:gain_.load();
    constexpr unsigned fade=128;
    unsigned discarded=0, missed=0;
    for(unsigned i=0;i<count;++i) {
      const uint64_t at=frame+i;
      const Block* b=output_.front();
      while(b && discarded<queueSlots &&
            (b->generation<generation || (b->generation==generation && b->frame+b->frames<=at))) {
        output_.pop(); ++discarded; b=output_.front();
      }
      const bool ready=active && b && b->generation==generation && b->frame<=at && at-b->frame<b->frames;
      float l=std::isfinite(left[i])?left[i]:0.f;
      float r=right?(std::isfinite(right[i])?right[i]:0.f):l;
      audioGain_+=std::clamp(gain-audioGain_,-1.f/fade,1.f/fade);
      float readyMix=0;
      if(ready) {
        auto offset=unsigned(at-b->frame);
        wet_=std::min(1.f,wet_+1.f/fade);
        tailL_=(audioGain_-1)*b->samples[offset]*wet_;
        tailR_=(audioGain_-1)*b->samples[maxFrames+offset]*wet_;
        tailLeft_=fade;
        tailReady_=wet_;readyMix=wet_;
        l+=tailL_; r+=tailR_;
      } else {
        if(active) ++missed;
        // A bounded 128-frame fade of the last correction avoids a hard step
        // when the next estimated block is absent. It is not another model.
        if((gain==1&&audioGain_==1)||!playing_.load())tailLeft_=0;
        if(tailLeft_) {
          float factor=float(--tailLeft_)/fade;
          l+=tailL_*factor; r+=tailR_*factor;
          readyMix=tailReady_*factor;
        }
        // Preserve the fading readiness on a short miss. Resetting wet to0
        // makes the next ready sample discard a still-audible correction,
        // creating a step even when the estimated/source PCM is constant.
        wet_=readyMix;
      }
      outL[i]=l; outR[i]=r;
      if(availability)availability[i]=readyMix;
    }
    metrics.renderedFrames.fetch_add(count,std::memory_order_relaxed);
    metrics.missedFrames.fetch_add(missed,std::memory_order_relaxed);
    if(missed) metrics.missedCallbacks.fetch_add(1,std::memory_order_relaxed);
    if(generation==this->generation()) playhead_.store(frame+count,std::memory_order_release);
  }
public:
  static constexpr size_t storageBytes() noexcept { return sizeof(Stream); }
};
} // namespace gsv
