const DEFAULT_ASSETS = {
  idle: ['/assets/master_idle.mp4'],
  listen: ['/assets/master_listen.mp4'],
  think: ['/assets/master_think.mp4', '/assets/master_think2.mp4'],
  speak_normal: ['/assets/master_speak2.mp4', '/assets/master_speak.mov', '/assets/master_speak.mp4'],
  speak_empathy: ['/assets/master_listen.mp4'],
};

export class AvatarManager {
  constructor(container, { assets = {}, fadeMs = 300, loadTimeoutMs = 10000 } = {}) {
    this.container = container;
    this.videos = [...container.querySelectorAll('video')];
    if (this.videos.length !== 2) throw new Error('AvatarManager requires exactly two videos');
    this.assets = { ...DEFAULT_ASSETS, ...assets };
    this.fadeMs = fadeMs;
    this.loadTimeoutMs = loadTimeoutMs;
    this.currentState = null;
    this.desiredState = 'idle';
    this.active = this.videos[0];
    this.disposed = false;
    this.running = null;
    container.style.setProperty('--avatar-fade', `${fadeMs}ms`);
    this.videos.forEach(video => {
      video.muted = true;
      video.playsInline = true;
      video.loop = true;
      video.preload = 'auto';
    });
    this.ready = this.changeState('idle');
  }

  changeState(state) {
    if (state === 'speak') state = 'speak_normal';
    if (!this.assets[state]) return Promise.reject(new Error(`Unknown avatar state: ${state}`));
    if (this.disposed) return Promise.resolve();
    this.desiredState = state;
    if (!this.running) {
      this.running = this.drain().finally(() => { this.running = null; });
    }
    return this.running;
  }

  async prepare(video, src) {
    // Install listeners before load(), including for cached files.
    const loaded = new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        video.removeEventListener('loadeddata', success);
        video.removeEventListener('error', failure);
      };
      const success = () => { cleanup(); resolve(); };
      const failure = () => { cleanup(); reject(new Error(`Cannot load ${src}`)); };
      const timer = setTimeout(failure, this.loadTimeoutMs);
      video.addEventListener('loadeddata', success, { once: true });
      video.addEventListener('error', failure, { once: true });
      video.src = src;
      video.load();
    });
    await loaded;
    let playTimer;
    try {
      await Promise.race([
        video.play(),
        new Promise((_, reject) => {
          playTimer = setTimeout(() => reject(new Error('Video playback timed out')), this.loadTimeoutMs);
        }),
      ]);
    } finally { clearTimeout(playTimer); }
    // A decoded frame must be available before opacity changes.
    await new Promise(resolve => {
      let frame;
      const finish = () => {
        clearTimeout(timer);
        if (frame !== undefined) video.cancelVideoFrameCallback(frame);
        resolve();
      };
      const timer = setTimeout(finish, 250);
      if (video.requestVideoFrameCallback) frame = video.requestVideoFrameCallback(finish);
    });
  }

  async drain() {
    while (!this.disposed && this.currentState !== this.desiredState) {
      const target = this.desiredState;
      const next = this.videos.find(video => video !== this.active);
      const sources = [].concat(this.assets[target]);
      let loaded = false;
      let error;
      for (const src of sources) {
        try { await this.prepare(next, src); loaded = true; break; }
        catch (cause) { error = cause; next.pause(); }
        if (this.disposed || target !== this.desiredState) break;
      }
      if (this.disposed) { next.pause(); return; }
      if (target !== this.desiredState) { next.pause(); continue; }
      if (!loaded) {
        this.container.dispatchEvent(new CustomEvent('avatarerror', { detail: { state: target, error } }));
        return; // Keep the previous video visible; changeState() can retry.
      }
      const previous = this.active;
      next.classList.add('active');
      previous.classList.remove('active');
      this.active = next;
      this.currentState = target;
      this.container.dataset.state = target;
      this.container.dispatchEvent(new CustomEvent('avatarchange', { detail: { state: target } }));
      // Never reuse the outgoing buffer until the fade has finished.
      await new Promise(resolve => setTimeout(resolve, this.fadeMs));
      previous.pause();
    }
  }

  analyzeSentiment(text, emotion) {
    if (emotion) return ['empathy', 'empathetic'].includes(emotion) ? 'speak_empathy' : 'speak_normal';
    return ['大変でしたね', 'お気持ち', '辛い', '寄り添い', '共感', 'ゆっくり']
      .some(word => text.includes(word)) ? 'speak_empathy' : 'speak_normal';
  }

  destroy() {
    this.disposed = true;
    this.videos.forEach(video => video.pause());
  }
}

export async function typeWriterEffect(element, text, { signal, intervalMs = 50 } = {}) {
  element.textContent = '';
  for (const character of text) {
    signal?.throwIfAborted();
    element.append(document.createTextNode(character));
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
  signal?.throwIfAborted();
}

/** fetchReply(message, { signal }) returns text or { text, emotion }. */
export function createConversationController({ avatar, fetchReply, renderReply }) {
  let current;
  return {
    async submit(message) {
      if (!message.trim()) return;
      current?.abort();
      const controller = new AbortController();
      current = controller;
      const { signal } = controller;
      try {
        await avatar.changeState('listen');
        signal.throwIfAborted();
        // No delayed timer: thinking starts with the actual API request.
        void avatar.changeState('think');
        const response = await fetchReply(message, { signal });
        signal.throwIfAborted();
        const text = typeof response === 'string' ? response : response.text;
        if (typeof text !== 'string') throw new Error('AI response must contain text');
        await avatar.changeState(avatar.analyzeSentiment(text, response.emotion));
        signal.throwIfAborted();
        await renderReply(text, { signal });
      } catch (error) {
        if (!signal.aborted) throw error;
      } finally {
        if (current === controller) {
          current = null;
          await avatar.changeState('idle');
        }
      }
    },
    cancel() {
      current?.abort();
      current = null;
      return avatar.changeState('idle');
    },
  };
}
