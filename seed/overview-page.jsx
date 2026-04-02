// Dashboard page displaying device online status statistics.
//
// This is the default overview page shown on the main dashboard.
// Customize the pie chart slices below to show different device groupings.

const FIVE_MINUTES = 5 * 60 * 1000;
const ONE_DAY = 24 * 60 * 60 * 1000;

// @ts-expect-error: top-level return (script is wrapped in a function at runtime)
return (
  <div class="flex justify-center mt-5 mb-10 gap-x-10">
    <pie-chart label="Online Status">
      <slice
        label="Online Now"
        color="#31a354"
        filter={`Events.Inform > NOW() - ${FIVE_MINUTES}`}
      />
      <slice
        label="Past 24 Hours"
        color="#a1d99b"
        filter={`Events.Inform > NOW() - ${FIVE_MINUTES} - ${ONE_DAY} AND Events.Inform < NOW() - ${FIVE_MINUTES}`}
      />
      <slice
        label="Others"
        color="#e5f5e0"
        filter={`Events.Inform < NOW() - ${FIVE_MINUTES} - ${ONE_DAY}`}
      />
    </pie-chart>
  </div>
);
