#include "lyrics_extractor.hpp"
#include <csignal>
#include <iomanip>
#include <iostream>
#include <sstream>
#include <string>

static volatile std::sig_atomic_t stopping=0;
static void stop(int){stopping=1;}
static std::string json(const std::string& s){
  std::ostringstream out;out<<'"';for(unsigned char c:s){switch(c){case '"':out<<"\\\"";break;case '\\':out<<"\\\\";break;case '\n':out<<"\\n";break;case '\r':out<<"\\r";break;case '\t':out<<"\\t";break;default:if(c<32)out<<"\\u"<<std::hex<<std::setw(4)<<std::setfill('0')<<unsigned(c)<<std::dec;else out<<c;}}out<<'"';return out.str();
}
int main(int argc,char** argv){
  if(argc<2||argc>4){std::cerr<<"model [language=auto] [threads=2]; stdin mono16k Float32\n";return 2;}
  std::signal(SIGTERM,stop);std::signal(SIGINT,stop);
  try{
    gsv::LyricsExtractor extractor(argv[1],argc>2?argv[2]:"auto",argc>3?std::stoi(argv[3]):2);
    bool ok=extractor.extract(std::cin,[](const gsv::LyricSegment& s){std::cout<<std::setprecision(9)<<"{\"type\":\"segment\",\"start\":"<<s.start<<",\"end\":"<<s.end<<",\"text\":"<<json(s.text)<<",\"language\":"<<json(s.language)<<",\"noSpeechProbability\":"<<s.noSpeechProbability<<"}\n"<<std::flush;},[]{return stopping!=0;},[](double at){std::cout<<"{\"type\":\"progress\",\"processedSeconds\":"<<at<<"}\n"<<std::flush;});
    std::cout<<"{\"type\":\"done\",\"cancelled\":"<<(ok?"false":"true")<<"}\n";return ok?0:3;
  }catch(const std::exception& e){std::cerr<<e.what()<<'\n';return 1;}
}
