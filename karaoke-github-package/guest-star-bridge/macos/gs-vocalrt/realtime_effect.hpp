#pragma once
#include "vocal_separator.hpp"
#include "coreml_p0.hpp"
#include <memory>
#include <string>
namespace gsv {
// Loading occurs once, on the single inference worker; never in render or UI.
class LazyCoreMLP0 : public Estimator {
  std::string path_;
  std::unique_ptr<Estimator> model_;
  bool failed_=false;
public:
  explicit LazyCoreMLP0(std::string path):path_(std::move(path)){}
  void prepare() override {
    reset();if(!model_)return;
    // Exercise first-prediction kernel setup before Play. This runs only on
    // the worker; reset recurrent history while retaining loaded weights.
    Block silence,output;silence.frames=128;
    std::atomic<uint64_t> generation{1};std::atomic<bool> stopping{false};
    if(!model_->vocals(silence,output,{generation,stopping,1}))
      throw std::runtime_error("Core ML warmup failed");
    model_->reset();
  }
  void reset() override {
    if(failed_) return; // one failed load; later blocks take cheap dry fallback
    if(!model_) {
      try {model_=coreMLP0(path_,"cpu");} catch(...) {failed_=true;throw;}
    }
    model_->reset();
  }
  bool vocals(const Block& in,Block& out,const Cancellation& c) override {return model_ && model_->vocals(in,out,c);}
};

// Native effect: base 512 plus model output delay gives the worker a bounded
// deadline. Always delay the dry signal by the same amount, so fallback does
// not shift time. Delay is exposed through AU latency and compensated in the
// existing native deck clock. Startup padding is ordinary fixed DSP latency,
// never additional silence while waiting for a model.
class RealtimeEffect : public VocalSeparator {
public:
  RealtimeEffect(Estimator& model,unsigned rate){open(model,rate);}
  void gain(float value) noexcept {setVocalGain(value);}
};
}
