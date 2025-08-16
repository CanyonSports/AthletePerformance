
"use client";
import { Line } from "react-chartjs-2";
import { Chart as ChartJS, LineElement, PointElement, LinearScale, CategoryScale, Tooltip } from "chart.js";
ChartJS.register(LineElement, PointElement, LinearScale, CategoryScale, Tooltip);

export default function Sparkline({ data, labels }: { data: (number|null)[]; labels: string[] }){
  return (
    <div className="h-16 w-full">
      <Line
        data={{ labels, datasets: [{ label: "trend", data, tension: 0.35 }] }}
        options={{ responsive: true, plugins: { legend: { display: false } }, scales: { x: { display: false }, y: { display: false } }, elements: { point: { radius: 0 } } }}
      />
    </div>
  );
}
