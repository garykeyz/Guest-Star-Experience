#include "lyrics_extractor.hpp"
#include "whisper.h"
#include <algorithm>
#include <cmath>
#include <stdexcept>
#include <vector>

namespace gsv {
struct LyricsExtractor::Impl {
  whisper_context* context=nullptr;
  std::string language;
  int threads;
  Impl(const std::string& model,const std::string& lang,int n):language(lang),threads(std::clamp(n,1,4)) {
    if(language!="auto" && whisper_lang_id(language.c_str())<0) throw std::invalid_argument("Unsupported language");
    auto p=whisper_context_default_params();p.use_gpu=false;
    context=whisper_init_from_file_with_params(model.c_str(),p);
    if(!context) throw std::runtime_error("Cannot load local transcription model");
  }
  ~Impl(){if(context)whisper_free(context);}
};
LyricsExtractor::LyricsExtractor(const std::string& model,const std::string& language,int threads)
 :impl_(std::make_unique<Impl>(model,language,threads)){}
LyricsExtractor::~LyricsExtractor()=default;
bool LyricsExtractor::extract(std::istream& pcm,const std::function<void(const LyricSegment&)>& emit,
 const std::function<bool()>& cancelled,const std::function<void(double)>& progress) {
  std::vector<float> samples(16000*30);uint64_t frames=0;
  auto abort=[](void* data)->bool {const auto& fn=*static_cast<const std::function<bool()>*>(data);return fn && fn();};
  while(pcm && !(cancelled&&cancelled())) {
    pcm.read(reinterpret_cast<char*>(samples.data()),samples.size()*sizeof(float));
    auto bytes=pcm.gcount();if(bytes%sizeof(float))throw std::runtime_error("Truncated Float32 PCM");
    int count=int(bytes/sizeof(float));if(!count)break;
    double energy=0;
    for(int i=0;i<count;++i){if(!std::isfinite(samples[i]))throw std::runtime_error("Nonfinite PCM");samples[i]=std::clamp(samples[i],-1.f,1.f);energy+=samples[i]*samples[i];}
    const double base=double(frames)/16000, duration=double(count)/16000;
    // Digital silence never reaches ASR, which may hallucinate on empty audio.
    if(energy/count>1e-8) {
      auto p=whisper_full_default_params(WHISPER_SAMPLING_GREEDY);
      p.n_threads=impl_->threads;p.language=impl_->language.c_str();p.translate=false;
      p.print_realtime=false;p.print_progress=false;p.print_timestamps=false;p.print_special=false;
      p.no_context=true;p.suppress_nst=true;p.abort_callback=abort;p.abort_callback_user_data=const_cast<void*>(static_cast<const void*>(&cancelled));
      int status=whisper_full(impl_->context,p,samples.data(),count);
      if(cancelled&&cancelled())return false;
      if(status)throw std::runtime_error("Local transcription failed");
      int lang=whisper_full_lang_id(impl_->context);
      for(int i=0;i<whisper_full_n_segments(impl_->context);++i) {
        float noSpeech=whisper_full_get_segment_no_speech_prob(impl_->context,i);
        const char* text=whisper_full_get_segment_text(impl_->context,i);
        double start=std::clamp(whisper_full_get_segment_t0(impl_->context,i)*.01,0.,duration);
        double end=std::clamp(whisper_full_get_segment_t1(impl_->context,i)*.01,start,duration);
        if(text && *text && end>start && noSpeech<.6f)
          emit({base+start,base+end,text,whisper_lang_str(lang),noSpeech});
      }
    }
    frames+=count;if(progress)progress(double(frames)/16000);
  }
  return !(cancelled&&cancelled());
}
}
