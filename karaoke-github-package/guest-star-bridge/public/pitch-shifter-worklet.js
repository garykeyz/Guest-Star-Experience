class GuestStarPitchShifter extends AudioWorkletProcessor {
  static get parameterDescriptors() { return [{ name: 'ratio', defaultValue: 1, minValue: 0.7, maxValue: 1.42, automationRate: 'k-rate' }]; }
  constructor() { super(); this.size = 4096; this.delay = 1024; this.write = 0; this.phase = 0; this.buffers = []; }
  sample(buffer, position) { const base = Math.floor(position); const fraction = position - base; const a = buffer[(base + this.size) % this.size] || 0; const b = buffer[(base + 1 + this.size) % this.size] || 0; return a + (b - a) * fraction; }
  process(inputs, outputs, parameters) {
    const input = inputs[0]; const output = outputs[0];
    if (!input?.length || !output?.length) return true;
    const ratio = parameters.ratio[0] || 1;
    while (this.buffers.length < output.length) this.buffers.push(new Float32Array(this.size));
    for (let frame = 0; frame < output[0].length; frame += 1) {
      const phase = this.phase; const other = (phase + 0.5) % 1;
      const gainA = 0.5 - 0.5 * Math.cos(2 * Math.PI * phase); const gainB = 0.5 - 0.5 * Math.cos(2 * Math.PI * other);
      const readA = this.write - this.delay + phase * this.delay * (ratio - 1); const readB = this.write - this.delay + other * this.delay * (ratio - 1);
      for (let channel = 0; channel < output.length; channel += 1) { const source = input[Math.min(channel, input.length - 1)]; const ring = this.buffers[channel]; ring[this.write] = source?.[frame] || 0; output[channel][frame] = this.sample(ring, readA) * gainA + this.sample(ring, readB) * gainB; }
      this.write = (this.write + 1) % this.size; this.phase = (phase + 1 / this.delay) % 1;
    }
    return true;
  }
}
registerProcessor('guest-star-pitch-shifter', GuestStarPitchShifter);
