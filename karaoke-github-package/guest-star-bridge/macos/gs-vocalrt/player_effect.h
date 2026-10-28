#import <AVFoundation/AVFoundation.h>
#ifdef __cplusplus
extern "C" {
#endif
// Selected at deck boundaries; releases the own model/worker when unselected.
AVAudioUnit *GSVCreatePlayerEffect(void);
void GSVPlayerEffectSelected(AVAudioUnit *unit, BOOL selected);
void GSVPlayerEffectBoundary(AVAudioUnit *unit);
void GSVPlayerEffectPlaying(AVAudioUnit *unit, BOOL playing);
void GSVPlayerEffectEnabled(AVAudioUnit *unit, BOOL enabled);
void GSVPlayerEffectGain(AVAudioUnit *unit, float gain);
void GSVPlayerEffectPressure(AVAudioUnit *unit, BOOL pressure);
NSDictionary *GSVPlayerEffectDiagnostics(AVAudioUnit *unit);
#ifdef __cplusplus
}
#endif
