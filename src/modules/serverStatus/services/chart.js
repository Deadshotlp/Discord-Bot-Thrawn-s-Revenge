export function buildPlayerHistoryChartUrl(dailyStats) {
  if (!Array.isArray(dailyStats) || dailyStats.length === 0) {
    return "";
  }

  const chartConfig = {
    type: "line",
    data: {
      labels: dailyStats.map((bucket) => bucket.label),
      datasets: [
        {
          label: "Peak Spieler",
          data: dailyStats.map((bucket) => bucket.peak),
          borderColor: "#e74c3c",
          fill: false
        },
        {
          label: "Durchschnitt",
          data: dailyStats.map((bucket) => bucket.average),
          borderColor: "#3498db",
          fill: false
        }
      ]
    },
    options: {
      title: {
        display: true,
        text: "Spieler der letzten 7 Tage"
      },
      scales: {
        yAxes: [
          {
            ticks: {
              beginAtZero: true
            }
          }
        ]
      }
    }
  };

  const encoded = encodeURIComponent(JSON.stringify(chartConfig));
  return `https://quickchart.io/chart?width=600&height=300&backgroundColor=white&c=${encoded}`;
}
