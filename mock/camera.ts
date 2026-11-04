import type { CameraState } from '../src/ha/cameraStream';

// The mock's camera: a canvas drawing of a doorstep with a running clock, as a
// real MediaStream. ?mockCamera=fail never connects, to see the failed state.
export function mockPlayCamera(video: HTMLVideoElement, onState: (s: CameraState) => void): () => void {
  const canvas = document.createElement('canvas');
  canvas.width = 1280;
  canvas.height = 720;
  const c = canvas.getContext('2d')!;
  const draw = () => {
    const sky = c.createLinearGradient(0, 0, 0, 720);
    sky.addColorStop(0, '#39424f');
    sky.addColorStop(1, '#1b2028');
    c.fillStyle = sky;
    c.fillRect(0, 0, 1280, 720);
    c.fillStyle = '#4a4238'; // the door frame
    c.fillRect(120, 60, 300, 660);
    c.fillStyle = '#2b2520';
    c.fillRect(140, 80, 260, 640);
    c.fillStyle = '#596270'; // the visitor
    c.beginPath();
    c.arc(760 + Math.sin(Date.now() / 900) * 14, 280, 96, 0, Math.PI * 2);
    c.fill();
    c.beginPath();
    c.ellipse(760 + Math.sin(Date.now() / 900) * 14, 640, 190, 280, 0, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#fff';
    c.font = '28px monospace';
    c.fillText(new Date().toLocaleTimeString(), 960, 50);
  };
  draw();
  const frames = window.setInterval(draw, 100);
  const start = window.setTimeout(() => {
    if (new URLSearchParams(window.location.search).get('mockCamera') === 'fail') return onState('failed');
    video.srcObject = canvas.captureStream(10);
    void video.play().catch(() => undefined);
    onState('playing');
  }, 900);
  return () => {
    window.clearInterval(frames);
    window.clearTimeout(start);
    video.srcObject = null;
  };
}
