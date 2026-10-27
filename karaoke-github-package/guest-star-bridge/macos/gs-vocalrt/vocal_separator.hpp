#pragma once
#include "stem_separator.hpp"
namespace gsv {
// One audio-thread owner must pair pushAudio/pullStems (or pullAudio).
// Lifecycle open/close requires render stopped. Controls are lock-free.
// Both buses retain aligned original = vocal + instrumental, even on failure.
// availability is essential: an absent estimate is not isolated vocal silence.
class VocalSeparator {
  StemSeparator separator_;
  static constexpr unsigned capacity_=4096;
  std::array<float,capacity_> vocalL_{},vocalR_{},instrumentalL_{},instrumentalR_{},originalL_{},originalR_{},availability_{};
  unsigned pending_=0,offset_=0;
  std::atomic<float> gain_{0};
  std::atomic<bool> enabled_{true};
  float audioGain_=0;
  float audioEnabled_=1;
  uint64_t audioEpoch_=0;
public:
  static constexpr unsigned latencyFrames=StemSeparator::latencyFrames; // base only; actual delay via getter
  VocalSeparator()=default;
  VocalSeparator(const VocalSeparator&)=delete;
  void open(Estimator& estimator,unsigned rate) {close();separator_.open(estimator,rate);audioEpoch_=0;}
  void close() noexcept {separator_.close();pending_=offset_=0;}
  bool isOpen() const noexcept {return separator_.isOpen();}
  unsigned latencySamples() const noexcept {return separator_.latencySamples();}
  void boundary() noexcept {separator_.boundary();}
  void playing(bool v) noexcept {separator_.playing(v);}
  // Bypass the mix while keeping recurrent inference warm during playback.
  // OFF/ON cannot reload weights, reset states or create a re-enable gap.
  void enabled(bool v) noexcept {enabled_.store(v,std::memory_order_relaxed);}
  void pressure(bool v) noexcept {separator_.pressure(v);}
  Counters& metrics() noexcept {return separator_.metrics();}
  uint64_t captureEpoch() const noexcept {return separator_.captureEpoch();}
  void setVocalGain(float v) noexcept {
    v=std::isfinite(v)?std::clamp(v,0.f,1.f):0.f;
    if(gain_.exchange(v,std::memory_order_relaxed)!=v)++metrics().gainChanges;
  }
  bool pushAudio(const float* left,const float* right,unsigned count,uint64_t sourceEpoch=0) noexcept {
    if(pending_||count>capacity_||!left)return false;
    auto epoch=captureEpoch();if(!sourceEpoch)sourceEpoch=epoch;
    if(audioEpoch_!=epoch){audioEpoch_=epoch;audioGain_=gain_.load(std::memory_order_relaxed);audioEnabled_=enabled_.load(std::memory_order_relaxed)?1.f:0.f;}
    separator_.process(left,right,{vocalL_.data(),vocalR_.data()},
      {instrumentalL_.data(),instrumentalR_.data()},count,sourceEpoch,
      {originalL_.data(),originalR_.data()},availability_.data());
    pending_=count;offset_=0;return true;
  }
  bool pullStems(StereoBus vocal,StereoBus instrumental,unsigned count,StereoBus original={},float* availability=nullptr) noexcept {
    if(count>pending_||!vocal.left||!vocal.right||!instrumental.left||!instrumental.right)return false;
    std::copy_n(vocalL_.data()+offset_,count,vocal.left);std::copy_n(vocalR_.data()+offset_,count,vocal.right);
    std::copy_n(instrumentalL_.data()+offset_,count,instrumental.left);std::copy_n(instrumentalR_.data()+offset_,count,instrumental.right);
    if(original.left)std::copy_n(originalL_.data()+offset_,count,original.left);
    if(original.right)std::copy_n(originalR_.data()+offset_,count,original.right);
    if(availability)std::copy_n(availability_.data()+offset_,count,availability);
    offset_+=count;pending_-=count;return true;
  }
  bool pullAudio(float* left,float* right,unsigned count) noexcept {
    if(count>pending_||!left||!right)return false;
    for(unsigned done=0;done<count;) {
      unsigned n=std::min(128u,count-done);float target=gain_.load(std::memory_order_relaxed);
      float enabled=enabled_.load(std::memory_order_relaxed)?1.f:0.f;
      for(unsigned i=0;i<n;++i){unsigned at=offset_+done+i;
        audioGain_+=std::clamp(target-audioGain_,-1.f/128,1.f/128);
        audioEnabled_+=std::clamp(enabled-audioEnabled_,-1.f/128,1.f/128);
        // Instrumental remains at unity; gain adds only the ready vocal bus.
        // vocal already includes readiness/fallback fade from Stream.
        // g=1 cancels the correction exactly, including deadline misses.
        left[done+i]=originalL_[at]+(audioGain_-1)*vocalL_[at]*audioEnabled_;
        right[done+i]=originalR_[at]+(audioGain_-1)*vocalR_[at]*audioEnabled_;
      }
      done+=n;
    }
    offset_+=count;pending_-=count;return true;
  }
  void process(const float* left,const float* right,float* outL,float* outR,unsigned count,uint64_t epoch=0) noexcept {
    if(!epoch)epoch=captureEpoch();
    for(unsigned done=0;done<count;){unsigned n=std::min(capacity_,count-done);
      if(pushAudio(left+done,right?right+done:nullptr,n,epoch))pullAudio(outL+done,outR+done,n);
      else { // API misuse cannot block the player; normal paired process never enters here.
        for(unsigned i=0;i<n;++i){float l=std::isfinite(left[done+i])?left[done+i]:0;
          outL[done+i]=l;outR[done+i]=right?(std::isfinite(right[done+i])?right[done+i]:0):l;}
      }
      done+=n;
    }
  }
};
}
