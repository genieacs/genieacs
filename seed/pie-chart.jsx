// Pie chart component that displays device counts by filter criteria.
//
// Attributes:
//   label - Chart title displayed above the pie chart
//
// Children:
//   <slice> elements with the following attributes:
//     label  - Slice label shown in the legend
//     color  - Fill color (e.g., "#31a354")
//     filter - Device filter expression for counting devices
//
// Example:
//   <pie-chart label="Status">
//     <slice label="Online" color="#31a354" filter="Events.Inform > NOW() - 300000" />
//     <slice label="Offline" color="#e5f5e0" filter="Events.Inform < NOW() - 300000" />
//   </pie-chart>

const getCoordinates = (percent) => {
  const angle = 2 * Math.PI * percent;
  const x = Math.cos(angle) * 100;
  const y = Math.sin(angle) * 100;
  return [x, y];
};

const slices = node.children
  .map((c) => c.get())
  .filter((c) => c.name === "slice")
  .map(({ attributes: { filter, label, color } }) => ({
    count: new Signal.State(0),
    filter,
    label,
    color,
  }));

const chart = new Signal.Computed(() => {
  let total = 0;
  let cumulative = 0;

  for (const slice of slices) total += slice.count.get();

  const renderSlice = (slice) => {
    const percent = (slice.count.get() || 0) / total;
    const [startX, startY] = getCoordinates(cumulative);
    cumulative += percent;
    const [endX, endY] = getCoordinates(cumulative);
    const largeArc = percent > 0.5 ? 1 : 0;
    const d = `
      M ${startX} ${startY}
      A 100 100 0 ${largeArc} 1 ${endX} ${endY}
      L 0 0
      Z
    `;

    const midAngle = cumulative - percent / 2;
    const percentageX = Math.cos(2 * Math.PI * midAngle) * 50;
    const percentageY = Math.sin(2 * Math.PI * midAngle) * 50;

    return (
      <>
        <path d={d} fill={slice.color} stroke="#fff" strokeWidth="1" />
        <a
          class="opacity-0 hover:opacity-100 focus-visible:opacity-100 outline-none"
          xlink:href={`#!/devices/?filter=${encodeURIComponent(slice.filter)}`}
          target="__blank"
        >
          <path class="stroke-cyan-500 stroke-1" d={d} fill-opacity="0" />
          <text
            class="opacity-40 font-medium fill-black"
            x={percentageX}
            y={percentageY}
            dominant-baseline="middle"
            text-anchor="middle"
          >
            {Math.round(percent * 100)}%
          </text>
        </a>
      </>
    );
  };

  return (
    <>
      <svg
        class="m-4"
        width="204px"
        height="204px"
        viewBox={"-102 -102 204 204"}
        xmlns="http://www.w3.org/2000/svg"
      >
        {slices.map(renderSlice)}
      </svg>
      <table class="table mt-8 text-sm">
        {slices.map((slice) => (
          <tr>
            <td>
              <span
                class="inline-block w-3 h-3 border border-stone-200 mr-1"
                style={{ "background-color": slice.color }}
              />
            </td>
            <td class="w-full">{slice.label}</td>
            <td class="text-stone-500 text-right tabular-nums">
              {Math.round((slice.count.get() * 100) / total) || 0}%
            </td>
            <td class="text-right tabular-nums">
              <a
                class="text-cyan-700 hover:text-cyan-900 font-medium ml-2"
                href={`#!/devices/?filter=${encodeURIComponent(slice.filter)}`}
              >
                {slice.count}
              </a>
            </td>
          </tr>
        ))}
        <tr>
          <td />
          <td colspan="2">Total</td>
          <td class="text-right tabular-nums">{total}</td>
        </tr>
      </table>
    </>
  );
});

// @ts-expect-error: top-level return (script is wrapped in a function at runtime)
return (
  <div class="p-4 bg-white shadow rounded-lg sm:p-6 sm:px-8">
    <h2 class="text-lg font-semibold text-stone-700 truncate mb-5 text-center">
      {node.attributes.label}
    </h2>
    {slices.map((s) => (
      <do-count arg={{ resource: "devices", filter: s.filter }} res={s.count} />
    ))}
    {chart}
  </div>
);
