mapboxgl.accessToken = 'pk.eyJ1IjoiZGptYW5zNjMwIiwiYSI6ImNtN2U1eWQ5eDBiOGsybnB2Nmt6MGtnejcifQ.vIQNH-qrlIFtigm5gDEalg';
import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';

// Initialize the map
const map = new mapboxgl.Map({
  container: 'map', // ID of the div where the map will render
  style: 'mapbox://styles/mapbox/streets-v12', // Map style
  center: [-71.09415, 42.36027], // [longitude, latitude]
  zoom: 12, // Initial zoom level
  minZoom: 5, // Minimum allowed zoom
  maxZoom: 18 // Maximum allowed zoom
});

function formatTime(minutes) {
  const date = new Date(0, 0, 0, 0, minutes);  // Set hours & minutes
  return date.toLocaleString('en-US', { timeStyle: 'short' }); // Format as HH:MM AM/PM
}

function computeStationTraffic(stations, trips) {
  // Compute departures: count trips by the starting station
  const departures = d3.rollup(
    trips,
    (v) => v.length,
    (d) => d.start_station_id
  );

  // Compute arrivals: count trips by the ending station
  const arrivals = d3.rollup(
    trips,
    (v) => v.length,
    (d) => d.end_station_id
  );

  // Update each station with arrivals, departures, and total traffic
  return stations.map((station) => {
    let id = station.short_name;
    station.departures = departures.get(id) ?? 0;
    station.arrivals = arrivals.get(id) ?? 0;
    station.totalTraffic = station.departures + station.arrivals;
    return station;
  });
}

function minutesSinceMidnight(date) {
  return date.getHours() * 60 + date.getMinutes();
}

function filterTripsbyTime(trips, timeFilter) {
  return timeFilter === -1 
    ? trips // If no filter is applied (-1), return all trips
    : trips.filter((trip) => {
        // Convert trip start and end times to minutes since midnight
        const startedMinutes = minutesSinceMidnight(trip.started_at);
        const endedMinutes = minutesSinceMidnight(trip.ended_at);
        
        // Include trips that started or ended within 60 minutes of the selected time
        return (
          Math.abs(startedMinutes - timeFilter) <= 60 ||
          Math.abs(endedMinutes - timeFilter) <= 60
        );
    });
}

map.on('load', async () => {
  const svg = d3.select('#map').select('svg');

  // Declare variables in the outer scope of map.on('load') so they are accessible later.
  let trips;
  let stations;
  let circles;
  let radiusScale;
  let stationFlow = d3.scaleQuantize().domain([0, 1]).range([0, 0.5, 1]);

  try {
    // Load trips data first and convert date strings to Date objects
    trips = await d3.csv(
      'https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv',
      (trip) => {
        trip.started_at = new Date(trip.started_at);
        trip.ended_at = new Date(trip.ended_at);
        return trip;
      }
    );
    console.log('Loaded CSV Data:', trips);

    // Now load station data
    const jsonurl = 'https://dsc106.com/labs/lab07/data/bluebikes-stations.json';
    const jsonData = await d3.json(jsonurl);
    console.log('Loaded JSON Data:', jsonData);

    // Compute station traffic using the loaded trips
    stations = computeStationTraffic(jsonData.data.stations, trips);
    console.log('Stations Array:', stations);

    map.addSource('boston_route', {
      type: 'geojson',
      data: 'https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson?...'
    });
    
    // Add Cambridge route source
    map.addSource('cambridge_route', {
      type: 'geojson',
      data: 'https://raw.githubusercontent.com/cambridgegis/cambridgegis_data/main/Recreation/Bike_Facilities/RECREATION_BikeFacilities.geojson'
    });
    
    // Add Boston bike lanes layer
    map.addLayer({
      id: 'bike-lanes-boston',
      type: 'line',
      source: 'boston_route',
      paint: {
        'line-color': '#32D400',
        'line-width': 5,
        'line-opacity': 0.6
      }
    });
    
    // Add Cambridge bike lanes layer
    map.addLayer({
      id: 'bike-lanes-cambridge',
      type: 'line',
      source: 'cambridge_route',
      paint: {
        'line-color': 'blue',
        'line-width': 5,
        'line-opacity': 0.6
      }
    });

    // Create a scale for circle radii based on total traffic
    radiusScale = d3.scaleSqrt()
      .domain([0, d3.max(stations, (d) => d.totalTraffic)])
      .range([0, 25]);

    // Create circles for the stations (using the computed stations)
    circles = svg.selectAll('circle')
      .data(stations, (d) => d.short_name)
      .enter()
      .append('circle')
      .attr('class', 'circle')
      .attr('r', d => radiusScale(d.totalTraffic))
      .attr('fill', 'steelblue')
      .attr('stroke', 'white')
      .attr('stroke-width', 1)
      .attr('opacity', 0.8)
      .each(function(d) {
        d3.select(this)
          .append('title')
          .text(`${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`);
      })
      .style("--departure-ratio", d => stationFlow(d.departures / d.totalTraffic));
      

    // Function to update circle positions when the map moves/zooms
    function updatePositions() {
      circles
        .attr('cx', d => {
          const point = new mapboxgl.LngLat(+d.lon, +d.lat);
          return map.project(point).x;
        })
        .attr('cy', d => {
          const point = new mapboxgl.LngLat(+d.lon, +d.lat);
          return map.project(point).y;
        });
    }

    // Update positions on map events
    updatePositions();
    map.on('move', updatePositions);
    map.on('zoom', updatePositions);
    map.on('resize', updatePositions);
    map.on('moveend', updatePositions);

  } catch (error) {
    console.error('Error loading data:', error);
  }

  const timeSlider = document.getElementById('timeFilter');
  const selectedTime = document.getElementById('selectedTime');
  const anyTimeLabel = document.getElementById('anyTime');

  function updateTimeDisplay() {
    let timeFilter = Number(timeSlider.value); // Get slider value

    if (timeFilter === -1) {
      selectedTime.textContent = ''; // Clear time display
      anyTimeLabel.style.display = 'block'; // Show "(any time)"
    } else {
      selectedTime.textContent = formatTime(timeFilter); // Display formatted time
      anyTimeLabel.style.display = 'none'; // Hide "(any time)"
    }
    
    // Call updateScatterPlot to reflect the changes on the map
    updateScatterPlot(timeFilter);
  }

  timeSlider.addEventListener('input', updateTimeDisplay);
  updateTimeDisplay();

  function updateScatterPlot(timeFilter) {
    // Get only the trips that match the selected time filter
    const filteredTrips = filterTripsbyTime(trips, timeFilter);
    
    // Recompute station traffic based on the filtered trips
    const filteredStations = computeStationTraffic(stations, filteredTrips);

    // Change the radiusScale range based on filtering
    radiusScale.range(timeFilter === -1 ? [0, 25] : [3, 50]);

    // Update the scatterplot by adjusting the radius of circles
    circles
      .data(filteredStations, (d) => d.short_name)
      .join('circle')
      .attr('r', (d) => radiusScale(d.totalTraffic))
      .style('--departure-ratio', (d) =>
        stationFlow(d.departures / d.totalTraffic),
      );
  }
});
