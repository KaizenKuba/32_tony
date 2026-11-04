// Wykrywanie BPM i pierwszej „jedynki”: obwiednia onsetów + autokorelacja.
export function analyzeBeat(buffer) {
  const sr = buffer.sampleRate;
  const n = Math.min(buffer.length, Math.floor(sr * 90));
  const mono = new Float32Array(n);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const d = buffer.getChannelData(c);
    for (let i = 0; i < n; i++) mono[i] += d[i] / buffer.numberOfChannels;
  }
  const hop = 512, win = 1024;
  const frames = Math.max(0, Math.floor((n - win) / hop));
  if (frames < 16) return { bpm: 90, firstBeat: 0 };
  const energy = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let e = 0;
    const o = f * hop;
    for (let k = 0; k < win; k++) { const v = mono[o + k]; e += v * v; }
    energy[f] = Math.log(1 + 1000 * e);
  }
  const onset = new Float32Array(frames);
  let mean = 0;
  for (let f = 1; f < frames; f++) { onset[f] = Math.max(0, energy[f] - energy[f - 1]); mean += onset[f]; }
  mean /= frames;
  for (let f = 0; f < frames; f++) onset[f] -= mean;

  const fps = sr / hop;
  const lagFor = b => Math.round((60 / b) * fps);
  const ac = l => {
    if (l <= 0 || l >= frames) return 0;
    let s = 0;
    for (let i = 0; i + l < frames; i++) s += onset[i] * onset[i + l];
    return s / (frames - l);
  };
  let bestLag = lagFor(90), best = -Infinity;
  for (let l = lagFor(180); l <= lagFor(60) && l < frames; l++) {
    const b = 60 * fps / l;
    const w = Math.exp(-Math.pow(Math.log2(b / 95), 2) / (2 * 0.6 * 0.6)); // preferencja ~95 BPM
    const s = ac(l) * w;
    if (s > best) { best = s; bestLag = l; }
  }
  const y0 = ac(bestLag - 1), y1 = ac(bestLag), y2 = ac(bestLag + 1);
  const den = y0 - 2 * y1 + y2;
  const delta = den !== 0 ? Math.max(-0.5, Math.min(0.5, 0.5 * (y0 - y2) / den)) : 0;
  const lag = bestLag + delta;
  let bpm = Math.round(600 * fps / lag) / 10;
  if (Math.abs(bpm - Math.round(bpm)) < 0.35) bpm = Math.round(bpm); // bity zwykle mają całe BPM

  // faza siatki beatów z największą sumą onsetów
  let bestPh = 0, bestPhS = -Infinity;
  for (let ph = 0; ph < Math.floor(lag); ph++) {
    let s = 0;
    for (let k = ph; k < frames; k += lag) s += onset[Math.floor(k)];
    if (s > bestPhS) { bestPhS = s; bestPh = ph; }
  }
  return { bpm, firstBeat: bestPh * hop / sr };
}

// Obwiednia szczytowa (rate próbek/s) fragmentu bufora.
export function envelope(buffer, start, duration, rate = 1000) {
  const sr = buffer.sampleRate;
  const s0 = Math.max(0, Math.floor(start * sr));
  const s1 = Math.min(buffer.length, Math.floor((start + duration) * sr));
  const per = Math.max(1, Math.floor(sr / rate));
  const out = [];
  const chans = [];
  for (let c = 0; c < buffer.numberOfChannels; c++) chans.push(buffer.getChannelData(c));
  for (let i = s0; i < s1; i += per) {
    let m = 0;
    const e = Math.min(s1, i + per);
    for (const d of chans) for (let k = i; k < e; k++) { const v = Math.abs(d[k]); if (v > m) m = v; }
    out.push(m);
  }
  return out;
}

// Szuka przesunięcia (ms, 0–500), przy którym onsety nagrania pokrywają się z bitem.
export function autoLatency(beatEnv, takeEnv) {
  const on = x => x.map((v, i) => (i ? Math.max(0, v - x[i - 1]) : 0));
  const a = on(beatEnv), b = on(takeEnv);
  let best = 0, bestS = -1;
  for (let lag = 0; lag <= 500; lag++) {
    const n = Math.min(a.length, b.length - lag);
    if (n <= 0) break;
    let s = 0;
    for (let i = 0; i < n; i++) s += a[i] * b[i + lag];
    if (s > bestS) { bestS = s; best = lag; }
  }
  return best;
}
