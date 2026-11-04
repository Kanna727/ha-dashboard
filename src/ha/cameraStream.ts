import Hls from 'hls.js/light';
import type { Connection } from 'home-assistant-js-websocket';

export type CameraState = 'playing' | 'failed';

// A camera that doesn't connect in this time gets the next way of playing it.
const WEBRTC_TIMEOUT_MS = 12_000;
const HLS_TIMEOUT_MS = 30_000; // HA starts the stream and fills a segment first
const STALL_SECONDS = 10; // the picture hasn't moved for this long: say so, don't show it as live
const HLS_TYPE = 'application/vnd.apple.mpegurl';

const noop = () => undefined;

type Signal =
  | { type: 'session'; session_id: string }
  | { type: 'answer'; answer: string }
  | { type: 'candidate'; candidate: RTCIceCandidateInit }
  | { type: 'error'; code: string; message: string };

interface Way {
  conn: Connection;
  entityId: string;
  video: HTMLVideoElement;
  baseUrl: string;
  addCleanup: (fn: () => void) => void;
  lost: () => void; // the stream died after it had started
}

// Resolves when the video shows its first frame.
function firstFrame(video: HTMLVideoElement, ms: number, addCleanup: Way['addCleanup']): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = () => reject(new Error('video error'));
    const onPlaying = () => resolve();
    const timer = window.setTimeout(() => reject(new Error('timed out')), ms);
    video.addEventListener('playing', onPlaying, { once: true });
    video.addEventListener('error', onError, { once: true });
    addCleanup(() => {
      window.clearTimeout(timer);
      video.removeEventListener('playing', onPlaying);
      video.removeEventListener('error', onError);
    });
  });
}

// WebRTC through HA (go2rtc): the live view, under a second behind. The same
// exchange as HA's own player: HA's WebSocket carries the offer, the answer and
// the candidates; the video itself comes straight from HA to this device.
async function playWebRtc({ conn, entityId, video, addCleanup, lost }: Way): Promise<void> {
  const client = await conn.sendMessagePromise<{ configuration?: RTCConfiguration; dataChannel?: string }>({
    type: 'camera/webrtc/get_client_config',
    entity_id: entityId,
  });
  const pc = new RTCPeerConnection(client.configuration);
  addCleanup(() => pc.close());
  if (client.dataChannel) pc.createDataChannel(client.dataChannel); // some cameras need one
  pc.addTransceiver('audio', { direction: 'recvonly' });
  pc.addTransceiver('video', { direction: 'recvonly' });

  const remote = new MediaStream();
  pc.ontrack = (e) => {
    remote.addTrack(e.track);
    video.srcObject = remote;
    void video.play().catch(noop);
  };

  // Candidates can turn up before the session they belong to, and before the answer.
  let session: string | undefined;
  const early: RTCIceCandidateInit[] = [];
  const sendCandidate = (candidate: RTCIceCandidateInit) =>
    conn.sendMessagePromise({ type: 'camera/webrtc/candidate', entity_id: entityId, session_id: session, candidate }).catch(noop);
  pc.onicecandidate = (e) => {
    if (!e.candidate) return;
    if (session) void sendCandidate(e.candidate.toJSON());
    else early.push(e.candidate.toJSON());
  };

  let started = false;
  let answered = noop as () => void;
  const hasAnswer = new Promise<void>((r) => (answered = r));
  const failed = new Promise<never>((_, reject) => {
    const fail = (why: string) => (started ? lost() : reject(new Error(why)));
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') fail('connection failed');
    };
    void pc
      .createOffer()
      .then((offer) => pc.setLocalDescription(offer).then(() => offer))
      .then((offer) =>
        conn.subscribeMessage<Signal>(
          (m) => {
            if (m.type === 'session') {
              session = m.session_id;
              early.splice(0).forEach((c) => void sendCandidate(c));
            } else if (m.type === 'answer') {
              pc.setRemoteDescription({ type: 'answer', sdp: m.answer }).then(answered, () => fail('bad answer'));
            } else if (m.type === 'candidate') {
              void hasAnswer.then(() => pc.addIceCandidate(m.candidate)).catch(noop);
            } else if (m.type === 'error') {
              fail(m.message);
            }
          },
          { type: 'camera/webrtc/offer', entity_id: entityId, offer: offer.sdp },
          { resubscribe: false }, // an offer can't be replayed after a reconnect
        ),
      )
      .then(
        (unsub) => addCleanup(() => void unsub().catch(noop)),
        (e: unknown) => fail(String(e)),
      );
  });

  await Promise.race([firstFrame(video, WEBRTC_TIMEOUT_MS, addCleanup), failed]);
  started = true;
}

// HA's HLS stream, the fallback: seconds behind and slow to start, but it needs no
// direct route to HA, so it works where WebRTC can't connect (a phone away from
// home). Through hls.js, like HA's own player: Chrome's built-in HLS froze on HA's
// stream. Not hls.js's low-latency mode: it asks for one-second parts, and stops
// getting video on a slow link or from a camera whose timestamps are off (HA then
// drops the idle stream). iPhones have no MediaSource for it and play HLS themselves.
async function playHls({ conn, entityId, video, baseUrl, addCleanup, lost }: Way): Promise<void> {
  const { url } = await conn.sendMessagePromise<{ url: string }>({ type: 'camera/stream', entity_id: entityId });
  const src = new URL(url, baseUrl).href;
  let started = false;
  const failed = new Promise<never>((_, reject) => {
    if (!Hls.isSupported()) {
      video.src = src;
      return;
    }
    const hls = new Hls({ lowLatencyMode: false, backBufferLength: 30 });
    addCleanup(() => hls.destroy());
    hls.on(Hls.Events.ERROR, (_e, data) => {
      if (!data.fatal) return;
      if (data.type === Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
      else if (started) lost();
      else reject(new Error(data.details));
    });
    hls.loadSource(src);
    hls.attachMedia(video);
  });
  void video.play().catch(noop);
  await Promise.race([firstFrame(video, HLS_TIMEOUT_MS, addCleanup), failed]);
  started = true;

  let last = -1;
  let still = 0;
  const watch = window.setInterval(() => {
    still = video.currentTime === last ? still + 1 : 0;
    last = video.currentTime;
    if (still < STALL_SECONDS) return;
    window.clearInterval(watch);
    lost();
  }, 1000);
  addCleanup(() => window.clearInterval(watch));
}

// Plays the camera in `video`, which must be muted so it may start by itself.
// Returns a function that stops it.
export function playCamera(
  connection: Promise<Connection>,
  baseUrl: string,
  entityId: string,
  video: HTMLVideoElement,
  onState: (s: CameraState) => void,
): () => void {
  let stopped = false;
  let cleanups: (() => void)[] = [];
  const cleanUp = () => {
    cleanups.forEach((fn) => fn());
    cleanups = [];
    video.srcObject = null;
    video.removeAttribute('src');
    video.load();
  };
  const report = (s: CameraState) => !stopped && onState(s);

  void (async () => {
    try {
      const conn = await connection;
      const { frontend_stream_types: types = [] } = await conn.sendMessagePromise<{ frontend_stream_types?: string[] }>({
        type: 'camera/capabilities',
        entity_id: entityId,
      });
      const ways = [
        ...(types.includes('web_rtc') && typeof RTCPeerConnection !== 'undefined' ? [playWebRtc] : []),
        ...(types.includes('hls') && (Hls.isSupported() || video.canPlayType(HLS_TYPE)) ? [playHls] : []),
      ];
      for (const play of ways) {
        if (stopped) return;
        const way: Way = {
          conn,
          entityId,
          video,
          baseUrl,
          addCleanup: (fn) => (stopped ? fn() : cleanups.push(fn)),
          lost: () => report('failed'),
        };
        try {
          await play(way);
          report('playing');
          return;
        } catch (e) {
          console.warn(`Camera: ${play === playWebRtc ? 'WebRTC' : 'HLS'} didn't start`, e);
          cleanUp();
        }
      }
    } catch (e) {
      console.warn('Camera: no stream', e);
    }
    report('failed');
  })();

  return () => {
    stopped = true;
    cleanUp();
  };
}
