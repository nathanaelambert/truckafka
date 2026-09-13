import { test, expect, type Page } from '@playwright/test';

const API_BASE = 'http://localhost:4000';

const NOW = Date.now();
const HOUR = 3600 * 1000;

const truckId = 'truck-1';
const driverId = 'driver-1';
const trailerId = 'trailer-1';
const loadId = 'load-1';
const loc1Id = 'loc-1';
const loc2Id = 'loc-2';
const eventId = 'event-1';
const eventId2 = 'event-2';

const mockTrucks = [{ id: truckId, number: '101', hub: 'Guelph', location_id: loc1Id, is_safe_to_drive: true, maxweight_kg: 50000, note: null }];
const mockTrailers = [{ id: trailerId, number: '201', hub: 'Guelph', location_id: loc1Id, is_safe_to_drive: true, maxweight_kg: 40000, note: null }];
const mockDrivers = [{ id: driverId, name: 'John Doe', email: 'john@truck.com', status: 'driving', cycle_id: 1, overtime: 0, day_start_hour: '06:00', remaining_drive_h: 8, remaining_on_duty_h: 11, remaining_cycle_h: 70, next_bed_time: null, home_location_id: loc1Id }];
const mockLoads = [{ id: loadId, number: 'L-001', weight: 25000, commodity: 'Widgets', pickup_location_id: loc1Id, dropoff_location_id: loc2Id, pickup_location_name: 'Warehouse', dropoff_location_name: 'Store', pickup_after: new Date(NOW - 24 * HOUR).toISOString(), pickup_before: new Date(NOW - 20 * HOUR).toISOString(), dropoff_after: new Date(NOW - 18 * HOUR).toISOString(), dropoff_before: new Date(NOW - 14 * HOUR).toISOString(), is_hazmat: false, rate_km: 2.5 }];
const mockHauls: any[] = [];
const mockLocations = [
  { id: loc1Id, name: 'Warehouse', address: '123 Main St', position: { lat: 43.5183, lng: -80.55 }, geofence_boundary: [{ lat: 43.52, lng: -80.56 }, { lat: 43.52, lng: -80.54 }, { lat: 43.51, lng: -80.54 }, { lat: 43.51, lng: -80.56 }] },
  { id: loc2Id, name: 'Store', address: '456 Oak Ave', position: { lat: 43.55, lng: -80.50 }, geofence_boundary: [{ lat: 43.56, lng: -80.51 }, { lat: 43.56, lng: -80.49 }, { lat: 43.54, lng: -80.49 }, { lat: 43.54, lng: -80.51 }] },
];

const mockEvents = [
  {
    id: eventId, type: 'haul',
    start_time: new Date(NOW - 20 * HOUR).toISOString(),
    end_time: new Date(NOW - 16 * HOUR).toISOString(),
    truck_id: truckId, load_id: loadId, trailer_id: trailerId, driver_id: driverId,
    start_location_id: loc1Id, end_location_id: loc2Id,
    start_location_name: 'Warehouse', end_location_name: 'Store',
    motion_id: 'motion-1', distance_m: 15000,
  },
  {
    id: eventId2, type: 'loading',
    start_time: new Date(NOW - 22 * HOUR).toISOString(),
    end_time: new Date(NOW - 21 * HOUR).toISOString(),
    truck_id: truckId, load_id: loadId, trailer_id: trailerId, driver_id: driverId,
    start_location_id: loc1Id, end_location_id: loc1Id,
    start_location_name: 'Warehouse', end_location_name: 'Warehouse',
    motion_id: null, distance_m: null,
  },
];

const mockSnapshot = {
  events: [
    { id: eventId, type: 'haul', lat: 43.53, lng: -80.52, has_motion: true, start_location_id: loc1Id, truck_id: truckId, load_id: loadId, trailer_id: trailerId, driver_id: driverId },
    { id: eventId2, type: 'loading', lat: 0, lng: 0, has_motion: false, start_location_id: loc1Id, truck_id: truckId, load_id: loadId, trailer_id: trailerId, driver_id: driverId },
  ],
};

async function setupMocks(page: Page) {
  await page.route(`${API_BASE}/api/login`, (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ token: 'fake-token', user: { id: 'u1', user_name: 'admin', name: 'Admin', role: 'admin' } }),
    });
  });
  await page.route(`${API_BASE}/api/trucks`, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mockTrucks) }));
  await page.route(`${API_BASE}/api/trailers`, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mockTrailers) }));
  await page.route(`${API_BASE}/api/drivers`, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mockDrivers) }));
  await page.route(`${API_BASE}/api/loads`, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mockLoads) }));
  await page.route(`${API_BASE}/api/hauls*`, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mockHauls) }));
  await page.route(`${API_BASE}/api/locations`, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mockLocations) }));
  await page.route(`${API_BASE}/api/fleet/summary`, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ total_trucks: 1, total_drivers: 1, total_loads: 1, total_hauls: 0 }) }));
  await page.route(`${API_BASE}/api/events?*`, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ events: mockEvents }) }));
  await page.route(`${API_BASE}/api/events/snapshot?*`, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mockSnapshot) }));
  await page.route(`${API_BASE}/api/positions/*`, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) }));
}

async function login(page: Page) {
  await page.goto('http://localhost:3001');
  await page.fill('input[type="text"]', 'admin');
  await page.fill('input[type="password"]', 'admin123');
  await page.click('button[type="submit"]');
  await page.waitForSelector('.monitor-timeline', { timeout: 10000 });
}

async function showAllActors(page: Page) {
  // Expand each category and click "show all"
  const categories = ['Trucks', 'Locations', 'Trailers', 'Drivers', 'Loads'];
  for (const cat of categories) {
    const header = page.locator(`.collapsible-header`).filter({ hasText: cat });
    await header.first().click();
    await page.waitForTimeout(100);
    const showAllBtn = page.locator('button').filter({ hasText: 'show all' });
    if (await showAllBtn.count() > 0) {
      await showAllBtn.first().click();
      await page.waitForTimeout(100);
    }
  }
}

async function pauseAndGoToPast(page: Page) {
  // Click pause button (first button in timeline-bar after the filter section)
  const pauseBtn = page.locator('.timeline-bar button').first();
  await pauseBtn.click();
  await page.waitForTimeout(200);
  // Click on timeline scroll area to move playhead to past time (sets isLiveTime=false)
  const scrollArea = page.locator('.monitor-timeline > div').nth(2);
  const box = await scrollArea.boundingBox();
  if (box) {
    await page.mouse.click(box.x + box.width * 0.33, box.y + box.height * 0.5);
  }
  await page.waitForTimeout(1000);
}

test.describe('Event Selection', () => {
  test.beforeEach(async ({ page }) => {
    await setupMocks(page);
    await login(page);
  });

  test('shows "no event selected" initially', async ({ page }) => {
    await expect(page.locator('text=no event selected')).toBeVisible();
  });

  test('selecting an event from timeline shows it in panel', async ({ page }) => {
    await showAllActors(page);
    await pauseAndGoToPast(page);
    // Wait for timeline events to render
    await page.waitForTimeout(500);
    // Click an event bar in the timeline
    const eventBars = page.locator('.monitor-timeline > div').nth(2).locator('div[style*="cursor: pointer"]');
    const count = await eventBars.count();
    expect(count).toBeGreaterThan(0);
    await eventBars.first().click();
    await page.waitForTimeout(500);
    // Panel should show event type (not "no event selected")
    await expect(page.locator('text=no event selected')).not.toBeVisible();
    // Should show the event type in the selected event panel
    await expect(page.locator('.control-section h3').filter({ hasText: /haul|loading|unloading|bobtail|deadmile|attach/i })).toBeVisible();
  });

  test('clicking same event again deselects it', async ({ page }) => {
    await showAllActors(page);
    await pauseAndGoToPast(page);
    await page.waitForTimeout(500);
    const eventBars = page.locator('.monitor-timeline > div').nth(2).locator('div[style*="cursor: pointer"]');
    await eventBars.first().click();
    await page.waitForTimeout(300);
    await expect(page.locator('text=no event selected')).not.toBeVisible();
    // Click same event again
    await eventBars.first().click();
    await page.waitForTimeout(300);
    await expect(page.locator('text=no event selected')).toBeVisible();
  });

  test('selected event marker is highlighted on map', async ({ page }) => {
    await showAllActors(page);
    await pauseAndGoToPast(page);
    await page.waitForTimeout(1000);
    // Wait for event markers to appear
    const eventMarkers = page.locator('.event-marker');
    await expect(eventMarkers.first()).toBeVisible({ timeout: 5000 });
    // Click an event marker on the map (force to bypass child element interception)
    await eventMarkers.first().click({ force: true });
    await page.waitForTimeout(500);
    // The selected marker should have a thicker border via box-shadow outline
    const selectedMarker = page.locator('.event-marker-selected').first();
    await expect(selectedMarker).toBeVisible();
  });

  test('event selection works during playback', async ({ page }) => {
    await showAllActors(page);
    // Don't pause - keep playing
    // Click on timeline to go to past (sets isLiveTime=false)
    const scrollArea = page.locator('.monitor-timeline > div').nth(2);
    const box = await scrollArea.boundingBox();
    if (box) {
      await page.mouse.click(box.x + box.width * 0.33, box.y + box.height * 0.5);
    }
    await page.waitForTimeout(1000);
    // Click an event in the timeline
    const eventBars = page.locator('.monitor-timeline > div').nth(2).locator('div[style*="cursor: pointer"]');
    const count = await eventBars.count();
    expect(count).toBeGreaterThan(0);
    await eventBars.first().click();
    await page.waitForTimeout(500);
    // Should be selected (no "no event selected" text)
    await expect(page.locator('text=no event selected')).not.toBeVisible();
  });

  test('clicking empty map deselects event', async ({ page }) => {
    await showAllActors(page);
    await pauseAndGoToPast(page);
    await page.waitForTimeout(500);
    const eventBars = page.locator('.monitor-timeline > div').nth(2).locator('div[style*="cursor: pointer"]');
    await eventBars.first().click();
    await page.waitForTimeout(300);
    await expect(page.locator('text=no event selected')).not.toBeVisible();
    // Click on empty map area (bottom-left, away from markers and buttons)
    const map = page.locator('.leaflet-container');
    const box = await map.boundingBox();
    if (box) {
      await page.mouse.click(box.x + 50, box.y + box.height - 50);
    }
    await page.waitForTimeout(500);
    await expect(page.locator('text=no event selected')).toBeVisible();
  });
});
