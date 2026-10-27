// Batch forced decoding of an existing text followed by acoustic cross-attention
// DTW from whisper.cpp. No new transcription; timestamps remain estimates.
#include "whisper.h"
#include <algorithm>
#include <cmath>
#include <fstream>
#include <iostream>
#include <iterator>
#include <limits>
#include <sstream>
#include <vector>
struct Forced {std::vector<whisper_token> tokens;};
static void force(whisper_context* ctx,whisper_state*,const whisper_token_data*,int count,float* logits,void* data){
 auto& words=static_cast<Forced*>(data)->tokens;
 auto next=count<int(words.size())?words[count]:whisper_token_eot(ctx);
 std::fill_n(logits,whisper_n_vocab(ctx),-std::numeric_limits<float>::infinity());logits[next]=0;
}
static std::string quote(const std::string& s){std::string r="\"";for(unsigned char c:s){if(c=='"'||c=='\\'){r+='\\';r+=c;}else if(c>=32)r+=c;else r+=' ';}return r+'"';}
int main(int argc,char** argv){
 if(argc!=4){std::cerr<<"model text-file language; stdin <=30s mono16kFloat32\n";return 2;}
 std::ifstream file(argv[2]);std::string text((std::istreambuf_iterator<char>(file)),{});
 if(!file||text.empty()||text.size()>10000)return 2;
 std::vector<float> samples(16000*30+1);std::cin.read(reinterpret_cast<char*>(samples.data()),samples.size()*4);int n=int(std::cin.gcount()/4);
 if(!n||n>16000*30)return 2;for(int i=0;i<n;i++)if(!std::isfinite(samples[i]))return 2;
 auto cp=whisper_context_default_params();cp.use_gpu=false;cp.flash_attn=false;cp.dtw_token_timestamps=true;cp.dtw_aheads_preset=WHISPER_AHEADS_TINY;cp.dtw_mem_size=128*1024*1024;
 auto ctx=whisper_init_from_file_with_params(argv[1],cp);if(!ctx)return 1;
 Forced wanted;wanted.tokens.resize(448);int count=whisper_tokenize(ctx,text.c_str(),wanted.tokens.data(),448);
 if(count<1||count>400){whisper_free(ctx);return 2;}wanted.tokens.resize(count);
 auto p=whisper_full_default_params(WHISPER_SAMPLING_GREEDY);p.n_threads=2;p.language=argv[3];p.no_context=true;p.no_timestamps=true;p.single_segment=true;p.token_timestamps=false;p.suppress_blank=false;p.suppress_nst=false;
 p.print_realtime=false;p.print_progress=false;p.print_timestamps=false;p.temperature=0;p.temperature_inc=0;p.max_tokens=count+1;p.logits_filter_callback=force;p.logits_filter_callback_user_data=&wanted;
 int result=whisper_full(ctx,p,samples.data(),n);
 if(result){whisper_free(ctx);return 1;}
 struct Word{std::string text;double start;};std::vector<Word> words;int matched=0;
 for(int seg=0;seg<whisper_full_n_segments(ctx);seg++)for(int at=0;at<whisper_full_n_tokens(ctx,seg);at++){
  auto token=whisper_full_get_token_data(ctx,seg,at);if(token.id>=whisper_token_eot(ctx))continue;
  if(matched>=count||token.id!=wanted.tokens[matched++]){whisper_free(ctx);return 1;}
  std::string part=whisper_full_get_token_text(ctx,seg,at);double start=std::clamp(token.t_dtw*.01,0.,double(n)/16000);
  bool newWord=!part.empty()&&part.front()==' ';if(newWord||words.empty()){auto begin=part.find_first_not_of(' ');if(begin!=std::string::npos)words.push_back({part.substr(begin),start});}else words.back().text+=part;
 }
 if(matched!=count||words.empty()){whisper_free(ctx);return 1;}
 std::cout<<"{\"method\":\"forced-text-cross-attention-dtw\",\"estimated\":true,\"words\":[";
 bool first=true;double previous=0;
 for(size_t i=0;i<words.size();i++){double start=std::max(previous,words[i].start);double end=i+1<words.size()?std::max(start,words[i+1].start):double(n)/16000;previous=start;
  if(end<=start)continue;if(!first)std::cout<<',';first=false;std::cout<<"{\"text\":"<<quote(words[i].text)<<",\"start\":"<<start<<",\"end\":"<<end<<'}';}
 std::cout<<"]}\n";whisper_free(ctx);return first?1:0;
}
