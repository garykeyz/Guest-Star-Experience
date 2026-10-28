#pragma once
#include "stream.hpp"
#include <memory>
namespace gsv {
struct StereoBus {float* left=nullptr;float* right=nullptr;};

// open/close require render stopped; process uses only fixed storage and atomics.
// One render producer; controls use atomics. Input and four bus buffers must
// be valid, non-overlapping planar arrays of count floats. Null input right
// duplicates mono. No decoder/file ownership, loading or whole-song buffering.
class StemSeparator {
  std::unique_ptr<Stream> stream_;
  Counters closedMetrics_;
  std::atomic<uint64_t> epoch_{1};
  uint64_t audioEpoch_=0, inputFrame_=0;
  unsigned fill_=0,latencySamples_=512;
  Block input_;
  std::array<float,1024> delayL_{},delayR_{};
  std::array<float,128> originalL_{},originalR_{};
  std::atomic<bool> running_{false};
  std::atomic<bool> enabled_{true};
public:
  static constexpr unsigned latencyFrames=512; // legacy base deadline; use latencySamples() for actual model delay
  StemSeparator()=default;
  ~StemSeparator(){close();}
  StemSeparator(const StemSeparator&)=delete;
  void open(Estimator& model,unsigned rate) {
    close();
    if(model.outputDelayFrames()>delayL_.size()-latencyFrames-(model.outputDelayFrames()?384:0))
      throw std::invalid_argument("Estimator output delay exceeds fixed render storage");
    // A preceding-hop model also needs assembly/scheduling reserve when
    // hardware conversion produces non-multiple-of-128 callbacks (e.g.471).
    // Without it the final slice asks for input not submitted until this
    // very callback, so a worker cannot have published that result yet.
    // Three hops cover incomplete accumulation plus measured M1 worker
    // jitter. Final trained model latency:1024/44100=23.22ms, fixed in OFF.
    latencySamples_=latencyFrames+model.outputDelayFrames()+(model.outputDelayFrames()?384:0);
    stream_=std::make_unique<Stream>(model,128,rate);
    epoch_.fetch_add(1);audioEpoch_=0;running_=false;enabled_=true;
  }
  void close() noexcept {running_=false;stream_.reset();epoch_.fetch_add(1);audioEpoch_=0;}
  bool isOpen() const noexcept {return bool(stream_);}
  unsigned latencySamples() const noexcept {return latencySamples_;}
  void boundary() noexcept {++epoch_;if(stream_)stream_->boundary(0);}
  void playing(bool v) noexcept {running_.store(v);if(stream_){stream_->enabled(v&&enabled_.load());stream_->playing(v);}if(v)boundary();}
  void enabled(bool v) noexcept {enabled_.store(v);if(stream_)stream_->enabled(v&&running_.load());}
  void pressure(bool v) noexcept {if(stream_)stream_->pressure(v);}
  Counters& metrics() noexcept {return stream_?stream_->metrics:closedMetrics_;}
  uint64_t captureEpoch() const noexcept {return epoch_.load();}
  void process(const float* inL,const float* inR,StereoBus vocal,StereoBus instrumental,
               unsigned count,uint64_t sourceEpoch=0,StereoBus original={},float* availability=nullptr) noexcept {
    auto bypass=[&]() noexcept {
      for(unsigned i=0;i<count;++i){float l=std::isfinite(inL[i])?inL[i]:0.f;float r=inR?(std::isfinite(inR[i])?inR[i]:0.f):l;
        vocal.left[i]=vocal.right[i]=0;instrumental.left[i]=l;instrumental.right[i]=r;
        if(availability)availability[i]=0;
        if(original.left)original.left[i]=l;if(original.right)original.right[i]=r;}
    };
    if(!stream_){bypass();return;}
    // AU host sizes are variable; a tiny per-sample assembler preserves fixed
    // 128-frame model shapes without allocations or blocking synchronization.
    if(!sourceEpoch)sourceEpoch=epoch_.load();
    const uint64_t generation=stream_->generation();
    auto epoch=epoch_.load();
    if(sourceEpoch!=epoch){
      // A seek/skip happened while the host was pulling the former source.
      // That already-in-flight callback remains original; never tag its audio
      // as the new generation or submit it into the new recurrent state.
      bypass();return;
    }
    if(epoch!=audioEpoch_) {
      audioEpoch_=epoch; inputFrame_=0;fill_=0;
      delayL_.fill(0);delayR_.fill(0);
    }
    if(!running_.load()) {
      bypass();return;
    }
    // A short assembler permits arbitrary host quantum sizes with static
    // 128-frame inference. Render each available delayed-original slice now.
    unsigned done=0;
    while(done<count) {
      unsigned chunk=std::min<unsigned>(128-fill_,count-done);
      if(inputFrame_<latencySamples_)chunk=std::min<unsigned>(chunk,latencySamples_-inputFrame_);
      const uint64_t from=inputFrame_;
      for(unsigned i=0;i<chunk;++i) {
        uint64_t at=inputFrame_+i;unsigned index=at%latencySamples_;
        float l=std::isfinite(inL[done+i])?inL[done+i]:0.f;
        float r=inR?(std::isfinite(inR[done+i])?inR[done+i]:0.f):l;
        originalL_[i]=delayL_[index];originalR_[i]=delayR_[index];
        delayL_[index]=l;delayR_[index]=r;
        input_.samples[fill_+i]=l;input_.samples[maxFrames+fill_+i]=r;
      }
      fill_+=chunk;inputFrame_+=chunk;
      if(fill_==128) {
        input_.frame=inputFrame_-128;input_.frames=128;input_.generation=generation;
        stream_->submit(input_);fill_=0;
      }
      if(from<latencySamples_) {
        std::fill_n(vocal.left+done,chunk,0.f);std::fill_n(vocal.right+done,chunk,0.f);
        std::fill_n(instrumental.left+done,chunk,0.f);std::fill_n(instrumental.right+done,chunk,0.f);
        if(availability)std::fill_n(availability+done,chunk,0.f);
      } else stream_->renderBuses(originalL_.data(),originalR_.data(),vocal.left+done,vocal.right+done,
          instrumental.left+done,instrumental.right+done,chunk,from-latencySamples_,generation,availability?availability+done:nullptr);
      if(original.left)std::copy_n(originalL_.data(),chunk,original.left+done);
      if(original.right)std::copy_n(originalR_.data(),chunk,original.right+done);
      done+=chunk;
    }
  }
};
}
