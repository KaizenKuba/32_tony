// Silnik audio na Web Audio API: bit (long / pętla), ścieżki wokalu, nagrywanie z mikrofonu.

const WORKLET = `
class RecProc extends AudioWorkletProcessor {
  constructor() {
    super();
    this.on = false; this.buf = new Float32Array(4096); this.n = 0; this.startFrame = 0;
    this.port.onmessage = e => {
      if (e.data === 'start') { this.on = true; this.n = 0; }
      if (e.data === 'stop') { this.flush(); this.on = false; this.port.postMessage({ done: true }); }
    };
  }
  flush() {
    if (this.n > 0) {
      this.port.postMessage({ frame: this.startFrame, data: this.buf.slice(0, this.n) });
      this.n = 0;
    }
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (this.on && ch) {
      for (let i = 0; i < ch.length; i++) {
        if (this.n === 0) this.startFrame = currentFrame + i;
        this.buf[this.n++] = ch[i];
        if (this.n === this.buf.length) this.flush();
      }
    }
    return true;
  }
}
registerProcessor('rec-proc', RecProc);
`;

export class Engine {
  constructor() {
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC({ latencyHint: 'playback' });
    this.master = this.ctx.createGain();
    this.master.connect(this.ctx.destination);
    this.sources = [];
    this.playing = false;
    this.recording = false;
    this.playStartCtx = 0;   // ctx.currentTime startu
    this.playStartPos = 0;   // pozycja w bicie (s) przy starcie
    this.loop = null;        // [ls, le]
    this.stopAt = null;
    this.stream = null;
    this.workletReady = null;
    this.onStateChange = () => {};
    this.setSession('playback');
  }

  /** Musi być wywołane w obsłudze kliknięcia (iOS). */
  async unlock() {
    if (this.ctx.state !== 'running') await this.ctx.resume();
  }

  setSession(type) {
    try { if (navigator.audioSession) navigator.audioSession.type = type; } catch (_) {}
  }

  get position() {
    if (!this.playing) return this.lastPosition || 0;
    const el = Math.max(0, this.ctx.currentTime - this.playStartCtx);
    if (this.loop) {
      const [ls, le] = this.loop;
      return ls + (el % (le - ls));
    }
    return this.playStartPos + el;
  }

  async decode(blob) {
    const ab = await blob.arrayBuffer();
    return await new Promise((res, rej) => this.ctx.decodeAudioData(ab, res, rej));
  }

  // ---------- odtwarzanie ----------

  /**
   * @param beat AudioBuffer bitu
   * @param pos  start (s)
   * @param loop [ls, le] albo null
   * @param takes [{buffer, position, volume}] – position już po korekcie latencji
   * @param stopAt (s) – automatyczne zatrzymanie (tylko long)
   */
  play({ beat, pos, loop = null, takes = [], stopAt = null }) {
    this.stopSources();
    if (!beat) return;
    const when = this.ctx.currentTime + 0.06;
    const dur = beat.duration;
    if (loop) {
      loop = [Math.max(0, loop[0]), Math.min(dur, loop[1])];
      if (loop[1] - loop[0] < 0.05) loop = null;
    }
    if (loop) {
      const [ls, le] = loop;
      const src = this.ctx.createBufferSource();
      src.buffer = beat; src.loop = true; src.loopStart = ls; src.loopEnd = le;
      src.connect(this.master);
      src.start(when, ls);
      this.sources.push(src);
      for (const t of takes) {
        const slice = this.loopSlice(t, ls, le);
        if (!slice) continue;
        const s = this.ctx.createBufferSource();
        s.buffer = slice; s.loop = true;
        s.connect(this.gainFor(t.volume));
        s.start(when);
        this.sources.push(s);
      }
      this.playStartPos = ls;
    } else {
      if (pos >= dur) return;
      const src = this.ctx.createBufferSource();
      src.buffer = beat;
      src.connect(this.master);
      src.start(when, Math.max(0, pos));
      this.sources.push(src);
      for (const t of takes) {
        const end = t.position + t.buffer.duration;
        if (end <= pos) continue;
        const s = this.ctx.createBufferSource();
        s.buffer = t.buffer;
        s.connect(this.gainFor(t.volume));
        if (t.position >= pos) s.start(when + (t.position - pos));
        else s.start(when, pos - t.position);
        this.sources.push(s);
      }
      this.playStartPos = pos;
    }
    this.playStartCtx = when;
    this.loop = loop;
    this.stopAt = stopAt != null ? stopAt : (loop ? null : dur);
    this.playing = true;
    this.onStateChange();
    this.watch();
  }

  gainFor(v) {
    const g = this.ctx.createGain();
    g.gain.value = v == null ? 1 : v;
    g.connect(this.master);
    this.sources.push(g);
    return g;
  }

  /** Fragment nagrania w oknie pętli, wklejony w bufor długości pętli. */
  loopSlice(t, ls, le) {
    const b = t.buffer, sr = b.sampleRate;
    const a0 = Math.max(ls, t.position), a1 = Math.min(le, t.position + b.duration);
    if (a1 <= a0) return null;
    const out = this.ctx.createBuffer(b.numberOfChannels, Math.max(1, Math.round((le - ls) * sr)), sr);
    const from = Math.round((a0 - t.position) * sr);
    const to = Math.round((a0 - ls) * sr);
    const len = Math.round((a1 - a0) * sr);
    for (let c = 0; c < b.numberOfChannels; c++) {
      const src = b.getChannelData(c).subarray(from, from + len);
      const dst = out.getChannelData(c);
      dst.set(src.subarray(0, Math.max(0, Math.min(src.length, dst.length - to))), to);
    }
    return out;
  }

  watch() {
    cancelAnimationFrame(this.raf);
    const tick = () => {
      if (!this.playing) return;
      if (this.stopAt != null && this.position >= this.stopAt) { this.stop(); return; }
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  stopSources() {
    for (const s of this.sources) {
      try { if (s.stop) s.stop(); } catch (_) {}
      try { s.disconnect(); } catch (_) {}
    }
    this.sources = [];
  }

  stop() {
    if (this.playing) this.lastPosition = this.position;
    this.stopSources();
    this.playing = false;
    this.loop = null;
    cancelAnimationFrame(this.raf);
    if (this.recording) this.finishRecording();
    this.onStateChange();
  }

  // ---------- mikrofon i nagrywanie ----------

  async listInputs() {
    try {
      const devs = await navigator.mediaDevices.enumerateDevices();
      return devs.filter(d => d.kind === 'audioinput');
    } catch (_) { return []; }
  }

  async openMic(deviceId) {
    this.setSession('play-and-record');
    const audio = {
      echoCancellation: false, noiseSuppression: false, autoGainControl: false,
      channelCount: 1,
    };
    if (deviceId) audio.deviceId = { exact: deviceId };
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio });
    } catch (e) {
      if (deviceId) { delete audio.deviceId; this.stream = await navigator.mediaDevices.getUserMedia({ audio }); }
      else throw e;
    }
    if (!this.workletReady) {
      const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
      this.workletReady = this.ctx.audioWorklet.addModule(url);
    }
    await this.workletReady;
    this.micSource = this.ctx.createMediaStreamSource(this.stream);
    this.recNode = new AudioWorkletNode(this.ctx, 'rec-proc', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1 });
    this.silent = this.ctx.createGain(); this.silent.gain.value = 0;
    this.micSource.connect(this.recNode); this.recNode.connect(this.silent); this.silent.connect(this.ctx.destination);
    const track = this.stream.getAudioTracks()[0];
    return track ? track.label : '';
  }

  closeMic() {
    try { this.micSource && this.micSource.disconnect(); } catch (_) {}
    try { this.recNode && this.recNode.disconnect(); } catch (_) {}
    try { this.silent && this.silent.disconnect(); } catch (_) {}
    if (this.stream) this.stream.getTracks().forEach(t => t.stop());
    this.stream = null; this.micSource = null; this.recNode = null;
    this.setSession('playback');
  }

  /** Startuje odtwarzanie i nagrywanie. onDone({buffer, blob, startPos}) po stopie. */
  async record({ beat, pos, stopAt, takes, deviceId, onDone }) {
    this.stop();
    await this.openMic(deviceId);
    this.chunks = [];
    this.onRecDone = onDone;
    this.recNode.port.onmessage = e => {
      if (e.data.data) this.chunks.push(e.data);
      if (e.data.done) this.buildTake();
    };
    this.recNode.port.postMessage('start');
    this.recording = true;
    this.play({ beat, pos, takes, stopAt });
  }

  finishRecording() {
    this.recording = false;
    if (this.recNode) this.recNode.port.postMessage('stop'); // odpowiedź „done” -> buildTake
    this.onStateChange();
  }

  buildTake() {
    const chunks = this.chunks || [];
    const sr = this.ctx.sampleRate;
    const total = chunks.reduce((s, c) => s + c.data.length, 0);
    const done = this.onRecDone;
    const playStartCtx = this.playStartCtx, playStartPos = this.playStartPos;
    this.closeMic();
    if (!total || !done) return;
    const buffer = this.ctx.createBuffer(1, total, sr);
    const d = buffer.getChannelData(0);
    let o = 0;
    for (const c of chunks) { d.set(c.data, o); o += c.data.length; }
    const firstTime = chunks[0].frame / sr;
    const startPos = playStartPos + (firstTime - playStartCtx);
    done({ buffer, blob: encodeWav(buffer), startPos });
  }
}

export function encodeWav(buffer) {
  const nc = buffer.numberOfChannels, sr = buffer.sampleRate, len = buffer.length;
  const chans = Array.from({ length: nc }, (_, c) => buffer.getChannelData(c));
  const bytes = len * nc * 2;
  const out = new DataView(new ArrayBuffer(44 + bytes));
  const w = (o, s) => { for (let i = 0; i < s.length; i++) out.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); out.setUint32(4, 36 + bytes, true); w(8, 'WAVE');
  w(12, 'fmt '); out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, nc, true);
  out.setUint32(24, sr, true); out.setUint32(28, sr * nc * 2, true); out.setUint16(32, nc * 2, true); out.setUint16(34, 16, true);
  w(36, 'data'); out.setUint32(40, bytes, true);
  let o = 44;
  for (let i = 0; i < len; i++) for (let c = 0; c < nc; c++) {
    const v = Math.max(-1, Math.min(1, chans[c][i]));
    out.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true); o += 2;
  }
  return new Blob([out], { type: 'audio/wav' });
}
