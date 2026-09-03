import { measureCanvasOperations } from '../../spikes/annotation/CanvasSpike';

declare global {
  interface Window {
    runSpi10Benchmark: () => unknown;
  }
}

window.runSpi10Benchmark = () => {
  const container = document.querySelector<HTMLDivElement>('#benchmark');
  if (container === null) throw new Error('benchmark container not found');
  measureCanvasOperations(container, 20);
  return measureCanvasOperations(container, 100);
};
