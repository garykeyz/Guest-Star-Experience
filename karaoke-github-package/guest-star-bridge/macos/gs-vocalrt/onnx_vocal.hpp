#pragma once
#include "stream.hpp"
#include <onnxruntime_cxx_api.h>
#include <CommonCrypto/CommonDigest.h>
#include <fstream>
#include <memory>
#include <vector>
#include <string>

namespace gsv {
// All session initialization and Run calls are owned by Stream's one worker.
// The derived graph contains one trained vocal branch and exactly two buses.
class OnnxVocalEstimator final : public Estimator {
  std::string path_;
  std::unique_ptr<Ort::Env> env_;
  std::unique_ptr<Ort::Session> session_;
  std::vector<Ort::Value> inputs_,outputs_;
  std::array<float,256> audio_{},vocal_{},instrumental_{};
  std::array<std::vector<float>,4> state_,next_;
  std::atomic<bool> ready_{false},failed_{false};
  std::atomic<uint64_t> loadNs_{0};
  Ort::RunOptions runOptions_;
  static constexpr const char* namesIn_[5]={"audio_chunk","vocals_audio_history","vocals_local_hidden","vocals_global_hidden","vocals_spectral_numerator_tail"};
  static constexpr const char* namesOut_[6]={"vocals","instrumental","next_vocals_audio_history","next_vocals_local_hidden","next_vocals_global_hidden","next_vocals_spectral_numerator_tail"};
  static void verifyFile(const std::string& path) {
    std::ifstream file(path,std::ios::binary);if(!file)throw std::runtime_error("Vocal streaming model missing");
    CC_SHA256_CTX ctx;CC_SHA256_Init(&ctx);std::array<char,65536> bytes;size_t total=0;
    while(file){file.read(bytes.data(),bytes.size());auto n=file.gcount();if(n){CC_SHA256_Update(&ctx,bytes.data(),unsigned(n));total+=n;}}
    unsigned char digest[CC_SHA256_DIGEST_LENGTH];CC_SHA256_Final(digest,&ctx);
    const char* hex="0123456789abcdef";std::string actual;actual.reserve(64);
    for(auto b:digest){actual+=hex[b>>4];actual+=hex[b&15];}
    if(total!=11069906||actual!="c08b0a2c2ee6510eb34425724e820f2302d549cd4a56acee23867a5f804f38eb")
      throw std::runtime_error("Vocal streaming model identity mismatch");
  }
  void run() {session_->Run(runOptions_,namesIn_,inputs_.data(),5,namesOut_,outputs_.data(),6);}
  void commitStates() noexcept {for(unsigned s=0;s<4;++s)std::copy(next_[s].begin(),next_[s].end(),state_[s].begin());}
public:
  explicit OnnxVocalEstimator(std::string path):path_(std::move(path)){}
  unsigned outputDelayFrames() const noexcept override {return 128;}
  bool ready() const noexcept {return ready_.load(std::memory_order_acquire);}
  bool failed() const noexcept {return failed_.load(std::memory_order_acquire);}
  double loadMs() const noexcept {return loadNs_.load()/1e6;}
  void prepare() override {
    if(ready())return;
    if(failed())throw std::runtime_error("Vocal model preparation previously failed");
    auto began=std::chrono::steady_clock::now();
    try {
      verifyFile(path_);
      env_=std::make_unique<Ort::Env>(ORT_LOGGING_LEVEL_WARNING,"GuestStarVocalStream");
      Ort::SessionOptions options;
      options.SetExecutionMode(ExecutionMode::ORT_SEQUENTIAL);
      options.SetIntraOpNumThreads(1);options.SetInterOpNumThreads(1);
      options.SetGraphOptimizationLevel(GraphOptimizationLevel::ORT_ENABLE_ALL);
      options.AddConfigEntry("session.intra_op.allow_spinning","0");
      options.AddConfigEntry("session.inter_op.allow_spinning","0");
      options.AddConfigEntry("mlas.disable_kleidiai","1");
      session_=std::make_unique<Ort::Session>(*env_,path_.c_str(),options);
      if(session_->GetInputCount()!=5||session_->GetOutputCount()!=6)throw std::runtime_error("Wrong two-bus model ABI");
      Ort::AllocatorWithDefaultOptions allocator;
      std::vector<std::vector<int64_t>> shapes={{1,2,128},{1,2,896},{2,20,96},{2,1,192},{1,1,2,128}};
      for(size_t i=0;i<5;++i){auto name=session_->GetInputNameAllocated(i,allocator);auto type=session_->GetInputTypeInfo(i);auto info=type.GetTensorTypeAndShapeInfo();
        if(std::string(name.get())!=namesIn_[i]||info.GetElementType()!=ONNX_TENSOR_ELEMENT_DATA_TYPE_FLOAT||info.GetShape()!=shapes[i])throw std::runtime_error("Wrong input tensor contract");}
      for(size_t i=0;i<6;++i){auto name=session_->GetOutputNameAllocated(i,allocator);auto type=session_->GetOutputTypeInfo(i);auto info=type.GetTensorTypeAndShapeInfo();
        if(std::string(name.get())!=namesOut_[i]||info.GetElementType()!=ONNX_TENSOR_ELEMENT_DATA_TYPE_FLOAT||info.GetShape()!=shapes[i<2?0:i-1])throw std::runtime_error("Wrong output tensor contract");}
      auto memory=Ort::MemoryInfo::CreateCpu(OrtArenaAllocator,OrtMemTypeDefault);
      inputs_.reserve(5);outputs_.reserve(6);
      inputs_.push_back(Ort::Value::CreateTensor<float>(memory,audio_.data(),audio_.size(),shapes[0].data(),3));
      outputs_.push_back(Ort::Value::CreateTensor<float>(memory,vocal_.data(),vocal_.size(),shapes[0].data(),3));
      outputs_.push_back(Ort::Value::CreateTensor<float>(memory,instrumental_.data(),instrumental_.size(),shapes[0].data(),3));
      for(unsigned s=0;s<4;++s){size_t count=1;for(auto d:shapes[s+1])count*=d;state_[s].resize(count);next_[s].resize(count);
        inputs_.push_back(Ort::Value::CreateTensor<float>(memory,state_[s].data(),count,shapes[s+1].data(),shapes[s+1].size()));
        outputs_.push_back(Ort::Value::CreateTensor<float>(memory,next_[s].data(),count,shapes[s+1].data(),shapes[s+1].size()));}
      // Prime ORT allocations/kernel caches off the audio and UI threads.
      for(unsigned i=0;i<8;++i){run();commitStates();}
      reset();
      loadNs_.store(std::chrono::duration_cast<std::chrono::nanoseconds>(std::chrono::steady_clock::now()-began).count());
      ready_.store(true,std::memory_order_release);
    } catch(...) {failed_.store(true,std::memory_order_release);throw;}
  }
  void reset() override {for(auto& state:state_)std::fill(state.begin(),state.end(),0.f);}
  bool vocals(const Block& in,Block& out,const Cancellation& cancellation) override {
    if(!ready()||in.frames!=128||cancellation.cancelled())return false;
    std::copy_n(in.samples.data(),128,audio_.data());std::copy_n(in.samples.data()+maxFrames,128,audio_.data()+128);
    run();
    if(cancellation.cancelled())return false;
    for(unsigned i=0;i<256;++i)if(!std::isfinite(vocal_[i])||!std::isfinite(instrumental_[i]))return false;
    for(auto& state:next_)for(float v:state)if(!std::isfinite(v))return false;
    commitStates();
    std::copy_n(vocal_.data(),128,out.samples.data());std::copy_n(vocal_.data()+128,128,out.samples.data()+maxFrames);
    return true; // Stream discards the first previous-hop result after reset.
  }
};
}
