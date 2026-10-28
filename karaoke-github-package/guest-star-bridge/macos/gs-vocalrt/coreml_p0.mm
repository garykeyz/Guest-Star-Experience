#import <Foundation/Foundation.h>
#import <CoreML/CoreML.h>
#import <Accelerate/Accelerate.h>
#include "coreml_p0.hpp"

@interface GSVFeatures : NSObject <MLFeatureProvider>
@property(nonatomic,strong) MLFeatureValue *featuresValue;
@property(nonatomic,strong) MLFeatureValue *stateValue;
@property(nonatomic,strong) NSSet<NSString *> *featureNames;
@end
@implementation GSVFeatures
- (MLFeatureValue *)featureValueForName:(NSString *)name {
  return [name isEqualToString:@"features"]?self.featuresValue:[name isEqualToString:@"state"]?self.stateValue:nil;
}
@end

namespace gsv {
class CoreMLP0 final : public Estimator {
  __strong MLModel* model_;
  __strong MLMultiArray *features_, *state_;
  __strong MLMultiArray *maskBacking_,*nextBacking_;
  __strong MLPredictionOptions *options_;
  __strong GSVFeatures* provider_;
  vDSP_DFT_Setup forward_=nullptr,inverse_=nullptr;
  std::array<float,128> inL_{},inR_{},zeros_{},reL_{},imL_{},reR_{},imR_{},outRe_{},outIm_{};
  static void ensure(bool condition,const char* message) { if(!condition) throw std::runtime_error(message); }
public:
  CoreMLP0(const std::string& path,const std::string& compute) {
    @autoreleasepool {
      @try {
      NSError* error=nil;
      MLModelConfiguration* config=[[MLModelConfiguration alloc] init];
      if(compute=="cpu") config.computeUnits=MLComputeUnitsCPUOnly;
      else if(compute=="cpu-gpu") config.computeUnits=MLComputeUnitsCPUAndGPU;
      else if(compute=="all") config.computeUnits=MLComputeUnitsAll;
      else throw std::invalid_argument("Unknown Core ML compute units");
      NSURL* url=[NSURL fileURLWithPath:[NSString stringWithUTF8String:path.c_str()]];
      model_=[MLModel modelWithContentsOfURL:url configuration:config error:&error];
      if(!model_) throw std::runtime_error(error.localizedDescription.UTF8String?:"Model load failed");
      auto description=model_.modelDescription;
      ensure(description.inputDescriptionsByName.count==2 && description.outputDescriptionsByName.count==2,"Wrong P0 model signature");
      ensure(description.inputDescriptionsByName[@"features"].multiArrayConstraint.shape.count==1 &&
        [description.inputDescriptionsByName[@"features"].multiArrayConstraint.shape[0] intValue]==65,"Wrong feature shape");
      ensure(description.inputDescriptionsByName[@"state"].multiArrayConstraint.shape.count==1 &&
        [description.inputDescriptionsByName[@"state"].multiArrayConstraint.shape[0] intValue]==16,"Wrong state shape");
      features_=[[MLMultiArray alloc] initWithShape:@[@65] dataType:MLMultiArrayDataTypeFloat32 error:&error];
      state_=[[MLMultiArray alloc] initWithShape:@[@16] dataType:MLMultiArrayDataTypeFloat32 error:&error];
      ensure(features_ && state_,"Cannot allocate input tensors");
      maskBacking_=[[MLMultiArray alloc] initWithShape:@[@65] dataType:MLMultiArrayDataTypeFloat32 error:&error];
      nextBacking_=[[MLMultiArray alloc] initWithShape:@[@16] dataType:MLMultiArrayDataTypeFloat32 error:&error];
      ensure(maskBacking_&&nextBacking_,"Cannot allocate output tensors");
      options_=[MLPredictionOptions new];options_.outputBackings=@{@"mask":maskBacking_,@"next_state":nextBacking_};
      provider_=[[GSVFeatures alloc] init]; provider_.featureNames=[NSSet setWithArray:@[@"features",@"state"]];
      provider_.featuresValue=[MLFeatureValue featureValueWithMultiArray:features_];
      provider_.stateValue=[MLFeatureValue featureValueWithMultiArray:state_];
      forward_=vDSP_DFT_zop_CreateSetup(nullptr,128,vDSP_DFT_FORWARD);
      inverse_=vDSP_DFT_zop_CreateSetup(nullptr,128,vDSP_DFT_INVERSE);
      if(!forward_||!inverse_){
        if(forward_){vDSP_DFT_DestroySetup(forward_);forward_=nullptr;}
        if(inverse_){vDSP_DFT_DestroySetup(inverse_);inverse_=nullptr;}
        throw std::runtime_error("DFT setup failed");
      }
      reset();
      } @catch(__unused NSException* error){
        if(forward_){vDSP_DFT_DestroySetup(forward_);forward_=nullptr;}
        if(inverse_){vDSP_DFT_DestroySetup(inverse_);inverse_=nullptr;}
        throw std::runtime_error("Core ML initialization rejected");
      }
    }
  }
  ~CoreMLP0() override { if(forward_)vDSP_DFT_DestroySetup(forward_); if(inverse_)vDSP_DFT_DestroySetup(inverse_); }
  void reset() override { std::fill_n(static_cast<float*>(state_.dataPointer),16,0.f); }
  bool vocals(const Block& input,Block& output,const Cancellation& cancellation) override {
    @autoreleasepool {
      @try {
      if(input.frames%128) return false;
      for(unsigned offset=0;offset<input.frames;offset+=128) {
        if(cancellation.cancelled()) return false;
        std::copy_n(input.samples.data()+offset,128,inL_.data());
        std::copy_n(input.samples.data()+maxFrames+offset,128,inR_.data());
        vDSP_DFT_Execute(forward_,inL_.data(),zeros_.data(),reL_.data(),imL_.data());
        vDSP_DFT_Execute(forward_,inR_.data(),zeros_.data(),reR_.data(),imR_.data());
        float* feature=static_cast<float*>(features_.dataPointer);
        for(unsigned k=0;k<65;++k) feature[k]=std::log1p(10*(std::hypot(reL_[k],imL_[k])+std::hypot(reR_[k],imR_[k])));
        NSError* error=nil;
        id<MLFeatureProvider> predicted=[model_ predictionFromFeatures:provider_ options:options_ error:&error];
        if(!predicted || cancellation.cancelled()) return false;
        MLMultiArray* mask=[predicted featureValueForName:@"mask"].multiArrayValue;
        MLMultiArray* next=[predicted featureValueForName:@"next_state"].multiArrayValue;
        if(mask.count!=65 || next.count!=16 || mask.dataType!=MLMultiArrayDataTypeFloat32 || next.dataType!=MLMultiArrayDataTypeFloat32) return false;
        const float* maskData=static_cast<float*>(mask.dataPointer);
        const float* stateData=static_cast<float*>(next.dataPointer);
        // Validate outputs before committing persistent recurrent state.
        for(unsigned i=0;i<16;++i) if(!std::isfinite(stateData[i*next.strides[0].unsignedIntValue])) return false;
        for(unsigned k=0;k<65;++k) {
          float m=maskData[k*mask.strides[0].unsignedIntValue];
          if(!std::isfinite(m)||m<0||m>1) return false;
        }
        for(unsigned i=0;i<16;++i) static_cast<float*>(state_.dataPointer)[i]=stateData[i*next.strides[0].unsignedIntValue];
        for(unsigned ch=0;ch<2;++ch) {
          auto& real=ch?reR_:reL_; auto& imag=ch?imR_:imL_;
          for(unsigned k=0;k<128;++k) {float m=maskData[std::min(k,128-k)*mask.strides[0].unsignedIntValue];real[k]*=m;imag[k]*=m;}
          vDSP_DFT_Execute(inverse_,real.data(),imag.data(),outRe_.data(),outIm_.data());
          for(unsigned i=0;i<128;++i) output.samples[ch*maxFrames+offset+i]=outRe_[i]/128;
        }
      }
      return true;
      } @catch(__unused NSException* error){return false;}
    }
  }
};
std::unique_ptr<Estimator> coreMLP0(const std::string& path,const std::string& compute) {
  return std::make_unique<CoreMLP0>(path,compute);
}
}
