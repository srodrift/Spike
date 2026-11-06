import {
  Chart as ChartJS,
  LinearScale,
  PointElement,
  LineElement,
  Filler,
  Tooltip,
  type Plugin,
} from 'chart.js';
import { Line } from 'react-chartjs-2';
import { LEVEL_STYLE, type Level } from '@/lib/spike';

ChartJS.register(LinearScale, PointElement, LineElement, Filler, Tooltip);

const PEAK: Record<Level, number> = { Low: 0.36, Medium: 0.62, High: 0.9 };
const MINUTES = Array.from({ length: 25 }, (_, i) => i * 5);

function curve(height: number, peakAt: number): { x: number; y: number }[] {
  return MINUTES.map((t) => {
    if (t === 0) return { x: t, y: 0.08 };
    const x = t / peakAt;
    return { x: t, y: 0.08 + (height - 0.08) * x * Math.exp(1 - x) };
  });
}

const BANDS = [
  { from: 0, to: 1 / 3, label: 'Low', fill: 'hsla(168, 32%, 70%, 0.14)' },
  { from: 1 / 3, to: 2 / 3, label: 'Moderate', fill: 'hsla(46, 92%, 60%, 0.12)' },
  { from: 2 / 3, to: 1, label: 'High', fill: 'hsla(12, 82%, 60%, 0.10)' },
];

const bandsPlugin: Plugin<'line'> = {
  id: 'spikeBands',
  beforeDraw(chart) {
    const { ctx, chartArea, scales } = chart;
    const y = scales.y;
    if (!chartArea || !y) return;
    ctx.save();
    BANDS.forEach((b) => {
      const top = y.getPixelForValue(b.to);
      const bottom = y.getPixelForValue(b.from);
      ctx.fillStyle = b.fill;
      ctx.fillRect(chartArea.left, top, chartArea.right - chartArea.left, bottom - top);
      ctx.fillStyle = 'hsla(292, 10%, 42%, 0.75)';
      ctx.font = '500 9px "Spline Sans Mono", monospace';
      ctx.textBaseline = 'top';
      ctx.fillText(b.label.toUpperCase(), chartArea.left + 6, top + 5);
    });
    ctx.restore();
  },
};

const AXIS_FONT = { family: 'Spline Sans Mono', size: 10 };
const AXIS_COLOR = 'hsl(292 10% 42%)';

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
      label: 'Your meal',
      data: curve(PEAK[original], 38),
      borderColor: o.color,
      backgroundColor: o.soft.replace(')', ' / 0.18)'),
      fill: true,
      tension: 0.42,
      borderWidth: 3,
      pointRadius: 0,
      borderDash: [] as number[],
    },
  ];
  if (adjusted) {
    datasets.push({
      label: 'With suggestion',
      data: curve(overlayHeight, delayed ? 50 : 42),
      borderColor: LEVEL_STYLE[adjusted].color,
      backgroundColor: 'transparent',
      fill: false,
      tension: 0.42,
      borderWidth: 3,
      pointRadius: 0,
      borderDash: [7, 5],
    });
  }
  return (
    <div>
      <p className="text-xs text-muted-foreground mb-2" data-testid="text-chart-caption">
        How sharply this meal may raise your blood sugar.
      </p>
      <div className="h-56 w-full" data-testid="chart-curve">
        <Line
          data={{ datasets }}
          plugins={[bandsPlugin]}
          options={{
            responsive: true,
            maintainAspectRatio: false,
            animation: { duration: 900, easing: 'easeOutCubic' },
            plugins: { legend: { display: false }, tooltip: { enabled: false } },
            scales: {
              x: {
                type: 'linear',
                min: 0,
                max: 120,
                grid: { display: false },
                border: { display: false },
                title: { display: true, text: 'min after eating', color: AXIS_COLOR, font: AXIS_FONT },
                ticks: { stepSize: 30, color: AXIS_COLOR, font: AXIS_FONT, maxRotation: 0 },
              },
              y: {
                min: 0,
                max: 1,
                border: { display: false },
                grid: { display: false },
                title: { display: true, text: 'Blood sugar rise', color: AXIS_COLOR, font: AXIS_FONT },
                ticks: { display: false },
              },
            },
          }}
        />
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs" data-testid="legend-curve">
        <span className="flex items-center gap-1.5">
          <i className="w-5 h-[3px] rounded-full" style={{ background: o.color }} /> Your meal
        </span>
        {adjusted && (
          <span className="flex items-center gap-1.5">
            <i className="w-5 h-0 border-t-[3px] border-dashed" style={{ borderColor: LEVEL_STYLE[adjusted].color }} /> With suggestion
          </span>
        )}
      </div>
    </div>
  );
}
