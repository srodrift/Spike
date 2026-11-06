import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Filler,
  Tooltip,
} from 'chart.js';
import { Line } from 'react-chartjs-2';
import { LEVEL_STYLE, type Level } from '@/lib/spike';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Filler, Tooltip);

const PEAK: Record<Level, number> = { Low: 0.36, Medium: 0.62, High: 0.9 };
const MINUTES = Array.from({ length: 25 }, (_, i) => i * 5);

function curve(height: number, peakAt: number): number[] {
  return MINUTES.map((t) => {
    if (t === 0) return 0.08;
    const x = t / peakAt;
    return 0.08 + (height - 0.08) * x * Math.exp(1 - x) * (t > peakAt ? 1 : 1);
  });
}

export function CurveChart({
  original,
  adjusted,
  fixCount,
  delayed,
}: {
  original: Level;
  adjusted: Level | null;
  fixCount: number;
  delayed: boolean;
}) {
  const o = LEVEL_STYLE[original];
  // Overlay is capped at one category step; extra fixes only soften shape slightly.
  const overlayHeight = adjusted
    ? Math.max(0.2, PEAK[adjusted] * (1 - 0.04 * Math.min(2, fixCount - 1)) - (original === 'Low' ? 0.06 : 0))
    : 0;
  const datasets = [
    {
      label: 'Original',
      data: curve(PEAK[original], 38),
      borderColor: o.color,
      backgroundColor: o.soft + '',
      fill: true,
      tension: 0.42,
      borderWidth: 3,
      pointRadius: 0,
    },
  ];
  if (adjusted) {
    datasets.push({
      label: 'With fixes',
      data: curve(overlayHeight, delayed ? 50 : 42),
      borderColor: LEVEL_STYLE[adjusted].color,
      backgroundColor: 'transparent',
      fill: false,
      tension: 0.42,
      borderWidth: 3,
      pointRadius: 0,
    });
  }
  return (
    <div className="h-56 w-full" data-testid="chart-curve">
      <Line
        data={{ labels: MINUTES.map((m) => (m % 30 === 0 ? `${m}m` : '')), datasets }}
        options={{
          responsive: true,
          maintainAspectRatio: false,
          animation: { duration: 900, easing: 'easeOutCubic' },
          plugins: { legend: { display: false }, tooltip: { enabled: false } },
          scales: {
            x: {
              grid: { display: false },
              border: { display: false },
              ticks: { color: 'hsl(292 10% 42%)', font: { family: 'Spline Sans Mono', size: 10 }, autoSkip: false, maxRotation: 0 },
            },
            y: {
              min: 0,
              max: 1,
              border: { display: false },
              grid: { color: 'hsla(32, 30%, 70%, 0.25)' },
              ticks: {
                stepSize: 0.33,
                color: 'hsl(292 10% 42%)',
                font: { family: 'Spline Sans Mono', size: 10 },
                callback: (v) => {
                  const n = Number(v);
                  if (n < 0.1) return 'baseline';
                  if (n < 0.4) return 'gentle';
                  if (n < 0.7) return 'moderate';
                  return 'sharp';
                },
              },
            },
          },
        }}
      />
    </div>
  );
}
